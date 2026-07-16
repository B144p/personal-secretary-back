import { Logger } from '@nestjs/common';
import { ETaskStatus, Prisma, UserState } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import pLimit from 'p-limit';
import { CalendarService } from 'src/calendar/calendar.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { orderLeavesByTree } from '../leaf-select';
import { buildBusyIntervals, computeRuleSchedule } from '../rule-schedule';
import { buildActiveTaskEventWrite } from '../task-event.write';
import { computeParentStatusRollup } from './classify';
import { buildEarlyMarkerGroups, type IEarlyMarkerTask } from './early-marker';
import type { IStatusChange, LeafTask, PlanWithTasks } from './interface';

dayjs.extend(utc);
dayjs.extend(timezone);

const limit = pLimit(2);

interface StepDeps {
  prisma: PrismaService;
  calendarService: CalendarService;
  logger: Logger;
}

// Step 1. Reconcile calendar: absorb any manual moves of our events (best-effort —
// a calendar hiccup must not block saving the user's status changes)
export const reconcileCalendar = async (
  userId: string,
  plan: PlanWithTasks,
  { prisma, calendarService, logger }: StepDeps,
): Promise<void> => {
  try {
    await reconcileCalendarMoves({ userId, plan, calendarService, prisma });
  } catch (err) {
    logger.error(
      'Failed to reconcile calendar moves',
      err instanceof Error ? err.stack : String(err),
    );
  }
};

// Step 2. Apply status changes
export const applyStatusChanges = async (
  planId: string,
  statusChanges: IStatusChange[],
  { prisma }: Pick<StepDeps, 'prisma'>,
): Promise<void> => {
  if (statusChanges.length === 0) return;
  await prisma.$transaction(
    statusChanges.map(({ taskId, newStatus }) =>
      prisma.task.update({
        where: { id: taskId, plan_id: planId },
        data: { status: newStatus as ETaskStatus },
      }),
    ),
  );
};

// Step 3. Persist DailyFeedback
export const persistDailyFeedback = async (
  planId: string,
  statusChanges: IStatusChange[],
  contextText: string | undefined,
  userState: UserState,
  { prisma }: Pick<StepDeps, 'prisma'>,
): Promise<void> => {
  await prisma.dailyFeedback.create({
    data: {
      plan_id: planId,
      date: dayjs().tz(userState.time_zone).startOf('day').toDate(),
      status_changes: statusChanges as unknown as Prisma.InputJsonValue,
      context_text: contextText,
    },
  });
};

// Step 4a. Held leaves are deprioritized: drop their future calendar event (if
// any) and exclude them from scheduling below. Past events are left
// untouched as a historical record. Best-effort — must run even if this
// request has no other reschedule-worthy change.
export const cleanupHeldLeaves = async (
  userId: string,
  heldLeaves: LeafTask[],
  { prisma, calendarService, logger }: StepDeps,
): Promise<void> => {
  if (heldLeaves.length === 0) return;
  try {
    const calClient = await calendarService.getClient(userId);
    const eventIds = heldLeaves.flatMap((t) =>
      t.events.map((e) => e.google_event_id),
    );
    await calendarService.removeEvents({
      client: calClient,
      events: eventIds,
    });
    await prisma.taskEvent.updateMany({
      where: {
        task_id: { in: heldLeaves.map((t) => t.id) },
        is_active: true,
      },
      data: { is_active: false },
    });
  } catch (err) {
    logger.warn(
      'Failed to clean up calendar event(s) for held task(s)',
      err instanceof Error ? err.stack : String(err),
    );
  }
};

// Step 4b. Re-derive every parent's status (DONE / IN_PROGRESS / HOLD /
// PENDING) from its children, cascading up multiple levels — a parent's
// status always reflects its subtree. Best-effort — a rollup failure must
// not turn the already-committed status changes into a 500 for the caller.
export const applyParentStatusRollup = async (
  planId: string,
  allTasks: LeafTask[],
  explicitlyChangedIds: Set<string>,
  { prisma, logger }: Pick<StepDeps, 'prisma' | 'logger'>,
): Promise<void> => {
  const changes = computeParentStatusRollup(allTasks, explicitlyChangedIds);
  if (changes.length === 0) return;

  const idsByStatus = new Map<ETaskStatus, string[]>();
  for (const { id, status } of changes) {
    const ids = idsByStatus.get(status);
    if (ids) ids.push(id);
    else idsByStatus.set(status, [id]);
  }

  try {
    await prisma.$transaction(
      [...idsByStatus].map(([status, ids]) =>
        prisma.task.updateMany({
          where: { id: { in: ids }, plan_id: planId },
          data: { status },
        }),
      ),
    );
  } catch (err) {
    logger.warn(
      'Failed to roll parent task statuses up from children',
      err instanceof Error ? err.stack : String(err),
    );
  }
};

