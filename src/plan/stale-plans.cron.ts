import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EPlanSourceType, EPlanStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

export const STALE_CLOSE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Claude Code plans nobody touched for a month go on HOLD, so a repo does not
// slowly collect half-finished plans in its session context. HOLD → READY
// resumes one. Only status changes: no tasks, OpenAI or calendar involved.
@Injectable()
export class StalePlansCron {
  private readonly logger = new Logger(StalePlansCron.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 3 * * *', { name: 'hold-stale-claude-code-plans' })
  async holdStalePlans(now = new Date()) {
    const { count } = await this.prisma.plan.updateMany({
      where: {
        source_type: EPlanSourceType.CLAUDE_CODE,
        status: { in: [EPlanStatus.DRAFT, EPlanStatus.READY] },
        last_activity_at: {
          lt: new Date(now.getTime() - STALE_CLOSE_DAYS * DAY_MS),
        },
      },
      data: { status: EPlanStatus.HOLD },
    });
    if (count)
      this.logger.log(`Put ${count} stale Claude Code plan(s) on HOLD`);
    return count;
  }
}
