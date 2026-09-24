import { Injectable, Logger } from '@nestjs/common';
import { EPlanStatus } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import pLimit from 'p-limit';
import { CalendarService } from 'src/calendar/calendar.service';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { PrismaService } from 'src/prisma/prisma.service';
import { ITaskScheduleProps } from '../interfaces';
import { selectSchedulableLeavesInOrder } from '../leaf-select';
import { buildBusyIntervals, computeRuleSchedule } from '../rule-schedule';
import { buildActiveTaskEventWrite } from '../task-event.write';

dayjs.extend(utc);
dayjs.extend(timezone);

// Matches CalendarService's own write concurrency (calendar.service.ts,
// update.progress/helpers.ts) — Calendar effectively serializes writes per
// calendar, so higher fan-out buys little and trips per-user rate limits
// sooner (this is what caused the orphaned/duplicated-events bug).
const limit = pLimit(2);

// Shared across an entire batch of inserts so retries stay inside the
// frontend's CALENDAR_SCHEDULE_TIMEOUT_MS (120s) instead of each insert
// independently spending its own full retry budget.
const SCHEDULE_DEADLINE_MS = 60_000;

@Injectable()
export class CalendarScheduleService {
  private readonly logger = new Logger(CalendarScheduleService.name);

  // TODO: replace with a job queue (e.g. BullMQ) so the lock survives restarts
  // and works correctly across multiple backend instances.
  private readonly schedulingLocks = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendarService: CalendarService,
  ) {}

  async generateAndApplyTaskSchedule(props: ITaskScheduleProps) {
    // Guard against a second concurrent call (e.g. double-click, retry)
    // scheduling the same plan twice — each call creates real Google Calendar
    // events before persisting, so a race here would leave one attempt's
    // calendar events orphaned with no DB record.
    if (this.schedulingLocks.has(props.id)) {
      throw new AppException(
        AppErrorCode.SCHEDULING_IN_PROGRESS,
        'This plan is already being scheduled',
      );
    }
    this.schedulingLocks.add(props.id);
    try {
      return await this.doGenerateAndApplyTaskSchedule(props);
    } finally {
      this.schedulingLocks.delete(props.id);
    }
  }

  private async doGenerateAndApplyTaskSchedule({
    userId,
    id,
  }: ITaskScheduleProps) {
    // Reject if another plan is already SCHEDULED
    const otherScheduled = await this.prisma.plan.findFirst({
      where: {
        user_id: userId,
        status: EPlanStatus.SCHEDULED,
        id: { not: id },
      },
    });
    if (otherScheduled) {
      throw new AppException(
        AppErrorCode.ANOTHER_PLAN_SCHEDULED,
        'Another plan is already scheduled',
      );
    }

    const plan = await this.getLeafTasks(id);
    if (!plan)
      throw new AppException(AppErrorCode.PLAN_NOT_FOUND, 'Plan not found');

    const userState = await this.prisma.userState.findUnique({
      where: { user_id: userId },
    });
    if (!userState) throw new Error('UserState not found');

    // Self-healing: remove any calendar event tagged with this plan that has
    // no task_event row at all — leftovers from a prior attempt that failed
    // after inserting but before persisting (e.g. a rate-limit error on a
    // sibling insert). Without this, re-clicking Schedule piles a fresh set
    // of events on top instead of replacing the stranded ones. Best-effort:
    // a sweep failure must not block scheduling.
    await this.sweepOrphanedEvents(userId, id);

    const range = {
      timeMin: dayjs().toISOString(),
      timeMax: dayjs().add(1, 'month').toISOString(),
    };
    const calendarEvents = await getCalendarWithScope({
      client: this.calendarService,
      userId,
      range,
    });

    // plan.tasks is already in DFS tree order (sequence_order preserved) —
    // pack them back-to-back into the earliest legal slots.
    const busyIntervals = buildBusyIntervals(calendarEvents.results);
    const { placements } = computeRuleSchedule({
      tasks: plan.tasks.map((t) => ({
        id: t.id,
        estimated_minutes: t.estimated_minutes,
      })),
      busyIntervals,
      userState,
    });

    const leafById = new Map(plan.tasks.map((t) => [t.id, t]));
    const schedule: IScheduledLeaf[] = placements.map((p) => ({
      id: p.taskId,
      title: leafById.get(p.taskId)!.title,
      description: leafById.get(p.taskId)!.description,
      start: p.start,
      end: p.end,
    }));

    const { taskEvents } = await applySchedule({
      userId,
      planId: id,
      client: this.calendarService,
      timeZone: userState.time_zone,
      schedule,
      logger: this.logger,
    });

    // Reuse each task's most recent inactive TaskEvent row (left behind by a prior
    // pause) instead of inserting a new one, so pause→resume cycles don't accumulate
    // dead rows. First-time scheduling has no prior row → create. is_active:false
    // filter guarantees we never clobber a live event.
    const reusableRows = await this.prisma.taskEvent.findMany({
      where: {
        task_id: { in: taskEvents.map((e) => e.taskId) },
        is_active: false,
      },
      orderBy: { created_at: 'desc' },
    });
    const reuseIdByTask = new Map<string, string>();
    for (const row of reusableRows) {
      if (!reuseIdByTask.has(row.task_id))
        reuseIdByTask.set(row.task_id, row.id);
    }

    // Persist TaskEvents + update plan status in a transaction
    try {
      await this.prisma.$transaction([
        ...taskEvents.flatMap(({ taskId, googleEventId, start, end }) =>
          buildActiveTaskEventWrite(this.prisma, {
            taskId,
            googleEventId,
            start,
            end,
            reuseRowId: reuseIdByTask.get(taskId),
          }),
        ),
        this.prisma.plan.update({
          where: { id },
          data: { status: EPlanStatus.SCHEDULED },
        }),
      ]);
    } catch (err) {
      // The Calendar events above were already created via the Google API —
      // if persisting fails, remove them so they don't leak with no DB record.
      await rollbackEvents({
        calendarService: this.calendarService,
        userId,
        eventIds: taskEvents.map((e) => e.googleEventId),
        logger: this.logger,
        context: { planId: id, phase: 'persist' },
      });
      throw err;
    }

    const scheduledTaskIds = taskEvents.map((e) => e.taskId);
    const scheduledLeafIds = new Set(scheduledTaskIds);
    const unscheduledTaskIds = plan.tasks
      .filter((t) => !scheduledLeafIds.has(t.id))
      .map((t) => t.id);

    return { scheduledTaskIds, unscheduledTaskIds };
  }

  // An "orphan" is a Google Calendar event tagged with this plan's id that has
  // no matching task_event row — the signature left by an interrupted prior
  // scheduling attempt (see rollbackEvents / applySchedule). Compares against
  // ALL task_event rows regardless of is_active: some inactive rows are kept
  // deliberately as work-history records (see update.progress/helpers.ts) and
  // must survive the sweep; only events with no row at all are removed.
  private async sweepOrphanedEvents(userId: string, planId: string) {
    try {
      const client = await this.calendarService.getClient(userId);
      const { data } = await client.events.list({
        calendarId: 'primary',
        privateExtendedProperty: [`plan_id=${planId}`],
      });

      const knownEventIds = new Set(
        (
          await this.prisma.taskEvent.findMany({
            where: { task: { plan_id: planId } },
            select: { google_event_id: true },
          })
        ).map((e) => e.google_event_id),
      );

      const orphanIds = (data.items ?? [])
        .map((e) => e.id)
        .filter(
          (eventId): eventId is string =>
            !!eventId && !knownEventIds.has(eventId),
        );
      if (orphanIds.length === 0) return;

      this.logger.warn(
        `Sweeping ${orphanIds.length} orphaned calendar event(s) for plan ${planId} with no task_event record`,
      );
      await rollbackEvents({
        calendarService: this.calendarService,
        userId,
        eventIds: orphanIds,
        logger: this.logger,
        context: { planId, phase: 'sweep' },
      });
    } catch (err) {
      this.logger.warn(
        `Orphan sweep failed for plan ${planId}; continuing with schedule`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async getLeafTasks(planId: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      include: {
        tasks: {
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            estimated_minutes: true,
            sequence_order: true,
            depth: true,
            parent_task_id: true,
          },
        },
      },
    });
    if (!plan) return null;

    // Schedulable leaves (not DONE/HOLD) in DFS tree order — shared with the
    // reschedule path so the two can't silently drift on "what needs a slot"
    // (this matters most on resume, where pause already cleared incomplete
    // leaves' events: an IN_PROGRESS leaf must be re-scheduled too, not just
    // PENDING ones).
    const leaves = selectSchedulableLeavesInOrder(plan.tasks);

    return { id: plan.id, title: plan.title, tasks: leaves };
  }

  async getCurrentSchedule({ userId }: { userId: string }) {
    const plan = await this.prisma.plan.findFirst({
      where: {
        user_id: userId,
        status: EPlanStatus.SCHEDULED,
        is_paused: false,
      },
      include: {
        tasks: {
          include: { events: { where: { is_active: true } } },
          orderBy: [{ depth: 'asc' }, { sequence_order: 'asc' }],
        },
      },
    });
    if (!plan) return { plan: null };

    const { tasks, ...rest } = plan;
    const byParent = new Map<string | null, (typeof tasks)[number][]>();
    for (const t of tasks) {
      const key = t.parent_task_id;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(t);
    }
    const build = (parentId: string | null): unknown[] =>
      (byParent.get(parentId) ?? [])
        .sort((a, b) => a.sequence_order - b.sequence_order)
        .map((t) => ({
          ...t,
          description: t.description ?? '',
          children: build(t.id),
        }));

    return {
      plan: {
        ...rest,
        source_type: rest.source_type ?? 'GENERATE',
        tasks: build(null),
      },
    };
  }
}

