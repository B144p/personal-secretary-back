import { Injectable } from '@nestjs/common';
import { EPlanStatus, Prisma } from '@prisma/client';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { PrismaService } from 'src/prisma/prisma.service';
import { summarizePlanProgress } from './progress-summary';

const withProgressData = {
  tasks: {
    select: {
      id: true,
      parent_task_id: true,
      title: true,
      status: true,
      events: {
        where: { is_active: true },
        select: { start: true, end: true },
      },
    },
  },
  feedbacks: {
    orderBy: { created_at: 'desc' },
    take: 1,
    select: { created_at: true },
  },
} satisfies Prisma.PlanInclude;

// Read-only progress summaries for agents. Never touches the calendar.
@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, includeDone: boolean) {
    const plans = await this.prisma.plan.findMany({
      where: {
        user_id: userId,
        ...(!includeDone && { status: { not: EPlanStatus.DONE } }),
      },
      include: withProgressData,
      orderBy: { last_activity_at: 'desc' },
    });
    const now = new Date();
    return plans.map((p) =>
      summarizePlanProgress(p, p.feedbacks[0]?.created_at ?? null, now),
    );
  }

  async one(userId: string, planId: string) {
    const plan = await this.prisma.plan.findFirst({
      where: { id: planId, user_id: userId },
      include: withProgressData,
    });
    if (!plan)
      throw new AppException(AppErrorCode.PLAN_NOT_FOUND, 'Plan not found');
    return summarizePlanProgress(
      plan,
      plan.feedbacks[0]?.created_at ?? null,
      new Date(),
    );
  }
}
