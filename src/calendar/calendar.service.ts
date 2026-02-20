import { Injectable } from '@nestjs/common';
import { EEventCategory } from '@prisma/client';
import { OpenAIService } from 'src/openai/openai.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import { getCalendarClient } from './calendar.client';
import { CalendarEvent } from './interfaces';

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly openAIService: OpenAIService,
  ) {}

  insertEvents(events: CalendarEvent[]) {
    console.log('Insert event:', events);
    // for (const ev of events) {
    //   await this.calendar.events.insert({
    //     calendarId: 'primary',
    //     requestBody: {
    //       summary: ev.title,
    //       description: ev.description,
    //       start: { dateTime: ev.start.toISOString(), timeZone: 'Asia/Bangkok' },
    //       end: { dateTime: ev.end.toISOString(), timeZone: 'Asia/Bangkok' },
    //     },
    //   });
    // }
  }

  classifyRules() {
    return this.openAIService.classifyRules();
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
          acc.rule.push({
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
          acc.ai.push({
            summary: event,
            keyword: '',
            category: EEventCategory.UNKNOWN,
            tags: [],
          });

        return acc;
      },
      {
        rule: [],
        ai: [],
      },
    );

    return {
      ...categorizedEvent,
      count: {
        rule: categorizedEvent.rule.length,
        ai: categorizedEvent.ai.length,
      },
    };
  }

  async getCalendarList(id: string): Promise<unknown> {
    const user = await this.userService.getProfile(id);
    const calendarClient = getCalendarClient(user.refresh_token);
    const calendarList = calendarClient.events.list({
      calendarId: 'primary',
    });

    return calendarList;
  }
}

interface ICategoryRules {
  rule: Array<IRuleBase & { id: string; matchedRule: unknown[] }>;
  ai: Array<IRuleBase & { tags: string[] }>;
}

interface IRuleBase {
  keyword: string;
  category: EEventCategory;
  summary: string;
}
