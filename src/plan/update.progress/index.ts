import { Injectable } from '@nestjs/common';
import { EPlanStatus, ETaskStatus, UserState } from '@prisma/client';
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
import { generateScheduleResponseSchema } from '../schemas';
import { schedulePrompt } from '../calendar.schedule/prompt';
import { CalendarScheduleService } from '../calendar.schedule';
import type {
  IGetCurrentScheduleProps,
  IUpdateProgressProps,
} from './interface';

dayjs.extend(utc);
dayjs.extend(timezone);

const limit = pLimit(2);

@Injectable()
export class UpdateProgressService {
  constructor(
    private readonly openai: OpenAI,
    private readonly prisma: PrismaService,
    private readonly calendarService: CalendarService,
    private readonly calendarScheduleService: CalendarScheduleService,
  ) {}

  async getCurrentSchedule({ userId }: IGetCurrentScheduleProps) {
    return this.calendarScheduleService.getCurrentSchedule({ userId });
  }

  async updateProgress({ userId, data }: IUpdateProgressProps) {
    const { statusChanges = [], contextText } = data;

    // Find the user's active SCHEDULED plan
    const plan = await this.prisma.plan.findFirst({
      where: { user_id: userId, status: EPlanStatus.SCHEDULED },
      include: {
        tasks: {
          include: { events: { where: { is_active: true } } },
        },
      },
    });
    if (!plan)
      throw new AppException(
        AppErrorCode.PLAN_NOT_FOUND,
        'No SCHEDULED plan found',
      );

    const userState = await this.prisma.userState.findUnique({
      where: { user_id: userId },
    });
    if (!userState) throw new Error('UserState not found');

    // 1. Reconcile calendar: absorb any manual moves of our events
    await reconcileCalendarMoves({
      userId,
      plan,
      calendarService: this.calendarService,
      prisma: this.prisma,
    });

    // 2. Apply status changes
    if (statusChanges.length > 0) {
      await this.prisma.$transaction(
        statusChanges.map(({ taskId, newStatus }) =>
          this.prisma.task.update({
            where: { id: taskId, plan_id: plan.id },
            data: { status: newStatus as ETaskStatus },
          }),
        ),
      );
    }

    // 3. Persist DailyFeedback
    await this.prisma.dailyFeedback.create({
      data: {
        plan_id: plan.id,
        date: dayjs().tz(userState.time_zone).format('YYYY-MM-DD'),
        status_changes:
          statusChanges as unknown as import('@prisma/client').Prisma.InputJsonValue,
        context_text: contextText,
      },
    });

    // 4. Re-fetch updated plan tasks
    const updatedPlan = await this.prisma.plan.findUnique({
      where: { id: plan.id },
      include: {
        tasks: {
          include: { events: { where: { is_active: true } } },
        },
      },
    });
    if (!updatedPlan) throw new Error('Plan disappeared');

    const allTasks = updatedPlan.tasks;

    // 5. Check if all leaves are DONE → mark plan DONE
    const leafIds = getLeafIds(allTasks);
    const allLeavesDone = allTasks
      .filter((t) => leafIds.has(t.id))
      .every((t) => t.status === ETaskStatus.DONE);

    if (allLeavesDone) {
      await this.prisma.plan.update({
        where: { id: plan.id },
        data: { status: EPlanStatus.DONE },
      });
      return {
        rescheduled: [],
        planStatus: EPlanStatus.DONE,
        unscheduledTaskIds: [],
      };
    }

    // 6. Identify slipped leaf tasks: PENDING or IN_PROGRESS with active event end in the past
    const now = dayjs();
    const slippedLeaves = allTasks.filter((t) => {
      if (!leafIds.has(t.id)) return false;
      if (t.status === ETaskStatus.DONE) return false;
      const activeEvent = t.events[0];
      if (!activeEvent) return false;
      return dayjs(activeEvent.end).isBefore(now);
    });

    if (slippedLeaves.length === 0) {
      return {
        rescheduled: [],
        planStatus: EPlanStatus.SCHEDULED,
        unscheduledTaskIds: [],
      };
    }

    // 7. Re-schedule slipped + remaining unscheduled leaves
    const remainingLeaves = allTasks.filter(
      (t) => leafIds.has(t.id) && t.status !== ETaskStatus.DONE,
    );

    const calendarEvents = await getCalendarRange({
      userId,
      calendarService: this.calendarService,
    });

    const mappedTasks = remainingLeaves.map((t) => ({
      id: t.id,
      title: t.title,
      estimated_minutes: t.estimated_minutes,
      status: t.status,
      sequence_order: t.sequence_order,
    }));

    const newSchedule = await rescheduleLeaves({
      client: this.openai,
      tasks: mappedTasks,
      calendar: calendarEvents,
      userState,
      contextText,
    });

    // 8. Apply new schedule: create Google events, update TaskEvents
    const rescheduled: string[] = [];
    const unscheduledTaskIds: string[] = [];

    for (const item of newSchedule) {
      const taskId = item.taskId;
      if (!taskId) {
        unscheduledTaskIds.push(String(item.task_ref));
        continue;
      }

      try {
        const googleEventId = await withRetry(() =>
          limit(() =>
            insertCalendarEvent({
              userId,
              planId: plan.id,
              client: this.calendarService,
              event: item,
            }),
          ),
        );

        await this.prisma.$transaction([
          // Deactivate old event
          this.prisma.taskEvent.updateMany({
            where: { task_id: taskId, is_active: true },
            data: { is_active: false },
          }),
          // Create new active event
          this.prisma.taskEvent.create({
            data: {
              task_id: taskId,
              google_event_id: googleEventId,
              start: new Date(item.start),
              end: new Date(item.end),
              is_active: true,
            },
          }),
        ]);

        rescheduled.push(taskId);
      } catch {
        unscheduledTaskIds.push(taskId);
      }
    }

    return {
      rescheduled,
      planStatus: EPlanStatus.SCHEDULED,
      unscheduledTaskIds,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getLeafIds = (tasks: { id: string; parent_task_id: string | null }[]) => {
  const parentSet = new Set(
    tasks.map((t) => t.parent_task_id).filter(Boolean) as string[],
  );
  return new Set(tasks.filter((t) => !parentSet.has(t.id)).map((t) => t.id));
};

const reconcileCalendarMoves = async ({
  userId,
  plan,
  calendarService,
  prisma,
}: {
  userId: string;
  plan: {
    id: string;
    tasks: Array<{
      id: string;
      events: Array<{ id: string; google_event_id: string }>;
    }>;
  };
  calendarService: CalendarService;
  prisma: PrismaService;
}) => {
  const calClient = await calendarService.getClient(userId);
  const calEvents = await calClient.events.list({
    calendarId: 'primary',
    privateExtendedProperty: [`plan_id=${plan.id}`],
  });

  const calMap: Record<string, { start: string; end: string }> = {};
  for (const e of calEvents.data.items ?? []) {
    if (e.id)
      calMap[e.id] = {
        start: e.start?.dateTime ?? '',
        end: e.end?.dateTime ?? '',
      };
  }

  for (const task of plan.tasks) {
    for (const ev of task.events) {
      const cal = calMap[ev.google_event_id];
      if (!cal) continue;
      await prisma.taskEvent.update({
        where: { id: ev.id },
        data: { start: new Date(cal.start), end: new Date(cal.end) },
      });
    }
  }
};

const getCalendarRange = async ({
  userId,
  calendarService,
}: {
  userId: string;
  calendarService: CalendarService;
}) => {
  const { results } = await calendarService.getCalendarRange({
    userId,
    range: {
      timeMin: dayjs().toISOString(),
      timeMax: dayjs().add(1, 'month').toISOString(),
    },
  });
  return {
    results: results.map(
      ({ extendedProperties, summary, start, end, description }) => ({
        extendedProperties,
        summary,
        start,
        end,
        description,
      }),
    ),
  };
};

const rescheduleLeaves = async ({
  client,
  tasks,
  calendar,
  userState,
  contextText,
}: {
  client: OpenAI;
  tasks: Array<{
    id: string;
    title: string;
    estimated_minutes: number | null;
    status: string;
    sequence_order: number;
  }>;
  calendar: { results: unknown[] };
  userState: UserState;
  contextText?: string;
}) => {
  const refMap: Record<string, string> = {};
  const mappedTasks = tasks.map((t, i) => {
    const ref = `T${i + 1}`;
    refMap[ref] = t.id;
    return {
      task_ref: ref,
      title: t.title,
      estimated_minutes: t.estimated_minutes,
    };
  });

  const userConstraints = `
## USER WORKING CONSTRAINTS
- Timezone: '${userState.time_zone}'
- Working hours: ${userState.working_hours_start} to ${userState.working_hours_end}
- Days off: [${userState.days_off.join(', ')}] (0=Sunday … 6=Saturday)
`;

  const llmRes = await client.responses.parse({
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
          {
            type: 'input_text' as const,
            text: `#TASKS: ${JSON.stringify({ tasks: mappedTasks })}`,
          },
          {
            type: 'input_text' as const,
            text: `#EXISTING SCHEDULE: ${JSON.stringify({ schedule: calendar.results })}`,
          },
          ...(contextText
            ? [{ type: 'input_text' as const, text: `Context: ${contextText}` }]
            : []),
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'reschedule',
        strict: true,
        schema: z.toJSONSchema(generateScheduleResponseSchema),
      },
    },
  });

  const { schedule } = validateOpenAIResponse(
    generateScheduleResponseSchema,
    llmRes.output_parsed,
  );
  return schedule.map(({ task_ref, ...rest }) => ({
    ...rest,
    taskId: refMap[task_ref],
    task_ref,
  }));
};

const insertCalendarEvent = async ({
  userId,
  planId,
  client,
  event,
}: {
  userId: string;
  planId: string;
  client: CalendarService;
  event: { taskId?: string; title?: string; start: string; end: string };
}): Promise<string> => {
  const createdEvent = await client.insertEvent({
    userId,
    request: {
      params: {
        calendarId: 'primary',
        requestBody: {
          summary: event.title ?? '',
          start: { dateTime: event.start },
          end: { dateTime: event.end },
          extendedProperties: {
            private: { plan_id: planId, task_id: event.taskId ?? '' },
          },
        },
      },
    },
  });
  if (!createdEvent.id)
    throw new Error('Google Calendar did not return event id');
  return createdEvent.id;
};
