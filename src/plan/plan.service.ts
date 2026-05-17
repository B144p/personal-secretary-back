import { Injectable } from '@nestjs/common';
import { EPlanStatus, ETaskStatus, Task } from '@prisma/client';
import { CalendarService } from 'src/calendar/calendar.service';
import { IHoldPlanProps } from 'src/calendar/interfaces';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import { CalendarScheduleService } from './calendar.schedule';
import {
  IGetDetailProps,
  IGetListProps,
  IPlanActionProps,
  IRemovePlanProps,
  IUpdatePlanStatus,
} from './interfaces';
import { GeneratePlanService } from './plan.generate';

@Injectable()
export class PlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly calendarService: CalendarService,
    private readonly calendarScheduleService: CalendarScheduleService,
    private readonly generatePlanService: GeneratePlanService,
  ) {}

  async generate(
    data: Parameters<typeof this.generatePlanService.generatePlan>[0],
  ) {
    return await this.generatePlanService.generatePlan(data);
  }

  async getList({ userId }: IGetListProps) {
    const user = await this.userService.getProfile(userId);
    const plans = await this.prisma.plan.findMany({
      where: { user_id: user.id },
      include: {
        tasks: {
          select: {
            title: true,
          },
        },
      },
      omit: {
        user_id: true,
      },
    });

    const planFormatedList = plans.map(({ tasks, ...rest }) => ({
      ...rest,
      tasks: tasks.map(({ title }) => title),
    }));

    return {
      count: planFormatedList.length,
      results: planFormatedList,
    };
  }

  async getDetail({ userId, id }: IGetDetailProps) {
    const user = await this.userService.getProfile(userId);
    const plan = await this.prisma.plan.findUnique({
      where: {
        user_id: user.id,
        id,
      },
      include: {
        tasks: {
          select: {
            title: true,
          },
        },
      },
      omit: {
        user_id: true,
      },
    });
    if (!plan) return 'Plan is not found!';

    const { tasks, ...restPlan } = plan;

    return {
      ...restPlan,
      tasks: tasks.map(({ title }) => title),
    };
  }

  async reGenerate(
    data: Pick<
      Parameters<typeof this.generatePlanService.reGeneratePlan>[0],
      'userId' | 'data'
    >,
  ) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: data.data.id, user_id: data.userId },
      include: { tasks: true },
    });
    if (!plan) return 'Plan is not found!';

    return await this.generatePlanService.reGeneratePlan({
      ...data,
      earlierTask: { title: plan.title, tasks: buildTaskTree(plan.tasks, null) },
    });
  }

  async generateAndApplyTaskSchedule(
    data: Parameters<
      typeof this.calendarScheduleService.generateAndApplyTaskSchedule
    >[0],
  ) {
    const scheduleRes =
      await this.calendarScheduleService.generateAndApplyTaskSchedule(data);

    await updatePlanStatus({
      id: data.id,
      status: EPlanStatus.SCHEDULED,
      client: this.prisma,
    });

    return scheduleRes;
  }

  // TODO: Refactor for reduce complexity
  async planAction({ userId, id, mode }: IPlanActionProps) {
    const plan = await this.getDetail({
      id,
      userId,
    });
    if (typeof plan === 'string') return plan;

    const approveAction = async () => {
      switch (plan.status) {
        case EPlanStatus.DRAFT:
          return await updatePlanStatus({
            id,
            status: EPlanStatus.READY,
            client: this.prisma,
          });
        case EPlanStatus.HOLD:
        case EPlanStatus.READY:
        case EPlanStatus.SCHEDULED:
          return 'Your plan is already approved.';
        default:
          throw new Error('Status is out of scope.');
      }
    };

    const pauseAction = async () => {
      switch (plan.status) {
        case EPlanStatus.DRAFT:
          return 'Your plan still in phase draft.';
        case EPlanStatus.HOLD:
        case EPlanStatus.READY:
        case EPlanStatus.SCHEDULED:
          return await holdPlan({
            id,
            userId,
            client: this.prisma,
            calendar: this.calendarService,
          });
        default:
          throw new Error('Status is out of scope.');
      }
    };

    switch (mode) {
      case 'pause':
        return await pauseAction();
      case 'approve':
        return await approveAction();
      default:
        return 'Action mode out of scope!';
    }
  }

  async remove({ id, userId }: IRemovePlanProps) {
    const plan = await this.getDetail({
      id,
      userId,
    });
    if (typeof plan === 'string') return plan;

    await this.prisma.plan.delete({
      where: {
        id,
        user_id: userId,
      },
    });
    return `Remove plan success.`;
  }

  async removeRelatedCalendarEvent(
    data: Parameters<
      typeof this.generatePlanService.removeRelatedCalendarEvent
    >[0],
  ) {
    return await this.generatePlanService.removeRelatedCalendarEvent(data);
  }
}

const updatePlanStatus = async ({ id, status, client }: IUpdatePlanStatus) => {
  await client.plan.update({
    where: { id },
    data: { status },
  });
  return `Trigger ${status} on #${id} plan success.`;
};

const holdPlan = async ({ id, userId, client, calendar }: IHoldPlanProps) => {
  await updatePlanStatus({
    id,
    status: EPlanStatus.HOLD,
    client,
  });

  // delete event except task_status Done
  const calendarClient = await calendar.getClient(userId);

  const relatedEvents = await calendarClient.events.list({
    calendarId: 'primary',
    privateExtendedProperty: [`plan_id=${id}`],
  });

  // Note: can migrate source_id into task model for easily manage schedule event
  const staleTasks = await client.task.findMany({
    where: {
      plan_id: id,
      status: {
        not: ETaskStatus.DONE,
      },
    },
  });

  // filter events which related task is not done yet
  const focusDeleteEventIds =
    relatedEvents.data.items?.reduce(
      (acc: Array<string>, { id, extendedProperties }) => {
        const { task_id } =
          extendedProperties?.private as IEventPrivateProperties;

        if (staleTasks.some((task) => task.id === task_id)) {
          acc.push(id!);
        }

        return acc;
      },
      [],
    ) ?? [];

  // remove events
  return await calendar.removeEvents({
    client: calendarClient,
    calendarId: 'primary',
    events: focusDeleteEventIds,
  });
};

interface IEventPrivateProperties {
  plan_id?: string;
  task_id?: string;
}

const buildTaskTree = (tasks: Task[], parentId: string | null): ReturnType<typeof import('./schemas').generatePlanResponseSchema.shape.tasks.element.parse>[] => {
  return tasks
    .filter((t) => t.parent_task_id === parentId)
    .sort((a, b) => a.sequence_order - b.sequence_order)
    .map((t) => ({
      title: t.title,
      description: t.description ?? '',
      sequence_order: t.sequence_order,
      estimated_minutes: t.estimated_minutes,
      children: buildTaskTree(tasks, t.id) as any,
    }));
};
