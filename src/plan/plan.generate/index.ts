import { Injectable } from '@nestjs/common';
import { EPlanSourceType, EPlanStatus, ETaskStatus } from '@prisma/client';
import { calendar_v3 } from 'googleapis';
import OpenAI from 'openai';
import { ChatModel } from 'openai/resources';
import pLimit from 'p-limit';
import { CalendarService } from 'src/calendar/calendar.service';
import { validateOpenAIResponse } from 'src/openai/utils';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import { z } from 'zod';
import { generatePlanResponseSchema } from '../schemas';
import type {
  IGeneratePlanProps,
  IGenerateTaskProps,
  IReGeneratePlanProps,
  IReGenerateTaskProps,
  IUpsertPlanProps,
} from './interface';
import { generatePlanPrompt, reGeneratePlanPrompt } from './prompt';

const CHAT_MODEL: ChatModel = 'gpt-5-nano';
const calendarLimit = pLimit(2);

@Injectable()
export class GeneratePlanService {
  constructor(
    private readonly openai: OpenAI,
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly calendarService: CalendarService,
  ) {}

  async generatePlan({ userId, prompt }: IGeneratePlanProps) {
    const generatedPlan = await generateTask({
      client: this.openai,
      prompt,
    });
    const user = await this.userService.getProfile(userId);
    const createdPlan = await upsertPlan({
      user,
      client: this.prisma,
      plan: generatedPlan.output,
    });

    return createdPlan;
  }

  async reGeneratePlan({ userId, earlierTask, data }: IReGeneratePlanProps) {
    const reGeneratedPlan = await reGenerateTask({
      client: this.openai,
      data: {
        feedback: data.feedback,
        earlierTask,
      },
    });
    const user = await this.userService.getProfile(userId);
    const upsertedPlan = await upsertPlan({
      user,
      client: this.prisma,
      plan: reGeneratedPlan.output,
      planId: data.id,
    });

    // remove events related to the plan in calendar
    const calendarClient = await this.calendarService.getClient(userId);
    await removeRelatedCalendarEvent({
      client: calendarClient,
      planId: data.id,
    });

    return upsertedPlan;
  }
}

const generateTask = async ({
  client,
  prompt: { goal, more_info },
}: IGenerateTaskProps) => {
  const llmRes = await client.responses.parse({
    model: CHAT_MODEL,
    input: [
      {
        role: 'system',
        content: Object.values(generatePlanPrompt.system).map((prompt) => ({
          type: 'input_text',
          text: prompt,
        })),
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Generate task plan for: ${goal}`,
          },
          {
            type: 'input_text',
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
        schema: z.toJSONSchema(generatePlanResponseSchema),
      },
    },
  });

  const outputParsed = validateOpenAIResponse(
    generatePlanResponseSchema,
    llmRes.output_parsed,
  );

  return {
    usage: llmRes.usage,
    output: outputParsed,
  };
};

const upsertPlan = async ({ user, client, plan, planId }: IUpsertPlanProps) => {
  if (planId) return await updatePlan({ user, client, plan, planId });
  return await createPlan({ user, client, plan });
};

const createPlan = async ({
  user,
  client,
  plan,
}: Pick<IUpsertPlanProps, 'user' | 'client' | 'plan'>) => {
  const { tasks, ...restCreatedPlan } = await client.plan.create({
    data: {
      user_id: user.id,
      title: plan.goal,
      source_type: EPlanSourceType.GENERATE,
      status: EPlanStatus.DRAFT,
      tasks: {
        createMany: {
          data: plan.tasks.map((task) => ({
            title: task,
            status: ETaskStatus.PENDING,
          })),
        },
      },
    },
    include: {
      tasks: {
        select: {
          title: true,
        },
      },
    },
    omit: {
      user_id: true,
    },
  });

  return {
    ...restCreatedPlan,
    tasks: tasks.map(({ title }) => title),
  };
};

const updatePlan = async ({
  user,
  client,
  plan,
  planId,
}: Pick<IUpsertPlanProps, 'user' | 'client' | 'plan' | 'planId'>) => {
  // This phase: replace all existing tasks with re-generated tasks.
  const { tasks, ...restCreatedPlan } = await client.plan.update({
    where: {
      id: planId,
      user_id: user.id,
    },
    data: {
      title: plan.goal,
      status: EPlanStatus.DRAFT,
      tasks: {
        deleteMany: {
          plan_id: planId,
        },
        createMany: {
          data: plan.tasks.map((task) => ({
            title: task,
            status: ETaskStatus.PENDING,
          })),
        },
      },
    },
    include: {
      tasks: {
        select: {
          title: true,
        },
      },
    },
    omit: {
      user_id: true,
    },
  });

  return {
    ...restCreatedPlan,
    tasks: tasks.map(({ title }) => title),
  };
};

const reGenerateTask = async ({
  client,
  data: { feedback, earlierTask },
}: IReGenerateTaskProps) => {
  const llmRes = await client.responses.parse({
    model: CHAT_MODEL,
    input: [
      {
        role: 'system',
        content: Object.values(reGeneratePlanPrompt.system).map((prompt) => ({
          type: 'input_text',
          text: prompt,
        })),
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Existing Tasks: ${JSON.stringify(earlierTask)}`,
          },
          {
            type: 'input_text',
            text: `User Feedback: ${feedback ?? 'Nothing'}`,
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

  const outputParsed = validateOpenAIResponse(
    generatePlanResponseSchema,
    llmRes.output_parsed,
  );

  return {
    usage: llmRes.usage,
    output: outputParsed,
  };
};

const removeRelatedCalendarEvent = async ({
  client,
  planId,
}: {
  client: calendar_v3.Calendar;
  planId: string;
}) => {
  const relateEvents = await client.events.list({
    calendarId: 'primary',
    privateExtendedProperty: [`plan_id=${planId}`],
  });

  await Promise.all(
    relateEvents.data.items?.map((event) =>
      calendarLimit(() =>
        client.events.delete({
          calendarId: 'primary',
          eventId: event.id ?? undefined,
        }),
      ),
    ) ?? [],
  );

  return {
    message: 'Related calendar events are removed successfully.',
  };
};
