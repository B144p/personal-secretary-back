import { Injectable } from '@nestjs/common';
import { EPlanSourceType, EPlanStatus, ETaskStatus } from '@prisma/client';
import { calendar_v3 } from 'googleapis';
import OpenAI from 'openai';
import { AiTask, getModelForTask } from 'src/openai/ai-task';
import { CalendarService } from 'src/calendar/calendar.service';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { validateOpenAIResponse } from 'src/openai/utils';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import { z } from 'zod';
import { generatePlanResponseSchema, IGeneratePlanResponse, ITaskNode } from '../schemas';
import type {
  IGeneratePlanProps,
  IGenerateTaskProps,
  IReGeneratePlanProps,
  IReGenerateTaskProps,
  IUpsertPlanProps,
} from './interface';
import { generatePlanPrompt, reGeneratePlanPrompt } from './prompt';

@Injectable()
export class GeneratePlanService {
  constructor(
    private readonly openai: OpenAI,
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly calendarService: CalendarService,
  ) {}

  async generatePlan({ userId, prompt }: IGeneratePlanProps) {
    const generatedPlan = await generateTask({ client: this.openai, prompt });
    const user = await this.userService.getProfile(userId);
    const createdPlan = await upsertPlan({ user, client: this.prisma, plan: generatedPlan.output });
    return createdPlan;
  }

  async reGeneratePlan({ userId, earlierTask, data }: IReGeneratePlanProps) {
    const reGeneratedPlan = await reGenerateTask({
      client: this.openai,
      data: { feedback: data.feedback, earlierTask },
    });
    const user = await this.userService.getProfile(userId);
    const upsertedPlan = await upsertPlan({
      user,
      client: this.prisma,
      plan: reGeneratedPlan.output,
      planId: data.id,
    });

    const calendarClient = await this.calendarService.getClient(userId);
    await removeRelatedCalendarEvent({
      client: calendarClient,
      calendar: this.calendarService,
      planId: data.id,
    });

    return upsertedPlan;
  }

  async removeRelatedCalendarEvent({ userId, planId }: { userId: string; planId: string }) {
    const calendarClient = await this.calendarService.getClient(userId);
    return await removeRelatedCalendarEvent({
      client: calendarClient,
      calendar: this.calendarService,
      planId,
    });
  }
}

// ─── AI call ────────────────────────────────────────────────────────────────

const generateTask = async ({ client, prompt: { goal, more_info } }: IGenerateTaskProps) => {
  const call = () =>
    client.responses.parse({
      model: getModelForTask(AiTask.PLAN_GENERATION),
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
            { type: 'input_text' as const, text: `Generate task plan for: ${goal}` },
            { type: 'input_text' as const, text: more_info ? `More info: ${more_info}` : '' },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'plan',
          strict: true,
          schema: z.toJSONSchema(generatePlanResponseSchema),
        },
      },
    });

  let llmRes = await call();
  let outputParsed = validateOpenAIResponse(generatePlanResponseSchema, llmRes.output_parsed);

  if (exceedsMaxDepth(outputParsed.tasks, 0)) {
    llmRes = await client.responses.parse({
      model: getModelForTask(AiTask.PLAN_GENERATION),
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
            { type: 'input_text' as const, text: `Generate task plan for: ${goal}` },
            { type: 'input_text' as const, text: more_info ? `More info: ${more_info}` : '' },
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
          schema: z.toJSONSchema(generatePlanResponseSchema),
        },
      },
    });
    outputParsed = validateOpenAIResponse(generatePlanResponseSchema, llmRes.output_parsed);

    if (exceedsMaxDepth(outputParsed.tasks, 0)) {
      throw new AppException(AppErrorCode.AI_GENERATION_FAILED, 'Generated task tree exceeds maximum depth of 4 after retry');
    }
  }

  return { usage: llmRes.usage, output: outputParsed };
};

const exceedsMaxDepth = (tasks: ITaskNode[], currentDepth: number): boolean => {
  if (currentDepth > 4) return true;
  return tasks.some((t) => t.children.length > 0 && exceedsMaxDepth(t.children, currentDepth + 1));
};

// ─── DB persist ─────────────────────────────────────────────────────────────

const upsertPlan = async ({ user, client, plan, planId }: IUpsertPlanProps) => {
  if (process.env.NODE_ENV === 'development') {
    plan.goal = `[DEV] ${plan.goal}`;
  }
  if (planId) return await updatePlan({ user, client, plan, planId });
  return await createPlan({ user, client, plan });
};

const createPlan = async ({ user, client, plan }: Pick<IUpsertPlanProps, 'user' | 'client' | 'plan'>) => {
  const created = await client.plan.create({
    data: {
      user_id: user.id,
      title: plan.goal,
      source_type: EPlanSourceType.GENERATE,
      status: EPlanStatus.DRAFT,
    },
    omit: { user_id: true },
  });

  await insertTaskTree({ client, planId: created.id, tasks: plan.tasks, parentId: null, depth: 0 });

  return client.plan.findUnique({
    where: { id: created.id },
    include: { tasks: true },
    omit: { user_id: true },
  });
};

const updatePlan = async ({ user, client, plan, planId }: Pick<IUpsertPlanProps, 'user' | 'client' | 'plan' | 'planId'>) => {
  await client.plan.update({
    where: { id: planId, user_id: user.id },
    data: {
      title: plan.goal,
      status: EPlanStatus.DRAFT,
      tasks: { deleteMany: { plan_id: planId as string } },
    },
  });

  await insertTaskTree({ client, planId: planId as string, tasks: plan.tasks, parentId: null, depth: 0 });

  return client.plan.findUnique({
    where: { id: planId as string },
    include: { tasks: true },
    omit: { user_id: true },
  });
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
      await insertTaskTree({ client, planId, tasks: task.children, parentId: created.id, depth: depth + 1 });
    }
  }
};

// ─── Regenerate ──────────────────────────────────────────────────────────────

const reGenerateTask = async ({ client, data: { feedback, earlierTask } }: IReGenerateTaskProps) => {
  const llmRes = await client.responses.parse({
    model: getModelForTask(AiTask.REGENERATION),
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
          { type: 'input_text' as const, text: `Existing Tasks: ${JSON.stringify(earlierTask)}` },
          { type: 'input_text' as const, text: `User Feedback: ${feedback ?? 'Nothing'}` },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'plan',
        strict: true,
        schema: z.toJSONSchema(generatePlanResponseSchema),
      },
    },
  });

  const outputParsed = validateOpenAIResponse(generatePlanResponseSchema, llmRes.output_parsed);
  return { usage: llmRes.usage, output: outputParsed as IGeneratePlanResponse };
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
