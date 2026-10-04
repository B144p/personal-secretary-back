import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
// zod-only modules — safe to import without booting Nest or Prisma.
import { AGENDA_MAX_DAYS } from '../src/agenda/agenda.builder';
import {
  IMPORT_MAX_DEPTH,
  IMPORT_MAX_TASKS,
  importPlanSchema,
  importTaskNodeSchema,
} from '../src/plan/dto/import-plan.dto';
import { PROGRESS_STATUSES } from '../src/plan/dto/update-progress.dto';
import { ApiError, CALENDAR_CALL_TIMEOUT_MS, type Api } from './api';
import { fail, planSummary, text, type PlanOut } from './tools';

// Tools for the PM side of the agent team (Chief of Staff, Tutor, ...).
// Read tools are safe everywhere; the agent tools change the user's Google
// Calendar and are only registered with PM_MCP_PROFILE=agent or all.

interface ProgressOut {
  plan_id: string;
  title: string;
  status: string;
}

const slow = { timeoutMs: CALENDAR_CALL_TIMEOUT_MS };

export const registerReadTools = (server: McpServer, api: Api) => {
  server.registerTool(
    'get_today',
    {
      title: 'Get today',
      description:
        "What the user has on: scheduled plan steps, other calendar events (with location), steps that slipped past their session, and Claude Code work in progress. Times are in the user's timezone. Use days: 7 for a week ahead.",
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe(
            "First day (YYYY-MM-DD). Defaults to today in the user's timezone.",
          ),
        days: z
          .number()
          .int()
          .min(1)
          .max(AGENDA_MAX_DAYS)
          .optional()
          .describe('How many days, 1 to 7 (default 1)'),
      },
    },
    async ({ date, days }) => {
      try {
        const query = new URLSearchParams();
        if (date) query.set('date', date);
        if (days) query.set('days', String(days));
        const qs = query.toString();
        return text(await api.get(`/agenda${qs ? `?${qs}` : ''}`));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'get_progress',
    {
      title: 'Get progress',
      description:
        'How plans are going: percent done (held and cancelled steps left out), slipped steps, next session and planned finish. Without plan_id, every plan that is not DONE.',
      inputSchema: {
        plan_id: z
          .string()
          .optional()
          .describe('One plan; omit for all open plans'),
      },
    },
    async ({ plan_id }) => {
      try {
        return text(
          await api.get(
            plan_id
              ? `/plan/${encodeURIComponent(plan_id)}/progress`
              : '/progress',
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );
};

export const registerAgentTools = (server: McpServer, api: Api) => {
  server.registerTool(
    'report_progress',
    {
      title: 'Report progress',
      description: [
        'Record what the user did on their SCHEDULED plan (not Claude Code plans: those use update_task_status).',
        'The backend then moves slipped and remaining steps to new calendar slots.',
        'Confirm with the user before marking steps DONE on their behalf.',
        'Use step ids from get_today or get_plan; only leaf steps of the scheduled plan are accepted.',
      ].join(' '),
      inputSchema: {
        changes: z
          .array(
            z.object({
              task_id: z.string(),
              status: z.enum(PROGRESS_STATUSES),
            }),
          )
          .max(100)
          .default([])
          .describe('Status changes for steps of the scheduled plan'),
        note: z
          .string()
          .max(2000)
          .optional()
          .describe('A note for the day, e.g. why something slipped'),
      },
    },
    async ({ changes, note }) => {
      try {
        const result = await api.patch(
          '/plan-progress',
          {
            statusChanges: changes.map((c) => ({
              taskId: c.task_id,
              newStatus: c.status,
            })),
            ...(note && { contextText: note }),
          },
          slow,
        );
        return text(result);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'reschedule',
    {
      title: 'Reschedule',
      description:
        "Move the scheduled plan's slipped and remaining steps to the next free calendar slots, without changing any status. Use when the user says they fell behind. Ask before calling it.",
      inputSchema: {
        note: z
          .string()
          .max(2000)
          .optional()
          .describe('Optional note saved as that day’s feedback'),
      },
    },
    async ({ note }) => {
      try {
        return text(
          await api.post(
            '/plan-progress/reschedule',
            note ? { note } : {},
            slow,
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'create_agent_plan',
    {
      title: 'Create agent plan',
      description: [
        "Create a DRAFT plan that can later be booked into the user's calendar, e.g. a learning path or a 2-week bet.",
        'Every leaf step needs estimated_minutes (5 to 480).',
        `Limits: at most ${IMPORT_MAX_DEPTH + 1} levels and ${IMPORT_MAX_TASKS} steps.`,
        'Nothing is booked until schedule_plan.',
      ].join(' '),
      inputSchema: {
        title: z.string().describe('Short plan title'),
        agent: z
          .string()
          .describe('Which agent made it, e.g. "tutor" or "chief"'),
        tasks: z
          .array(importTaskNodeSchema)
          .describe(
            'Ordered steps; children are sub-steps; leaves need estimated_minutes',
          ),
      },
    },
    async ({ title, agent, tasks }) => {
      const parsed = importPlanSchema.safeParse({
        title,
        source_type: 'AGENT',
        source_id: agent,
        tasks,
      });
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
        return text(`Created. ${planSummary(plan)}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    'schedule_plan',
    {
      title: 'Schedule plan',
      description: [
        "Book a plan's steps into the user's Google Calendar inside working hours (a DRAFT plan is marked READY first).",
        'Only one plan can be scheduled at a time: if another holds the slot, tell the user which one and ask what to do.',
        'Always ask the user before calling this. Claude Code plans cannot be scheduled.',
      ].join(' '),
      inputSchema: {
        plan_id: z.string().describe('Plan to schedule'),
      },
    },
    async ({ plan_id }) => {
      const id = encodeURIComponent(plan_id);
      try {
        const plan = await api.get<PlanOut>(`/plan/${id}`);
        if (plan.status === 'DRAFT')
          await api.patch(`/plan/${id}/transition`, { to: 'READY' });
        const result = await api.patch(`/plan/${id}/schedule`, {}, slow);
        return text(result);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'ANOTHER_PLAN_SCHEDULED') {
          try {
            const plans = await api.get<ProgressOut[]>('/progress');
            const holder = plans.find((p) => p.status === 'SCHEDULED');
            if (holder) {
              return {
                ...text(
                  `Not scheduled: "${holder.title}" (id ${holder.plan_id}) is already scheduled, and only one plan can be. Ask the user whether to finish or unschedule it first.`,
                ),
                isError: true,
              };
            }
          } catch {
            // fall through to the plain error
          }
        }
        return fail(err);
      }
    },
  );
};
