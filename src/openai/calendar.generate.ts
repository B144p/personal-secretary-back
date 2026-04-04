import { Injectable } from '@nestjs/common';
import { EEventCategory } from '@prisma/client';
import OpenAI from 'openai';
import { ChatModel } from 'openai/resources';
import { z } from 'zod';
import { CalendarClassifierService } from './calendar.classifier';
import { CalendarGeneratorSchema } from './schemas';
import { validateOpenAIResponse } from './utils';

const CHAT_MODEL: ChatModel = 'gpt-5-nano';

@Injectable()
export class CalendarGeneratorService {
  constructor(
    private readonly openai: OpenAI,
    private readonly calendarClassifierService: CalendarClassifierService,
  ) {}

  async calendarGenerator(amount: number = 10) {
    const { usage, outputFormat } = await summaryGenerator({
      client: this.openai,
      amount,
    });

    return { usage, outputFormat };
  }

  async categoryRuleGenerator() {
    const promiseData = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const { outputFormat } = await this.calendarGenerator(100);

        return await this.calendarClassifierService.classifyEvent(
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
