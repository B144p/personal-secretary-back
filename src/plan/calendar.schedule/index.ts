import { Injectable } from '@nestjs/common';
import { EPlanStatus, UserState } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import OpenAI from 'openai';
import pLimit from 'p-limit';
import { AiTask, getModelForTask, IAiTaskModels } from 'src/openai/ai-task';
import { CalendarService } from 'src/calendar/calendar.service';
import { AppErrorCode, AppException } from 'src/common/errors/app-exception';
import { OpenAIClientFactory } from 'src/openai/openai-client.factory';
import { validateOpenAIResponse } from 'src/openai/utils';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
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
    private readonly openaiFactory: OpenAIClientFactory,
    private readonly prisma: PrismaService,
    private readonly calendarService: CalendarService,
    private readonly userService: UserService,
  ) {}

  async generateAndApplyTaskSchedule({ userId, id }: ITaskScheduleProps) {
    // Reject if another plan is already SCHEDULED
    const otherScheduled = await this.prisma.plan.findFirst({
      where: {
        user_id: userId,
        status: EPlanStatus.SCHEDULED,
        id: { not: id },
      },
    });
    if (otherScheduled) {
      throw new AppException(
        AppErrorCode.ANOTHER_PLAN_SCHEDULED,
        'Another plan is already scheduled',
      );
    }

    const plan = await this.getLeafTasks(id);
    if (!plan)
      throw new AppException(AppErrorCode.PLAN_NOT_FOUND, 'Plan not found');

    const userState = await this.prisma.userState.findUnique({
      where: { user_id: userId },
    });
    if (!userState) throw new Error('UserState not found');

    const range = {
      timeMin: dayjs().toISOString(),
      timeMax: dayjs().add(1, 'month').toISOString(),
    };
    const calendarEvents = await getCalendarWithScope({
      client: this.calendarService,
      userId,
      range,
    });

    const client = await this.openaiFactory.forUser(userId);
    const models = await this.userService.getAiModels(userId);
    const generatedSchedule = await generateLeafSchedule({
      client,
      models,
      calendar: calendarEvents,
      plan,
      userState,
    });

    const { taskEvents } = await applySchedule({
      userId,
      planId: id,
      client: this.calendarService,
      timeZone: userState.time_zone,
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
      this.prisma.plan.update({
        where: { id },
        data: { status: EPlanStatus.SCHEDULED },
      }),
    ]);

    const scheduledTaskIds = taskEvents.map((e) => e.taskId);
    const scheduledLeafIds = new Set(scheduledTaskIds);
    const unscheduledTaskIds = plan.tasks
      .filter((t) => !scheduledLeafIds.has(t.id))
      .map((t) => t.id);

    return { scheduledTaskIds, unscheduledTaskIds };
  }

  async getLeafTasks(planId: string) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      include: {
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
            estimated_minutes: true,
            sequence_order: true,
            depth: true,
            parent_task_id: true,
          },
        },
      },
    });
    if (!plan) return null;

    type PlanTask = (typeof plan.tasks)[number];
    const parentIds = new Set(
      plan.tasks.map((t) => t.parent_task_id).filter(Boolean) as string[],
    );

    // DFS traversal so leaves come out in true tree order (parent sequence preserved)
    const byParent = new Map<string | null, PlanTask[]>();
    for (const t of plan.tasks) {
      if (!byParent.has(t.parent_task_id)) byParent.set(t.parent_task_id, []);
      byParent.get(t.parent_task_id)!.push(t);
    }
    const leaves: PlanTask[] = [];
    const visit = (parentId: string | null) => {
      const children = (byParent.get(parentId) ?? []).sort(
        (a, b) => a.sequence_order - b.sequence_order,
      );
      for (const child of children) {
        if (parentIds.has(child.id)) {
          visit(child.id);
        } else if (child.status === 'PENDING') {
          leaves.push(child);
        }
      }
    };
    visit(null);

    return { id: plan.id, title: plan.title, tasks: leaves };
  }

  async getCurrentSchedule({ userId }: { userId: string }) {
    const plan = await this.prisma.plan.findFirst({
      where: {
        user_id: userId,
        status: EPlanStatus.SCHEDULED,
        is_paused: false,
      },
      include: {
        tasks: {
          include: { events: { where: { is_active: true } } },
          orderBy: [{ depth: 'asc' }, { sequence_order: 'asc' }],
        },
      },
    });
    if (!plan) return { plan: null };

    const { tasks, ...rest } = plan;
    const byParent = new Map<string | null, (typeof tasks)[number][]>();
    for (const t of tasks) {
      const key = t.parent_task_id;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(t);
    }
    const build = (parentId: string | null): unknown[] =>
      (byParent.get(parentId) ?? [])
        .sort((a, b) => a.sequence_order - b.sequence_order)
        .map((t) => ({
          ...t,
          description: t.description ?? '',
          children: build(t.id),
        }));

    return {
      plan: {
        ...rest,
        source_type: rest.source_type ?? 'GENERATE',
        tasks: build(null),
      },
    };
  }
}