// ─── Calendar fetch ───────────────────────────────────────────────────────────

const getCalendarWithScope = async ({
  client,
  ...restProps
}: IGetCalendarProps) => {
  const { results } = await client.getCalendarRange(restProps);
  const formatedData = results.map(
    ({ extendedProperties, summary, start, end, description }) => ({
      extendedProperties,
      summary,
      start,
      end,
      description,
    }),
  );
  return { results: formatedData, count: formatedData.length };
};
type IGetCalendarProps = Parameters<CalendarService['getCalendarRange']>[0] & {
  client: CalendarService;
};

// ─── Rollback ──────────────────────────────────────────────────────────────────

// Best-effort delete of events already created via the Google API when a
// later step fails. Swallows its own failure: the caller is already
// unwinding a real error, and that's what the user needs to see — a cleanup
// failure here must not mask it. Logs loudly, since these ids are the
// residual leak surface if the delete itself fails.
export const rollbackEvents = async ({
  calendarService,
  userId,
  eventIds,
  logger,
  context,
}: {
  calendarService: CalendarService;
  userId: string;
  eventIds: string[];
  logger: Logger;
  context: Record<string, unknown>;
}): Promise<void> => {
  if (eventIds.length === 0) return;
  try {
    const client = await calendarService.getClient(userId);
    await calendarService.removeEvents({
      client,
      calendarId: 'primary',
      events: eventIds,
    });
  } catch (cleanupErr) {
    logger.error(
      `Calendar rollback failed; events are orphaned with no DB record: ${JSON.stringify(
        { ...context, orphanedEventIds: eventIds },
      )}`,
      cleanupErr instanceof Error ? cleanupErr.stack : String(cleanupErr),
    );
  }
};

