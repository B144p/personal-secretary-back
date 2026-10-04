import { Injectable } from '@nestjs/common';
import { EPlanSourceType, EPlanStatus, ETaskStatus } from '@prisma/client';
import dayjs from 'dayjs';
import { CalendarService } from 'src/calendar/calendar.service';
import { AppException } from 'src/common/errors/app-exception';
import { getLeafIds } from 'src/plan/leaf-select';
import { classifyLeaves } from 'src/plan/update.progress/classify';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import {
  agendaRange,
  buildAgenda,
  clampDays,
  type AgendaCalendarEvent,
} from './agenda.builder';
import type { AgendaQuery } from './agenda.dto';

// What the user has on: plan steps booked in the calendar, other calendar
// events, steps that slipped, and Claude Code work in progress. Read-only.
// A calendar failure is reported in calendar_error, never thrown, so an
// agent still sees the plan side.
@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendarService: CalendarService,
    private readonly userService: UserService,
  ) {}

  async getAgenda(userId: string, query: AgendaQuery) {
    const userState = await this.userService.getSettings(userId);
    const now = new Date();
    const days = clampDays(query.days);
    const { start, end } = agendaRange({
      timeZone: userState.time_zone,
      date: query.date,
      days,
      now,
    });

    const [taskEvents, scheduledPlan, inProgress, calendar] = await Promise.all(
      [
        this.prisma.taskEvent.findMany({
          where: {
            is_active: true,
            start: { gte: start.toDate(), lt: end.toDate() },
            task: { plan: { user_id: userId } },
          },
          include: {
            task: {
              include: {
                parent: { select: { title: true } },
                plan: { select: { id: true, title: true } },
              },
            },
          },
          orderBy: { start: 'asc' },
        }),
        this.prisma.plan.findFirst({
          where: { user_id: userId, status: EPlanStatus.SCHEDULED },
          include: {
            tasks: { include: { events: { where: { is_active: true } } } },
          },
        }),
        this.prisma.task.findMany({
          where: {
            status: ETaskStatus.IN_PROGRESS,
            children: { none: {} },
            plan: {
              user_id: userId,
              source_type: EPlanSourceType.CLAUDE_CODE,
              status: { notIn: [EPlanStatus.DONE, EPlanStatus.HOLD] },
            },
          },
          include: {
            plan: {
              select: { id: true, title: true, repo_key: true, branch: true },
            },
          },
        }),
        this.calendarService
          .getCalendarRange({
            userId,
            range: {
              timeMin: start.toISOString(),
              timeMax: end.toISOString(),
              singleEvents: true,
              orderBy: 'startTime',
            },
          })
          .then((r) => ({ events: r.results, error: null as string | null }))
          .catch((err: unknown) => ({
            events: [],
            error:
              err instanceof AppException ? err.code : 'CALENDAR_UNAVAILABLE',
          })),
      ],
    );

    const slipped = scheduledPlan
      ? classifyLeaves({
          allTasks: scheduledPlan.tasks,
          leafIds: getLeafIds(scheduledPlan.tasks),
          statusChanges: [],
          now: dayjs(now),
        })
          .slippedLeaves.filter((t) => t.status !== ETaskStatus.CANCELLED)
          .map((t) => ({
            plan_id: scheduledPlan.id,
            task_id: t.id,
            title: t.title,
            scheduled_end: t.events[0].end,
            status: t.status,
          }))
      : [];

    return buildAgenda({
      userState,
      date: query.date,
      days,
      now,
      taskEvents: taskEvents.map((te) => ({
        start: te.start,
        end: te.end,
        task: {
          id: te.task.id,
          title: te.task.title,
          status: te.task.status,
          estimated_minutes: te.task.estimated_minutes,
          parent_title: te.task.parent?.title ?? null,
        },
        plan: te.task.plan,
      })),
      calendarEvents: calendar.events as AgendaCalendarEvent[],
      slipped,
      claudeCodeInProgress: inProgress.map((t) => ({
        plan_id: t.plan.id,
        plan_title: t.plan.title,
        task_id: t.id,
        title: t.title,
        repo_key: t.plan.repo_key,
        branch: t.plan.branch,
      })),
      calendarError: calendar.error,
    });
  }
}
