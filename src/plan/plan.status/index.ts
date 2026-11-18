import { Injectable, NotFoundException } from '@nestjs/common';
import { ETaskStatus } from '@prisma/client';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { PrismaService } from 'src/prisma/prisma.service';
import type {
  BulkUpdateTaskStatusDto,
  UpdateTaskStatusDto,
} from '../dto/update-task-status.dto';
import { assertClaudeCodePlan } from '../source-guard';
import { loadPlanWithTaskTree } from '../task-tree';
import { lockPlanRow, ROLLUP_TX_OPTIONS } from './lock';
import {
  activePlanStatus,
  rollupTaskStatus,
  rollupTaskStatuses,
} from './rollup';

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
        planStatus: activePlanStatus(plan.status, plan.is_paused),
      });

      await tx.task.update({
        where: { id: taskId },
        data: { status: newStatus, status_note: dto.note ?? null },
      });
      for (const [id, status] of result.tasks) {
        await tx.task.update({ where: { id }, data: { status } });
      }
      await tx.plan.update({
        where: { id: planId },
        data: { status: result.plan, last_activity_at: new Date() },
      });

      return loadPlanWithTaskTree(tx, planId);
    }, ROLLUP_TX_OPTIONS);
  }

  // All-or-nothing: every id is checked before the first write, and the whole
  // list shares one lock, one rollup and one returned tree.
  async bulkUpdateStatus({
    userId,
    planId,
    dto,
  }: {
    userId: string;
    planId: string;
    dto: BulkUpdateTaskStatusDto;
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

      const start = new Map(plan.tasks.map((t) => [t.id, t.status]));
      const unknown = dto.updates
        .map((u) => u.task_id)
        .filter((id) => !start.has(id));
      if (unknown.length > 0) {
        throw new AppException(
          AppErrorCode.TASK_NOT_IN_PLAN,
          `Tasks not in this plan: ${unknown.join(', ')}`,
          { task_ids: unknown },
        );
      }

      const result = rollupTaskStatuses({
        tasks: plan.tasks,
        changes: dto.updates.map((u) => ({
          id: u.task_id,
          status: u.status as ETaskStatus,
        })),
        planStatus: activePlanStatus(plan.status, plan.is_paused),
      });

      // Grouped so a long list stays a few queries inside the transaction.
      // A later update in the list can move an earlier task (closing its
      // parent), so listed tasks take their final status, not the requested one.
      const listed = new Map<
        string,
        { status: ETaskStatus; note: string | null; ids: string[] }
      >();
      for (const { task_id, note } of dto.updates) {
        const status = result.tasks.get(task_id) ?? start.get(task_id)!;
        const key = JSON.stringify([status, note ?? null]);
        const group = listed.get(key) ?? {
          status,
          note: note ?? null,
          ids: [],
        };
        group.ids.push(task_id);
        listed.set(key, group);
      }
      for (const { status, note, ids } of listed.values()) {
        await tx.task.updateMany({
          where: { id: { in: ids }, plan_id: planId },
          data: { status, status_note: note },
        });
      }

      // Tasks moved only by the rollup keep their note.
      const listedIds = new Set(dto.updates.map((u) => u.task_id));
      const derived = new Map<ETaskStatus, string[]>();
      for (const [id, status] of result.tasks) {
        if (listedIds.has(id)) continue;
        derived.set(status, [...(derived.get(status) ?? []), id]);
      }
      for (const [status, ids] of derived) {
        await tx.task.updateMany({
          where: { id: { in: ids }, plan_id: planId },
          data: { status },
        });
      }

      await tx.plan.update({
        where: { id: planId },
        data: { status: result.plan, last_activity_at: new Date() },
      });

      return loadPlanWithTaskTree(tx, planId);
    }, ROLLUP_TX_OPTIONS);
  }
}
