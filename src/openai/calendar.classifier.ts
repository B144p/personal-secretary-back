import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { ChatModel } from 'openai/resources';
import { PrismaService } from 'src/prisma/prisma.service';
import { z } from 'zod';
import { classifyRulesPrompt } from './prompt';
import { CategoryRulesSchema, ICategoryRulesResponse } from './schemas';

const CHAT_MODEL: ChatModel = 'gpt-5-nano';

@Injectable()
export class CalendarClassifierService {
  constructor(
    private readonly openai: OpenAI,
    private readonly prisma: PrismaService,
  ) {}

  async classifyEvent(summaries: string[]) {
    const classifiedEvent = await classifyEventWithOpenAI({
      client: this.openai,
      summaries,
    });
    const createCategoryRuleRes = await upsertCategoryRule({
      client: this.prisma,
      rules: classifiedEvent.outputFormat,
    });

    return createCategoryRuleRes;
  }
}

const classifyEventWithOpenAI = async ({
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
          {
            type: 'input_text',
            text: classifyRulesPrompt.explainOutputSchema,
          },
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

const upsertCategoryRule = async ({
  client,
  rules,
}: ICreateCategoryRuleProps) => {
  return await Promise.all(
    rules.results.map(({ keyword, category, tags }) => {
      return client.categoryRule.upsert({
        where: { keyword },
        create: {
          keyword,
          category,
          tags: tags?.length
            ? { create: tags.map((tag) => ({ tag })) }
            : undefined,
        },
        update: {
          tags: {
            deleteMany: {},
            create: tags.map((tag) => ({ tag })),
          },
        },
      });
    }),
  );
};

interface IClassifyEventCategoriesProps {
  client: OpenAI;
  summaries: string[];
}

interface ICreateCategoryRuleProps {
  client: PrismaService;
  rules: ICategoryRulesResponse;
}
