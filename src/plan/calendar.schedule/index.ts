import { Injectable } from '@nestjs/common';
import { EPlanStatus, UserState } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import OpenAI from 'openai';
import pLimit from 'p-limit';
import { AiTask, getModelForTask } from 'src/openai/ai-task';
import { CalendarService } from 'src/calendar/calendar.service';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
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

dayjs.extend(utc);
dayjs.extend(timezone);

const limit = pLimit(2);

@Injectable()
export class CalendarScheduleService {
  constructor(
    private readonly openai: OpenAI,
    private readonly prisma: PrismaService,
    private readonly calendarService: CalendarService,
  ) {}

  async generateAndApplyTaskSchedule({ userId, id }: ITaskScheduleProps) {
    // Reject if another plan is already SCHEDULED
    const otherScheduled = await this.prisma.plan.findFirst({
      where: { user_id: userId, status: EPlanStatus.SCHEDULED, id: { not: id } },
    });
    if (otherScheduled) {
      throw new AppException(AppErrorCode.ANOTHER_PLAN_SCHEDULED, 'Another plan is already scheduled');
    }

    const plan = await this.getLeafTasks(id);
    if (!plan) throw new AppException(AppErrorCode.PLAN_NOT_FOUND, 'Plan not found');

    const userState = await this.prisma.userState.findUnique({ where: { user_id: userId } });
    if (!userState) throw new Error('UserState not found');

    const range = {
      timeMin: dayjs().toISOString(),
      timeMax: dayjs().add(1, 'month').toISOString(),
    };
    const calendarEvents = await getCalendarWithScope({ client: this.calendarService, userId, range });

    const generatedSchedule = await generateLeafSchedule({
      client: this.openai,
      calendar: calendarEvents,
      plan,
      userState,
    });

    const { eventRes, taskEvents } = await applySchedule({
      userId,
      planId: id,
      client: this.calendarService,
      data: generatedSchedule,
    });

    // Persist TaskEvents + update plan status in a transaction
    await this.prisma.$transaction([
      ...taskEvents.map(({ taskId, googleEventId, start, end }) =>
        this.prisma.taskEvent.create({
          data: {
            task_id: taskId,
            google_event_id: googleEventId,
            start: new Date(start),
            end: new Date(end),
            is_active: true,
          },
        }),
      ),
      this.prisma.plan.update({ where: { id }, data: { status: EPlanStatus.SCHEDULED } }),
    ]);

    return {
      schedule: generatedSchedule.outputFormat.schedule,
      eventRes,
    };
  }

  async getLeafTasks(planId: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      include: {
        tasks: {
          select: { id: true, title: true, status: true, estimated_minutes: true, sequence_order: true, depth: true, parent_task_id: true },
          orderBy: [{ depth: 'asc' }, { sequence_order: 'asc' }],
        },
      },
    });
    if (!plan) return null;

    // Only schedule leaf tasks (no children)
    const allTaskIds = new Set(plan.tasks.map((t) => t.id));
    const parentIds = new Set(plan.tasks.map((t) => t.parent_task_id).filter(Boolean) as string[]);
    const leaves = plan.tasks.filter((t) => !parentIds.has(t.id));

    return { id: plan.id, title: plan.title, tasks: leaves };
  }

  async getCurrentSchedule({ userId }: { userId: string }) {
    const calendarEvents = await getCalendarWithScope({
      client: this.calendarService,
      userId,
      range: {
        timeMin: dayjs().startOf('d').toISOString(),
        timeMax: dayjs().endOf('d').toISOString(),
      },
    });

    const scheduleMap = calendarEvents.results.reduce(
      (acc: Record<string, Set<string>>, { extendedProperties }) => {
        if (!extendedProperties.private?.plan_id || !extendedProperties.private?.task_id)
          return acc;

        const { plan_id, task_id } = extendedProperties.private;

        if (!acc[plan_id]) acc[plan_id] = new Set();
        acc[plan_id].add(task_id);

        return acc;
      },
      {},
    );

    const plans = await this.prisma.plan.findMany({
      where: { id: { in: Object.keys(scheduleMap) } },
      include: { tasks: true },
    });

    return plans.map((plan) => ({
      ...plan,
      tasks: plan.tasks.filter((task) => scheduleMap[plan.id]?.has(task.id)),
    }));
  }
}

