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

// Claude Code plans must never reach OpenAI or Google Calendar, even through
// routes that exist for OpenAI-generated plans.
describe('Claude Code plan source guard', () => {
  const calendarService = {
    getClient: jest.fn(),
    removeEvents: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('re_generate rejects before touching calendar, tasks or OpenAI', async () => {
    const reGeneratePlan = jest.fn();
    const taskDeleteMany = jest.fn();
    const prisma = {
      plan: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'plan1',
          source_type: EPlanSourceType.CLAUDE_CODE,
          status: EPlanStatus.SCHEDULED,
          tasks: [{ id: 't1', status: ETaskStatus.PENDING }],
        }),
      },
      taskEvent: { findMany: jest.fn() },
      task: { deleteMany: taskDeleteMany },
    } as unknown as PrismaService;
    const service = new PlanService(
      prisma,
      {} as UserService,
      calendarService as unknown as CalendarService,
      {} as CalendarScheduleService,
      { reGeneratePlan } as unknown as GeneratePlanService,
    );

    await expect(
      service.reGenerate({
        userId: 'u1',
        data: { id: 'plan1', reason: 'long enough reason' },
      }),
    ).rejects.toMatchObject({ code: AppErrorCode.PLAN_SOURCE_NOT_SUPPORTED });

    expect(reGeneratePlan).not.toHaveBeenCalled();
    expect(taskDeleteMany).not.toHaveBeenCalled();
    expect(calendarService.getClient).not.toHaveBeenCalled();
    expect(calendarService.removeEvents).not.toHaveBeenCalled();
  });

  it('schedule rejects before any calendar call', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValue({ source_type: EPlanSourceType.CLAUDE_CODE });
    const service = new CalendarScheduleService(
      { plan: { findFirst } } as unknown as PrismaService,
      calendarService as unknown as CalendarService,
    );

    await expect(
      service.generateAndApplyTaskSchedule({ userId: 'u1', id: 'plan1' }),
    ).rejects.toMatchObject({ code: AppErrorCode.PLAN_SOURCE_NOT_SUPPORTED });

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(calendarService.getClient).not.toHaveBeenCalled();
  });

  it('schedule still proceeds past the guard for generated plans', async () => {
    // Second findFirst is the existing "another plan scheduled" check —
    // returning one proves execution continued past the source guard.
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ source_type: EPlanSourceType.GENERATE })
      .mockResolvedValueOnce({ id: 'other' });
    const service = new CalendarScheduleService(
      { plan: { findFirst } } as unknown as PrismaService,
      calendarService as unknown as CalendarService,
    );

    await expect(
      service.generateAndApplyTaskSchedule({ userId: 'u1', id: 'plan1' }),
    ).rejects.toMatchObject({ code: AppErrorCode.ANOTHER_PLAN_SCHEDULED });
  });
});
