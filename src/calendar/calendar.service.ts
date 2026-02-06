import { Injectable } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { getCalendarClient } from './calendar.client';
import { EEventCategory } from './constants';
import { CalendarEvent } from './interfaces';
import { categorizeMockup } from './mocks';

@Injectable()
export class CalendarService {
  constructor(private readonly userService: UserService) {}

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

  classifyEvent() {
    const events = categorizeMockup.eventSummary;
    const categoryRule = categorizeMockup.categoryRule;

    const categorizedEvent = events.map((event) => {
      const matchedRule = categoryRule
        .filter((rule) =>
          event.toLowerCase().includes(rule.keyword.toLowerCase()),
        )
        .sort((a, b) => b.keyword.length - a.keyword.length);

      if (matchedRule.length > 0) {
        return {
          ...matchedRule[0],
          summary: event,
        };
      }

      // In case of no matched rule => let LLM to categorize
      return {
        summary: event,
        keyword: '',
        category: EEventCategory.UNKNOWN,
        tags: [],
      };
    });

    return categorizedEvent;
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