// ─── Calendar fetch ───────────────────────────────────────────────────────────

const getCalendarWithScope = async ({ client, ...restProps }: IGetCalendarProps) => {
  const { results } = await client.getCalendarRange(restProps);
  const formatedData = results.map(({ extendedProperties, summary, start, end, description }) => ({
    extendedProperties,
    summary,
    start,
    end,
    description,
  }));
  return { results: formatedData, count: formatedData.length };
};
type IGetCalendarProps = Parameters<CalendarService['getCalendarRange']>[0] & { client: CalendarService };

// ─── AI scheduling ────────────────────────────────────────────────────────────

const generateLeafSchedule = async ({
  client,
  plan,
  calendar,
  userState,
}: IGenerateLeafSchedule) => {
  const mapToRefs = (tasks: IGenerateLeafSchedule['plan']['tasks']) => {
    const refMap: Record<string, (typeof tasks)[number]> = {};
    const mapped = tasks.map((task, index) => {
      const ref = `T${index + 1}`;
      refMap[ref] = task;
      return { task_ref: ref, title: task.title, estimated_minutes: task.estimated_minutes };
    });
    return { mapped, refMap };
  };

  const mapBack = (
    refMap: ReturnType<typeof mapToRefs>['refMap'],
    schedule: IGenerateScheduleResponse['schedule'],
  ) => ({
    schedule: schedule.map(({ task_ref, ...rest }) => ({ ...rest, ...refMap[task_ref] })),
  });

  const refMapData = mapToRefs(plan.tasks);
  const userConstraints = buildUserConstraints(userState);

  const callAI = (correctionMsg?: string) =>
    client.responses.parse({
      model: getModelForTask(AiTask.SCHEDULING),
      input: [
        {
          role: 'system',
          content: Object.values(schedulePrompt.system).map((text) => ({
            type: 'input_text' as const,
            text,
          })),
        },
        {
          role: 'developer',
          content: [
            ...Object.values(schedulePrompt.developer).map((text) => ({
              type: 'input_text' as const,
              text: text.replace('{{minTaskDurationMin}}', '15'),
            })),
            { type: 'input_text' as const, text: userConstraints },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'input_text' as const, text: `#TASKS: ${JSON.stringify({ tasks: refMapData.mapped })}` },
            { type: 'input_text' as const, text: `#EXISTING SCHEDULE: ${JSON.stringify({ schedule: calendar.results })}` },
            ...(correctionMsg ? [{ type: 'input_text' as const, text: correctionMsg }] : []),
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

  let llmRes = await callAI();
  let { schedule, ...restParsed } = validateOpenAIResponse(generateScheduleResponseSchema, llmRes.output_parsed);
  let validationError = validateSchedule(schedule, refMapData.mapped, userState);

  if (validationError) {
    llmRes = await callAI(`VALIDATION ERROR — please fix: ${validationError}`);
    ({ schedule, ...restParsed } = validateOpenAIResponse(generateScheduleResponseSchema, llmRes.output_parsed));
    validationError = validateSchedule(schedule, refMapData.mapped, userState);
    if (validationError) {
      throw new AppException(AppErrorCode.SCHEDULING_INFEASIBLE, `Schedule validation failed after retry: ${validationError}`);
    }
  }

  return {
    usage: llmRes.usage,
    outputFormat: { ...restParsed, ...mapBack(refMapData.refMap, schedule) },
  };
};

const buildUserConstraints = (state: UserState) => `
## USER WORKING CONSTRAINTS
- Timezone: '${state.time_zone}'
- Working hours: ${state.working_hours_start} to ${state.working_hours_end} (local time)
- Days off: [${state.days_off.join(', ')}] (0=Sunday … 6=Saturday)
Only schedule within these constraints.
`;

const validateSchedule = (
  schedule: IGenerateScheduleResponse['schedule'],
  tasks: { task_ref: string; estimated_minutes: number | null }[],
  userState: UserState,
): string | null => {
  const taskMap = Object.fromEntries(tasks.map((t) => [t.task_ref, t]));
  const now = dayjs();

  for (const item of schedule) {
    const start = dayjs(item.start);
    const end = dayjs(item.end);

    if (start.isBefore(now)) return `Task ${item.task_ref} starts in the past`;

    const startLocal = start.tz(userState.time_zone);
    const endLocal = end.tz(userState.time_zone);
    const [wStart] = userState.working_hours_start.split(':').map(Number);
    const [wEnd] = userState.working_hours_end.split(':').map(Number);
    if (startLocal.hour() < wStart || endLocal.hour() > wEnd) {
      return `Task ${item.task_ref} is outside working hours`;
    }

    if (userState.days_off.includes(startLocal.day())) {
      return `Task ${item.task_ref} falls on a day off`;
    }

    const task = taskMap[item.task_ref];
    if (task?.estimated_minutes) {
      const durationMin = end.diff(start, 'minute');
      if (Math.abs(durationMin - task.estimated_minutes) > 15) {
        return `Task ${item.task_ref} duration mismatch: expected ${task.estimated_minutes}m, got ${durationMin}m`;
      }
    }
  }

  // Check overlaps
  const sorted = [...schedule].sort((a, b) => dayjs(a.start).valueOf() - dayjs(b.start).valueOf());
  for (let i = 1; i < sorted.length; i++) {
    if (dayjs(sorted[i].start).isBefore(dayjs(sorted[i - 1].end))) {
      return `Tasks ${sorted[i - 1].task_ref} and ${sorted[i].task_ref} overlap`;
    }
  }

  return null;
};

interface IGenerateLeafSchedule {
  client: OpenAI;
  plan: Exclude<Awaited<ReturnType<CalendarScheduleService['getLeafTasks']>>, null>;
  calendar: Awaited<ReturnType<typeof getCalendarWithScope>>;
  userState: UserState;
}

// ─── Apply schedule ────────────────────────────────────────────────────────────

const applySchedule = async ({ userId, planId, client, data }: IScheduleEventToCalendar) => {
  const { outputFormat: { schedule } } = data;

  const results = await Promise.all(
    schedule.map((record) =>
      limit(() =>
        withRetry(() =>
          insertCalendarEvent({ userId, planId, client, event: record }),
        ),
      ),
    ),
  );

  const taskEvents = results.map((googleEventId, i) => ({
    taskId: schedule[i].id as string,
    googleEventId,
    start: schedule[i].start,
    end: schedule[i].end,
  }));

  return { eventRes: results, taskEvents };
};

interface IScheduleEventToCalendar {
  planId: string;
  userId: string;
  client: CalendarService;
  data: Awaited<ReturnType<typeof generateLeafSchedule>>;
}

const insertCalendarEvent = async ({ userId, planId, client, event }: IInsertCalendarEvent): Promise<string> => {
  const privateProperties = { plan_id: planId, task_id: event.id as string };

  const createdCalendarEvent = await client.insertEvent({
    userId,
    request: {
      params: {
        calendarId: 'primary',
        requestBody: {
          summary: event.title,
          start: { dateTime: event.start },
          end: { dateTime: event.end },
          extendedProperties: { private: privateProperties },
        },
      },
    },
  });

  if (!createdCalendarEvent.id) throw new Error('Google Calendar did not return event id');
  return createdCalendarEvent.id;
};

interface IInsertCalendarEvent extends Pick<IScheduleEventToCalendar, 'userId' | 'planId' | 'client'> {
  event: IScheduleEventToCalendar['data']['outputFormat']['schedule'][number];
}
