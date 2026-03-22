import { forwardRef, Inject, Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import OpenAI from 'openai';
import { CalendarService } from 'src/calendar/calendar.service';

@Injectable()
export class CalendarScheduleService {
  constructor(
    @Inject(forwardRef(() => CalendarService))
    private readonly calendarService: CalendarService,
    private readonly openai: OpenAI,
  ) {}

  async generateAndApplyTaskSchedule({ userId }: ITaskScheduleProps) {
    // get calendar 1 month
    const calendarEvents = await getCalendarWithScope({
      client: this.calendarService,
      userId,
      range: {
        timeMin: dayjs().toISOString(),
        timeMax: dayjs().add(1, 'month').toISOString(),
      },
    });

    // generate task schedule
    const generatedSchedule = await generateTaskSchedule({
      client: this.openai,
      calendar: calendarEvents,
    });

    // schedule event into calendar
    const applyScheduleRes = await applySchedule({
      client: this.calendarService,
      data: generatedSchedule,
    });

    return applyScheduleRes;
  }
}
interface ITaskScheduleProps {
  userId: string;
}

const getCalendarWithScope = async ({
  client,
  ...restProps
}: IGetCalendarProps) => {
  const { results } = await client.getCalendarRange(restProps);
  const formatedData = results.map(
    ({ extendedProperties, summary, start, end, description }) => ({
      extendedProperties,
      summary,
      start,
      end,
      description,
    }),
  );
  return {
    results: formatedData,
    count: formatedData.length,
  };
};
type IGetCalendarProps = Parameters<CalendarService['getCalendarRange']>[0] & {
  client: CalendarService;
};

const generateTaskSchedule = async ({ calendar }: IGenerateTaskSchedule) => {
  return new Promise((resolve) => resolve(calendar));
};
interface IGenerateTaskSchedule {
  client: OpenAI;
  calendar: Awaited<ReturnType<typeof getCalendarWithScope>>;
}

const applySchedule = async ({ data }: IScheduleEventToCalendar) => {
  return new Promise((resolve) => resolve(data));
};
interface IScheduleEventToCalendar {
  client: CalendarService;
  data: Awaited<ReturnType<typeof generateTaskSchedule>>;
}
