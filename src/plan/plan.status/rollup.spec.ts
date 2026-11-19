import { EPlanStatus, ETaskStatus } from '@prisma/client';
import {
  activePlanStatus,
  rollupTaskStatus,
  rollupTaskStatuses,
  type RollupTask,
} from './rollup';

const { PENDING, IN_PROGRESS, DONE, CANCELLED } = ETaskStatus;

// A ── A1, A2      B (leaf)
const tree = (s: Partial<Record<string, ETaskStatus>> = {}): RollupTask[] => [
  { id: 'A', parent_task_id: null, status: s.A ?? PENDING },
  { id: 'A1', parent_task_id: 'A', status: s.A1 ?? PENDING },
  { id: 'A2', parent_task_id: 'A', status: s.A2 ?? PENDING },
  { id: 'B', parent_task_id: null, status: s.B ?? PENDING },
];

const run = (
  tasks: RollupTask[],
  changedId: string,
  newStatus: ETaskStatus,
  planStatus: EPlanStatus = EPlanStatus.DRAFT,
) => rollupTaskStatus({ tasks, changedId, newStatus, planStatus });

describe('rollupTaskStatus', () => {
  it('moves a DRAFT plan to READY and the parent to IN_PROGRESS when a child starts', () => {
    const r = run(tree(), 'A1', IN_PROGRESS);
    expect(r.plan).toBe(EPlanStatus.READY);
    expect(Object.fromEntries(r.tasks)).toEqual({ A: IN_PROGRESS });
  });

  it('marks the parent DONE once every child is DONE or CANCELLED', () => {
    const r = run(tree({ A1: CANCELLED }), 'A2', DONE, EPlanStatus.READY);
    expect(r.tasks.get('A')).toBe(DONE);
    expect(r.plan).toBe(EPlanStatus.READY);
  });

  it('marks the parent CANCELLED when every child is cancelled', () => {
    const r = run(tree({ A1: CANCELLED }), 'A2', CANCELLED);
    expect(r.tasks.get('A')).toBe(CANCELLED);
  });

  it('closes open descendants when a parent is closed, keeping finished ones', () => {
    const r = run(tree({ A1: DONE }), 'A', CANCELLED);
    expect(Object.fromEntries(r.tasks)).toEqual({ A2: CANCELLED });
  });

  it('marks the plan DONE when every top-level task is terminal', () => {
    const r = run(
      tree({ A: DONE, A1: DONE, A2: DONE }),
      'B',
      DONE,
      EPlanStatus.READY,
    );
    expect(r.plan).toBe(EPlanStatus.DONE);
  });

  it('reopens a DONE plan and its closed parent when a task goes back to PENDING', () => {
    const r = run(
      tree({ A: DONE, A1: DONE, A2: DONE, B: DONE }),
      'A2',
      PENDING,
      EPlanStatus.DONE,
    );
    expect(r.plan).toBe(EPlanStatus.READY);
    expect(r.tasks.get('A')).toBe(IN_PROGRESS);
  });

  it('leaves unrelated tasks alone', () => {
    const r = run(tree(), 'B', DONE);
    expect(r.tasks.size).toBe(0);
    expect(r.plan).toBe(EPlanStatus.READY);
  });

  it('treats a stale HOLD plan as READY again, but keeps a paused one on HOLD', () => {
    expect(activePlanStatus(EPlanStatus.HOLD, false)).toBe(EPlanStatus.READY);
    expect(activePlanStatus(EPlanStatus.HOLD, true)).toBe(EPlanStatus.HOLD);
    expect(activePlanStatus(EPlanStatus.DRAFT, false)).toBe(EPlanStatus.DRAFT);
  });
});

describe('rollupTaskStatuses', () => {
  const runAll = (
    tasks: RollupTask[],
    changes: [string, ETaskStatus][],
    planStatus: EPlanStatus = EPlanStatus.READY,
  ) =>
    rollupTaskStatuses({
      tasks,
      changes: changes.map(([id, status]) => ({ id, status })),
      planStatus,
    });

  it('closes the parent when siblings close in the same batch', () => {
    const r = runAll(tree(), [
      ['A1', DONE],
      ['A2', CANCELLED],
    ]);
    expect(Object.fromEntries(r.tasks)).toEqual({
      A: DONE,
      A1: DONE,
      A2: CANCELLED,
    });
    expect(r.plan).toBe(EPlanStatus.READY);
  });

  it('marks the plan DONE when the batch closes every top-level task', () => {
    const r = runAll(tree(), [
      ['A1', DONE],
      ['A2', DONE],
      ['B', DONE],
    ]);
    expect(r.plan).toBe(EPlanStatus.DONE);
  });

  it('lets a later parent close override an earlier open child', () => {
    const r = runAll(tree(), [
      ['A1', IN_PROGRESS],
      ['A', CANCELLED],
    ]);
    expect(Object.fromEntries(r.tasks)).toEqual({
      A: CANCELLED,
      A1: CANCELLED,
      A2: CANCELLED,
    });
  });

  it('applies changes in list order', () => {
    const r = runAll(tree(), [
      ['A', CANCELLED],
      ['A1', IN_PROGRESS],
    ]);
    expect(Object.fromEntries(r.tasks)).toEqual({
      A: IN_PROGRESS,
      A1: IN_PROGRESS,
      A2: CANCELLED,
    });
  });

  it('reopens a DONE plan and its closed parent', () => {
    const r = runAll(
      tree({ A: DONE, A1: DONE, A2: DONE, B: DONE }),
      [['A2', PENDING]],
      EPlanStatus.DONE,
    );
    expect(r.plan).toBe(EPlanStatus.READY);
    expect(Object.fromEntries(r.tasks)).toEqual({
      A: IN_PROGRESS,
      A2: PENDING,
    });
  });

  it('matches the same updates made one by one', () => {
    const first = run(tree(), 'A1', DONE);
    const afterFirst = tree({ A1: DONE, A: first.tasks.get('A') });
    const second = run(afterFirst, 'B', IN_PROGRESS, first.plan);

    const r = runAll(
      tree(),
      [
        ['A1', DONE],
        ['B', IN_PROGRESS],
      ],
      EPlanStatus.DRAFT,
    );
    expect(r.plan).toBe(second.plan);
    expect(Object.fromEntries(r.tasks)).toEqual({
      A: first.tasks.get('A'),
      A1: DONE,
      B: IN_PROGRESS,
    });
  });

  it('does not mutate the task list it is given', () => {
    const tasks = tree();
    runAll(tasks, [['A1', DONE]]);
    expect(tasks).toEqual(tree());
  });
});
