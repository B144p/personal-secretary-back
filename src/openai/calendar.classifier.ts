import OpenAI from 'openai';
import { ChatModel } from 'openai/resources';
import { z } from 'zod';
import { classifyRulesPrompt } from './prompt';
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
          { type: 'input_text', text: classifyRulesPrompt.explainOutputSchema },
          { type: 'input_text', text: classifyRulesPrompt.keywordRules },
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

  const outputParsed = validateCategoryRuleResponse(llmRes.output_parsed);
  const outputFormat = {
    ...outputParsed,
    results: outputParsed.results.map((result, index) => ({
      ...result,
      summary: summaries[index],
    })),
  };

  return {
    usage: llmRes.usage,
    outputFormat,
  };
};

const validateCategoryRuleResponse = (rawResponse: unknown) => {
  if (!rawResponse) {
    throw new Error('Response from OpenAI is null');
  }

  const parsed = CategoryRulesSchema.safeParse(rawResponse);
  if (!parsed.success) {
    throw new Error(
      `Wrong format response from OpenAI: ${JSON.stringify(parsed.error.issues)}`,
    );
  }
  return parsed.data;
};

interface IClassifyEventCategoriesProps {
  client: OpenAI;
  summaries: string[];
}