// ─── Apply schedule ────────────────────────────────────────────────────────────

interface IScheduledLeaf {
  id: string;
  title: string;
  description: string | null;
  start: string;
  end: string;
}

export const applySchedule = async ({
  userId,
  planId,
  client,
  timeZone,
  schedule,
  logger,
}: IScheduleEventToCalendar) => {
  const deadlineAt = Date.now() + SCHEDULE_DEADLINE_MS;

  // allSettled, not all: Promise.all rejects the moment one insert fails
  // while its siblings are STILL IN FLIGHT. Those siblings go on to create
  // real events after we've already unwound — a catch here can't clean up
  // events that don't exist yet. allSettled guarantees every insert has
  // settled before we decide anything, so the fulfilled set is complete and
  // fully deletable.
  const results = await Promise.allSettled(
    schedule.map((record) =>
      limit(() =>
        insertCalendarEvent({
          userId,
          planId,
          client,
          timeZone,
          event: record,
          deadlineAt,
        }),
      ),
    ),
  );

  const taskEvents: Array<{
    taskId: string;
    googleEventId: string;
    start: string;
    end: string;
  }> = [];
  const failures: unknown[] = [];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      taskEvents.push({
        taskId: schedule[i].id,
        googleEventId: result.value,
        start: schedule[i].start,
        end: schedule[i].end,
      });
    } else {
      failures.push(result.reason);
    }
  });

  if (failures.length > 0) {
    await rollbackEvents({
      calendarService: client,
      userId,
      eventIds: taskEvents.map((e) => e.googleEventId),
      logger,
      context: { planId, phase: 'insert' },
    });
    throw failures[0];
  }

  return { taskEvents };
};

interface IScheduleEventToCalendar {
  planId: string;
  userId: string;
  timeZone: string;
  client: CalendarService;
  schedule: IScheduledLeaf[];
  logger: Logger;
}

const insertCalendarEvent = async ({
  userId,
  planId,
  client,
  timeZone,
  event,
  deadlineAt,
}: IInsertCalendarEvent): Promise<string> => {
  const privateProperties = { plan_id: planId, task_id: event.id };

  const createdCalendarEvent = await client.insertEvent({
    userId,
    request: {
      params: {
        calendarId: 'primary',
        requestBody: {
          summary: event.title,
          description: event.description ?? undefined,
          start: { dateTime: event.start, timeZone },
          end: { dateTime: event.end, timeZone },
          extendedProperties: { private: privateProperties },
        },
      },
    },
    deadlineAt,
  });

  if (!createdCalendarEvent.id)
    throw new Error('Google Calendar did not return event id');
  return createdCalendarEvent.id;
};

interface IInsertCalendarEvent
  extends Pick<
    IScheduleEventToCalendar,
    'userId' | 'planId' | 'client' | 'timeZone'
  > {
  event: IScheduledLeaf;
  deadlineAt?: number;
}
