import { EPlanSourceType, EPlanStatus, ETaskStatus } from '@prisma/client';
import { CalendarService } from 'src/calendar/calendar.service';
import { AppErrorCode } from 'src/common/errors/app-exception';
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

describe('PlanService.createTask on active plans', () => {
  const makeService = (plan: {
    source_type: EPlanSourceType;
    status: EPlanStatus;
  }) => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
      plan: {
        findUnique: jest.fn().mockResolvedValue({ id: 'plan1', ...plan }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ status: plan.status }),
        update: jest.fn(),
      },
      task: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'A', depth: 0, plan_id: 'plan1' }),
        count: jest.fn().mockResolvedValue(1),
        create: jest.fn().mockResolvedValue({
          id: 'new',
          parent_task_id: 'A',
          status: ETaskStatus.PENDING,
        }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'A', parent_task_id: null, status: ETaskStatus.DONE },
          { id: 'A1', parent_task_id: 'A', status: ETaskStatus.DONE },
          { id: 'new', parent_task_id: 'A', status: ETaskStatus.PENDING },
        ]),
        update: jest.fn(),
      },
    };
    // The transaction client is the same mock, so writes are observable.
    prisma.$transaction.mockImplementation(
      (fn: (tx: typeof prisma) => unknown) => fn(prisma),
    );
    const service = new PlanService(
      prisma as unknown as PrismaService,
      {} as UserService,
      {} as CalendarService,
      {} as CalendarScheduleService,
      {} as GeneratePlanService,
    );
    return { prisma, service };
  };

  it('adds a task to a DONE Claude Code plan and reopens the parent and plan', async () => {
    const { prisma, service } = makeService({
      source_type: EPlanSourceType.CLAUDE_CODE,
      status: EPlanStatus.DONE,
    });
    await service.createTask({
      userId: 'u1',
      planId: 'plan1',
      body: { title: 'Fix flaky test found on the way', parent_task_id: 'A' },
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.task.create).toHaveBeenCalled();
    expect(prisma.task.update).toHaveBeenCalledWith({
      where: { id: 'A' },
      data: { status: ETaskStatus.IN_PROGRESS },
    });
    expect(prisma.plan.update).toHaveBeenCalledWith({
      where: { id: 'plan1' },
      data: { status: EPlanStatus.READY },
    });
  });

  it('keeps generated plans DRAFT-only', async () => {
    const { prisma, service } = makeService({
      source_type: EPlanSourceType.GENERATE,
      status: EPlanStatus.READY,
    });
    await expect(
      service.createTask({
        userId: 'u1',
        planId: 'plan1',
        body: { title: 'x' },
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.PLAN_NOT_EDITABLE });
    expect(prisma.task.create).not.toHaveBeenCalled();
  });
});
