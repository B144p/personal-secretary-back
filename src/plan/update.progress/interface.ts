export type IGetCurrentScheduleProps = IUserReq & {};

export interface IUpdateProgressProps extends IUserReq {
  data?: unknown;
}

interface IUserReq {
  userId: string;
}
