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
