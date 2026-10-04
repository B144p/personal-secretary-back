import { Injectable, NotFoundException } from '@nestjs/common';
import {
  EPlanSourceType,
  EPlanStatus,
  ETaskStatus,
  Task,
} from '@prisma/client';
import { CalendarService } from 'src/calendar/calendar.service';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import { CalendarScheduleService } from './calendar.schedule';
import { IGetDetailProps, IGetListProps, IRemovePlanProps } from './interfaces';
import { normalizeRepoKey } from './repo-key';
import { GeneratePlanService } from './plan.generate';
import { lockPlanRow, ROLLUP_TX_OPTIONS } from './plan.status/lock';
import { activePlanStatus, rollupTaskStatus } from './plan.status/rollup';
import { assertCanRegenerate } from './source-guard';

@Injectable()
export class PlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly calendarService: CalendarService,
    private readonly calendarScheduleService: CalendarScheduleService,
    private readonly generatePlanService: GeneratePlanService,
  ) {}

  async generate(
    data: Parameters<typeof this.generatePlanService.generatePlan>[0],
  ) {
    return await this.generatePlanService.generatePlan(data);
  }

  async getList({ userId, query = {} }: IGetListProps) {
    const user = await this.userService.getProfile(userId);
    const plans = await this.prisma.plan.findMany({
      where: {
        user_id: user.id,
        ...(query.repo_key && { repo_key: normalizeRepoKey(query.repo_key) }),
        ...(query.open && { status: { not: EPlanStatus.DONE } }),
        // Plans from before source_type existed are GENERATE (see below).
        ...(query.source_type &&
          (query.source_type === 'GENERATE'
            ? { OR: [{ source_type: 'GENERATE' }, { source_type: null }] }
            : { source_type: query.source_type })),
      },
      orderBy: { last_activity_at: 'desc' },
      include: {
        tasks: {
          include: { events: { where: { is_active: true } } },
          orderBy: [{ depth: 'asc' }, { sequence_order: 'asc' }],
        },
      },
    });

    return plans.map(({ tasks, ...rest }) => ({
      ...rest,
      source_type: rest.source_type ?? 'GENERATE',
      tasks: buildPlanTaskTree(tasks),
    }));
  }

  async getDetail({ userId, id }: IGetDetailProps) {
    const user = await this.userService.getProfile(userId);
    const plan = await this.prisma.plan.findUnique({
      where: {
        user_id: user.id,
        id,
      },
      include: {
        tasks: {
          include: { events: { where: { is_active: true } } },
          orderBy: [{ depth: 'asc' }, { sequence_order: 'asc' }],
        },
      },
    });
    if (!plan)
      throw new AppException(AppErrorCode.PLAN_NOT_FOUND, 'Plan not found');

    const { tasks, ...restPlan } = plan;

    return {
      ...restPlan,
      source_type: restPlan.source_type ?? 'GENERATE',
      tasks: buildPlanTaskTree(tasks),
    };
  }

  async reGenerate(
    data: Pick<
      Parameters<typeof this.generatePlanService.reGeneratePlan>[0],
      'userId' | 'data'
    >,
  ) {
    const { userId, data: dto } = data;

    if (!dto.reason || dto.reason.length < 10) {
      throw new AppException(
        AppErrorCode.REASON_REQUIRED,
        'reason must be at least 10 characters',
      );
    }

    const plan = await this.prisma.plan.findUnique({
      where: { id: dto.id, user_id: userId },
      include: { tasks: true },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    // Must run before any calendar cleanup or task deletion below.
    assertCanRegenerate(plan);

    // Determine the subtree root
    const rootTaskId = dto.task_id ?? null;
    const subtaskIds = collectSubtreeIds(plan.tasks, rootTaskId);

    // Classify tasks in scope
    const subtree = plan.tasks.filter((t) => subtaskIds.has(t.id));
    const pendingIds = subtree
      .filter((t) => t.status === ETaskStatus.PENDING)
      .map((t) => t.id);
    const preserved = subtree.filter(
      (t) =>
        t.status === ETaskStatus.IN_PROGRESS || t.status === ETaskStatus.DONE,
    );

    // If plan is SCHEDULED: delete calendar events for pending tasks being pruned
    if (plan.status === EPlanStatus.SCHEDULED && pendingIds.length > 0) {
      const activeEvents = await this.prisma.taskEvent.findMany({
        where: { task_id: { in: pendingIds }, is_active: true },
      });
      if (activeEvents.length > 0) {
        const calClient = await this.calendarService.getClient(userId);
        await this.calendarService.removeEvents({
          client: calClient,
          calendarId: 'primary',
          events: activeEvents.map((e) => e.google_event_id),
        });
        await this.prisma.taskEvent.updateMany({
          where: { id: { in: activeEvents.map((e) => e.id) } },
          data: { is_active: false },
        });
      }
    }

    // Delete pending tasks in subtree
    if (pendingIds.length > 0) {
      await this.prisma.task.deleteMany({ where: { id: { in: pendingIds } } });
    }

    const preservedTree = buildTaskTree(preserved, rootTaskId ?? null);

    return await this.generatePlanService.reGeneratePlan({
      userId,
      preservedTasks: preservedTree,
      parentTaskId: rootTaskId,
      data: dto,
    });
  }

  async generateAndApplyTaskSchedule(
    data: Parameters<
      typeof this.calendarScheduleService.generateAndApplyTaskSchedule
    >[0],
  ) {
    return this.calendarScheduleService.generateAndApplyTaskSchedule(data);
  }

  async pause({ userId, id }: { userId: string; id: string }) {
    const plan = await this.prisma.plan.findUnique({
      where: { id, user_id: userId },
      include: {
        tasks: { include: { events: { where: { is_active: true } } } },
      },
    });
    if (!plan)
      throw new AppException(AppErrorCode.PLAN_NOT_FOUND, 'Plan not found');
    if (plan.is_paused) return { message: 'Plan is already paused' };

    // If SCHEDULED: remove active Google events for incomplete leaves, deactivate TaskEvents
    if (plan.status === EPlanStatus.SCHEDULED) {
      const incompleteTasks = plan.tasks.filter(
        (t) => t.status !== ETaskStatus.DONE,
      );
      const activeEventIds = incompleteTasks.flatMap((t) =>
        t.events.map((e) => e.google_event_id),
      );
      if (activeEventIds.length > 0) {
        const calClient = await this.calendarService.getClient(userId);
        await this.calendarService.removeEvents({
          client: calClient,
          calendarId: 'primary',
          events: activeEventIds,
        });
        await this.prisma.taskEvent.updateMany({
          where: {
            task_id: { in: incompleteTasks.map((t) => t.id) },
            is_active: true,
          },
          data: { is_active: false },
        });
      }
    }

    await this.prisma.plan.update({
      where: { id },
      data: {
        is_paused: true,
        paused_at: new Date(),
        ...(plan.status === EPlanStatus.SCHEDULED && {
          status: EPlanStatus.HOLD,
        }),
      },
    });
    return { message: 'Plan paused' };
  }

  async resume({ userId, id }: { userId: string; id: string }) {
    const plan = await this.prisma.plan.findUnique({
      where: { id, user_id: userId },
    });
    if (!plan)
      throw new AppException(AppErrorCode.PLAN_NOT_FOUND, 'Plan not found');
    if (!plan.is_paused) return { message: 'Plan is not paused' };

    if (plan.status === EPlanStatus.HOLD) {
      await this.calendarScheduleService.generateAndApplyTaskSchedule({
        userId,
        id,
      });
    }

    await this.prisma.plan.update({
      where: { id },
      data: { is_paused: false, paused_at: null },
    });

    return { message: 'Plan resumed' };
  }

  async transition({
    userId,
    id,
    to,
  }: {
    userId: string;
    id: string;
    to: string;
  }) {
    const allowed = ['READY', 'DRAFT', 'DONE'];
    if (!allowed.includes(to)) {
      throw new AppException(
        AppErrorCode.INVALID_TRANSITION,
        `Target status ${to} is not allowed`,
      );
    }

    const plan = await this.prisma.plan.findUnique({
      where: { id, user_id: userId },
      include: { tasks: true },
    });
    if (!plan)
      throw new AppException(AppErrorCode.PLAN_NOT_FOUND, 'Plan not found');

    const current = plan.status;

    if (to === 'DONE') {
      // Same rule as the status rollup: a CANCELLED step is finished too,
      // but a plan where every step was cancelled was not done.
      const leafIds = getLeafIds(plan.tasks);
      const leaves = plan.tasks.filter((t) => leafIds.has(t.id));
      const allFinished = leaves.every(
        (t) =>
          t.status === ETaskStatus.DONE || t.status === ETaskStatus.CANCELLED,
      );
      if (!allFinished || !leaves.some((t) => t.status === ETaskStatus.DONE)) {
        throw new AppException(
          AppErrorCode.INVALID_TRANSITION,
          'All leaf tasks must be DONE or CANCELLED (at least one DONE) before marking plan DONE',
        );
      }
    }

    const validTransitions: Record<string, string[]> = {
      DRAFT: ['READY'],
      READY: ['DRAFT', 'DONE'],
      SCHEDULED: ['DRAFT', 'DONE'],
      HOLD: ['READY'],
      DONE: [],
    };

    if (!validTransitions[current]?.includes(to)) {
      throw new AppException(
        AppErrorCode.INVALID_TRANSITION,
        `Cannot transition from ${current} to ${to}`,
      );
    }

    await this.prisma.plan.update({
      where: { id },
      data: { status: to as EPlanStatus, last_activity_at: new Date() },
    });
    return { message: `Plan transitioned to ${to}` };
  }

  async remove({ id, userId }: IRemovePlanProps) {
    const plan = await this.prisma.plan.findUnique({
      where: { id, user_id: userId },
      include: {
        tasks: { include: { events: { where: { is_active: true } } } },
      },
    });
    if (!plan)
      throw new AppException(AppErrorCode.PLAN_NOT_FOUND, 'Plan not found');

    // Delete active Calendar events for incomplete leaves
    if (plan.status === EPlanStatus.SCHEDULED) {
      const incompleteTasks = plan.tasks.filter(
        (t) => t.status !== ETaskStatus.DONE,
      );
      const activeEventIds = incompleteTasks.flatMap((t) =>
        t.events.map((e) => e.google_event_id),
      );
      if (activeEventIds.length > 0) {
        const calClient = await this.calendarService.getClient(userId);
        await this.calendarService.removeEvents({
          client: calClient,
          calendarId: 'primary',
          events: activeEventIds,
        });
      }
    }

    await this.prisma.plan.delete({ where: { id, user_id: userId } });
    return { message: 'Plan deleted' };
  }

  async updateTask({
    userId,
    planId,
    taskId,
    body,
  }: {
    userId: string;
    planId: string;
    taskId: string;
    body: unknown;
  }) {
    const { updateTaskSchema } = await import('./dto/update-task.dto');
    const parsed = updateTaskSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppException(
        AppErrorCode.INVALID_GOAL,
        parsed.error.issues[0]?.message ?? 'Invalid body',
      );
    }

    const plan = await this.prisma.plan.findUnique({
      where: { id: planId, user_id: userId },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.status !== EPlanStatus.DRAFT) {
      throw new AppException(
        AppErrorCode.PLAN_NOT_EDITABLE,
        'Only DRAFT plans can be edited',
      );
    }

    const task = await this.prisma.task.findUnique({
      where: { id: taskId, plan_id: planId },
    });
    if (!task) throw new NotFoundException('Task not found');

    return this.prisma.task.update({
      where: { id: taskId },
      data: parsed.data,
    });
  }

  async removeRelatedCalendarEvent(
    data: Parameters<
      typeof this.generatePlanService.removeRelatedCalendarEvent
    >[0],
  ) {
    return await this.generatePlanService.removeRelatedCalendarEvent(data);
  }

  async createTask({
    userId,
    planId,
    body,
  }: {
    userId: string;
    planId: string;
    body: unknown;
  }) {
    const { createTaskSchema } = await import('./dto/create-task.dto');
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppException(
        AppErrorCode.INVALID_GOAL,
        parsed.error.issues[0]?.message ?? 'Invalid body',
      );
    }

    const plan = await this.prisma.plan.findUnique({
      where: { id: planId, user_id: userId },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    // Claude Code discovers new steps mid-work, so its plans accept new tasks
    // while active. Others stay DRAFT-only: they would need rescheduling.
    const isClaudeCode = plan.source_type === EPlanSourceType.CLAUDE_CODE;
    if (
      plan.status !== EPlanStatus.DRAFT &&
      !(isClaudeCode && CLAUDE_CODE_TASK_ADD_STATUSES.includes(plan.status))
    ) {
      throw new AppException(
        AppErrorCode.PLAN_NOT_EDITABLE,
        'Only DRAFT plans can be edited',
      );
    }

    const { parent_task_id, sequence_order, ...rest } = parsed.data;

    let depth = 0;
    if (parent_task_id) {
      const parent = await this.prisma.task.findUnique({
        where: { id: parent_task_id, plan_id: planId },
      });
      if (!parent) throw new NotFoundException('Parent task not found');
      depth = parent.depth + 1;
    }

    if (depth > MAX_TASK_DEPTH) {
      throw new AppException(
        AppErrorCode.INVALID_GOAL,
        'Task nesting too deep',
      );
    }

    const finalSequenceOrder =
      sequence_order ??
      (await this.prisma.task.count({
        where: { plan_id: planId, parent_task_id: parent_task_id ?? null },
      }));

    const data = {
      ...rest,
      plan_id: planId,
      parent_task_id: parent_task_id ?? null,
      depth,
      sequence_order: finalSequenceOrder,
    };
    if (!isClaudeCode) return this.prisma.task.create({ data });
    if (plan.status === EPlanStatus.DRAFT) {
      const task = await this.prisma.task.create({ data });
      await this.prisma.plan.update({
        where: { id: planId },
        data: { last_activity_at: new Date() },
      });
      return task;
    }

    // New open work reopens closed ancestors and a finished Claude Code plan.
    // Same lock as the status rollup, so a concurrent update_task_status
    // can't overwrite this rollup (or the reverse), and it's all-or-nothing.
    return this.prisma.$transaction(async (tx) => {
      await lockPlanRow(tx, planId);
      const locked = await tx.plan.findUniqueOrThrow({
        where: { id: planId },
        select: { status: true, is_paused: true },
      });
      const task = await tx.task.create({ data });
      const tasks = await tx.task.findMany({
        where: { plan_id: planId },
        select: { id: true, parent_task_id: true, status: true },
      });
      const rollup = rollupTaskStatus({
        tasks,
        changedId: task.id,
        newStatus: task.status,
        planStatus: activePlanStatus(locked.status, locked.is_paused),
      });
      for (const [id, status] of rollup.tasks) {
        await tx.task.update({ where: { id }, data: { status } });
      }
      await tx.plan.update({
        where: { id: planId },
        data: { status: rollup.plan, last_activity_at: new Date() },
      });
      return task;
    }, ROLLUP_TX_OPTIONS);
  }

  async deleteTask({
    userId,
    planId,
    taskId,
  }: {
    userId: string;
    planId: string;
    taskId: string;
  }) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId, user_id: userId },
      include: { tasks: true },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.status !== EPlanStatus.DRAFT) {
      throw new AppException(
        AppErrorCode.PLAN_NOT_EDITABLE,
        'Only DRAFT plans can be edited',
      );
    }

    const task = plan.tasks.find((t) => t.id === taskId);
    if (!task) throw new NotFoundException('Task not found');

    const idsToDelete = collectSubtreeIds(plan.tasks, taskId);
    await this.prisma.task.deleteMany({
      where: { id: { in: [...idsToDelete] } },
    });

    return { message: 'Task deleted', deletedCount: idsToDelete.size };
  }
}

