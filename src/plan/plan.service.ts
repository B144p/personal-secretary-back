import { Injectable } from '@nestjs/common';
import { EPlanStatus } from '@prisma/client';
import { OpenAIService } from 'src/openai/openai.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import {
  IGetDetailProps,
  IGetListProps,
  IPlanActionProps,
  IRemovePlanProps,
} from './interfaces';

@Injectable()
export class PlanService {
  constructor(
    private readonly openAIService: OpenAIService,
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
  ) {}

  async generate(data: Parameters<typeof this.openAIService.generatePlan>[0]) {
    return await this.openAIService.generatePlan(data);
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
    data: Parameters<typeof this.openAIService.reGeneratePlan>[0],
  ) {
    return await this.openAIService.reGeneratePlan(data);
  }

  // TODO: Refactor for reduce complexity
  async planAction({ userId, id, mode }: IPlanActionProps) {
    const plan = await this.getDetail({
      id,
      userId,
    });
    if (typeof plan === 'string') return plan;

    const updatePlanStatus = async (id: string, status: EPlanStatus) => {
      await this.prisma.plan.update({
        where: { id },
        data: { status },
      });
      return `Trigger ${mode} on #${id} plan success.`;
    };

    const approveAction = async () => {
      switch (plan.status) {
        case EPlanStatus.DRAFT:
          return await updatePlanStatus(id, EPlanStatus.READY);
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
          return await updatePlanStatus(id, EPlanStatus.HOLD);
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
