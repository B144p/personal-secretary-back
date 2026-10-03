// Pure: picks the plan a new Claude Code session in a repo should resume and
// renders the short block the SessionStart hook injects. No Nest, no Prisma,
// so it is unit-tested with plain objects.
//
// The block is prepended to every session in the repo, so it stays at
// CONTEXT_MAX_LINES or fewer.

export const STALE_HIDE_DAYS = 14;
export const CONTEXT_MAX_LINES = 15;
const MAX_CANCELLED = 3;
const MAX_TITLE = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ContextTask {
  id: string;
  parent_task_id: string | null;
  title: string;
  status: string;
  status_note: string | null;
  sequence_order: number;
}

export interface ContextPlan {
  id: string;
  title: string;
  status: string;
  branch: string | null;
  last_activity_at: Date;
  tasks: ContextTask[];
}

export interface RepoContext {
  repo_key: string;
  branch: string | null;
  plan: {
    id: string;
    title: string;
    status: string;
    branch: string | null;
    last_activity_at: string;
  } | null;
  counts: Record<string, number>;
  tasks_left: { id: string; title: string; status: string }[];
  cancelled: { id: string; title: string; note: string }[];
  other_open_count: number;
  stale_count: number;
  text: string;
}

const clip = (s: string, max = MAX_TITLE) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;

const age = (from: Date, now: Date) => {
  const days = Math.floor((now.getTime() - from.getTime()) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
};

// Leaves in plan order, each titled with its parent for context.
const leavesInOrder = (tasks: ContextTask[]) => {
  const children = new Map<string | null, ContextTask[]>();
  for (const t of tasks) {
    const list = children.get(t.parent_task_id) ?? [];
    list.push(t);
    children.set(t.parent_task_id, list);
  }
  for (const list of children.values())
    list.sort((a, b) => a.sequence_order - b.sequence_order);

  const out: { task: ContextTask; title: string }[] = [];
  const walk = (parentId: string | null, prefix: string) => {
    for (const t of children.get(parentId) ?? []) {
      const title = prefix ? `${prefix} › ${t.title}` : t.title;
      if (children.has(t.id)) walk(t.id, t.title);
      else out.push({ task: t, title });
    }
  };
  walk(null, '');
  return out;
};

export const pickPlan = (
  plans: ContextPlan[],
  branch: string | null,
  now: Date,
) => {
  const cutoff = now.getTime() - STALE_HIDE_DAYS * DAY_MS;
  const fresh = plans
    .filter((p) => p.last_activity_at.getTime() >= cutoff)
    .sort(
      (a, b) => b.last_activity_at.getTime() - a.last_activity_at.getTime(),
    );
  const plan =
    (branch && fresh.find((p) => p.branch === branch)) || fresh[0] || null;
  return {
    plan,
    otherOpen: fresh.length - (plan ? 1 : 0),
    stale: plans.length - fresh.length,
  };
};

export const buildRepoContext = ({
  repoKey,
  branch,
  plans,
  now,
}: {
  repoKey: string;
  branch: string | null;
  // Open plans of this repo (not DONE or HOLD).
  plans: ContextPlan[];
  now: Date;
}): RepoContext => {
  const { plan, otherOpen, stale } = pickPlan(plans, branch, now);
  const staleNote = stale
    ? ` (${stale} idle for over ${STALE_HIDE_DAYS} days, see list_plans)`
    : '';

  if (!plan) {
    return {
      repo_key: repoKey,
      branch,
      plan: null,
      counts: {},
      tasks_left: [],
      cancelled: [],
      other_open_count: 0,
      stale_count: stale,
      text: `Personal PM: no open plan for this repo${staleNote}.`,
    };
  }

  const leaves = leavesInOrder(plan.tasks);
  const counts: Record<string, number> = {};
  for (const { task } of leaves)
    counts[task.status] = (counts[task.status] ?? 0) + 1;

  const open = leaves.filter(
    ({ task }) => !['DONE', 'CANCELLED'].includes(task.status),
  );
  const tasksLeft = [
    ...open.filter(({ task }) => task.status === 'IN_PROGRESS'),
    ...open.filter(({ task }) => task.status !== 'IN_PROGRESS'),
  ];
  const cancelled = leaves
    .filter(({ task }) => task.status === 'CANCELLED' && task.status_note)
    .slice(-MAX_CANCELLED);

  const branchNote =
    plan.branch && plan.branch !== branch ? `, made on ${plan.branch}` : '';
  const header = [
    '## Personal PM: open plan in this repo',
    `Repo: ${repoKey}${branch ? ` (branch: ${branch})` : ''}`,
    `Plan: "${clip(plan.title)}" · ${plan.status} · id ${plan.id} · active ${age(plan.last_activity_at, now)}${branchNote}`,
    `Steps: ${['DONE', 'IN_PROGRESS', 'PENDING', 'HOLD', 'CANCELLED']
      .filter((s) => counts[s])
      .map((s) => `${counts[s]} ${s}`)
      .join(' · ')}`,
  ];
  const footer = [
    ...(otherOpen
      ? [
          `${otherOpen} other open plan${otherOpen > 1 ? 's' : ''} in this repo: call list_plans with this repo_key${staleNote}.`,
        ]
      : stale
        ? [`Older plans${staleNote}.`]
        : []),
    'Report steps with update_task_status; get_plan shows the full tree.',
  ];

  const cancelledLines = cancelled.map(
    ({ task, title }) =>
      `  [CANCELLED] ${clip(title)} — ${clip(task.status_note ?? '', 120)}`,
  );
  // Task lines share what is left of the budget; cancelled notes are kept
  // because they stop a fresh session from redoing dropped work.
  let budget =
    CONTEXT_MAX_LINES - header.length - footer.length - cancelledLines.length;
  const taskLines: string[] = [];
  if (tasksLeft.length > budget) budget -= 1; // room for the "+N more" line
  for (const { task, title } of tasksLeft.slice(0, Math.max(budget, 0)))
    taskLines.push(`  [${task.status}] ${clip(title)} (id ${task.id})`);
  const hidden = tasksLeft.length - taskLines.length;
  if (hidden > 0) taskLines.push(`  +${hidden} more open steps (get_plan)`);

  const text = [...header, ...taskLines, ...cancelledLines, ...footer]
    .slice(0, CONTEXT_MAX_LINES)
    .join('\n');

  return {
    repo_key: repoKey,
    branch,
    plan: {
      id: plan.id,
      title: plan.title,
      status: plan.status,
      branch: plan.branch,
      last_activity_at: plan.last_activity_at.toISOString(),
    },
    counts,
    tasks_left: tasksLeft.map(({ task, title }) => ({
      id: task.id,
      title,
      status: task.status,
    })),
    cancelled: cancelled.map(({ task, title }) => ({
      id: task.id,
      title,
      note: task.status_note ?? '',
    })),
    other_open_count: otherOpen,
    stale_count: stale,
    text,
  };
};
