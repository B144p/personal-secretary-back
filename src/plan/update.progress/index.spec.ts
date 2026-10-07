import { EPlanStatus, ETaskStatus, UserState } from '@prisma/client';
import { CalendarScheduleService } from '../calendar.schedule';
import { CalendarService } from '../../calendar/calendar.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppErrorCode } from '../../common/errors/app-exception';

// See apply-schedule.spec.ts for why p-limit needs this stub under ts-jest —
// calendar.service.ts (imported transitively via ./helpers/./index) pulls it
// in at module load time.
jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => (fn: () => Promise<unknown>) => fn(),
}));

jest.mock('./helpers', () => ({
  applyEarlyMarkers: jest.fn(),
  applyParentStatusRollup: jest.fn(),
  applyRuleReschedule: jest.fn().mockResolvedValue({
    rescheduledCount: 0,
    unscheduledTaskIds: [],
    rescheduleFailed: false,
  }),
  applyStatusChanges: jest.fn(),
  cleanupCompletedEarly: jest.fn(),
  cleanupHeldLeaves: jest.fn(),
  persistDailyFeedback: jest.fn(),
  reconcileCalendar: jest.fn(),
}));

import { UpdateProgressService } from './index';
import * as helpers from './helpers';

const future = new Date(Date.now() + 60 * 60 * 1000);

const userState = {
  user_id: 'u1',
  time_zone: 'UTC',
  working_hours_start: '09:00',
  working_hours_end: '17:00',
} as unknown as UserState;

// A single leaf just marked DONE, ahead of its scheduled event — the plan
// has no other non-held leaves, so this update completes the plan.
const completingTask = {
  id: 't1',
  parent_task_id: null,
  status: ETaskStatus.DONE,
  events: [{ id: 'ev1', google_event_id: 'gcal-1', end: future }],
};

