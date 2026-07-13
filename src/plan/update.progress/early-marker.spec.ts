import { ETaskStatus } from '@prisma/client';
import { buildEarlyMarkerGroups, IEarlyMarkerTask } from './early-marker';

const task = (
  overrides: Partial<IEarlyMarkerTask> & { id: string },
): IEarlyMarkerTask => ({
  title: `Task ${overrides.id}`,
  status: ETaskStatus.DONE,
  ...overrides,
});

describe('buildEarlyMarkerGroups', () => {
  it('titles a group "[<STATUS>] Early task"', () => {
    const groups = buildEarlyMarkerGroups([
      task({ id: 't1', status: ETaskStatus.DONE }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].summary).toBe('[DONE] Early task');
  });

  it('lists every task in the group description', () => {
    const groups = buildEarlyMarkerGroups([
      task({ id: 't1', title: 'Write report', status: ETaskStatus.DONE }),
      task({ id: 't2', title: 'Review PR', status: ETaskStatus.DONE }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].description).toBe('- Write report\n- Review PR');
    expect(groups[0].taskIds).toEqual(['t1', 't2']);
  });

  it('creates one group per distinct status', () => {
    const groups = buildEarlyMarkerGroups([
      task({ id: 't1', status: ETaskStatus.DONE }),
      task({ id: 't2', status: ETaskStatus.IN_PROGRESS }),
      task({ id: 't3', status: ETaskStatus.HOLD }),
    ]);
    expect(groups.map((g) => g.status).sort()).toEqual(
      [ETaskStatus.DONE, ETaskStatus.HOLD, ETaskStatus.IN_PROGRESS].sort(),
    );
    expect(groups.every((g) => g.taskIds.length === 1)).toBe(true);
  });

  it('returns an empty array for no tasks', () => {
    expect(buildEarlyMarkerGroups([])).toEqual([]);
  });
});