// Steps 7-8. Re-schedule slipped + remaining unscheduled leaves. Triggering
// this on early completion (not just overdue) lets the scheduler — which
// already packs tasks ASAP — pull the remaining plan forward.
export const applyRuleReschedule = async (
  {
    userId,
    planId,
    userState,
    allTasks,
    remainingLeaves,
    slippedLeaves,
  }: {
    userId: string;
    planId: string;
    userState: UserState;
    allTasks: LeafTask[];
    remainingLeaves: LeafTask[];
    slippedLeaves: LeafTask[];
  },
  { prisma, calendarService, logger }: StepDeps,
): Promise<{
  rescheduledCount: number;
  unscheduledTaskIds: string[];
  rescheduleFailed: boolean;
}> => {
  const taskMeta = new Map(
    remainingLeaves.map((t) => [
      t.id,
      {
        status: t.status,
        activeEvent: t.events[0] as (typeof t.events)[0] | undefined,
      },
    ]),
  );

  let rescheduledCount = 0;
  let unscheduledTaskIds: string[] = remainingLeaves.map((t) => t.id);
  let rescheduleFailed = false;

  // Slipped IN_PROGRESS tasks already represent real work done — keep
  // their past event as a record instead of deleting it; they still get
  // a fresh continuation block below like any other remaining leaf.
  const inProgressSlippedIds = new Set(
    slippedLeaves
      .filter((t) => t.status === ETaskStatus.IN_PROGRESS)
      .map((t) => t.id),
  );

  // Old Google event id(s) per task, captured before they get swapped out
  // below — used to delete the stale event once the task is rescheduled.
  const oldEventIdsByTask = new Map<string, string[]>(
    remainingLeaves
      .filter((t) => !inProgressSlippedIds.has(t.id))
      .map((t) => [t.id, t.events.map((e) => e.google_event_id)]),
  );

  // Best-effort: the status changes above are already committed, so a
  // calendar failure here must not turn into a 500 for the caller.
  try {
    const calendarEvents = await getCalendarRange({
      userId,
      planId,
      calendarService,
    });

    // Order remaining leaves by tree position (sequence_order within each
    // sibling group, depth-first) — this is the same order the AI used to
    // be told to "preserve", now used directly to pack the schedule.
    const orderedLeaves = orderLeavesByTree(allTasks, remainingLeaves);

    const busyIntervals = buildBusyIntervals(calendarEvents.results);

    const { placements, unschedulableTaskIds } = computeRuleSchedule({
      tasks: orderedLeaves.map((t) => ({
        id: t.id,
        estimated_minutes: t.estimated_minutes,
      })),
      busyIntervals,
      userState,
    });

    const leafById = new Map(orderedLeaves.map((t) => [t.id, t]));
    const newSchedule = placements.map((p) => {
      const leaf = leafById.get(p.taskId)!;
      return {
        taskId: p.taskId,
        title: leaf.title,
        description: leaf.description,
        start: p.start,
        end: p.end,
      };
    });

    // Apply new schedule: create Google events, update TaskEvents
    const rescheduled: string[] = [];
    const failedTaskIds: string[] = [...unschedulableTaskIds];
    const calClient = await calendarService.getClient(userId);

    for (const item of newSchedule) {
      const taskId = item.taskId;

      try {
        const meta = taskMeta.get(taskId);
        const isPendingWithEvent =
          meta?.status === ETaskStatus.PENDING && !!meta?.activeEvent;

        let patchedInPlace = false;
        if (isPendingWithEvent) {
          try {
            // PENDING task: no work history to preserve — shift the existing event in place.
            await calendarService.patchEvent({
              userId,
              eventId: meta.activeEvent!.google_event_id,
              requestBody: {
                summary: item.title ?? '',
                start: {
                  dateTime: item.start,
                  timeZone: userState.time_zone,
                },
                end: {
                  dateTime: item.end,
                  timeZone: userState.time_zone,
                },
              },
            });
            await prisma.$transaction(
              buildActiveTaskEventWrite(prisma, {
                taskId,
                googleEventId: meta.activeEvent!.google_event_id,
                start: item.start,
                end: item.end,
                reuseRowId: meta.activeEvent!.id,
              }),
            );
            patchedInPlace = true;
          } catch (err) {
            // Event likely manually deleted from Google Calendar — fall through to recreate it.
            logger.warn(
              `In-place patch failed for PENDING task ${taskId}; recreating event`,
              err instanceof Error ? err.stack : String(err),
            );
          }
        }

        if (!patchedInPlace) {
          // IN_PROGRESS (or no existing event, or PENDING fallback after failed patch):
          // insert a new Google event and deactivate the old task_event.
          // IN_PROGRESS slipped tasks keep their old calendar event as a work-history record.
          const googleEventId = await limit(() =>
            insertCalendarEvent({
              userId,
              planId,
              client: calendarService,
              timeZone: userState.time_zone,
              event: item,
            }),
          );

          await prisma.$transaction(
            buildActiveTaskEventWrite(prisma, {
              taskId,
              googleEventId,
              start: item.start,
              end: item.end,
              preserveHistory: true,
            }),
          );

          // Delete the stale Google event (best-effort; 404 on already-deleted is harmless).
          const oldEventIds = oldEventIdsByTask.get(taskId);
          if (oldEventIds && oldEventIds.length > 0) {
            try {
              await calendarService.removeEvents({
                client: calClient,
                events: oldEventIds,
              });
            } catch (err) {
              logger.warn(
                `Failed to delete stale calendar event(s) for task ${taskId}`,
                err instanceof Error ? err.stack : String(err),
              );
            }
          }
        }

        rescheduled.push(taskId);
      } catch {
        failedTaskIds.push(taskId);
      }
    }

    rescheduledCount = rescheduled.length;
    unscheduledTaskIds = failedTaskIds;
  } catch (err) {
    logger.error(
      'Failed to reschedule remaining tasks after status update',
      err instanceof Error ? err.stack : String(err),
    );
    rescheduleFailed = true;
  }

  return { rescheduledCount, unscheduledTaskIds, rescheduleFailed };
};

