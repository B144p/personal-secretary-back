import { Injectable } from '@nestjs/common';
import { EPlanSourceType, EPlanStatus, ETaskStatus } from '@prisma/client';
import { calendar_v3 } from 'googleapis';
import { AiTask, getModelForTask } from 'src/openai/ai-task';
import { CalendarService } from 'src/calendar/calendar.service';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { OpenAIClientFactory } from 'src/openai/openai-client.factory';
import { validateOpenAIResponse } from 'src/openai/utils';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import { z } from 'zod';
import {
  generatePlanResponseSchema,
  IGeneratePlanResponse,
  ITaskNode,
} from '../schemas';
import type {
  IGeneratePlanProps,
  IGenerateTaskProps,
  IReGeneratePlanProps,
  IReGenerateTaskProps,
  IUpsertPlanProps,
} from './interface';
import { generatePlanPrompt, reGeneratePlanPrompt } from './prompt';

// z.toJSONSchema(z.tuple([])) emits prefixItems:[] which OpenAI rejects.
// Walk the schema and replace empty-tuple nodes with a maxItems:0 array.
const patchSchema = (s: unknown): unknown => {
  if (Array.isArray(s)) return s.map(patchSchema);
  if (s !== null && typeof s === 'object') {
    const obj = s as Record<string, unknown>;
    if (Array.isArray(obj.prefixItems) && obj.prefixItems.length === 0) {
      return { type: 'array', items: { type: 'string' }, maxItems: 0 };
    }
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, patchSchema(v)]),
    );
  }
  return s;
};

const GENERATE_PLAN_JSON_SCHEMA = patchSchema(
  z.toJSONSchema(generatePlanResponseSchema),
) as Record<string, unknown>;

@Injectable()
export class GeneratePlanService {
  constructor(
    private readonly openaiFactory: OpenAIClientFactory,
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly calendarService: CalendarService,
  ) {}

  async generatePlan({ userId, prompt }: IGeneratePlanProps) {
    const client = await this.openaiFactory.forUser(userId);
    const models = await this.userService.getAiModels(userId);
    const generatedPlan = await generateTask({ client, models, prompt });
    const user = await this.userService.getProfile(userId);
    const createdPlan = await upsertPlan({
      user,
      client: this.prisma,
      plan: generatedPlan.output,
    });
    return createdPlan;
  }

  async reGeneratePlan({
    userId,
    preservedTasks,
    parentTaskId,
    data,
  }: IReGeneratePlanProps) {
    const plan = await this.prisma.plan.findUnique({ where: { id: data.id } });
    const planTitle = plan?.title ?? '';
    const client = await this.openaiFactory.forUser(userId);
    const models = await this.userService.getAiModels(userId);

    const reGeneratedPlan = await reGenerateTask({
      client,
      models,
      data: {
        reason: data.reason,
        feedback: data.feedback,
        planTitle,
        preservedTasks,
      },
    });

    // Insert the regenerated subtree under the correct parent
    await insertTaskTree({
      client: this.prisma,
      planId: data.id,
      tasks: reGeneratedPlan.output.tasks,
      parentId: parentTaskId,
      depth: parentTaskId
        ? await getDepthForParent(this.prisma, parentTaskId)
        : 0,
    });

    return loadPlanWithTaskTree(this.prisma, data.id);
  }

  async removeRelatedCalendarEvent({
    userId,
    planId,
  }: {
    userId: string;
    planId: string;
  }) {
    const calendarClient = await this.calendarService.getClient(userId);
    return await removeRelatedCalendarEvent({
      client: calendarClient,
      calendar: this.calendarService,
      planId,
    });
  }
}

// ─── AI call ────────────────────────────────────────────────────────────────

