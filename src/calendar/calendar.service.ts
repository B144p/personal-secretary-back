import { Injectable } from '@nestjs/common';
import { EEventCategory } from '@prisma/client';
import dayjs from 'dayjs';
import { OpenAIService } from 'src/openai/openai.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import { getCalendarClient } from './calendar.client';
import { IGetCalendarRangeProps, IInsertEvent } from './interfaces';
import { categorizeMockup } from './mocks';

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly openAIService: OpenAIService,
  ) {}

  async getClient(userId: string) {
    const user = await this.userService.getProfile(userId);
    return getCalendarClient(user.refresh_token);
  }

  async insertEvent({ userId, request }: IInsertEvent) {
    const client = await this.getClient(userId);
    const { params, options } = request;
    const createdEvent = await client.events.insert(
      {
        ...params,
        calendarId: params.calendarId ?? 'primary',
      },
      options,
    );

    return createdEvent.data;
  }

  classifyRules() {
    return this.openAIService.classifyRules(categorizeMockup.eventSummary);
  }

  generateCalendarRule() {
    return this.openAIService.generateCategoryRules();
  }

  async classifyEvent(events: string[]): Promise<unknown> {
    const categoryRule = await this.prisma.categoryRule.findMany({
      select: { id: true, keyword: true, category: true },
    });

    const categorizedEvent = events.reduce(
      (acc: ICategoryRules, event) => {
        const matchedRule = categoryRule
          .filter((rule) =>
            event.toLowerCase().includes(rule.keyword.toLowerCase()),
          )
          .sort((a, b) => b.keyword.length - a.keyword.length);

        if (matchedRule.length > 0) {
          acc.classified.push({
            ...matchedRule[0],
            matchedRule: matchedRule.map(({ keyword, category }) => ({
              keyword,
              category,
            })),
            summary: event,
          });
        }

        // In case of no matched rule => let LLM to categorize
        else
          acc.unClassify.push({
            summary: event,
            keyword: '',
            category: EEventCategory.UNKNOWN,
            tags: [],
          });

        return acc;
      },
      {
        classified: [],
        unClassify: [],
      },
    );

    const classifyAIEvent =
      categorizedEvent.unClassify.length > 0
        ? await this.openAIService.classifyRules(
            categorizedEvent.unClassify.map(({ summary }) => summary),
          )
        : { results: [], count: 0 };

    const classifyAIEventFormat = {
      ...classifyAIEvent,
      results: classifyAIEvent.results.map((result, index) => ({
        ...result,
        summary: categorizedEvent.unClassify[index].summary,
      })),
    };

    return {
      ...categorizedEvent,
      count: {
        classified: categorizedEvent.classified.length,
        unClassify: categorizedEvent.unClassify.length,
      },
      classifyAIEvent: classifyAIEventFormat,
    };
  }

  async getCalendarList(userId: string) {
    const user = await this.userService.getProfile(userId);
    const client = await this.getClient(user.id);

    const updatedMin = user.user_state?.last_calendar_sync
      ? dayjs(user.user_state.last_calendar_sync).toISOString()
      : undefined; // If never sync before, get all calendar events

    const calendarList = await client.events.list({
      calendarId: 'primary',
      updatedMin,
    });

    await this.prisma.userState.upsert({
      where: { user_id: user.id },
      create: {
        user_id: user.id,
        last_calendar_sync: dayjs().toISOString(),
      },
      update: {
        last_calendar_sync: dayjs().toISOString(),
      },
    });

    const dataFormat =
      calendarList.data.items?.map(
        ({ kind, etag, created, updated, ...rest }) => {
          return rest;
        },
      ) ?? [];

    return {
      results: dataFormat,
      count: dataFormat.length,
    };
  }

  async getCalendarRange({
    userId,
    calendarId = 'primary',
    range,
  }: IGetCalendarRangeProps) {
    const user = await this.userService.getProfile(userId);
    const calendarClient = getCalendarClient(user.refresh_token);

    const calendarList = await calendarClient.events.list({
      calendarId,
      ...range,
    });

    const dataFormat =
      calendarList.data.items?.map(({ extendedProperties, ...rest }) => {
        const parsedExtendedProperties = {
          ...extendedProperties,
          private: (extendedProperties?.private ??
            {}) as IEventPrivateProperties,
        };
        return {
          ...rest,
          extendedProperties: parsedExtendedProperties,
        };
      }) ?? [];

    return {
      range,
      results: dataFormat,
      count: dataFormat.length,
    };
  }
}

interface ICategoryRules {
  classified: Array<IRuleBase & { id: string; matchedRule: unknown[] }>;
  unClassify: Array<IRuleBase & { tags: string[] }>;
}

interface IRuleBase {
  keyword: string;
  category: EEventCategory;
  summary: string;
}

interface IEventPrivateProperties {
  plan_id?: string;
  task_id?: string;
}
