import { Injectable, Logger } from '@nestjs/common';
import { EPlanStatus } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { CalendarService } from 'src/calendar/calendar.service';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { PrismaService } from 'src/prisma/prisma.service';
import { CalendarScheduleService } from '../calendar.schedule';
import { getLeafIds } from '../leaf-select';
import {
  allNonHeldLeavesDone,
  classifyLeaves,
  findHeldLeavesWithFutureEvents,
} from './classify';
import { resolveFeedbackDay } from './feedback-day';
import {
  applyEarlyMarkers,
  applyParentStatusRollup,
  applyRuleReschedule,
  applyStatusChanges,
  cleanupCompletedEarly,
  cleanupHeldLeaves,
  persistDailyFeedback,
  reconcileCalendar,
} from './helpers';
import type {
  IGetCurrentScheduleProps,
  IUpdateProgressProps,
} from './interface';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class UpdateProgressService {
  private readonly logger = new Logger(UpdateProgressService.name);

  // TODO: replace with a job queue (e.g. BullMQ) so the lock survives restarts
  // and works correctly across multiple backend instances.
  private readonly progressLocks = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendarService: CalendarService,
    private readonly calendarScheduleService: CalendarScheduleService,
  ) {}

  async getCurrentSchedule({ userId }: IGetCurrentScheduleProps) {
    return this.calendarScheduleService.getCurrentSchedule({ userId });
  }

  async updateProgress(props: IUpdateProgressProps) {
    return this.withProgressLock(props.userId, () =>
      this.doUpdateProgress(props, 'feedback'),
    );
  }

  // Moves slipped and remaining steps of the scheduled plan to the next free
  // slots without any status change (an agent, or "I fell behind"). Same
  // pipeline and lock as a feedback update; a feedback row is saved only
  // when a note is given.
  async reschedule({ userId, note }: { userId: string; note?: string }) {
    return this.withProgressLock(userId, () =>
      this.doUpdateProgress(
        { userId, data: { statusChanges: [], contextText: note } },
        'reschedule',
      ),
    );
  }

  private async withProgressLock<T>(userId: string, run: () => Promise<T>) {
    // Guard against a second concurrent call (e.g. double-click, retry) for
    // the same user — each call can create real Google Calendar events
    // before persisting, so a race here would leave one attempt's events
    // orphaned with no DB record, or duplicated outright.
    if (this.progressLocks.has(userId)) {
      throw new AppException(
        AppErrorCode.PROGRESS_UPDATE_IN_PROGRESS,
        'A progress update is already in flight for this plan',
      );
    }
    this.progressLocks.add(userId);
    try {
      return await run();
    } finally {
      this.progressLocks.delete(userId);
    }
  }

  private async doUpdateProgress(
    { userId, data }: IUpdateProgressProps,
    mode: 'feedback' | 'reschedule',
  ) {
    const { statusChanges = [], contextText } = data;
    const deps = {
      prisma: this.prisma,
      calendarService: this.calendarService,
      logger: this.logger,
    };

    if (mode === 'feedback' && statusChanges.length === 0 && !contextText) {
      throw new AppException(
        AppErrorCode.NO_OP_FEEDBACK,
        'No changes to submit',
      );
    }

    // Find the user's active SCHEDULED plan
    const plan = await this.prisma.plan.findFirst({
      where: { user_id: userId, status: EPlanStatus.SCHEDULED },
      include: {
        tasks: {
          include: { events: { where: { is_active: true } } },
        },
      },
    });
    if (!plan)
      throw new AppException(
        AppErrorCode.PLAN_NOT_FOUND,
        'No SCHEDULED plan found',
      );

    // Only leaves of this plan can change here. Checked before anything is
    // written, so a stray id (another plan, a parent task) changes nothing.
    const planLeafIds = getLeafIds(plan.tasks);
    const foreign = statusChanges.filter((c) => !planLeafIds.has(c.taskId));
    if (foreign.length) {
      throw new AppException(
        AppErrorCode.TASK_NOT_IN_PLAN,
        'Some tasks are not steps of the scheduled plan',
        { taskIds: foreign.map((c) => c.taskId), planId: plan.id },
      );
    }

    const userState = await this.prisma.userState.findUnique({
      where: { user_id: userId },
    });
    if (!userState) throw new Error('UserState not found');

    // 1. Reconcile calendar: absorb any manual moves of our events (best-effort —
    // a calendar hiccup must not block saving the user's status changes)
    await reconcileCalendar(userId, plan, deps);

    // 2. Apply status changes
    await applyStatusChanges(plan.id, statusChanges, deps);

    // 3. Persist DailyFeedback (a bare reschedule has nothing to record)
    if (mode === 'feedback' || contextText)
      await persistDailyFeedback(
        plan.id,
        statusChanges,
        contextText,
        userState,
        deps,
      );

    // 4. Re-fetch updated plan tasks
    const updatedPlan = await this.prisma.plan.findUnique({
      where: { id: plan.id },
      include: {
        tasks: {
          include: {
            events: { where: { is_active: true } },
          },
        },
      },
    });
    if (!updatedPlan) throw new Error('Plan disappeared');

    const allTasks = updatedPlan.tasks;
    const leafIds = getLeafIds(allTasks);
    const now = dayjs();
    // The working day this feedback pertains to — today, or yesterday when
    // submitted before today's working hours begin (e.g. an after-midnight
    // review). Anchors the "[<STATUS>] Early task" marker events below.
    const feedbackDay = resolveFeedbackDay(userState, now);

    // 4a. Held leaves are deprioritized: their future calendar event (if
    // any) gets dropped and they're excluded from scheduling below. Past
    // events are left untouched as a historical record. The drop itself
    // happens later (step 9), after early markers are recorded.
    const heldLeavesWithFutureEvents = findHeldLeavesWithFutureEvents(
      allTasks,
      leafIds,
      now,
    );

    // 4b. Re-derive each parent's status (DONE / IN_PROGRESS / HOLD /
    // PENDING) from its children, cascading up multiple levels. Best-effort.
    const changedTaskIds = new Set(statusChanges.map((sc) => sc.taskId));
    await applyParentStatusRollup(plan.id, allTasks, changedTaskIds, deps);

    // 5. Whether this update completes the plan: all non-held leaves DONE.
    // Held leaves are skipped for completion purposes; an all-held plan
    // stays stalled rather than auto-completing. Checked now but acted on
    // after classification/markers below, so a completing update still gets
    // its early-marker and stale-event cleanup instead of skipping them.
    const isCompleting = allNonHeldLeavesDone(allTasks, leafIds);

    // 6. Classify what changed: slipped / completed-early / completed-late /
    // early (DONE, IN_PROGRESS or HOLD ahead of schedule) leaves, plus the
    // full set of remaining leaves that still need a slot.
    const {
      slippedLeaves,
      completedEarly,
      completedLate,
      remainingLeaves,
      earlyLeaves,
    } = classifyLeaves({ allTasks, leafIds, statusChanges, now });

    // TODO: completedEarly.length === 0 is redundant here — completedEarly
    // is always a subset of earlyLeaves (DONE is one of its three
    // statuses), so earlyLeaves.length === 0 already implies it. Safe to
    // drop; kept for now to avoid touching this gate mid-branch.
    // A reschedule also books remaining steps that have no slot at all,
    // e.g. ones an earlier repack listed in unscheduledTaskIds.
    const unbookedLeaves =
      mode === 'reschedule'
        ? remainingLeaves.filter((t) => t.events.length === 0)
        : [];
    if (
      !isCompleting &&
      slippedLeaves.length === 0 &&
      completedEarly.length === 0 &&
      completedLate.length === 0 &&
      heldLeavesWithFutureEvents.length === 0 &&
      earlyLeaves.length === 0 &&
      unbookedLeaves.length === 0
    ) {
      return {
        rescheduled: 0,
        planStatus: EPlanStatus.SCHEDULED,
        unscheduledTaskIds: [],
      };
    }

    // 8. Record one marker event per status for leaves changed ahead of
    // schedule (e.g. "[DONE] Early task" listing the tasks), plus a
    // task_event row per early task pointing at its marker. Runs before the
    // cleanup/reschedule steps below so every early task's marker row exists
    // before its original event is deleted (DONE/HOLD) or replaced
    // (IN_PROGRESS). Best-effort.
    await applyEarlyMarkers(
      userId,
      plan.id,
      earlyLeaves,
      userState,
      feedbackDay,
      deps,
    );

    // 9. Held leaves are deprioritized: drop their future calendar event (if
    // any) now that its marker row (if early) has been recorded above. Past
    // events are left untouched as a historical record. Best-effort — must
    // run even if this request has no other reschedule-worthy change.
    await cleanupHeldLeaves(userId, heldLeavesWithFutureEvents, deps);

    if (isCompleting) {
      // Early-completed (DONE) tasks have no other flow that removes their
      // now-stale original event — HOLD-early was just handled by
      // cleanupHeldLeaves above. Best-effort like the other cleanup steps.
      await cleanupCompletedEarly(userId, completedEarly, deps);
      await this.prisma.plan.update({
        where: { id: plan.id },
        data: { status: EPlanStatus.DONE },
      });
      return {
        rescheduled: 0,
        planStatus: EPlanStatus.DONE,
        unscheduledTaskIds: [],
      };
    }

    // 10. Re-schedule slipped + remaining unscheduled leaves. Triggering
    // this on early completion (not just overdue) lets the scheduler —
    // which already packs tasks ASAP — pull the remaining plan forward.
    const { rescheduledCount, unscheduledTaskIds, rescheduleFailed } =
      await applyRuleReschedule(
        {
          userId,
          planId: plan.id,
          userState,
          allTasks,
          remainingLeaves,
          slippedLeaves,
        },
        deps,
      );

    // 11. Early-completed (DONE) tasks have no other flow that removes their
    // now-stale original event — HOLD-early is handled by cleanupHeldLeaves
    // above, IN_PROGRESS-early is re-slotted by applyRuleReschedule above.
    // Best-effort like the other cleanup steps.
    await cleanupCompletedEarly(userId, completedEarly, deps);

    return {
      rescheduled: rescheduledCount,
      planStatus: EPlanStatus.SCHEDULED,
      unscheduledTaskIds,
      ...(rescheduleFailed ? { rescheduleFailed: true } : {}),
    };
  }
}