const MAX_TASK_DEPTH = 4;

// HOLD: a stale Claude Code plan; adding work picks it up again (READY).
const CLAUDE_CODE_TASK_ADD_STATUSES: EPlanStatus[] = [
  EPlanStatus.DRAFT,
  EPlanStatus.READY,
  EPlanStatus.HOLD,
  EPlanStatus.DONE,
];

const getLeafIds = (tasks: { id: string; parent_task_id: string | null }[]) => {
  const parentSet = new Set(
    tasks.map((t) => t.parent_task_id).filter(Boolean) as string[],
  );
  return new Set(tasks.filter((t) => !parentSet.has(t.id)).map((t) => t.id));
};

const collectSubtreeIds = (
  tasks: Task[],
  rootId: string | null,
): Set<string> => {
  const ids = new Set<string>();
  const queue = rootId
    ? [rootId]
    : tasks.filter((t) => t.parent_task_id === null).map((t) => t.id);
  for (const id of queue) {
    ids.add(id);
    tasks
      .filter((t) => t.parent_task_id === id)
      .forEach((t) => queue.push(t.id));
  }
  return ids;
};

type SimpleTaskNode = {
  title: string;
  description: string;
  sequence_order: number;
  estimated_minutes: number | null;
  children: SimpleTaskNode[];
};

type TaskWithEvents = Task & {
  events: import('@prisma/client').TaskEvent[];
};

type TaskTreeNode = Omit<TaskWithEvents, 'description'> & {
  description: string;
  children: TaskTreeNode[];
};

const buildPlanTaskTree = (tasks: TaskWithEvents[]): TaskTreeNode[] => {
  const byParent = new Map<string | null, TaskWithEvents[]>();
  for (const t of tasks) {
    const key = t.parent_task_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(t);
  }
  const build = (parentId: string | null): TaskTreeNode[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.sequence_order - b.sequence_order)
      .map((t) => ({
        ...t,
        description: t.description ?? '',
        children: build(t.id),
      }));
  return build(null);
};

const buildTaskTree = (
  tasks: Task[],
  parentId: string | null,
): SimpleTaskNode[] =>
  tasks
    .filter((t) => t.parent_task_id === parentId)
    .sort((a, b) => a.sequence_order - b.sequence_order)
    .map((t) => ({
      title: t.title,
      description: t.description ?? '',
      sequence_order: t.sequence_order,
      estimated_minutes: t.estimated_minutes,
      children: buildTaskTree(tasks, t.id),
    }));
