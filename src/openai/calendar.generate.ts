import { Injectable } from '@nestjs/common';
import { EEventCategory } from '@prisma/client';
import OpenAI from 'openai';
import { ChatModel } from 'openai/resources';
import { z } from 'zod';
import { CalendarClassifierService } from './calendar.classifier';
import { OpenAIClientFactory } from './openai-client.factory';
import { CalendarGeneratorSchema } from './schemas';
import { validateOpenAIResponse } from './utils';

// NOTE: Dev-only / out-of-v1-scope (requirements/2026-05-16.md §2.2, T16). Gated by DevOnlyGuard,
// NOTE: not reachable in production. Intentionally hardcoded — not part of the AiSetting/getModelForTask DB config.
const CHAT_MODEL: ChatModel = 'gpt-5-nano';

@Injectable()
export class CalendarGeneratorService {
  constructor(
    private readonly openaiFactory: OpenAIClientFactory,
    private readonly calendarClassifierService: CalendarClassifierService,
  ) {}

  async calendarGenerator(userId: string, amount: number = 10) {
    const client = await this.openaiFactory.forUser(userId);
    const { usage, outputFormat } = await summaryGenerator({
      client,
      amount,
    });

    return { usage, outputFormat };
  }

  async categoryRuleGenerator(userId: string) {
    const promiseData = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const { outputFormat } = await this.calendarGenerator(userId, 100);

        return await this.calendarClassifierService.classifyEvent(
          userId,
          outputFormat.results,
        );
      }),
    );

    return promiseData.reduce(
      (acc: IGenerateCalendarResponse, { results, count }) => {
        const resultsFormat = results.map(({ id, keyword, category }) => ({
          id,
          keyword,
          category,
        }));
        acc.results.push(...resultsFormat);
        acc.count += count;

        return acc;
      },
      {
        results: [],
        count: 0,
      },
    );
  }
}

const summaryGenerator = async ({ client, amount }: ISummaryGeneratorProps) => {
  const llmRes = await client.responses.parse({
    model: CHAT_MODEL,
    input: [
      {
        role: 'developer',
        content: 'Return valid JSON only.',
      },
      {
        role: 'system',
        content: `You generate realistic human-written calendar event. Not include time or date, just event summary.`,
      },
      {
        role: 'user',
        content: `Generate ${amount} calendar event. Return format: { "results": string[] }`,
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'calendar_summary',
        strict: true,
        schema: z.toJSONSchema(CalendarGeneratorSchema),
      },
    },
  });

  const outputParsed = validateOpenAIResponse(
    CalendarGeneratorSchema,
    llmRes.output_parsed,
  );

  return {
    usage: llmRes.usage,
    outputFormat: {
      results: outputParsed.results,
      count: outputParsed.results.length,
    },
  };
};

interface ISummaryGeneratorProps {
  client: OpenAI;
  amount: number;
}

export interface IGenerateCalendarResponse {
  results: Array<{
    id: string;
    keyword: string;
    category: EEventCategory;
  }>;
  count: number;
}
