import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { ChatModel } from 'openai/resources';
import { PrismaService } from 'src/prisma/prisma.service';
import { z } from 'zod';
import { classifyRulesPrompt } from './prompt';
import { CategoryRulesSchema, ICategoryRulesResponse } from './schemas';
import { validateOpenAIResponse } from './utils';

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

  const outputParsed = validateOpenAIResponse(
    CategoryRulesSchema,
    llmRes.output_parsed,
  );
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

const upsertCategoryRule = async ({
  client,
  rules,
}: ICreateCategoryRuleProps) => {
  const createCategoryRuleTags = async (tags: string[]) => {
    return await client.categoryRuleTag.createMany({
      data: tags.map((tag) => ({ tag })),
      skipDuplicates: true,
    });
  };

  const findIdCategoryRuleTags = async (tags: string[]) => {
    return await client.categoryRuleTag.findMany({
      where: {
        tag: { in: tags },
      },
      select: { id: true },
    });
  };

  const createCategoryRule = async ({
    keyword,
    category,
    tags,
  }: ICategoryRulesResponse['results'][number]) => {
    await createCategoryRuleTags(tags);
    const tagIdRecords = await findIdCategoryRuleTags(tags);
    return await client.categoryRule.upsert({
      where: { keyword },
      create: {
        keyword,
        category,
        keyword_tags: {
          createMany: {
            data: tagIdRecords.map(({ id }) => ({ tag_id: id })),
            skipDuplicates: true,
          },
        },
      },
      update: {
        keyword_tags: {
          createMany: {
            data: tagIdRecords.map(({ id }) => ({ tag_id: id })),
            skipDuplicates: true,
          },
        },
      },
    });
  };

  const createdRules = await Promise.all(
    rules.results.map((data) => createCategoryRule(data)),
  );

  return { results: createdRules, count: createdRules.length };
};

interface IClassifyEventCategoriesProps {
  client: OpenAI;
  summaries: string[];
}

interface ICreateCategoryRuleProps {
  client: PrismaService;
  rules: ICategoryRulesResponse;
}
