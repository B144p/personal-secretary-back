import { Injectable } from '@nestjs/common';
import { EPlanSourceType, EPlanStatus, ETaskStatus } from '@prisma/client';
import OpenAI from 'openai';
import { ChatModel } from 'openai/resources';
import { GeneratePlanDto } from 'src/plan/dto/generate-plan.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import { z } from 'zod';
import { generatePlanPrompt } from './prompt';
import { generatePlanResponseSchema, IGeneratePlanResponse } from './schemas';

const CHAT_MODEL: ChatModel = 'gpt-5-nano';

interface IGeneratePlanProps {
  userId: string;
  prompt: GeneratePlanDto;
}

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
    const createdPlan = await createPlan({
      user,
      client: this.prisma,
      plan: generatedPlan.output,
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

const createPlan = async ({ user, client, plan }: ICreatedPlanProps) => {
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

interface IGenerateTaskProps {
  client: OpenAI;
  prompt: GeneratePlanDto;
}

interface ICreatedPlanProps {
  user: Awaited<ReturnType<UserService['getProfile']>>;
  client: PrismaService;
  plan: IGeneratePlanResponse;
}
