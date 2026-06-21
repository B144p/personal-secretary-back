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
