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