const generateTask = async ({
  client,
  models,
  prompt: { goal, more_info },
}: IGenerateTaskProps) => {
  const call = () =>
    client.responses.parse({
      model: getModelForTask(AiTask.PLAN_GENERATION, models),
      input: [
        {
          role: 'system',
          content: Object.values(generatePlanPrompt.system).map((text) => ({
            type: 'input_text' as const,
            text,
          })),
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text' as const,
              text: `Generate task plan for: ${goal}`,
            },
            {
              type: 'input_text' as const,
              text: more_info ? `More info: ${more_info}` : '',
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'plan',
          strict: true,
          schema: GENERATE_PLAN_JSON_SCHEMA,
        },
      },
    });

  let llmRes: Awaited<ReturnType<typeof call>> = await call();
  let outputParsed = validateOpenAIResponse(
    generatePlanResponseSchema,
    llmRes.output_parsed,
  );

  if (exceedsMaxDepth(outputParsed.tasks, 0)) {
    llmRes = await client.responses.parse({
      model: getModelForTask(AiTask.PLAN_GENERATION, models),
      input: [
        {
          role: 'system',
          content: Object.values(generatePlanPrompt.system).map((text) => ({
            type: 'input_text' as const,
            text,
          })),
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text' as const,
              text: `Generate task plan for: ${goal}`,
            },
            {
              type: 'input_text' as const,
              text: more_info ? `More info: ${more_info}` : '',
            },
          ],
        },
        {
          role: 'assistant',
          content: JSON.stringify(outputParsed),
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text' as const,
              text: 'The previous response exceeded maximum depth of 4. Please flatten it so no task tree is deeper than 4 levels.',
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'plan',
          strict: true,
          schema: GENERATE_PLAN_JSON_SCHEMA,
        },
      },
    });
    outputParsed = validateOpenAIResponse(
      generatePlanResponseSchema,
      llmRes.output_parsed,
    );

    if (exceedsMaxDepth(outputParsed.tasks, 0)) {
      throw new AppException(
        AppErrorCode.AI_GENERATION_FAILED,
        'Generated task tree exceeds maximum depth of 4 after retry',
      );
    }
  }

  return { usage: llmRes.usage, output: outputParsed };
};

const exceedsMaxDepth = (tasks: ITaskNode[], currentDepth: number): boolean => {
  if (currentDepth > 4) return true;
  return tasks.some(
    (t) =>
      t.children.length > 0 && exceedsMaxDepth(t.children, currentDepth + 1),
  );
};

// ─── DB persist ─────────────────────────────────────────────────────────────

const upsertPlan = async ({ user, client, plan, planId }: IUpsertPlanProps) => {
  if (process.env.NODE_ENV === 'development') {
    plan.goal = `[DEV] ${plan.goal}`;
  }
  if (planId) return await updatePlan({ user, client, plan, planId });
  return await createPlan({ user, client, plan });
};

const createPlan = async ({
  user,
  client,
  plan,
}: Pick<IUpsertPlanProps, 'user' | 'client' | 'plan'>) => {
  const created = await client.plan.create({
    data: {
      user_id: user.id,
      title: plan.goal,
      source_type: EPlanSourceType.GENERATE,
      status: EPlanStatus.DRAFT,
    },
  });

  await insertTaskTree({
    client,
    planId: created.id,
    tasks: plan.tasks,
    parentId: null,
    depth: 0,
  });

  return loadPlanWithTaskTree(client, created.id);
};

const updatePlan = async ({
  user,
  client,
  plan,
  planId,
}: Pick<IUpsertPlanProps, 'user' | 'client' | 'plan' | 'planId'>) => {
  await client.plan.update({
    where: { id: planId, user_id: user.id },
    data: {
      title: plan.goal,
      status: EPlanStatus.DRAFT,
      tasks: { deleteMany: { plan_id: planId as string } },
    },
  });

  await insertTaskTree({
    client,
    planId: planId as string,
    tasks: plan.tasks,
    parentId: null,
    depth: 0,
  });

  return loadPlanWithTaskTree(client, planId as string);
};

