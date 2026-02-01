import { Injectable } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { getCalendarClient } from './calendar.client';
import { CalendarEvent } from './interfaces';

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

  async getCalendarList(id: string): Promise<unknown> {
    const user = await this.userService.getProfile(id);
    const calendarClient = getCalendarClient(user.refresh_token);
    const calendarList = calendarClient.events.list({
      calendarId: 'primary',
    });

    return calendarList;
  }
}
