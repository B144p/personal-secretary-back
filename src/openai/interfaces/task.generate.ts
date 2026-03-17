import OpenAI from 'openai';
import { GeneratePlanDto } from 'src/plan/dto/generate-plan.dto';
import { ReGeneratePlanDto } from 'src/plan/dto/re-generate-plan.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import { IGeneratePlanResponse } from '../schemas';

export interface IGeneratePlanProps {
  userId: string;
  prompt: GeneratePlanDto;
}

export interface IReGeneratePlanProps {
  userId: string;
  data: ReGeneratePlanDto & { id: string };
}

export interface IGenerateTaskProps {
  client: OpenAI;
  prompt: GeneratePlanDto;
}

export interface IReGenerateTaskProps {
  client: OpenAI;
  data: ReGeneratePlanDto & {
    earlierTask: {
      title: string;
      tasks: Array<string>;
    };
  };
}

export interface IGetPlanProps {
  client: PrismaService;
  id: string;
  userId: string;
}

export interface IUpsertPlanProps {
  user: Awaited<ReturnType<UserService['getProfile']>>;
  client: PrismaService;
  plan: IGeneratePlanResponse;
  planId?: string;
}
