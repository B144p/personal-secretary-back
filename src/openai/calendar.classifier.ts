import OpenAI from 'openai';
import { ChatModel } from 'openai/resources';
import { z } from 'zod';
import { classifyRulesPrompt } from './prompt/calendar.prompt';
import { CategoryRulesSchema } from './schemas';

const CHAT_MODEL: ChatModel = 'gpt-5-nano';

export const classifyEventCategories = async ({
  client,
  summaries,
}: IClassifyEventCategoriesProps) => {
  const llmRes = await client.responses.parse({
    model: CHAT_MODEL,
    // temperature: 0,
    input: [
      {
        role: 'system',
        content: [
          { type: 'input_text', text: classifyRulesPrompt.instruction },
        ],
      },
      {
        role: 'system',
        content: [
          { type: 'input_text', text: classifyRulesPrompt.explainOutputSchema },
        ],
      },
      {
        role: 'system',
        content: [
          { type: 'input_text', text: classifyRulesPrompt.decisionRules },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: classifyRulesPrompt.classifyInput(summaries),
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'category_rule',
        strict: true,
        schema: z.toJSONSchema(CategoryRulesSchema),
      },
    },
  });
  return llmRes.output_parsed;
};

interface IClassifyEventCategoriesProps {
  client: OpenAI;
  summaries: string[];
}
