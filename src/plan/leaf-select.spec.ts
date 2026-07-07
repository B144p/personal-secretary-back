import { ETaskStatus } from '@prisma/client';
import {
  getLeafIds,
  isSchedulableLeaf,
  orderLeavesByTree,
  selectSchedulableLeavesInOrder,
} from './leaf-select';

type FakeTask = {
  id: string;
  parent_task_id: string | null;
  sequence_order: number;
  status: ETaskStatus;
};

const task = (overrides: Partial<FakeTask> & { id: string }): FakeTask => ({
  parent_task_id: null,
  sequence_order: 0,
  status: ETaskStatus.PENDING,
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

describe('orderLeavesByTree', () => {
  it('orders leaves depth-first by sequence_order within each sibling group', () => {
    const root = task({ id: 'root' });
    const a = task({ id: 'a', parent_task_id: 'root', sequence_order: 1 });
    const b = task({ id: 'b', parent_task_id: 'root', sequence_order: 0 });
    const b1 = task({ id: 'b1', parent_task_id: 'b', sequence_order: 0 });
    const allTasks = [root, a, b, b1];
    const targetLeaves = [a, b1];

    expect(orderLeavesByTree(allTasks, targetLeaves).map((t) => t.id)).toEqual([
      'b1',
      'a',
    ]);
  });

  it('ignores tasks not present in targetLeaves', () => {
    const parent = task({ id: 'parent' });
    const child = task({ id: 'child', parent_task_id: 'parent' });
    expect(
      orderLeavesByTree([parent, child], [child]).map((t) => t.id),
    ).toEqual(['child']);
  });
});

describe('isSchedulableLeaf', () => {
  it('is true for PENDING and IN_PROGRESS', () => {
    expect(isSchedulableLeaf(ETaskStatus.PENDING)).toBe(true);
    expect(isSchedulableLeaf(ETaskStatus.IN_PROGRESS)).toBe(true);
  });

  it('is false for DONE and HOLD', () => {
    expect(isSchedulableLeaf(ETaskStatus.DONE)).toBe(false);
    expect(isSchedulableLeaf(ETaskStatus.HOLD)).toBe(false);
  });
});

describe('selectSchedulableLeavesInOrder', () => {
  it('excludes non-leaf (parent) tasks', () => {
    const parent = task({ id: 'parent' });
    const child = task({ id: 'child', parent_task_id: 'parent' });
    expect(
      selectSchedulableLeavesInOrder([parent, child]).map((t) => t.id),
    ).toEqual(['child']);
  });

  it('excludes DONE and HOLD leaves, keeps PENDING and IN_PROGRESS', () => {
    const tasks = [
      task({ id: 'done', status: ETaskStatus.DONE, sequence_order: 0 }),
      task({ id: 'held', status: ETaskStatus.HOLD, sequence_order: 1 }),
      task({ id: 'pending', status: ETaskStatus.PENDING, sequence_order: 2 }),
      task({
        id: 'in_progress',
        status: ETaskStatus.IN_PROGRESS,
        sequence_order: 3,
      }),
    ];
    expect(selectSchedulableLeavesInOrder(tasks).map((t) => t.id)).toEqual([
      'pending',
      'in_progress',
    ]);
  });

  it('returns schedulable leaves in DFS tree order across nested subtrees', () => {
    const root = task({ id: 'root', sequence_order: 0 });
    const groupA = task({
      id: 'groupA',
      parent_task_id: 'root',
      sequence_order: 0,
    });
    const groupB = task({
      id: 'groupB',
      parent_task_id: 'root',
      sequence_order: 1,
    });
    const a1 = task({
      id: 'a1',
      parent_task_id: 'groupA',
      sequence_order: 0,
    });
    const b1 = task({
      id: 'b1',
      parent_task_id: 'groupB',
      status: ETaskStatus.DONE,
      sequence_order: 0,
    });
    const b2 = task({
      id: 'b2',
      parent_task_id: 'groupB',
      status: ETaskStatus.IN_PROGRESS,
      sequence_order: 1,
    });

    const result = selectSchedulableLeavesInOrder([
      root,
      groupA,
      groupB,
      a1,
      b1,
      b2,
    ]);
    expect(result.map((t) => t.id)).toEqual(['a1', 'b2']);
  });
});
