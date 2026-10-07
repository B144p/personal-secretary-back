import { z } from 'zod';

// Shape of a plan handed over by Claude Code (via the MCP `create_plan` tool).
// Depends on zod only, so the MCP server can reuse it as the tool's input
// schema without pulling in Nest or Prisma.

// Matches MAX_TASK_DEPTH in plan.service.ts: depth 0..4 → five levels.
export const IMPORT_MAX_DEPTH = 4;
export const IMPORT_MAX_TASKS = 100;

export interface ImportTaskNode {
  title: string;
  description?: string;
  // Minutes the step takes; agent plans need it on every leaf to be booked.
  estimated_minutes?: number;
  children?: ImportTaskNode[];
}

export const IMPORT_SOURCE_TYPES = ['CLAUDE_CODE', 'AGENT'] as const;

export const importTaskNodeSchema: z.ZodType<ImportTaskNode> = z.lazy(() =>
  z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional(),
    estimated_minutes: z.number().int().min(5).max(480).optional(),
    children: z.array(importTaskNodeSchema).optional(),
  }),
);

const measure = (
  nodes: ImportTaskNode[],
  depth: number,
): { count: number; maxDepth: number } =>
  nodes.reduce(
    (acc, n) => {
      const sub = measure(n.children ?? [], depth + 1);
      return {
        count: acc.count + 1 + sub.count,
        maxDepth: Math.max(acc.maxDepth, depth, sub.maxDepth),
      };
    },
    { count: 0, maxDepth: -1 },
  );

const missingEstimates = (nodes: ImportTaskNode[]): number =>
  nodes.reduce(
    (n, t) =>
      n +
      (t.children?.length
        ? missingEstimates(t.children)
        : t.estimated_minutes
          ? 0
          : 1),
    0,
  );

export const importPlanSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    // CLAUDE_CODE (default: hooks and create_plan) or AGENT (create_agent_plan:
    // a plan an agent hands over to be scheduled; source_id = agent name).
    source_type: z.enum(IMPORT_SOURCE_TYPES).default('CLAUDE_CODE'),
    source_id: z.string().trim().max(500).optional(),
    // Set by the plan hook ("<session_id>:<plan hash>"). Re-sending the same
    // key returns the existing plan instead of creating a duplicate.
    import_key: z.string().trim().min(1).max(200).optional(),
    // Where the plan was made: normalized git origin URL (else repo root path)
    // and the branch. When repo_key is missing, source_id is used instead.
    repo_key: z.string().trim().min(1).max(500).optional(),
    branch: z.string().trim().min(1).max(200).optional(),
    // The earlier plan this one follows up on (same user).
    parent_plan_id: z.string().uuid().optional(),
    tasks: z.array(importTaskNodeSchema).min(1),
  })
  .superRefine((plan, ctx) => {
    if (plan.source_type === 'AGENT') {
      if (!plan.source_id) {
        ctx.addIssue({
          code: 'custom',
          path: ['source_id'],
          message: 'Agent plans need source_id (the agent name)',
        });
      }
      if (missingEstimates(plan.tasks) > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['tasks'],
          message: 'Every leaf task of an agent plan needs estimated_minutes',
        });
      }
    }
    const { count, maxDepth } = measure(plan.tasks, 0);
    if (maxDepth > IMPORT_MAX_DEPTH) {
      ctx.addIssue({
        code: 'custom',
        path: ['tasks'],
        message: `Task tree is too deep (max ${IMPORT_MAX_DEPTH + 1} levels)`,
      });
    }
    if (count > IMPORT_MAX_TASKS) {
      ctx.addIssue({
        code: 'custom',
        path: ['tasks'],
        message: `Too many tasks (max ${IMPORT_MAX_TASKS})`,
      });
    }
  });

// source_type may be left out by callers (defaults to CLAUDE_CODE).
type ParsedImportPlan = z.infer<typeof importPlanSchema>;
export type ImportPlanDto = Omit<ParsedImportPlan, 'source_type'> &
  Partial<Pick<ParsedImportPlan, 'source_type'>>;