const loadPlanWithTaskTree = async (client: PrismaService, planId: string) => {
  const plan = await client.plan.findUnique({
    where: { id: planId },
    include: {
      tasks: {
        include: { events: { where: { is_active: true } } },
        orderBy: [{ depth: 'asc' }, { sequence_order: 'asc' }],
      },
    },
  });
  if (!plan) return null;
  const { tasks, ...rest } = plan;
  const byParent = new Map<string | null, (typeof tasks)[number][]>();
  for (const t of tasks) {
    const key = t.parent_task_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(t);
  }
  const build = (parentId: string | null): unknown[] =>
    (byParent.get(parentId) ?? [])
      .sort((a, b) => a.sequence_order - b.sequence_order)
      .map((t) => ({
        ...t,
        description: t.description ?? '',
        children: build(t.id),
      }));
  return {
    ...rest,
    source_type: rest.source_type ?? 'GENERATE',
    tasks: build(null),
  };
};

const insertTaskTree = async ({
  client,
  planId,
  tasks,
  parentId,
  depth,
}: {
  client: PrismaService;
  planId: string;
  tasks: ITaskNode[];
  parentId: string | null;
  depth: number;
}) => {
  for (const task of tasks) {
    const isLeaf = task.children.length === 0;
    const created = await client.task.create({
      data: {
        plan_id: planId,
        title: task.title,
        description: task.description,
        status: ETaskStatus.PENDING,
        parent_task_id: parentId,
        depth,
        sequence_order: task.sequence_order,
        estimated_minutes: isLeaf ? task.estimated_minutes : null,
      },
    });

    if (task.children.length > 0) {
      await insertTaskTree({
        client,
        planId,
        tasks: task.children,
        parentId: created.id,
        depth: depth + 1,
      });
    }
  }
};

// ─── Regenerate ──────────────────────────────────────────────────────────────

const reGenerateTask = async ({
  client,
  models,
  data: { reason, feedback, planTitle, preservedTasks },
}: IReGenerateTaskProps) => {
  const llmRes = await client.responses.parse({
    model: getModelForTask(AiTask.REGENERATION, models),
    input: [
      {
        role: 'system',
        content: Object.values(reGeneratePlanPrompt.system).map((text) => ({
          type: 'input_text' as const,
          text,
        })),
      },
      {
        role: 'user',
        content: [
          { type: 'input_text' as const, text: `Plan: ${planTitle}` },
          {
            type: 'input_text' as const,
            text: `Reason for regeneration: ${reason}`,
          },
          {
            type: 'input_text' as const,
            text:
              preservedTasks.length > 0
                ? `Preserved tasks (already IN_PROGRESS or DONE — do not touch): ${JSON.stringify(preservedTasks)}`
                : 'No preserved tasks.',
          },
          {
            type: 'input_text' as const,
            text: feedback ? `Additional feedback: ${feedback}` : '',
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'plan',
        strict: true,
        schema: GENERATE_PLAN_JSON_SCHEMA,
      },
    },
  });

  const outputParsed = validateOpenAIResponse(
    generatePlanResponseSchema,
    llmRes.output_parsed,
  );
  return { usage: llmRes.usage, output: outputParsed as IGeneratePlanResponse };
};

const getDepthForParent = async (client: PrismaService, parentId: string) => {
  const parent = await client.task.findUnique({
    where: { id: parentId },
    select: { depth: true },
  });
  return (parent?.depth ?? 0) + 1;
};

// ─── Calendar cleanup ─────────────────────────────────────────────────────────

const removeRelatedCalendarEvent = async ({
  client,
  calendar,
  planId,
}: {
  client: calendar_v3.Calendar;
  calendar: CalendarService;
  planId: string;
}) => {
  const relateEvents = await client.events.list({
    calendarId: 'primary',
    privateExtendedProperty: [`plan_id=${planId}`],
  });

  const focusDeleteEventIds =
    relateEvents.data.items?.reduce((acc: string[], event) => {
      if (event.id) acc.push(event.id);
      return acc;
    }, []) ?? [];

  await calendar.removeEvents({
    client,
    calendarId: 'primary',
    events: focusDeleteEventIds,
  });

  return { message: 'Related calendar events are removed successfully.' };
};
