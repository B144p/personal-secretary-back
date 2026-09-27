import { ETaskStatus, Prisma } from '@prisma/client';
import type { ITaskNode } from './schemas';

// Shared task-tree persistence, used by both OpenAI generation
// (plan.generate) and Claude Code import (plan.import). Kept free of any
// OpenAI or calendar dependency so the import path cannot reach either.

// PrismaService and a $transaction client both satisfy this.
export type TaskTreeClient = Prisma.TransactionClient;

export const loadPlanWithTaskTree = async (
  client: TaskTreeClient,
  planId: string,
) => {
  const plan = await client.plan.findUnique({
    where: { id: planId },
    include: {
      tasks: {
        include: { events: { where: { is_active: true } } },
        orderBy: [{ depth: 'asc' }, { sequence_order: 'asc' }],
      },
    },
  });
  if (!plan) return null;
  const { tasks, ...rest } = plan;
  const byParent = new Map<string | null, (typeof tasks)[number][]>();
  for (const t of tasks) {
    const key = t.parent_task_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(t);
  }
  const build = (parentId: string | null): unknown[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.sequence_order - b.sequence_order)
      .map((t) => ({
        ...t,
        description: t.description ?? '',
        children: build(t.id),
      }));
  return {
    ...rest,
    source_type: rest.source_type ?? 'GENERATE',
    tasks: build(null),
  };
};

export const insertTaskTree = async ({
  client,
  planId,
  tasks,
  parentId,
  depth,
}: {
  client: TaskTreeClient;
  planId: string;
  tasks: ITaskNode[];
  parentId: string | null;
  depth: number;
}) => {
  for (const task of tasks) {
    const isLeaf = task.children.length === 0;
    const created = await client.task.create({
      data: {
        plan_id: planId,
        title: task.title,
        description: task.description,
        status: ETaskStatus.PENDING,
        parent_task_id: parentId,
        depth,
        sequence_order: task.sequence_order,
        estimated_minutes: isLeaf ? task.estimated_minutes : null,
      },
    });

    if (task.children.length > 0) {
      await insertTaskTree({
        client,
        planId,
        tasks: task.children,
        parentId: created.id,
        depth: depth + 1,
      });
    }
  }
};
