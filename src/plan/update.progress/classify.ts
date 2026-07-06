import { ETaskStatus } from '@prisma/client';
import dayjs, { Dayjs } from 'dayjs';
import type { IStatusChange } from './interface';

export const getLeafIds = (
  tasks: { id: string; parent_task_id: string | null }[],
) => {
  const parentSet = new Set(
    tasks.map((t) => t.parent_task_id).filter(Boolean) as string[],
  );
  return new Set(tasks.filter((t) => !parentSet.has(t.id)).map((t) => t.id));
};

// Depth-first walk of the full task tree, collecting the subset of tasks
// present in `targetLeaves` in tree order (sequence_order within each
// sibling group). This is how AI scheduling order used to be "preserved" —
// now it directly drives the rule-based packing order.
export const orderLeavesByTree = <
  T extends {
    id: string;
    parent_task_id: string | null;
    sequence_order: number;
  },
>(
  allTasks: T[],
  targetLeaves: T[],
): T[] => {
  const targetIds = new Set(targetLeaves.map((t) => t.id));
  const byParent = new Map<string | null, T[]>();
  for (const t of allTasks) {
    if (!byParent.has(t.parent_task_id)) byParent.set(t.parent_task_id, []);
    byParent.get(t.parent_task_id)!.push(t);
  }
  const ordered: T[] = [];
  const visit = (parentId: string | null) => {
    const children = (byParent.get(parentId) ?? []).sort(
      (a, b) => a.sequence_order - b.sequence_order,
    );
    for (const child of children) {
      if (targetIds.has(child.id)) ordered.push(child);
      visit(child.id);
    }
  };
  visit(null);
  return ordered;
};

type StatusClassifiable = {
  id: string;
  parent_task_id: string | null;
  status: ETaskStatus;
  events: { end: Date }[];
};

// Held leaves are deprioritized: their active event (if still in the
// future) should be dropped and they should be excluded from scheduling.
export const findHeldLeavesWithFutureEvents = <T extends StatusClassifiable>(
  allTasks: T[],
  leafIds: Set<string>,
  now: Dayjs,
): T[] => {
  return allTasks.filter((t) => {
    if (!leafIds.has(t.id)) return false;
    if (t.status !== ETaskStatus.HOLD) return false;
    const activeEvent = t.events[0];
    if (!activeEvent) return false;
    return dayjs(activeEvent.end).isAfter(now);
  });
};

// True when every non-held leaf is DONE (and there's at least one non-held
// leaf) — an all-held plan stays stalled rather than auto-completing.
export const allNonHeldLeavesDone = <
  T extends Pick<StatusClassifiable, 'id' | 'parent_task_id' | 'status'>,
>(
  allTasks: T[],
  leafIds: Set<string>,
): boolean => {
  const nonHeldLeaves = allTasks.filter(
    (t) => leafIds.has(t.id) && t.status !== ETaskStatus.HOLD,
  );
  return (
    nonHeldLeaves.length > 0 &&
    nonHeldLeaves.every((t) => t.status === ETaskStatus.DONE)
  );
};

// Buckets leaf tasks by what happened to them this request, driving both
// the "does anything need rescheduling?" gate and the reschedule input:
// - slippedLeaves: not done/held, but their scheduled event already ended
// - completedEarly: just marked DONE, event hasn't ended yet (finished ahead)
// - completedLate: just marked DONE, event already ended (finished, but late)
// - remainingLeaves: everything still needing a calendar slot (not DONE/HOLD)
export const classifyLeaves = <T extends StatusClassifiable>({
  allTasks,
  leafIds,
  statusChanges,
  now,
}: {
  allTasks: T[];
  leafIds: Set<string>;
  statusChanges: IStatusChange[];
  now: Dayjs;
}): {
  slippedLeaves: T[];
  completedEarly: T[];
  completedLate: T[];
  remainingLeaves: T[];
} => {
  const slippedLeaves = allTasks.filter((t) => {
    if (!leafIds.has(t.id)) return false;
    if (t.status === ETaskStatus.DONE) return false;
    if (t.status === ETaskStatus.HOLD) return false;
    const activeEvent = t.events[0];
    if (!activeEvent) return false;
    return dayjs(activeEvent.end).isBefore(now);
  });

  const completedTaskIds = new Set(
    statusChanges
      .filter((sc) => sc.newStatus === ETaskStatus.DONE)
      .map((sc) => sc.taskId),
  );
  const completedEarly = allTasks.filter((t) => {
    if (!leafIds.has(t.id)) return false;
    if (!completedTaskIds.has(t.id)) return false;
    const activeEvent = t.events[0];
    if (!activeEvent) return false;
    return dayjs(activeEvent.end).isAfter(now);
  });

  const completedLate = allTasks.filter((t) => {
    if (!leafIds.has(t.id)) return false;
    if (!completedTaskIds.has(t.id)) return false;
    const activeEvent = t.events[0];
    if (!activeEvent) return false;
    return dayjs(activeEvent.end).isBefore(now);
  });

  const remainingLeaves = allTasks.filter(
    (t) =>
      leafIds.has(t.id) &&
      t.status !== ETaskStatus.DONE &&
      t.status !== ETaskStatus.HOLD,
  );

  return { slippedLeaves, completedEarly, completedLate, remainingLeaves };
};

// Bottom-up: a parent whose non-HOLD children are all done (recursively)
// should itself become DONE, cascading up multiple levels. HOLD children are
// ignored — same rule as allNonHeldLeavesDone ("an all-held plan stays
// stalled"). Tasks already changed explicitly this request are left alone.
// Returns the ids of tasks that should be promoted to DONE.
export const computeParentStatusRollup = <
  T extends Pick<StatusClassifiable, 'id' | 'parent_task_id' | 'status'>,
>(
  allTasks: T[],
  explicitlyChangedIds: Set<string> = new Set(),
): string[] => {
  const byParent = new Map<string | null, T[]>();
  for (const t of allTasks) {
    if (!byParent.has(t.parent_task_id)) byParent.set(t.parent_task_id, []);
    byParent.get(t.parent_task_id)!.push(t);
  }

  const promoted: string[] = [];

  // Returns whether this task's subtree is "effectively done" (its own
  // status is DONE, or it should be promoted to DONE).
  const resolve = (task: T): boolean => {
    const children = byParent.get(task.id) ?? [];
    if (children.length === 0) return task.status === ETaskStatus.DONE;

    const results = children.map((c) => ({ child: c, done: resolve(c) }));
    const considered = results.filter(
      ({ child }) => child.status !== ETaskStatus.HOLD,
    );
    const shouldBeDone =
      considered.length > 0 && considered.every(({ done }) => done);

    if (
      shouldBeDone &&
      task.status !== ETaskStatus.DONE &&
      task.status !== ETaskStatus.HOLD &&
      !explicitlyChangedIds.has(task.id)
    ) {
      promoted.push(task.id);
    }

    return shouldBeDone || task.status === ETaskStatus.DONE;
  };

  const roots = byParent.get(null) ?? [];
  for (const root of roots) resolve(root);

  return promoted;
};