// Step 8b. Early-completed tasks (DONE, ahead of their scheduled event) have
// no other flow that cleans up their now-stale original event — HOLD-early
// leaves are handled by cleanupHeldLeaves, IN_PROGRESS-early leaves are
// re-slotted by applyRuleReschedule. Remove the original Google event and
// deactivate its TaskEvent so only the "Early task" marker remains.
// Best-effort — must not turn already-committed status changes into a 500.
export const cleanupCompletedEarly = async (
  userId: string,
  completedEarly: LeafTask[],
  { prisma, calendarService, logger }: StepDeps,
): Promise<void> => {
  if (completedEarly.length === 0) return;
  try {
    const calClient = await calendarService.getClient(userId);
    const eventIds = completedEarly.flatMap((t) =>
      t.events.map((e) => e.google_event_id),
    );
    await calendarService.removeEvents({
      client: calClient,
      events: eventIds,
    });
    await prisma.taskEvent.updateMany({
      where: {
        task_id: { in: completedEarly.map((t) => t.id) },
        is_active: true,
      },
      data: { is_active: false },
    });
  } catch (err) {
    logger.warn(
      'Failed to clean up calendar event(s) for early-completed task(s)',
      err instanceof Error ? err.stack : String(err),
    );
  }
};

// Step 9. Record one marker event per status for leaves changed ahead of
// their scheduled event (DONE / IN_PROGRESS / HOLD) — e.g. "[DONE] Early
// task" listing every task completed early in this submission. Best-effort.
export const applyEarlyMarkers = async (
  userId: string,
  planId: string,
  earlyLeaves: LeafTask[],
  userState: UserState,
  feedbackDay: dayjs.Dayjs,
  { prisma, calendarService, logger }: StepDeps,
): Promise<void> => {
  if (earlyLeaves.length === 0) return;
  try {
    await createEarlyMarkerEvents({
      userId,
      planId,
      tasks: earlyLeaves,
      userState,
      feedbackDay,
      prisma,
      calendarService,
    });
  } catch (err) {
    logger.error(
      'Failed to create early-marker calendar events',
      err instanceof Error ? err.stack : String(err),
    );
  }
};

// ─── Calendar helpers ───────────────────────────────────────────────────────

