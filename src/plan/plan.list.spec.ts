import { EPlanStatus } from '@prisma/client';
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

describe('PlanService.getList filters', () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const service = new PlanService(
    { plan: { findMany } } as unknown as PrismaService,
    {
      getProfile: jest.fn().mockResolvedValue({ id: 'u1' }),
    } as unknown as UserService,
    {} as CalendarService,
    {} as CalendarScheduleService,
    {} as GeneratePlanService,
  );
  const where = () => findMany.mock.calls[0][0].where;

  beforeEach(() => findMany.mockClear());

  it('lists every plan, newest activity first, when no filter is given', async () => {
    await service.getList({ userId: 'u1' });
    expect(where()).toEqual({ user_id: 'u1' });
    expect(findMany.mock.calls[0][0].orderBy).toEqual({
      last_activity_at: 'desc',
    });
  });

  it('matches the normalized repo key and skips DONE plans', async () => {
    await service.getList({
      userId: 'u1',
      query: { repo_key: 'git@github.com:me/repo.git', open: true },
    });
    expect(where()).toEqual({
      user_id: 'u1',
      repo_key: 'github.com/me/repo',
      status: { not: EPlanStatus.DONE },
    });
  });

  it('treats a missing source_type as GENERATE', async () => {
    await service.getList({ userId: 'u1', query: { source_type: 'GENERATE' } });
    expect(where()).toEqual({
      user_id: 'u1',
      OR: [{ source_type: 'GENERATE' }, { source_type: null }],
    });
  });
});
