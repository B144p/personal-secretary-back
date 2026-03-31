import { calendar_v3 } from 'googleapis';
import { MethodOptions } from 'googleapis/build/src/apis/calendar';

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

interface IUserReq {
  userId: string;
}
