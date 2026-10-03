import { EPlanStatus, ETaskStatus } from '@prisma/client';
import { CalendarService } from 'src/calendar/calendar.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';

// See calendar.schedule/apply-schedule.spec.ts for why p-limit needs this
// stub under ts-jest.
jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => (fn: () => Promise<unknown>) => fn(),
}));

import { CalendarScheduleService } from './calendar.schedule';
import { GeneratePlanService } from './plan.generate';
import { PlanService } from './plan.service';

describe('PlanService.transition to DONE', () => {
  const planUpdate = jest.fn();
  const findUnique = jest.fn();
  const service = new PlanService(
    { plan: { findUnique, update: planUpdate } } as unknown as PrismaService,
    {} as UserService,
    {} as CalendarService,
    {} as CalendarScheduleService,
    {} as GeneratePlanService,
  );

  const withLeaves = (...statuses: ETaskStatus[]) =>
    findUnique.mockResolvedValue({
      id: 'plan1',
      status: EPlanStatus.READY,
      tasks: [
        { id: 'root', parent_task_id: null, status: ETaskStatus.IN_PROGRESS },
        ...statuses.map((status, i) => ({
          id: `leaf${i}`,
          parent_task_id: 'root',
          status,
        })),
      ],
    });

  beforeEach(() => jest.clearAllMocks());

  it('accepts CANCELLED steps next to DONE ones', async () => {
    withLeaves(ETaskStatus.DONE, ETaskStatus.CANCELLED);
    await service.transition({ userId: 'u1', id: 'plan1', to: 'DONE' });
    expect(planUpdate).toHaveBeenCalledWith({
      where: { id: 'plan1' },
      data: { status: EPlanStatus.DONE, last_activity_at: expect.any(Date) },
    });
  });

  it('rejects open steps', async () => {
    withLeaves(ETaskStatus.DONE, ETaskStatus.PENDING);
    await expect(
      service.transition({ userId: 'u1', id: 'plan1', to: 'DONE' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(planUpdate).not.toHaveBeenCalled();
  });

  it('rejects a plan where every step was cancelled', async () => {
    withLeaves(ETaskStatus.CANCELLED, ETaskStatus.CANCELLED);
    await expect(
      service.transition({ userId: 'u1', id: 'plan1', to: 'DONE' }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});
