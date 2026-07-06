import { ETaskStatus } from '@prisma/client';
import dayjs from 'dayjs';
import {
  allNonHeldLeavesDone,
  classifyLeaves,
  computeParentStatusRollup,
  findHeldLeavesWithFutureEvents,
  getLeafIds,
} from './classify';

const now = dayjs('2026-07-06T12:00:00Z');
const past = now.subtract(1, 'hour').toDate();
const future = now.add(1, 'hour').toDate();

type FakeTask = {
  id: string;
  parent_task_id: string | null;
  status: ETaskStatus;
  events: { end: Date }[];
};

const task = (overrides: Partial<FakeTask> & { id: string }): FakeTask => ({
  parent_task_id: null,
  status: ETaskStatus.PENDING,
  events: [],
  ...overrides,
});

describe('getLeafIds', () => {
  it('excludes tasks that have children', () => {
    const tasks = [
      task({ id: 'parent' }),
      task({ id: 'child', parent_task_id: 'parent' }),
    ];
    expect(getLeafIds(tasks)).toEqual(new Set(['child']));
  });
});

describe('findHeldLeavesWithFutureEvents', () => {
  it('includes a HOLD leaf whose active event ends in the future', () => {
    const t = task({
      id: 't1',
      status: ETaskStatus.HOLD,
      events: [{ end: future }],
    });
    const leafIds = getLeafIds([t]);
    expect(findHeldLeavesWithFutureEvents([t], leafIds, now)).toEqual([t]);
  });

  it('excludes a HOLD leaf whose active event already ended', () => {
    const t = task({
      id: 't1',
      status: ETaskStatus.HOLD,
      events: [{ end: past }],
    });
    const leafIds = getLeafIds([t]);
    expect(findHeldLeavesWithFutureEvents([t], leafIds, now)).toEqual([]);
  });

  it('excludes a non-HOLD leaf even with a future event', () => {
    const t = task({
      id: 't1',
      status: ETaskStatus.PENDING,
      events: [{ end: future }],
    });
    const leafIds = getLeafIds([t]);
    expect(findHeldLeavesWithFutureEvents([t], leafIds, now)).toEqual([]);
  });

  it('excludes a non-leaf task', () => {
    const parent = task({
      id: 'parent',
      status: ETaskStatus.HOLD,
      events: [{ end: future }],
    });
    const child = task({ id: 'child', parent_task_id: 'parent' });
    const leafIds = getLeafIds([parent, child]);
    expect(
      findHeldLeavesWithFutureEvents([parent, child], leafIds, now),
    ).toEqual([]);
  });
});

describe('allNonHeldLeavesDone', () => {
  it('is true when every non-held leaf is DONE', () => {
    const tasks = [
      task({ id: 't1', status: ETaskStatus.DONE }),
      task({ id: 't2', status: ETaskStatus.HOLD }),
    ];
    expect(allNonHeldLeavesDone(tasks, getLeafIds(tasks))).toBe(true);
  });

  it('is false when a non-held leaf is not DONE', () => {
    const tasks = [
      task({ id: 't1', status: ETaskStatus.DONE }),
      task({ id: 't2', status: ETaskStatus.PENDING }),
    ];
    expect(allNonHeldLeavesDone(tasks, getLeafIds(tasks))).toBe(false);
  });

  it('is false when every leaf is HOLD (stays stalled, not auto-completed)', () => {
    const tasks = [task({ id: 't1', status: ETaskStatus.HOLD })];
    expect(allNonHeldLeavesDone(tasks, getLeafIds(tasks))).toBe(false);
  });
});

