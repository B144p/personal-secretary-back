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
  it('promotes a parent when all children are DONE', () => {
    const parent = task({ id: 'parent', status: ETaskStatus.PENDING });
    const child1 = task({
      id: 'child1',
      parent_task_id: 'parent',
      status: ETaskStatus.DONE,
    });
    const child2 = task({
      id: 'child2',
      parent_task_id: 'parent',
      status: ETaskStatus.DONE,
    });
    expect(computeParentStatusRollup([parent, child1, child2])).toEqual([
      'parent',
    ]);
  });

  it('does not promote when a child is not DONE', () => {
    const parent = task({ id: 'parent', status: ETaskStatus.PENDING });
    const child1 = task({
      id: 'child1',
      parent_task_id: 'parent',
      status: ETaskStatus.DONE,
    });
    const child2 = task({
      id: 'child2',
      parent_task_id: 'parent',
      status: ETaskStatus.PENDING,
    });
    expect(computeParentStatusRollup([parent, child1, child2])).toEqual([]);
  });

  it('is a no-op when the parent is already DONE', () => {
    const parent = task({ id: 'parent', status: ETaskStatus.DONE });
    const child = task({
      id: 'child',
      parent_task_id: 'parent',
      status: ETaskStatus.DONE,
    });
    expect(computeParentStatusRollup([parent, child])).toEqual([]);
  });

  it('cascades a 3-level promotion up to the root', () => {
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
    const promoted = computeParentStatusRollup([root, mid, leaf]);
    expect(promoted).toEqual(expect.arrayContaining(['mid', 'root']));
    expect(promoted).toHaveLength(2);
  });

  it('ignores HOLD children when checking completeness', () => {
    const parent = task({ id: 'parent', status: ETaskStatus.PENDING });
    const child1 = task({
      id: 'child1',
      parent_task_id: 'parent',
      status: ETaskStatus.DONE,
    });
    const child2 = task({
      id: 'child2',
      parent_task_id: 'parent',
      status: ETaskStatus.HOLD,
    });
    expect(computeParentStatusRollup([parent, child1, child2])).toEqual([
      'parent',
    ]);
  });

  it('does not promote when every child is HOLD (needs >=1 non-held child)', () => {
    const parent = task({ id: 'parent', status: ETaskStatus.PENDING });
    const child1 = task({
      id: 'child1',
      parent_task_id: 'parent',
      status: ETaskStatus.HOLD,
    });
    const child2 = task({
      id: 'child2',
      parent_task_id: 'parent',
      status: ETaskStatus.HOLD,
    });
    expect(computeParentStatusRollup([parent, child1, child2])).toEqual([]);
  });

  it('never promotes a HOLD parent even if all its children are DONE', () => {
    const parent = task({ id: 'parent', status: ETaskStatus.HOLD });
    const child = task({
      id: 'child',
      parent_task_id: 'parent',
      status: ETaskStatus.DONE,
    });
    expect(computeParentStatusRollup([parent, child])).toEqual([]);
  });

  it('excludes a task explicitly changed this request', () => {
    const parent = task({ id: 'parent', status: ETaskStatus.PENDING });
    const child = task({
      id: 'child',
      parent_task_id: 'parent',
      status: ETaskStatus.DONE,
    });
    expect(
      computeParentStatusRollup([parent, child], new Set(['parent'])),
    ).toEqual([]);
  });
});
