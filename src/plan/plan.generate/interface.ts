import OpenAI from 'openai';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import { GeneratePlanDto } from '../dto/generate-plan.dto';
import { ReGeneratePlanDto } from '../dto/re-generate-plan.dto';
import { IGeneratePlanResponse } from '../schemas';

export interface IGeneratePlanProps {
  userId: string;
  prompt: GeneratePlanDto;
}

export interface IGenerateTaskProps {
  client: OpenAI;
  prompt: GeneratePlanDto;
}

export interface IUpsertPlanProps {
  user: Awaited<ReturnType<UserService['getProfile']>>;
  client: PrismaService;
  plan: IGeneratePlanResponse;
  planId?: string;
}

export interface IReGeneratePlanProps {
  userId: string;
  earlierTask: {
    title: string;
    tasks: Array<string>;
  };
  data: ReGeneratePlanDto & { id: string };
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
