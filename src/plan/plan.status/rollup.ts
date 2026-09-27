import { EPlanStatus, ETaskStatus } from '@prisma/client';

// Pure status rollup for Claude Code plans. Given the task list after one
// task changed, work out which descendants/ancestors and the plan itself
// must change too. No I/O, so it is unit-tested directly.

export interface RollupTask {
  id: string;
  parent_task_id: string | null;
  status: ETaskStatus;
}

export interface RollupResult {
  // Task id → new status, only for tasks other than the one the caller set.
  tasks: Map<string, ETaskStatus>;
  plan: EPlanStatus;
}

const TERMINAL: ETaskStatus[] = [ETaskStatus.DONE, ETaskStatus.CANCELLED];
export const isTerminal = (s: ETaskStatus) => TERMINAL.includes(s);

export const rollupTaskStatus = ({
  tasks,
  changedId,
  newStatus,
  planStatus,
}: {
  tasks: RollupTask[];
  changedId: string;
  newStatus: ETaskStatus;
  planStatus: EPlanStatus;
}): RollupResult => {
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const children = new Map<string | null, string[]>();
  for (const t of tasks) {
    const list = children.get(t.parent_task_id) ?? [];
    list.push(t.id);
    children.set(t.parent_task_id, list);
  }
  const changes = new Map<string, ETaskStatus>();
  const set = (id: string, s: ETaskStatus) => {
    if (status.get(id) === s) return;
    status.set(id, s);
    if (id !== changedId) changes.set(id, s);
  };

  set(changedId, newStatus);

  // Closing a parent closes its open descendants the same way.
  if (isTerminal(newStatus)) {
    const queue = [...(children.get(changedId) ?? [])];
    while (queue.length) {
      const id = queue.shift()!;
      if (!isTerminal(status.get(id)!)) set(id, newStatus);
      queue.push(...(children.get(id) ?? []));
    }
  }

  // Ancestors follow their children.
  let parentId = byId.get(changedId)?.parent_task_id ?? null;
  while (parentId) {
    const kids = (children.get(parentId) ?? []).map((id) => status.get(id)!);
    const current = status.get(parentId)!;
    if (kids.every(isTerminal)) {
      set(
        parentId,
        kids.every((s) => s === ETaskStatus.CANCELLED)
          ? ETaskStatus.CANCELLED
          : ETaskStatus.DONE,
      );
    } else if (kids.some((s) => s !== ETaskStatus.PENDING)) {
      set(parentId, ETaskStatus.IN_PROGRESS);
    } else if (isTerminal(current)) {
      set(parentId, ETaskStatus.PENDING);
    }
    parentId = byId.get(parentId)?.parent_task_id ?? null;
  }

  const roots = (children.get(null) ?? []).map((id) => status.get(id)!);
  const plan =
    roots.length > 0 && roots.every(isTerminal)
      ? EPlanStatus.DONE
      : planStatus === EPlanStatus.DRAFT || planStatus === EPlanStatus.DONE
        ? EPlanStatus.READY
        : planStatus;

  return { tasks: changes, plan };
};
