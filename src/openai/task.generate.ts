import { Injectable } from '@nestjs/common';
import { EPlanSourceType, EPlanStatus, ETaskStatus } from '@prisma/client';
import OpenAI from 'openai';
import { ChatModel } from 'openai/resources';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import { z } from 'zod';
import {
  IGeneratePlanProps,
  IGenerateTaskProps,
  IGetPlanProps,
  IReGeneratePlanProps,
  IReGenerateTaskProps,
  IUpsertPlanProps,
} from './interfaces';
import { generatePlanPrompt, reGeneratePlanPrompt } from './prompt';
import { generatePlanResponseSchema } from './schemas';

const CHAT_MODEL: ChatModel = 'gpt-5-nano';

@Injectable()
export class TaskGeneratorService {
  constructor(
    private readonly userService: UserService,
    private readonly openai: OpenAI,
    private readonly prisma: PrismaService,
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

  async reGeneratePlan({ userId, data }: IReGeneratePlanProps) {
    const earlierTasks = await getPlan({
      client: this.prisma,
      id: data.id,
      userId,
    });
    if (!earlierTasks) return 'Something went wrong';

    const formatedEarlierTasks = {
      title: earlierTasks.title,
      tasks: earlierTasks.tasks.map(({ title }) => title),
    };

    const reGeneratedPlan = await reGenerateTask({
      client: this.openai,
      data: {
        feedback: data.feedback,
        earlierTask: formatedEarlierTasks,
      },
    });
    const user = await this.userService.getProfile(userId);
    const createdPlan = await upsertPlan({
      user,
      client: this.prisma,
      plan: reGeneratedPlan.output,
      planId: data.id,
    });

    return createdPlan;
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
        content: [
          { type: 'input_text', text: generatePlanPrompt.instruction },
          // {
          //   type: 'input_text',
          //   text: generatePlanPrompt.explainOutputSchema,
          // },
          { type: 'input_text', text: generatePlanPrompt.rules },
        ],
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
  const outputParsed = validateGeneratePlanResponse(llmRes.output_parsed);

  return {
    usage: llmRes.usage,
    output: outputParsed,
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
        content: [
          { type: 'input_text', text: reGeneratePlanPrompt.instruction },
          { type: 'input_text', text: reGeneratePlanPrompt.rules },
        ],
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
  const outputParsed = validateGeneratePlanResponse(llmRes.output_parsed);

  return {
    usage: llmRes.usage,
    output: outputParsed,
  };
};

const validateGeneratePlanResponse = (rawResponse: unknown) => {
  if (!rawResponse) {
    throw new Error('Response from OpenAI is null');
  }

  const parsed = generatePlanResponseSchema.safeParse(rawResponse);
  if (!parsed.success) {
    throw new Error(
      `Wrong format response from OpenAI: ${JSON.stringify(parsed.error.issues)}`,
    );
  }
  return parsed.data;
};

const getPlan = async ({ client, id, userId }: IGetPlanProps) => {
  return await client.plan.findUnique({
    where: {
      id,
      user_id: userId,
    },
    include: {
      tasks: {
        select: {
          title: true,
        },
      },
    },
  });
};

const upsertPlan = async ({ user, client, plan, planId }: IUpsertPlanProps) => {
  if (planId) return await updatePlan({ user, client, plan, planId });
  return await createPlan({ user, client, plan });
};

const updatePlan = async ({
  user,
  client,
  plan,
  planId,
}: Pick<IUpsertPlanProps, 'user' | 'client' | 'plan' | 'planId'>) => {
  const { tasks, ...restCreatedPlan } = await client.plan.update({
    where: {
      id: planId,
      user_id: user.id,
    },
    data: {
      title: plan.goal,
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
