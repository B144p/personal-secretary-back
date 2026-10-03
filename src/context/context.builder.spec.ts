import {
  buildRepoContext,
  CONTEXT_MAX_LINES,
  type ContextPlan,
  type ContextTask,
  STALE_HIDE_DAYS,
} from './context.builder';

const NOW = new Date('2026-10-04T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let seq = 0;
const task = (
  title: string,
  status = 'PENDING',
  extra: Partial<ContextTask> = {},
): ContextTask => ({
  id: `t${++seq}`,
  parent_task_id: null,
  title,
  status,
  status_note: null,
  sequence_order: seq,
  ...extra,
});

const plan = (extra: Partial<ContextPlan> = {}): ContextPlan => ({
  id: `p${++seq}`,
  title: 'CSV export',
  status: 'READY',
  branch: 'main',
  last_activity_at: daysAgo(1),
  tasks: [task('Only step')],
  ...extra,
});

const build = (plans: ContextPlan[], branch: string | null = 'main') =>
  buildRepoContext({ repoKey: 'github.com/me/repo', branch, plans, now: NOW });

describe('buildRepoContext', () => {
  it('prefers the open plan on the current branch', () => {
    const onBranch = plan({
      title: 'On branch',
      branch: 'feat/x',
      last_activity_at: daysAgo(3),
    });
    const newer = plan({
      title: 'Newer',
      branch: 'main',
      last_activity_at: daysAgo(0),
    });
    const ctx = build([newer, onBranch], 'feat/x');
    expect(ctx.plan?.title).toBe('On branch');
    expect(ctx.other_open_count).toBe(1);
    expect(ctx.text).toContain('1 other open plan in this repo');
  });

  it('falls back to the most recently active plan', () => {
    const older = plan({
      title: 'Older',
      branch: 'a',
      last_activity_at: daysAgo(5),
    });
    const newer = plan({
      title: 'Newer',
      branch: 'b',
      last_activity_at: daysAgo(2),
    });
    const ctx = build([older, newer], 'other');
    expect(ctx.plan?.title).toBe('Newer');
    expect(ctx.text).toContain('active 2 days ago, made on b');
  });

  it('returns one line when there is no open plan', () => {
    const ctx = build([]);
    expect(ctx.plan).toBeNull();
    expect(ctx.text).toBe('Personal PM: no open plan for this repo.');
  });

  it('leaves out plans idle longer than the stale window and counts them', () => {
    const stale = plan({ last_activity_at: daysAgo(STALE_HIDE_DAYS + 1) });
    const ctx = build([stale]);
    expect(ctx.plan).toBeNull();
    expect(ctx.stale_count).toBe(1);
    expect(ctx.text).toContain('1 idle for over 14 days');
  });

  it('lists IN_PROGRESS first, keeps cancelled reasons and names the parent', () => {
    const parent = task('API', 'IN_PROGRESS');
    const p = plan({
      tasks: [
        parent,
        task('Write tests', 'PENDING', { parent_task_id: parent.id }),
        task('Stream rows', 'IN_PROGRESS', { parent_task_id: parent.id }),
        task('Serializer', 'DONE', { parent_task_id: parent.id }),
        task('Add endpoint', 'CANCELLED', {
          parent_task_id: parent.id,
          status_note: 'one already existed',
        }),
      ],
    });
    const ctx = build([p]);
    const lines = ctx.text.split('\n');
    expect(lines[3]).toBe(
      'Steps: 1 DONE · 1 IN_PROGRESS · 1 PENDING · 1 CANCELLED',
    );
    expect(lines[4]).toMatch(
      /^ {2}\[IN_PROGRESS\] API › Stream rows \(id t\d+\)$/,
    );
    expect(lines[5]).toMatch(/^ {2}\[PENDING\] API › Write tests/);
    expect(ctx.text).toContain(
      '[CANCELLED] API › Add endpoint — one already existed',
    );
    expect(ctx.tasks_left.map((t) => t.status)).toEqual([
      'IN_PROGRESS',
      'PENDING',
    ]);
  });

  it(`never goes over ${CONTEXT_MAX_LINES} lines`, () => {
    const many = Array.from({ length: 40 }, (_, i) => task(`Step ${i}`));
    const cancelled = Array.from({ length: 5 }, (_, i) =>
      task(`Dropped ${i}`, 'CANCELLED', { status_note: 'not needed' }),
    );
    const ctx = build([
      plan({ tasks: [...many, ...cancelled] }),
      plan(),
      plan({ last_activity_at: daysAgo(30) }),
    ]);
    const lines = ctx.text.split('\n');
    expect(lines.length).toBeLessThanOrEqual(CONTEXT_MAX_LINES);
    expect(ctx.text).toMatch(/\+\d+ more open steps \(get_plan\)/);
    expect(ctx.text).toContain('Dropped 4');
    expect(ctx.tasks_left).toHaveLength(40);
  });
});