const reconcileCalendarMoves = async ({
  userId,
  plan,
  calendarService,
  prisma,
}: {
  userId: string;
  plan: {
    id: string;
    tasks: Array<{
      id: string;
      events: Array<{ id: string; google_event_id: string }>;
    }>;
  };
  calendarService: CalendarService;
  prisma: PrismaService;
}) => {
  const calClient = await calendarService.getClient(userId);
  const calEvents = await calClient.events.list({
    calendarId: 'primary',
    privateExtendedProperty: [`plan_id=${plan.id}`],
  });

  const calMap: Record<string, { start: string; end: string }> = {};
  for (const e of calEvents.data.items ?? []) {
    if (e.id)
      calMap[e.id] = {
        start: e.start?.dateTime ?? '',
        end: e.end?.dateTime ?? '',
      };
  }

  for (const task of plan.tasks) {
    for (const ev of task.events) {
      const cal = calMap[ev.google_event_id];
      // Skip all-day or otherwise non-timed events (empty dateTime) — they
      // would otherwise produce an Invalid Date and fail the DB update
      if (!cal || !cal.start || !cal.end) continue;
      await prisma.taskEvent.update({
        where: { id: ev.id },
        data: { start: new Date(cal.start), end: new Date(cal.end) },
      });
    }
  }
};

const getCalendarRange = async ({
  userId,
  planId,
  calendarService,
}: {
  userId: string;
  planId: string;
  calendarService: CalendarService;
}) => {
  const { results } = await calendarService.getCalendarRange({
    userId,
    range: {
      timeMin: dayjs().toISOString(),
      timeMax: dayjs().add(1, 'month').toISOString(),
    },
  });
  return {
    // Exclude this plan's own events from the busy-list so the packer can
    // freely repack the plan's remaining leaves into the earliest slots.
    results: results
      .filter(({ extendedProperties }) => {
        return extendedProperties?.private?.plan_id !== planId;
      })
      .map(({ extendedProperties, summary, start, end, description }) => ({
        extendedProperties,
        summary,
        start,
        end,
        description,
      })),
  };
};

const insertCalendarEvent = async ({
  userId,
  planId,
  client,
  timeZone,
  event,
}: {
  userId: string;
  planId: string;
  client: CalendarService;
  timeZone: string;
  event: {
    taskId?: string;
    title?: string;
    description?: string | null;
    start: string;
    end: string;
  };
}): Promise<string> => {
  const createdEvent = await client.insertEvent({
    userId,
    request: {
      params: {
        calendarId: 'primary',
        requestBody: {
          summary: event.title ?? '',
          description: event.description ?? undefined,
          start: { dateTime: event.start, timeZone },
          end: { dateTime: event.end, timeZone },
          extendedProperties: {
            private: { plan_id: planId, task_id: event.taskId ?? '' },
          },
        },
      },
    },
  });
  if (!createdEvent.id)
    throw new Error('Google Calendar did not return event id');
  return createdEvent.id;
};

// Records leaves changed ahead of their scheduled event as one marker event
// per status, stacked after working hours on the day the change happened.
// The tasks' own original events are handled elsewhere (cleanupHeldLeaves
// for HOLD, applyRuleReschedule for IN_PROGRESS, cleanupCompletedEarly for
// DONE) — this only ever adds the marker.
const EARLY_MARKER_MINUTES = 15;

const createEarlyMarkerEvents = async ({
  userId,
  planId,
  tasks,
  userState,
  feedbackDay,
  prisma,
  calendarService,
}: {
  userId: string;
  planId: string;
  tasks: IEarlyMarkerTask[];
  userState: UserState;
  feedbackDay: dayjs.Dayjs;
  prisma: PrismaService;
  calendarService: CalendarService;
}) => {
  const groups = buildEarlyMarkerGroups(tasks);

  const [endHour, endMinute] = userState.working_hours_end
    .split(':')
    .map(Number);
  let cursor = feedbackDay
    .hour(endHour)
    .minute(endMinute)
    .second(0)
    .millisecond(0);

  for (const group of groups) {
    const start = cursor;
    const end = cursor.add(EARLY_MARKER_MINUTES, 'minute');

    const markerEventId = await limit(async () => {
      const created = await calendarService.insertEvent({
        userId,
        request: {
          params: {
            calendarId: 'primary',
            requestBody: {
              summary: group.summary,
              description: group.description,
              start: {
                dateTime: start.format(),
                timeZone: userState.time_zone,
              },
              end: { dateTime: end.format(), timeZone: userState.time_zone },
              extendedProperties: {
                private: {
                  plan_id: planId,
                  early_marker: 'true',
                  status: group.status,
                },
              },
            },
          },
        },
      });
      if (!created.id)
        throw new Error('Google Calendar did not return event id');
      return created.id;
    });

    await prisma.taskEvent.createMany({
      data: group.taskIds.map((taskId) => ({
        task_id: taskId,
        google_event_id: markerEventId,
        start: start.toDate(),
        end: end.toDate(),
        is_active: false,
      })),
    });

    cursor = end;
  }
};
