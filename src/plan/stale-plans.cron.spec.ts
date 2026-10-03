import { EPlanSourceType, EPlanStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { STALE_CLOSE_DAYS, StalePlansCron } from './stale-plans.cron';

describe('StalePlansCron', () => {
  it('puts open Claude Code plans idle past the window on HOLD', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const cron = new StalePlansCron({
      plan: { updateMany },
    } as unknown as PrismaService);
    const now = new Date('2026-10-04T03:00:00Z');

    await expect(cron.holdStalePlans(now)).resolves.toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        source_type: EPlanSourceType.CLAUDE_CODE,
        status: { in: [EPlanStatus.DRAFT, EPlanStatus.READY] },
        last_activity_at: {
          lt: new Date(now.getTime() - STALE_CLOSE_DAYS * 86_400_000),
        },
      },
      data: { status: EPlanStatus.HOLD },
    });
  });
});
