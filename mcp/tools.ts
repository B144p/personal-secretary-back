import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
// zod-only module — safe to import without booting Nest or Prisma.
import {
  IMPORT_MAX_DEPTH,
  IMPORT_MAX_TASKS,
  importPlanSchema,
  importTaskNodeSchema,
} from '../src/plan/dto/import-plan.dto';
import { TASK_STATUS_UPDATES } from '../src/plan/dto/update-task-status.dto';
import { ApiError, type Api } from './api';
import { repoInfo, sessionRepo } from './git';

// Connect, read, create, and report progress. There is intentionally no tool
// that generates (OpenAI) or schedules (Google Calendar) a plan.

const text = (value: unknown): CallToolResult => ({
  content: [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const fail = (err: unknown): CallToolResult => {
  const message =
    err instanceof ApiError
      ? `Backend error ${err.status}${err.code ? ` ${err.code}` : ''}: ${err.message}`
      : `Unexpected error: ${(err as Error).message}`;
  return { ...text(message), isError: true };
};

interface TaskOut {
  id: string;
  title: string;
  status: string;
  status_note?: string | null;
  children: TaskOut[];
}
export interface PlanOut {
  id: string;
  title: string;
  status: string;
  source_type: string;
  source_id: string | null;
  repo_key?: string | null;
  branch?: string | null;
  parent_plan_id?: string | null;
  last_activity_at?: string;
  created_at: string;
  tasks: TaskOut[];
}

const countTasks = (tasks: TaskOut[]): number =>
  tasks.reduce((n, t) => n + 1 + countTasks(t.children ?? []), 0);

// Ids are included so Claude can call update_task_status / add_task next.
export const outline = (tasks: TaskOut[], indent = ''): string =>
  tasks
    .map(
      (t, i) =>
        `${indent}${i + 1}. [${t.status}] ${t.title} (id ${t.id})${t.status_note ? ` — ${t.status_note}` : ''}\n${outline(t.children ?? [], indent + '   ')}`,
    )
    .join('');

export const planSummary = (plan: PlanOut) =>
  `Plan "${plan.title}" (${plan.status}, id ${plan.id}) with ${countTasks(plan.tasks)} tasks:\n\n${outline(plan.tasks)}`;

export const registerTools = (server: McpServer, api: Api) => {
  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'Check the connection to Personal Secretary and show which account the access token belongs to.',
      inputSchema: {},
    },
    async () => {
      try {
        const me = await api.get<{
          id: string;
          email: string;
          name: string | null;
          status: string;
        }>('/me');
        return text({
          id: me.id,
          email: me.email,
          name: me.name,
          status: me.status,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'list_plans',
    {
      title: 'List plans',
      description:
        "List the user's plans in Personal Secretary, most recently active first (id, title, status, source, repo, branch, task count). Filter by repo and to open (not DONE) plans to see what is still in progress in a repo.",
      inputSchema: {
        only_claude_code: z
          .boolean()
          .optional()
          .describe('Only include plans created from Claude Code'),
        repo_key: z
          .string()
          .optional()
          .describe(
            'Only plans of this repo: its git origin URL (any form) or repo root path',
          ),
        open_only: z
          .boolean()
          .optional()
          .describe('Only plans that are not DONE'),
      },
    },
    async ({ only_claude_code, repo_key, open_only }) => {
      try {
        const query = new URLSearchParams();
        if (only_claude_code) query.set('source_type', 'CLAUDE_CODE');
        if (repo_key) query.set('repo_key', repo_key);
        if (open_only) query.set('open', 'true');
        const qs = query.toString();
        const plans = await api.get<PlanOut[]>(`/plan${qs ? `?${qs}` : ''}`);
        return text(
          plans.map((p) => ({
            id: p.id,
            title: p.title,
            status: p.status,
            source_type: p.source_type,
            repo_key: p.repo_key ?? p.source_id,
            branch: p.branch ?? null,
            parent_plan_id: p.parent_plan_id ?? null,
            tasks: countTasks(p.tasks),
            last_activity_at: p.last_activity_at,
            created_at: p.created_at,
          })),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'create_plan',
    {
      title: 'Create plan',
      description: [
        'Save an implementation plan written in plan mode to Personal Secretary as a DRAFT plan with tasks.',
        'Call this exactly once per plan, before starting to implement it and before any file edit.',
        'This applies whether the user approved the plan at the plan-mode prompt, or dismissed the prompt (e.g. pressed ESC, switched model or mode) and then told you to go ahead.',
        'Do not call it again for the same plan; call it again only for a newly written plan.',
        'If the personal-pm plan hook is installed it saves the plan automatically: when a "Saved as Personal Secretary plan" note has already appeared, do not call this tool.',
        "Pass the plan's steps as tasks in order, and use children for sub-steps of a step.",
        `Limits: at most ${IMPORT_MAX_DEPTH + 1} levels and ${IMPORT_MAX_TASKS} tasks in total.`,
        'This never calls an AI model and never books calendar events.',
      ].join(' '),
      inputSchema: {
        title: z.string().describe('Short plan title, e.g. the feature name'),
        source_id: z
          .string()
          .optional()
          .describe(
            'Where the plan was written: the git origin URL of the repo, or its absolute path. Defaults to the session repo (with its branch).',
          ),
        parent_plan_id: z
          .string()
          .optional()
          .describe('Id of the earlier plan this one follows up on, if any'),
        tasks: z
          .array(importTaskNodeSchema)
          .describe('Ordered steps; each may have children (sub-steps)'),
      },
    },
    async (args) => {
      // Same schema the backend enforces — fail fast with a readable message.
      const parsed = importPlanSchema.safeParse(args);
      if (!parsed.success) {
        return {
          ...text(
            `Invalid plan: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
          ),
          isError: true,
        };
      }
      try {
        // No source given: the plan belongs to the repo of this session.
        const where = parsed.data.source_id
          ? {}
          : sessionRepo(repoInfo(process.env.PM_SESSION_CWD ?? process.cwd()));
        const plan = await api.post<PlanOut>('/plan/import', {
          ...parsed.data,
          ...where,
        });
        return text(`Created. ${planSummary(plan)}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'get_plan',
    {
      title: 'Get plan',
      description:
        'Show one plan with its task tree, including task ids, statuses and status notes. Use it to find task ids for update_task_status and add_task.',
      inputSchema: { plan_id: z.string().describe('Plan id') },
    },
    async ({ plan_id }) => {
      try {
        const plan = await api.get<PlanOut>(
          `/plan/${encodeURIComponent(plan_id)}`,
        );
        return text(planSummary(plan));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'update_task_status',
    {
      title: 'Update task status',
      description: [
        'Report progress on a task of a Claude Code plan while implementing it.',
        'Set IN_PROGRESS when you start a step, DONE when it is finished, and CANCELLED when it turned out unnecessary or impractical.',
        'CANCELLED requires a note with the reason, so a later session does not redo work that was dropped on purpose.',
        'Parent tasks and the plan status follow automatically: closing a parent closes its open sub-tasks, and the plan becomes DONE once every top-level task is DONE or CANCELLED.',
      ].join(' '),
      inputSchema: {
        plan_id: z.string().describe('Plan id'),
        task_id: z.string().describe('Task id (see get_plan)'),
        status: z.enum(TASK_STATUS_UPDATES),
        note: z
          .string()
          .optional()
          .describe('Why the status changed. Required for CANCELLED.'),
      },
    },
    async ({ plan_id, task_id, status, note }) => {
      if (status === 'CANCELLED' && !note?.trim()) {
        return {
          ...text('A note with the reason is required for CANCELLED.'),
          isError: true,
        };
      }
      try {
        const plan = await api.patch<PlanOut>(
          `/plan/${encodeURIComponent(plan_id)}/tasks/${encodeURIComponent(task_id)}/status`,
          { status, ...(note?.trim() && { note: note.trim() }) },
        );
        return text(`Updated. ${planSummary(plan)}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'add_task',
    {
      title: 'Add task',
      description:
        'Add a step discovered while implementing a Claude Code plan (e.g. a bug found on the way). Give the reason it was added. Optionally nest it under an existing task.',
      inputSchema: {
        plan_id: z.string().describe('Plan id'),
        title: z.string().min(1).max(200).describe('Short task title'),
        reason: z.string().min(1).max(2000).describe('Why this step was added'),
        parent_task_id: z
          .string()
          .optional()
          .describe('Parent task id, to add it as a sub-step'),
      },
    },
    async ({ plan_id, title, reason, parent_task_id }) => {
      try {
        const id = encodeURIComponent(plan_id);
        const task = await api.post<{ id: string; title: string }>(
          `/plan/${id}/tasks`,
          {
            title,
            description: reason,
            ...(parent_task_id && { parent_task_id }),
          },
        );
        const plan = await api.get<PlanOut>(`/plan/${id}`);
        return text(
          `Added task "${task.title}" (id ${task.id}). ${planSummary(plan)}`,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'get_repo_context',
    {
      title: 'Get repo context',
      description:
        'What is in progress in the current repo: the open plan to resume (preferring the current branch), its open steps with ids, cancelled steps with their reasons, and how many other open plans exist. The same block is shown at session start.',
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe(
            "The session's working directory (inside the repo). Defaults to the directory Claude Code started the server in.",
          ),
      },
    },
    async ({ cwd }) => {
      try {
        const info = repoInfo(
          cwd ?? process.env.PM_SESSION_CWD ?? process.cwd(),
        );
        if (!info.repo_key) return text('Not inside a git repository.');
        const query = new URLSearchParams({ repo_key: info.repo_key });
        if (info.branch) query.set('branch', info.branch);
        const ctx = await api.get<{ text: string }>(`/context?${query}`);
        return text(ctx.text);
      } catch (err) {
        return fail(err);
      }
    },
  );
};
