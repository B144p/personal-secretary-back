import { calendar_v3 } from 'googleapis';
import { MethodOptions } from 'googleapis/build/src/apis/calendar';
import { PrismaService } from 'src/prisma/prisma.service';
import { CalendarService } from '../calendar.service';

export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  description: string;
}

export interface IGetCalendarRangeProps {
  userId: string;
  calendarId?: string;
  range: {
    timeMin?: string;
    timeMax?: string;
    timeZone?: string;
  };
}

export interface IInsertEvent extends IUserReq {
  userId: string;
  request: {
    params: calendar_v3.Params$Resource$Events$Insert;
    options?: MethodOptions;
  };
}

export interface IRemoveEvents {
  client: calendar_v3.Calendar;
  calendarId?: string;
  events: Array<string>;
}

export interface IHoldPlanProps {
  id: string;
  userId: string;
  client: PrismaService;
  calendar: CalendarService;
}

interface IUserReq {
  userId: string;
}
