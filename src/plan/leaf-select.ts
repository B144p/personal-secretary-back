import { ETaskStatus } from '@prisma/client';

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

// A leaf still needs a calendar slot when it's neither finished nor parked.
export const isSchedulableLeaf = (status: ETaskStatus): boolean =>
  status !== ETaskStatus.DONE && status !== ETaskStatus.HOLD;

// Schedulable leaves (not DONE/HOLD) in DFS tree order — the single source of
// truth for "what needs a slot", shared by initial scheduling (calendar.schedule)
// and reschedule (update.progress) so the two can't silently drift apart again.
export const selectSchedulableLeavesInOrder = <
  T extends {
    id: string;
    parent_task_id: string | null;
    sequence_order: number;
    status: ETaskStatus;
  },
>(
  allTasks: T[],
): T[] => {
  const leafIds = getLeafIds(allTasks);
  const schedulable = allTasks.filter(
    (t) => leafIds.has(t.id) && isSchedulableLeaf(t.status),
  );
  return orderLeavesByTree(allTasks, schedulable);
};
