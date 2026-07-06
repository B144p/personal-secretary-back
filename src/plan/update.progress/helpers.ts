import { Logger } from '@nestjs/common';
import { ETaskStatus, Prisma, UserState } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import pLimit from 'p-limit';
import { CalendarService } from 'src/calendar/calendar.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { withRetry } from 'src/utils';
import { computeRuleSchedule } from '../rule-schedule';
import { buildActiveTaskEventWrite } from '../task-event.write';
import { computeParentStatusRollup, orderLeavesByTree } from './classify';
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

// Step 4b. Roll parent statuses up: any parent whose non-held children are
// all DONE becomes DONE too, cascading up multiple levels. Best-effort —
// a rollup failure must not turn the already-committed status changes into
// a 500 for the caller.
export const applyParentStatusRollup = async (
  planId: string,
  allTasks: LeafTask[],
  explicitlyChangedIds: Set<string>,
  { prisma, logger }: Pick<StepDeps, 'prisma' | 'logger'>,
): Promise<void> => {
  const promotedIds = computeParentStatusRollup(allTasks, explicitlyChangedIds);
  if (promotedIds.length === 0) return;
  try {
    await prisma.task.updateMany({
      where: { id: { in: promotedIds }, plan_id: planId },
      data: { status: ETaskStatus.DONE },
    });
  } catch (err) {
    logger.warn(
      'Failed to roll parent task status up to DONE',
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

    const busyIntervals = calendarEvents.results
      .filter((e) => !!e.start?.dateTime && !!e.end?.dateTime)
      .map((e) => ({
        start: dayjs(e.start!.dateTime),
        end: dayjs(e.end!.dateTime),
      }));

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
            await withRetry(async () => {
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
          const googleEventId = await withRetry(() =>
            limit(() =>
              insertCalendarEvent({
                userId,
                planId,
                client: calendarService,
                timeZone: userState.time_zone,
                event: item,
              }),
            ),
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

// Step 9. Record a marker event for tasks finished ahead of schedule. The
// original scheduled event is left untouched; best-effort like above.
export const applyDoneMarkers = async (
  userId: string,
  planId: string,
  completedEarly: LeafTask[],
  userState: UserState,
  { calendarService, logger }: Pick<StepDeps, 'calendarService' | 'logger'>,
): Promise<void> => {
  if (completedEarly.length === 0) return;
  try {
    await createDoneMarkerEvents({
      userId,
      planId,
      tasks: completedEarly,
      userState,
      calendarService,
    });
  } catch (err) {
    logger.error(
      'Failed to create done-marker calendar events',
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

// Records work finished ahead of schedule as a marker event, stacked after
// working hours on the day it was actually completed. The originally
// scheduled event for the task is left untouched.
const createDoneMarkerEvents = async ({
  userId,
  planId,
  tasks,
  userState,
  calendarService,
}: {
  userId: string;
  planId: string;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    estimated_minutes: number | null;
  }>;
  userState: UserState;
  calendarService: CalendarService;
}) => {
  const [endHour, endMinute] = userState.working_hours_end
    .split(':')
    .map(Number);
  let cursor = dayjs()
    .tz(userState.time_zone)
    .hour(endHour)
    .minute(endMinute)
    .second(0)
    .millisecond(0);

  for (const task of tasks) {
    const durationMinutes = task.estimated_minutes ?? 30;
    const start = cursor;
    const end = cursor.add(durationMinutes, 'minute');

    await withRetry(() =>
      limit(() =>
        calendarService.insertEvent({
          userId,
          request: {
            params: {
              calendarId: 'primary',
              requestBody: {
                summary: task.title,
                description: task.description ?? undefined,
                start: {
                  dateTime: start.format(),
                  timeZone: userState.time_zone,
                },
                end: { dateTime: end.format(), timeZone: userState.time_zone },
                extendedProperties: {
                  private: {
                    plan_id: planId,
                    task_id: task.id,
                    done_marker: 'true',
                  },
                },
              },
            },
          },
        }),
      ),
    );

    cursor = end;
  }
};
