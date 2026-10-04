import {
  type ProgressPlan,
  type ProgressTask,
  summarizePlanProgress,
} from './progress-summary';

const NOW = new Date('2026-10-05T05:00:00Z');
const at = (h: number) => new Date(NOW.getTime() + h * 3600_000);

const leaf = (
  id: string,
  status: string,
  events: ProgressTask['events'] = [],
): ProgressTask => ({ id, parent_task_id: 'root', title: id, status, events });

const plan = (tasks: ProgressTask[], over: Partial<ProgressPlan> = {}) => ({
  id: 'p1',
  title: 'Landing page',
  status: 'SCHEDULED',
  source_type: null,
  source_id: null,
  is_paused: false,
  created_at: new Date('2026-10-01T00:00:00Z'),
  tasks: [
    {
      id: 'root',
      parent_task_id: null,
      title: 'root',
      status: 'IN_PROGRESS',
      events: [],
    },
    ...tasks,
  ],
  ...over,
});

describe('summarizePlanProgress', () => {
  it('counts leaves and leaves HOLD and CANCELLED out of the percentage', () => {
    const p = summarizePlanProgress(
      plan([
        leaf('a', 'DONE'),
        leaf('b', 'DONE'),
        leaf('c', 'PENDING'),
        leaf('d', 'HOLD'),
        leaf('e', 'CANCELLED'),
      ]),
      null,
      NOW,
    );
    expect(p.leaves).toEqual({
      total: 5,
      done: 2,
      in_progress: 0,
      pending: 1,
      hold: 1,
      cancelled: 1,
    });
    expect(p.percent_done).toBe(67);
    expect(p.source_type).toBe('GENERATE');
  });

  it('finds slipped steps, the next session and the planned finish', () => {
    const p = summarizePlanProgress(
      plan([
        leaf('late', 'PENDING', [{ start: at(-3), end: at(-2) }]),
        leaf('done-past', 'DONE', [{ start: at(-5), end: at(-4) }]),
        leaf('next', 'PENDING', [{ start: at(2), end: at(3) }]),
        leaf('later', 'IN_PROGRESS', [{ start: at(24), end: at(25) }]),
      ]),
      new Date('2026-10-04T14:40:00Z'),
      NOW,
    );
    expect(p.slipped).toBe(1);
    expect(p.next_session).toEqual({
      task_id: 'next',
      title: 'next',
      start: at(2).toISOString(),
    });
    expect(p.planned_finish).toBe(at(25).toISOString());
    expect(p.last_feedback_at).toBe('2026-10-04T14:40:00.000Z');
  });

  it('has no sessions or finish for a plan with no booked events', () => {
    const p = summarizePlanProgress(
      plan([leaf('a', 'PENDING')], { status: 'DRAFT' }),
      null,
      NOW,
    );
    expect(p.next_session).toBeNull();
    expect(p.planned_finish).toBeNull();
    expect(p.percent_done).toBe(0);
  });
});