describe('UpdateProgressService', () => {
  let planFindFirst: jest.Mock;
  let planFindUnique: jest.Mock;
  let planUpdate: jest.Mock;
  let userStateFindUnique: jest.Mock;
  let fakePrisma: PrismaService;
  let service: UpdateProgressService;

  beforeEach(() => {
    jest.clearAllMocks();
    planFindFirst = jest.fn().mockResolvedValue({
      id: 'plan1',
      tasks: [completingTask],
    });
    planFindUnique = jest.fn().mockResolvedValue({
      id: 'plan1',
      tasks: [completingTask],
    });
    planUpdate = jest.fn().mockResolvedValue({});
    userStateFindUnique = jest.fn().mockResolvedValue(userState);
    fakePrisma = {
      plan: {
        findFirst: planFindFirst,
        findUnique: planFindUnique,
        update: planUpdate,
      },
      userState: { findUnique: userStateFindUnique },
    } as unknown as PrismaService;

    service = new UpdateProgressService(
      fakePrisma,
      {} as CalendarService,
      {} as CalendarScheduleService,
    );
  });

  it('runs early markers and stale-event cleanup before completing the plan, and skips reschedule', async () => {
    const result = await service.updateProgress({
      userId: 'u1',
      data: { statusChanges: [{ taskId: 't1', newStatus: 'DONE' }] },
    });

    expect(helpers.applyEarlyMarkers).toHaveBeenCalledWith(
      'u1',
      'plan1',
      expect.arrayContaining([expect.objectContaining({ id: 't1' })]),
      userState,
      expect.anything(),
      expect.anything(),
    );
    expect(helpers.cleanupCompletedEarly).toHaveBeenCalledWith(
      'u1',
      expect.arrayContaining([expect.objectContaining({ id: 't1' })]),
      expect.anything(),
    );
    expect(planUpdate).toHaveBeenCalledWith({
      where: { id: 'plan1' },
      data: { status: EPlanStatus.DONE },
    });
    expect(helpers.applyRuleReschedule).not.toHaveBeenCalled();
    expect(result.planStatus).toBe(EPlanStatus.DONE);

    // Markers must be recorded before the original event is torn down.
    const markerOrder = (helpers.applyEarlyMarkers as jest.Mock).mock
      .invocationCallOrder[0];
    const cleanupOrder = (helpers.cleanupCompletedEarly as jest.Mock).mock
      .invocationCallOrder[0];
    expect(markerOrder).toBeLessThan(cleanupOrder);
  });

  it('rejects task ids that are not leaves of the scheduled plan before writing anything', async () => {
    planFindFirst.mockResolvedValueOnce({
      id: 'plan1',
      tasks: [
        { ...completingTask, id: 'parent', events: [] },
        { ...completingTask, id: 't1', parent_task_id: 'parent' },
      ],
    });

    for (const taskId of ['other-plan-task', 'parent']) {
      await expect(
        service.updateProgress({
          userId: 'u1',
          data: { statusChanges: [{ taskId, newStatus: 'DONE' }] },
        }),
      ).rejects.toMatchObject({
        code: AppErrorCode.TASK_NOT_IN_PLAN,
        details: { taskIds: [taskId] },
      });
      planFindFirst.mockResolvedValueOnce({
        id: 'plan1',
        tasks: [
          { ...completingTask, id: 'parent', events: [] },
          { ...completingTask, id: 't1', parent_task_id: 'parent' },
        ],
      });
    }
    expect(helpers.reconcileCalendar).not.toHaveBeenCalled();
    expect(helpers.applyStatusChanges).not.toHaveBeenCalled();
    expect(helpers.persistDailyFeedback).not.toHaveBeenCalled();
  });

  describe('reschedule', () => {
    const slipped = {
      id: 't1',
      parent_task_id: null,
      status: ETaskStatus.PENDING,
      events: [
        {
          id: 'ev1',
          google_event_id: 'g1',
          end: new Date(Date.now() - 3600_000),
        },
      ],
    };
    const onTrack = {
      ...slipped,
      events: [{ ...slipped.events[0], end: future }],
    };

    it('repacks slipped steps without a status change or feedback row', async () => {
      planFindFirst.mockResolvedValueOnce({ id: 'plan1', tasks: [slipped] });
      planFindUnique.mockResolvedValueOnce({ id: 'plan1', tasks: [slipped] });

      await service.reschedule({ userId: 'u1' });

      expect(helpers.applyRuleReschedule).toHaveBeenCalledWith(
        expect.objectContaining({
          slippedLeaves: [expect.objectContaining({ id: 't1' })],
        }),
        expect.anything(),
      );
      expect(helpers.applyStatusChanges).toHaveBeenCalledWith(
        'plan1',
        [],
        expect.anything(),
      );
      expect(helpers.persistDailyFeedback).not.toHaveBeenCalled();
    });

    it('returns rescheduled 0 when nothing slipped, and saves a given note', async () => {
      planFindFirst.mockResolvedValueOnce({ id: 'plan1', tasks: [onTrack] });
      planFindUnique.mockResolvedValueOnce({ id: 'plan1', tasks: [onTrack] });

      await expect(
        service.reschedule({ userId: 'u1', note: 'sick day' }),
      ).resolves.toEqual({
        rescheduled: 0,
        planStatus: EPlanStatus.SCHEDULED,
        unscheduledTaskIds: [],
      });
      expect(helpers.applyRuleReschedule).not.toHaveBeenCalled();
      expect(helpers.persistDailyFeedback).toHaveBeenCalledWith(
        'plan1',
        [],
        'sick day',
        userState,
        expect.anything(),
      );
    });

    it('books remaining steps that have no slot yet', async () => {
      const unbooked = { ...slipped, id: 't2', events: [] };
      planFindFirst.mockResolvedValueOnce({
        id: 'plan1',
        tasks: [onTrack, unbooked],
      });
      planFindUnique.mockResolvedValueOnce({
        id: 'plan1',
        tasks: [onTrack, unbooked],
      });

      await service.reschedule({ userId: 'u1' });

      expect(helpers.applyRuleReschedule).toHaveBeenCalledWith(
        expect.objectContaining({
          remainingLeaves: expect.arrayContaining([
            expect.objectContaining({ id: 't2' }),
          ]),
        }),
        expect.anything(),
      );
    });

    it('shares the per-user lock with feedback updates', async () => {
      let release!: (v: unknown) => void;
      planFindFirst.mockReturnValueOnce(new Promise((r) => (release = r)));
      const first = service.updateProgress({
        userId: 'u1',
        data: { contextText: 'note' },
      });
      await expect(service.reschedule({ userId: 'u1' })).rejects.toMatchObject({
        code: AppErrorCode.PROGRESS_UPDATE_IN_PROGRESS,
      });
      release({ id: 'plan1', tasks: [onTrack] });
      planFindUnique.mockResolvedValueOnce({ id: 'plan1', tasks: [onTrack] });
      await first;
    });
  });

  it('rejects a second concurrent call for the same user while the first is in flight', async () => {
    let resolveFindFirst!: (v: unknown) => void;
    planFindFirst.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFindFirst = resolve;
      }),
    );

    const first = service.updateProgress({
      userId: 'u1',
      data: { statusChanges: [{ taskId: 't1', newStatus: 'DONE' }] },
    });

    await expect(
      service.updateProgress({
        userId: 'u1',
        data: { statusChanges: [{ taskId: 't1', newStatus: 'DONE' }] },
      }),
    ).rejects.toMatchObject({
      code: AppErrorCode.PROGRESS_UPDATE_IN_PROGRESS,
    });

    resolveFindFirst({ id: 'plan1', tasks: [completingTask] });
    await first;
  });

  it('releases the lock after completion, allowing a subsequent call', async () => {
    await service.updateProgress({
      userId: 'u1',
      data: { statusChanges: [{ taskId: 't1', newStatus: 'DONE' }] },
    });

    await expect(
      service.updateProgress({
        userId: 'u1',
        data: { statusChanges: [{ taskId: 't1', newStatus: 'DONE' }] },
      }),
    ).resolves.toBeDefined();
  });

  it('releases the lock after a failure, allowing a retry', async () => {
    planFindFirst.mockResolvedValueOnce(null);

    await expect(
      service.updateProgress({
        userId: 'u1',
        data: { statusChanges: [{ taskId: 't1', newStatus: 'DONE' }] },
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.PLAN_NOT_FOUND });

    await expect(
      service.updateProgress({
        userId: 'u1',
        data: { statusChanges: [{ taskId: 't1', newStatus: 'DONE' }] },
      }),
    ).resolves.toBeDefined();
  });
});
