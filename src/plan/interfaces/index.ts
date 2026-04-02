import { EPlanStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

interface IUserReq {
  userId: string;
}

export type IGetListProps = IUserReq & {};

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
}

export interface IUpdatePlanStatus {
  id: string;
  status: EPlanStatus;
  client: PrismaService;
}
