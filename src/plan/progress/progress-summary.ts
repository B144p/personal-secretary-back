// Pure: how one plan is going, in the flat shape agents read
// (GET /progress, GET /plan/:id/progress, the get_progress tool).

export interface ProgressTask {
  id: string;
  parent_task_id: string | null;
  title: string;
  status: string;
  // Active events only.
  events: { start: Date; end: Date }[];
}

export interface ProgressPlan {
  id: string;
  title: string;
  status: string;
  source_type: string | null;
  source_id: string | null;
  is_paused: boolean;
  created_at: Date;
  tasks: ProgressTask[];
}

export interface PlanProgress {
  plan_id: string;
  title: string;
  status: string;
  source_type: string;
  source_id: string | null;
  is_paused: boolean;
  leaves: {
    total: number;
    done: number;
    in_progress: number;
    pending: number;
    hold: number;
    cancelled: number;
  };
  percent_done: number;
  slipped: number;
  next_session: { task_id: string; title: string; start: string } | null;
  planned_finish: string | null;
  last_feedback_at: string | null;
  created_at: string;
}

export const summarizePlanProgress = (
  plan: ProgressPlan,
  lastFeedbackAt: Date | null,
  now: Date,
): PlanProgress => {
  const parents = new Set(plan.tasks.map((t) => t.parent_task_id));
  const leaves = plan.tasks.filter((t) => !parents.has(t.id));
  const count = (s: string) => leaves.filter((t) => t.status === s).length;
  const counts = {
    total: leaves.length,
    done: count('DONE'),
    in_progress: count('IN_PROGRESS'),
    pending: count('PENDING'),
    hold: count('HOLD'),
    cancelled: count('CANCELLED'),
  };
  // HOLD and CANCELLED steps are not part of the work left to do.
  const counted = counts.total - counts.hold - counts.cancelled;

  const open = leaves.filter(
    (t) => !['DONE', 'HOLD', 'CANCELLED'].includes(t.status),
  );
  // Same rule as classifyLeaves: its booked session ended and it is not done.
  const slipped = open.filter(
    (t) => t.events[0] && t.events[0].end.getTime() < now.getTime(),
  ).length;

  const upcoming = open
    .flatMap((t) => t.events.map((e) => ({ t, start: e.start })))
    .filter(({ start }) => start.getTime() >= now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

  const ends = plan.tasks.flatMap((t) => t.events.map((e) => e.end.getTime()));

  return {
    plan_id: plan.id,
    title: plan.title,
    status: plan.status,
    source_type: plan.source_type ?? 'GENERATE',
    source_id: plan.source_id,
    is_paused: plan.is_paused,
    leaves: counts,
    percent_done: counted > 0 ? Math.round((counts.done / counted) * 100) : 0,
    slipped,
    next_session: upcoming
      ? {
          task_id: upcoming.t.id,
          title: upcoming.t.title,
          start: upcoming.start.toISOString(),
        }
      : null,
    planned_finish: ends.length
      ? new Date(Math.max(...ends)).toISOString()
      : null,
    last_feedback_at: lastFeedbackAt?.toISOString() ?? null,
    created_at: plan.created_at.toISOString(),
  };
};
