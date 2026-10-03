import { Injectable, NotFoundException } from '@nestjs/common';
import { ETaskStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import type { UpdateTaskStatusDto } from '../dto/update-task-status.dto';
import { assertClaudeCodePlan } from '../source-guard';
import { loadPlanWithTaskTree } from '../task-tree';
import { lockPlanRow, ROLLUP_TX_OPTIONS } from './lock';
import { rollupTaskStatus } from './rollup';

// Task status reported by Claude Code while it works. Prisma only: no
// OpenAI, and no TaskEvent/calendar writes (Claude Code plans are never
// scheduled).
@Injectable()
export class PlanTaskStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async updateStatus({
    userId,
    planId,
    taskId,
    dto,
  }: {
    userId: string;
    planId: string;
    taskId: string;
    dto: UpdateTaskStatusDto;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await lockPlanRow(tx, planId);
      const plan = await tx.plan.findUnique({
        where: { id: planId, user_id: userId },
        include: {
          tasks: { select: { id: true, parent_task_id: true, status: true } },
        },
      });
      if (!plan) throw new NotFoundException('Plan not found');
      assertClaudeCodePlan(plan, 'task status updates');
      if (!plan.tasks.some((t) => t.id === taskId))
        throw new NotFoundException('Task not found');

      const newStatus = dto.status as ETaskStatus;
      const result = rollupTaskStatus({
        tasks: plan.tasks,
        changedId: taskId,
        newStatus,
        planStatus: plan.status,
      });

      await tx.task.update({
        where: { id: taskId },
        data: { status: newStatus, status_note: dto.note ?? null },
      });
      for (const [id, status] of result.tasks) {
        await tx.task.update({ where: { id }, data: { status } });
      }
      if (result.plan !== plan.status) {
        await tx.plan.update({
          where: { id: planId },
          data: { status: result.plan },
        });
      }

      return loadPlanWithTaskTree(tx, planId);
    }, ROLLUP_TX_OPTIONS);
  }
}
