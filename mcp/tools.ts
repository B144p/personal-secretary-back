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
import { ApiError, type Api } from './api';

// Phase 1 surface: connect, read, create. There is intentionally no tool that
// generates (OpenAI) or schedules (Google Calendar) a plan.

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
  title: string;
  status: string;
  children: TaskOut[];
}
interface PlanOut {
  id: string;
  title: string;
  status: string;
  source_type: string;
  source_id: string | null;
  created_at: string;
  tasks: TaskOut[];
}

const countTasks = (tasks: TaskOut[]): number =>
  tasks.reduce((n, t) => n + 1 + countTasks(t.children ?? []), 0);

const outline = (tasks: TaskOut[], indent = ''): string =>
  tasks
    .map(
      (t, i) =>
        `${indent}${i + 1}. [${t.status}] ${t.title}\n${outline(t.children ?? [], indent + '   ')}`,
    )
    .join('');

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
        "List the user's plans in Personal Secretary (id, title, status, source, task count). Optionally only plans created from Claude Code.",
      inputSchema: {
        only_claude_code: z
          .boolean()
          .optional()
          .describe('Only include plans created from Claude Code'),
      },
    },
    async ({ only_claude_code }) => {
      try {
        const plans = await api.get<PlanOut[]>('/plan');
        return text(
          plans
            .filter((p) => !only_claude_code || p.source_type === 'CLAUDE_CODE')
            .map((p) => ({
              id: p.id,
              title: p.title,
              status: p.status,
              source_type: p.source_type,
              source_id: p.source_id,
              tasks: countTasks(p.tasks),
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
        'Save an approved implementation plan to Personal Secretary as a DRAFT plan with tasks.',
        "Call this after the user approves a plan (e.g. right after exiting plan mode), passing the plan's steps as tasks in order.",
        'Use children for sub-steps of a step.',
        `Limits: at most ${IMPORT_MAX_DEPTH + 1} levels and ${IMPORT_MAX_TASKS} tasks in total.`,
        'This never calls an AI model and never books calendar events.',
      ].join(' '),
      inputSchema: {
        title: z.string().describe('Short plan title, e.g. the feature name'),
        source_id: z
          .string()
          .optional()
          .describe(
            'Where the plan was written: the git origin URL of the repo, or its absolute path',
          ),
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
        const plan = await api.post<PlanOut>('/plan/import', parsed.data);
        return text(
          `Created plan "${plan.title}" (${plan.status}, id ${plan.id}) with ${countTasks(plan.tasks)} tasks:\n\n${outline(plan.tasks)}`,
        );
      } catch (err) {
        return fail(err);
      }
    },
  );
};
