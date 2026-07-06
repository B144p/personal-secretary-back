import { Injectable, Logger } from '@nestjs/common';
import { EPlanStatus } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { CalendarService } from 'src/calendar/calendar.service';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { PrismaService } from 'src/prisma/prisma.service';
import { CalendarScheduleService } from '../calendar.schedule';
import {
  allNonHeldLeavesDone,
  classifyLeaves,
  findHeldLeavesWithFutureEvents,
  getLeafIds,
} from './classify';
import {
  applyDoneMarkers,
  applyRuleReschedule,
  applyStatusChanges,
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendarService: CalendarService,
    private readonly calendarScheduleService: CalendarScheduleService,
  ) {}

  async getCurrentSchedule({ userId }: IGetCurrentScheduleProps) {
    return this.calendarScheduleService.getCurrentSchedule({ userId });
  }

  async updateProgress({ userId, data }: IUpdateProgressProps) {
    const { statusChanges = [], contextText } = data;
    const deps = {
      prisma: this.prisma,
      calendarService: this.calendarService,
      logger: this.logger,
    };

    if (statusChanges.length === 0 && !contextText) {
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

    const userState = await this.prisma.userState.findUnique({
      where: { user_id: userId },
    });
    if (!userState) throw new Error('UserState not found');

    // 1. Reconcile calendar: absorb any manual moves of our events (best-effort —
    // a calendar hiccup must not block saving the user's status changes)
    await reconcileCalendar(userId, plan, deps);

    // 2. Apply status changes
    await applyStatusChanges(plan.id, statusChanges, deps);

    // 3. Persist DailyFeedback
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

    // 4a. Held leaves are deprioritized: drop their future calendar event (if
    // any) and exclude them from scheduling below. Past events are left
    // untouched as a historical record. Best-effort — must run even if this
    // request has no other reschedule-worthy change.
    const heldLeavesWithFutureEvents = findHeldLeavesWithFutureEvents(
      allTasks,
      leafIds,
      now,
    );
    await cleanupHeldLeaves(userId, heldLeavesWithFutureEvents, deps);

    // 5. Check if all non-held leaves are DONE → mark plan DONE. Held leaves
    // are skipped for completion purposes; an all-held plan stays stalled
    // rather than auto-completing.
    if (allNonHeldLeavesDone(allTasks, leafIds)) {
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

    // 6. Classify what changed: slipped / completed-early / completed-late
    // leaves, plus the full set of remaining leaves that still need a slot.
    const { slippedLeaves, completedEarly, completedLate, remainingLeaves } =
      classifyLeaves({ allTasks, leafIds, statusChanges, now });

    if (
      slippedLeaves.length === 0 &&
      completedEarly.length === 0 &&
      completedLate.length === 0 &&
      heldLeavesWithFutureEvents.length === 0
    ) {
      return {
        rescheduled: 0,
        planStatus: EPlanStatus.SCHEDULED,
        unscheduledTaskIds: [],
      };
    }

    // 7-8. Re-schedule slipped + remaining unscheduled leaves. Triggering
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

    // 9. Record a marker event for tasks finished ahead of schedule. The
    // original scheduled event is left untouched; best-effort like above.
    await applyDoneMarkers(userId, plan.id, completedEarly, userState, deps);

    return {
      rescheduled: rescheduledCount,
      planStatus: EPlanStatus.SCHEDULED,
      unscheduledTaskIds,
      ...(rescheduleFailed ? { rescheduleFailed: true } : {}),
    };
  }
}
