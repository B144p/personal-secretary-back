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