describe('classifyLeaves', () => {
  it('buckets a slipped leaf: not done/held, event already ended', () => {
    const t = task({
      id: 't1',
      status: ETaskStatus.IN_PROGRESS,
      events: [{ end: past }],
    });
    const leafIds = getLeafIds([t]);
    const result = classifyLeaves({
      allTasks: [t],
      leafIds,
      statusChanges: [],
      now,
    });
    expect(result.slippedLeaves).toEqual([t]);
    expect(result.remainingLeaves).toEqual([t]);
    expect(result.completedEarly).toEqual([]);
    expect(result.completedLate).toEqual([]);
  });

  it('buckets a leaf completed early: just marked DONE, event still in the future', () => {
    const t = task({
      id: 't1',
      status: ETaskStatus.DONE,
      events: [{ end: future }],
    });
    const leafIds = getLeafIds([t]);
    const result = classifyLeaves({
      allTasks: [t],
      leafIds,
      statusChanges: [{ taskId: 't1', newStatus: 'DONE' }],
      now,
    });
    expect(result.completedEarly).toEqual([t]);
    expect(result.completedLate).toEqual([]);
    expect(result.slippedLeaves).toEqual([]);
    // DONE tasks never need a new calendar slot
    expect(result.remainingLeaves).toEqual([]);
  });

  it('buckets a leaf completed late: just marked DONE, event already ended', () => {
    const t = task({
      id: 't1',
      status: ETaskStatus.DONE,
      events: [{ end: past }],
    });
    const leafIds = getLeafIds([t]);
    const result = classifyLeaves({
      allTasks: [t],
      leafIds,
      statusChanges: [{ taskId: 't1', newStatus: 'DONE' }],
      now,
    });
    expect(result.completedLate).toEqual([t]);
    expect(result.completedEarly).toEqual([]);
    expect(result.slippedLeaves).toEqual([]);
    expect(result.remainingLeaves).toEqual([]);
  });

  it('excludes DONE and HOLD leaves from remainingLeaves', () => {
    const done = task({
      id: 'done',
      status: ETaskStatus.DONE,
      events: [{ end: past }],
    });
    const held = task({
      id: 'held',
      status: ETaskStatus.HOLD,
      events: [{ end: future }],
    });
    const pending = task({ id: 'pending', status: ETaskStatus.PENDING });
    const tasks = [done, held, pending];
    const leafIds = getLeafIds(tasks);
    const result = classifyLeaves({
      allTasks: tasks,
      leafIds,
      statusChanges: [],
      now,
    });
    expect(result.remainingLeaves).toEqual([pending]);
  });

  it('ignores non-leaf (parent) tasks entirely', () => {
    const parent = task({
      id: 'parent',
      status: ETaskStatus.IN_PROGRESS,
      events: [{ end: past }],
    });
    const child = task({ id: 'child', parent_task_id: 'parent' });
    const tasks = [parent, child];
    const leafIds = getLeafIds(tasks);
    const result = classifyLeaves({
      allTasks: tasks,
      leafIds,
      statusChanges: [],
      now,
    });
    expect(result.slippedLeaves).toEqual([]);
    expect(result.remainingLeaves).toEqual([child]);
  });
});

