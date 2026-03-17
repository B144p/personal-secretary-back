import { Injectable } from '@nestjs/common';
import { OpenAIService } from 'src/openai/openai.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';

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
    const { tasks, ...restPlan } = await this.prisma.plan.findUniqueOrThrow({
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

  planAction(id: string, action: 'approve' | 'pause' | 'schedule') {
    return `Trigger ${action} on #${id} plan`;
  }

  remove(id: string) {
    return `This action removes a #${id} plan`;
  }
}

interface IUserReq {
  userId: string;
}

type IGetListProps = IUserReq & {};

interface IGetDetailProps extends IUserReq {
  id: string;
}
