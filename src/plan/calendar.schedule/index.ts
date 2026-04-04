import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import OpenAI from 'openai';
import { ChatModel } from 'openai/resources';
import pLimit from 'p-limit';
import { CalendarService } from 'src/calendar/calendar.service';
import { validateOpenAIResponse } from 'src/openai/utils';
import { PrismaService } from 'src/prisma/prisma.service';
import { withRetry } from 'src/utils';
import { z } from 'zod';
import { ITaskScheduleProps } from '../interfaces';
import {
  generateScheduleResponseSchema,
  IGenerateScheduleResponse,
} from '../schemas';
import { schedulePrompt } from './prompt';

const CHAT_MODEL: ChatModel = 'gpt-5-nano';

const limit = pLimit(2);

@Injectable()
export class CalendarScheduleService {
  constructor(
    private readonly openai: OpenAI,
    private readonly prisma: PrismaService,
    private readonly calendarService: CalendarService,
  ) {}

  async generateAndApplyTaskSchedule({ userId, id }: ITaskScheduleProps) {
    const plan = await this.getTasks(id);
    const isPlanExist = typeof plan !== 'string';
    if (!isPlanExist) return plan;

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
      plan,
    });

    // schedule event into calendar
    const applyScheduleRes = await applySchedule({
      userId,
      planId: id,
      client: this.calendarService,
      data: generatedSchedule,
    });

    return applyScheduleRes;
  }

  async getTasks(planId: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      include: {
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
      },
    });
    if (!plan) return 'Plan not found!';

    const { id, title, tasks } = plan;
    return { id, title, tasks };
  }
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

const generateTaskSchedule = async ({
  client,
  plan,
  calendar,
}: IGenerateTaskSchedule) => {
  // Note: Avoid LLM return wrong ID
  const mapToRefs = (tasks: IGenerateTaskSchedule['plan']['tasks']) => {
    const refMap: Record<string, (typeof tasks)[number]> = {};

    const mapped = tasks.map((task, index) => {
      const ref = `T${index + 1}`;
      refMap[ref] = task;

      return {
        task_ref: ref,
        title: task.title,
      };
    });

    return { mapped, refMap };
  };

  const mapBack = (
    refMap: ReturnType<typeof mapToRefs>['refMap'],
    schedule: IGenerateScheduleResponse['schedule'],
  ) => {
    return {
      schedule: schedule.map(({ task_ref, ...restRes }) => ({
        ...restRes,
        ...refMap[task_ref],
      })),
    };
  };

  const refMapData = mapToRefs(plan.tasks);

  const llmRes = await client.responses.parse({
    model: CHAT_MODEL,
    input: [
      {
        role: 'system',
        content: Object.values(schedulePrompt.system).map((prompt) => ({
          type: 'input_text',
          text: prompt,
        })),
      },
      {
        role: 'developer',
        content: Object.values(schedulePrompt.developer).map((prompt) => ({
          type: 'input_text',
          text: prompt,
        })),
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `#TASKS: ${JSON.stringify({ tasks: refMapData.mapped })}`,
          },
          {
            type: 'input_text',
            text: `#EXISTING SCHEDULE: ${JSON.stringify({ schedule: calendar.results })}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'category_rule',
        strict: true,
        schema: z.toJSONSchema(generateScheduleResponseSchema),
      },
    },
  });

  const { schedule, ...restOutputParsed } = validateOpenAIResponse(
    generateScheduleResponseSchema,
    llmRes.output_parsed,
  );

  const outputFormat = {
    ...restOutputParsed,
    ...mapBack(refMapData.refMap, schedule),
  };

  return {
    usage: llmRes.usage,
    outputFormat,
  };
};
interface IGenerateTaskSchedule {
  client: OpenAI;
  plan: Exclude<
    Awaited<ReturnType<CalendarScheduleService['getTasks']>>,
    string
  >;
  calendar: Awaited<ReturnType<typeof getCalendarWithScope>>;
}

const applySchedule = async ({
  userId,
  planId,
  client,
  data,
}: IScheduleEventToCalendar) => {
  const {
    outputFormat: { schedule },
  } = data;

  const eventRes = await Promise.all(
    schedule.map((record) =>
      limit(() =>
        withRetry(() =>
          insertCalendarEvent({
            userId,
            planId,
            client,
            event: record,
          }),
        ),
      ),
    ),
  );

  return {
    schedule,
    eventRes,
  };
};
interface IScheduleEventToCalendar {
  planId: string;
  userId: string;
  client: CalendarService;
  data: Awaited<ReturnType<typeof generateTaskSchedule>>;
}

const insertCalendarEvent = async ({
  userId,
  planId,
  client,
  event,
}: IInsertCalendarEvent) => {
  const privateProperties: Pick<
    Required<IEventPrivateProperties>,
    'plan_id' | 'task_id'
  > = {
    plan_id: planId,
    task_id: event.id,
  };

  const createdCalendarEvent = await client.insertEvent({
    userId,
    request: {
      params: {
        calendarId: 'primary',
        requestBody: {
          summary: event.title,
          start: {
            dateTime: event.start,
          },
          end: {
            dateTime: event.end,
          },
          extendedProperties: {
            private: privateProperties,
          },
        },
      },
    },
  });

  return createdCalendarEvent;
};
interface IInsertCalendarEvent
  extends Pick<IScheduleEventToCalendar, 'userId' | 'planId' | 'client'> {
  event: IScheduleEventToCalendar['data']['outputFormat']['schedule'][number];
}

interface IEventPrivateProperties {
  plan_id?: string;
  task_id?: string;
}
