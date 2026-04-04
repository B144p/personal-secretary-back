import { z } from 'zod';

export const validateOpenAIResponse = <T extends z.ZodObject>(
  schema: T,
  rawResponse: unknown,
) => {
  if (!rawResponse) {
    throw new Error('Response from OpenAI is null');
  }

  const parsed = schema.safeParse(rawResponse);
  if (!parsed.success) {
    throw new Error(
      `Wrong format response from OpenAI: ${JSON.stringify(parsed.error.issues)}`,
    );
  }
  return parsed.data;
};
