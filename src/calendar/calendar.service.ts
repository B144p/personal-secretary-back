import { Injectable } from '@nestjs/common';
import { calendar_v3, google } from 'googleapis';
import { CalendarEvent } from './interfaces';

@Injectable()
export class CalendarService {
  private calendar: calendar_v3.Calendar;

  constructor() {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    this.calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  }

  async insertEvents(events: CalendarEvent[]) {
    for (const ev of events) {
      await this.calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: ev.title,
          description: ev.description,
          start: { dateTime: ev.start.toISOString(), timeZone: 'Asia/Bangkok' },
          end: { dateTime: ev.end.toISOString(), timeZone: 'Asia/Bangkok' },
        },
      });
    }
  }
}