describe('computeParentStatusRollup', () => {
  // Builds a parent + N children with the given statuses, and returns the
  // derived status computeParentStatusRollup assigns to the parent (or
  // undefined if it's left unchanged).
  const deriveFor = (
    parentStatus: ETaskStatus,
    childStatuses: ETaskStatus[],
  ): ETaskStatus | undefined => {
    const parent = task({ id: 'parent', status: parentStatus });
    const children = childStatuses.map((status, i) =>
      task({ id: `child${i}`, parent_task_id: 'parent', status }),
    );
    const changes = computeParentStatusRollup([parent, ...children]);
    return changes.find((c) => c.id === 'parent')?.status;
  };

  it('derives DONE when all non-HOLD children are DONE', () => {
    expect(
      deriveFor(ETaskStatus.PENDING, [ETaskStatus.DONE, ETaskStatus.DONE]),
    ).toBe(ETaskStatus.DONE);
  });

  it('derives DONE when HOLD children are mixed in but the rest are DONE', () => {
    expect(
      deriveFor(ETaskStatus.PENDING, [ETaskStatus.DONE, ETaskStatus.HOLD]),
    ).toBe(ETaskStatus.DONE);
  });

  it('derives IN_PROGRESS when a child is IN_PROGRESS', () => {
    expect(
      deriveFor(ETaskStatus.PENDING, [
        ETaskStatus.IN_PROGRESS,
        ETaskStatus.PENDING,
      ]),
    ).toBe(ETaskStatus.IN_PROGRESS);
  });

  it('derives IN_PROGRESS when some (not all) non-HOLD children are DONE', () => {
    expect(
      deriveFor(ETaskStatus.PENDING, [ETaskStatus.DONE, ETaskStatus.PENDING]),
    ).toBe(ETaskStatus.IN_PROGRESS);
  });

  it('derives HOLD when every child is HOLD', () => {
    expect(
      deriveFor(ETaskStatus.PENDING, [ETaskStatus.HOLD, ETaskStatus.HOLD]),
    ).toBe(ETaskStatus.HOLD);
  });

  it('leaves PENDING unchanged when nothing has started', () => {
    expect(
      deriveFor(ETaskStatus.PENDING, [
        ETaskStatus.PENDING,
        ETaskStatus.PENDING,
      ]),
    ).toBeUndefined();
  });

  it('is a no-op when the parent already matches the derived status', () => {
    expect(
      deriveFor(ETaskStatus.DONE, [ETaskStatus.DONE, ETaskStatus.DONE]),
    ).toBeUndefined();
  });

  it('moves a HOLD parent to DONE once all its children are DONE (re-derivation overrides HOLD)', () => {
    expect(
      deriveFor(ETaskStatus.HOLD, [ETaskStatus.DONE, ETaskStatus.DONE]),
    ).toBe(ETaskStatus.DONE);
  });

  it('cascades a 3-level DONE promotion up to the root', () => {
    const root = task({ id: 'root', status: ETaskStatus.PENDING });
    const mid = task({
      id: 'mid',
      parent_task_id: 'root',
      status: ETaskStatus.PENDING,
    });
    const leaf = task({
      id: 'leaf',
      parent_task_id: 'mid',
      status: ETaskStatus.DONE,
    });
    const changes = computeParentStatusRollup([root, mid, leaf]);
    expect(changes).toEqual(
      expect.arrayContaining([
        { id: 'mid', status: ETaskStatus.DONE },
        { id: 'root', status: ETaskStatus.DONE },
      ]),
    );
    expect(changes).toHaveLength(2);
  });

  it('cascades a 3-level IN_PROGRESS promotion up to the root', () => {
    const root = task({ id: 'root', status: ETaskStatus.PENDING });
    const mid = task({
      id: 'mid',
      parent_task_id: 'root',
      status: ETaskStatus.PENDING,
    });
    const leaf = task({
      id: 'leaf',
      parent_task_id: 'mid',
      status: ETaskStatus.IN_PROGRESS,
    });
    const changes = computeParentStatusRollup([root, mid, leaf]);
    expect(changes).toEqual(
      expect.arrayContaining([
        { id: 'mid', status: ETaskStatus.IN_PROGRESS },
        { id: 'root', status: ETaskStatus.IN_PROGRESS },
      ]),
    );
    expect(changes).toHaveLength(2);
  });

  it('excludes a task explicitly changed this request, but still propagates its explicit status to the parent', () => {
    const root = task({ id: 'root', status: ETaskStatus.PENDING });
    const mid = task({
      id: 'mid',
      parent_task_id: 'root',
      status: ETaskStatus.DONE,
    });
    const leaf = task({
      id: 'leaf',
      parent_task_id: 'mid',
      status: ETaskStatus.PENDING,
    });
    const changes = computeParentStatusRollup(
      [root, mid, leaf],
      new Set(['mid']),
    );
    // `mid` itself is left alone (explicitly changed this request)...
    expect(changes.find((c) => c.id === 'mid')).toBeUndefined();
    // ...but `root` still derives from mid's explicit DONE status.
    expect(changes).toEqual([{ id: 'root', status: ETaskStatus.DONE }]);
  });

  it('still re-derives parents nested below an explicitly-changed ancestor', () => {
    // root (explicitly changed) > mid > leaf(DONE): mid must still be derived
    // even though its ancestor root is pinned.
    const root = task({ id: 'root', status: ETaskStatus.HOLD });
    const mid = task({
      id: 'mid',
      parent_task_id: 'root',
      status: ETaskStatus.PENDING,
    });
    const leaf = task({
      id: 'leaf',
      parent_task_id: 'mid',
      status: ETaskStatus.DONE,
    });
    const changes = computeParentStatusRollup(
      [root, mid, leaf],
      new Set(['root']),
    );
    expect(changes.find((c) => c.id === 'root')).toBeUndefined();
    expect(changes).toEqual([{ id: 'mid', status: ETaskStatus.DONE }]);
  });
});
