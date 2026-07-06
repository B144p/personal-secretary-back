import { Prisma } from '@prisma/client';

export type IGetCurrentScheduleProps = IUserReq & {};

export interface IStatusChange {
  taskId: string;
  newStatus: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'HOLD';
}

export interface IUpdateProgressProps extends IUserReq {
  data: {
    statusChanges?: IStatusChange[];
    contextText?: string;
  };
}

interface IUserReq {
  userId: string;
}

export type PlanWithTasks = Prisma.PlanGetPayload<{
  include: { tasks: { include: { events: true } } };
}>;
export type LeafTask = PlanWithTasks['tasks'][number];
