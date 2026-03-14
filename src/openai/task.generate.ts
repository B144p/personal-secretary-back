import { EPlanSourceType, EPlanStatus, ETaskStatus } from '@prisma/client';
import OpenAI from 'openai';
import { ChatModel } from 'openai/resources';
import { GeneratePlanDto } from 'src/plan/dto/generate-plan.dto';
import { z } from 'zod';
import { generatePlanPrompt } from './prompt';
import { generatePlanResponseSchema } from './schemas';

const CHAT_MODEL: ChatModel = 'gpt-5-nano';

export const generateTask = async ({
  client,
  prompt: { goal, more_info },
}: IGenerateTask) => {
  if (!goal) {
    return 'Can not generate plan because goal is empty!';
  }

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
  const outputFormat = {
    title: outputParsed.goal,
    source_type: EPlanSourceType.GENERATE,
    status: EPlanStatus.DRAFT,
    tasks: outputParsed.tasks.map((task) => ({
      title: task,
      status: ETaskStatus.PENDING,
    })),
  };

  return {
    usage: llmRes.usage,
    outputFormat,
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

interface IGenerateTask {
  client: OpenAI;
  prompt: GeneratePlanDto;
}
