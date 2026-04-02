import { Injectable } from '@nestjs/common';
import { EPlanStatus } from '@prisma/client';
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
    const earlierTask = await this.getDetail({
      id: data.data.id,
      userId: data.userId,
    });
    if (typeof earlierTask === 'string') return earlierTask;

    return await this.generatePlanService.reGeneratePlan({
      ...data,
      earlierTask,
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
          return await updatePlanStatus({
            id,
            status: EPlanStatus.HOLD,
            client: this.prisma,
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
}

const updatePlanStatus = async ({ id, status, client }: IUpdatePlanStatus) => {
  await client.plan.update({
    where: { id },
    data: { status },
  });
  return `Trigger ${status} on #${id} plan success.`;
};
