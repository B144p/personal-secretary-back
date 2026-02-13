import OpenAI from 'openai';
import { ChatCompletion, ChatModel } from 'openai/resources';
import { promptConfig } from './constants';
import { IGeneratePlanResponse } from './interfaces';
import { generatePlanResponseSchema } from './schemas';

const CHAT_MODEL: ChatModel = 'gpt-5-nano';

export const generateTask = async ({ client, prompt }: IGenerateTask) => {
  const res: ChatCompletion = await client.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      ...(promptConfig.generatePlan.messages ?? []),
      {
        role: 'user',
        content: `Generate task plan for: ${prompt}`,
      },
    ],
    response_format: promptConfig.generatePlan.response_format,
  });

  const {
    choices: [
      {
        message: { content },
      },
    ],
  } = res;

  if (typeof content !== 'string') {
    throw new Error('OpenAI response content is null or not a string');
  }

  return JSON.parse(content) as IGeneratePlanResponse;

  // const validatedRes = this.validateGeneratePlanResponse(JSON.parse(content));
  // return validatedRes;
};

const validateGeneratePlanResponse = (rawResponse: unknown) => {
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
  prompt: string;
}
