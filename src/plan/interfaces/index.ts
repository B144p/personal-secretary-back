import { EPlanStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import type { ListPlansQuery } from '../dto/list-plans.dto';

interface IUserReq {
  userId: string;
}

export type IGetListProps = IUserReq & { query?: ListPlansQuery };

export interface IGetDetailProps extends IUserReq {
  id: string;
}

export type IPlanActionMode = 'approve' | 'pause';
export interface IPlanActionProps extends IUserReq {
  id: string;
  mode: IPlanActionMode;
}

export type IRemovePlanProps = IUserReq & {
  id: string;
};

export interface ITaskScheduleProps extends IUserReq {
  id: string;
  // Set by resume: books a paused (HOLD) plan again. Every other caller may
  // only schedule a DRAFT or READY plan that is not paused.
  resume?: boolean;
}

export interface IUpdatePlanStatus {
  id: string;
  status: EPlanStatus;
  client: PrismaService;
}