// ─── Calendar fetch ───────────────────────────────────────────────────────────

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
  return { results: formatedData, count: formatedData.length };
};
type IGetCalendarProps = Parameters<CalendarService['getCalendarRange']>[0] & {
  client: CalendarService;
};

// ─── AI scheduling ────────────────────────────────────────────────────────────

const generateLeafSchedule = async ({
  client,
  models,
  plan,
  calendar,
  userState,
}: IGenerateLeafSchedule) => {
  const mapToRefs = (tasks: IGenerateLeafSchedule['plan']['tasks']) => {
    const refMap: Record<string, (typeof tasks)[number]> = {};
    const mapped = tasks.map((task, index) => {
      const ref = `T${index + 1}`;
      refMap[ref] = task;
      return {
        task_ref: ref,
        title: task.title,
        estimated_minutes: task.estimated_minutes,
      };
    });
    return { mapped, refMap };
  };

  const mapBack = (
    refMap: ReturnType<typeof mapToRefs>['refMap'],
    schedule: IGenerateScheduleResponse['schedule'],
  ) => ({
    schedule: schedule.map(({ task_ref, ...rest }) => ({
      ...rest,
      ...refMap[task_ref],
    })),
  });

  const refMapData = mapToRefs(plan.tasks);
  const userConstraints = buildUserConstraints(userState);

  const earliest = getEarliestScheduleTime(userState);
  const scheduleAfter = earliest.format(); // preserves timezone offset (e.g. +07:00)

  const callAI = (correctionMsg?: string) =>
    client.responses.parse({
      model: getModelForTask(AiTask.SCHEDULING, models),
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
            {
              type: 'input_text' as const,
              text: `#EARLIEST START TIME: ${scheduleAfter} (${earliest.format('YYYY-MM-DD HH:mm')} ${userState.time_zone}) — do not schedule any task before this moment.`,
            },
            {
              type: 'input_text' as const,
              text: `#TASKS: ${JSON.stringify({ tasks: refMapData.mapped })}`,
            },
            {
              type: 'input_text' as const,
              text: `#EXISTING SCHEDULE: ${JSON.stringify({ schedule: calendar.results })}`,
            },
            ...(correctionMsg
              ? [{ type: 'input_text' as const, text: correctionMsg }]
              : []),
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
  let { schedule, ...restParsed } = validateOpenAIResponse(
    generateScheduleResponseSchema,
    llmRes.output_parsed,
  );
  let validationError = validateSchedule(
    schedule,
    refMapData.mapped,
    userState,
  );

  if (validationError) {
    llmRes = await callAI(`VALIDATION ERROR — please fix: ${validationError}`);
    ({ schedule, ...restParsed } = validateOpenAIResponse(
      generateScheduleResponseSchema,
      llmRes.output_parsed,
    ));
    validationError = validateSchedule(schedule, refMapData.mapped, userState);
    if (validationError) {
      throw new AppException(
        AppErrorCode.SCHEDULING_INFEASIBLE,
        `Schedule validation failed after retry: ${validationError}`,
      );
    }
  }

  return {
    usage: llmRes.usage,
    outputFormat: { ...restParsed, ...mapBack(refMapData.refMap, schedule) },
  };
};

const getEarliestScheduleTime = (state: UserState): dayjs.Dayjs => {
  const now = dayjs().tz(state.time_zone).add(2, 'minute');
  const [startHour, startMin = 0] = state.working_hours_start
    .split(':')
    .map(Number);
  const [endHour] = state.working_hours_end.split(':').map(Number);

  if (!state.days_off.includes(now.day())) {
    const todayStart = now
      .startOf('day')
      .hour(startHour)
      .minute(startMin)
      .second(0);
    const todayEnd = now.startOf('day').hour(endHour).minute(0).second(0);

    if (now.isBefore(todayStart)) return todayStart; // too early — wait for working hours today
    if (now.isBefore(todayEnd)) return now; // within working hours — start now
  }

  // After working hours or today is a day off — find next working day
  let next = now
    .startOf('day')
    .add(1, 'day')
    .hour(startHour)
    .minute(startMin)
    .second(0);
  while (state.days_off.includes(next.day())) {
    next = next.add(1, 'day');
  }
  return next;
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
  // Allow 3-minute grace period so API latency doesn't cause false failures
  const earliest = dayjs().subtract(3, 'minute');

  for (const item of schedule) {
    const start = dayjs(item.start);
    const end = dayjs(item.end);

    if (start.isBefore(earliest))
      return `Task ${item.task_ref} starts in the past`;

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
      const tolerance = Math.max(15, task.estimated_minutes * 0.1);
      if (Math.abs(durationMin - task.estimated_minutes) > tolerance) {
        return `Task ${item.task_ref} duration mismatch: expected ${task.estimated_minutes}m, got ${durationMin}m`;
      }
    }
  }

  // Check overlaps
  const sorted = [...schedule].sort(
    (a, b) => dayjs(a.start).valueOf() - dayjs(b.start).valueOf(),
  );
  for (let i = 1; i < sorted.length; i++) {
    if (dayjs(sorted[i].start).isBefore(dayjs(sorted[i - 1].end))) {
      return `Tasks ${sorted[i - 1].task_ref} and ${sorted[i].task_ref} overlap`;
    }
  }

  return null;
};

interface IGenerateLeafSchedule {
  client: OpenAI;
  models: IAiTaskModels;
  plan: Exclude<
    Awaited<ReturnType<CalendarScheduleService['getLeafTasks']>>,
    null
  >;
  calendar: Awaited<ReturnType<typeof getCalendarWithScope>>;
  userState: UserState;
}

// ─── Apply schedule ────────────────────────────────────────────────────────────

const applySchedule = async ({
  userId,
  planId,
  client,
  timeZone,
  data,
}: IScheduleEventToCalendar) => {
  const {
    outputFormat: { schedule },
  } = data;

  const results = await Promise.all(
    schedule.map((record) =>
      limit(() =>
        withRetry(() =>
          insertCalendarEvent({
            userId,
            planId,
            client,
            timeZone,
            event: record,
          }),
        ),
      ),
    ),
  );

  const taskEvents = results.map((googleEventId, i) => ({
    taskId: schedule[i].id,
    googleEventId,
    start: schedule[i].start,
    end: schedule[i].end,
  }));

  return { eventRes: results, taskEvents };
};

interface IScheduleEventToCalendar {
  planId: string;
  userId: string;
  timeZone: string;
  client: CalendarService;
  data: Awaited<ReturnType<typeof generateLeafSchedule>>;
}

const insertCalendarEvent = async ({
  userId,
  planId,
  client,
  timeZone,
  event,
}: IInsertCalendarEvent): Promise<string> => {
  const privateProperties = { plan_id: planId, task_id: event.id };

  const createdCalendarEvent = await client.insertEvent({
    userId,
    request: {
      params: {
        calendarId: 'primary',
        requestBody: {
          summary: event.title,
          start: { dateTime: event.start, timeZone },
          end: { dateTime: event.end, timeZone },
          extendedProperties: { private: privateProperties },
        },
      },
    },
  });

  if (!createdCalendarEvent.id)
    throw new Error('Google Calendar did not return event id');
  return createdCalendarEvent.id;
};

interface IInsertCalendarEvent
  extends Pick<
    IScheduleEventToCalendar,
    'userId' | 'planId' | 'client' | 'timeZone'
  > {
  event: IScheduleEventToCalendar['data']['outputFormat']['schedule'][number];
}
