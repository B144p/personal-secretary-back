import { ETaskStatus } from '@prisma/client';
import dayjs, { Dayjs } from 'dayjs';
import { isSchedulableLeaf } from '../leaf-select';
import type { IStatusChange } from './interface';

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
// - earlyLeaves: just changed to DONE/IN_PROGRESS/HOLD, event hasn't ended
//   yet — the superset of "ahead of schedule" changes that get an
//   "[STATUS] Early task" marker event (completedEarly is its DONE subset)
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
  earlyLeaves: T[];
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
    (t) => leafIds.has(t.id) && isSchedulableLeaf(t.status),
  );

  const earlyStatuses = new Set<string>([
    ETaskStatus.DONE,
    ETaskStatus.IN_PROGRESS,
    ETaskStatus.HOLD,
  ]);
  const changedStatusByTaskId = new Map(
    statusChanges
      .filter((sc) => earlyStatuses.has(sc.newStatus))
      .map((sc) => [sc.taskId, sc.newStatus]),
  );
  const earlyLeaves = allTasks.filter((t) => {
    if (!leafIds.has(t.id)) return false;
    if (!changedStatusByTaskId.has(t.id)) return false;
    const activeEvent = t.events[0];
    if (!activeEvent) return false;
    return dayjs(activeEvent.end).isAfter(now);
  });

  return {
    slippedLeaves,
    completedEarly,
    completedLate,
    remainingLeaves,
    earlyLeaves,
  };
};

// Derives a parent's status from its children's (already-resolved) statuses:
// - all non-HOLD children DONE (≥1 such child) → DONE
// - any child IN_PROGRESS, or (≥1 non-HOLD child DONE but not all) → IN_PROGRESS
// - every child HOLD → HOLD
// - otherwise → PENDING
const deriveParentStatus = (childStatuses: ETaskStatus[]): ETaskStatus => {
  const nonHold = childStatuses.filter((s) => s !== ETaskStatus.HOLD);

  if (nonHold.length > 0 && nonHold.every((s) => s === ETaskStatus.DONE)) {
    return ETaskStatus.DONE;
  }
  if (childStatuses.some((s) => s === ETaskStatus.IN_PROGRESS)) {
    return ETaskStatus.IN_PROGRESS;
  }
  if (nonHold.some((s) => s === ETaskStatus.DONE)) {
    return ETaskStatus.IN_PROGRESS;
  }
  if (nonHold.length === 0) {
    return ETaskStatus.HOLD;
  }
  return ETaskStatus.PENDING;
};

// Bottom-up: re-derives every parent's status from its children, cascading
// through multiple levels — a parent's status always reflects its subtree
// (see deriveParentStatus). Tasks explicitly changed this request keep their
// explicit status (and that status propagates to their own parent), rather
// than being overwritten by the derived value.
// Returns the {id, status} pairs that actually change.
export const computeParentStatusRollup = <
  T extends Pick<StatusClassifiable, 'id' | 'parent_task_id' | 'status'>,
>(
  allTasks: T[],
  explicitlyChangedIds: Set<string> = new Set(),
): { id: string; status: ETaskStatus }[] => {
  const byParent = new Map<string | null, T[]>();
  for (const t of allTasks) {
    if (!byParent.has(t.parent_task_id)) byParent.set(t.parent_task_id, []);
    byParent.get(t.parent_task_id)!.push(t);
  }

  const changes: { id: string; status: ETaskStatus }[] = [];

  // Returns this task's effective status (its own, for leaves and
  // explicitly-changed tasks; otherwise the derived status). Always recurses
  // first so nodes below an explicitly-changed ancestor still get re-derived.
  const resolve = (task: T): ETaskStatus => {
    const children = byParent.get(task.id) ?? [];
    if (children.length === 0) return task.status;

    const childStatuses = children.map(resolve);

    // Respect an explicit change to this node: keep its status and propagate
    // it upward, but its descendants were still re-derived above.
    if (explicitlyChangedIds.has(task.id)) return task.status;

    const derived = deriveParentStatus(childStatuses);
    if (derived !== task.status) {
      changes.push({ id: task.id, status: derived });
    }

    return derived;
  };

  const roots = byParent.get(null) ?? [];
  for (const root of roots) resolve(root);

  return changes;
};
