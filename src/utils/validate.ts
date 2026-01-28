import { Request } from 'express';

export const validateJwtPayload = (payload: Request['user']) => {
  if (!payload) {
    throw new Error('Validate payload is undefined');
  }
  return payload as IJwtSignData;
};

export interface IJwtSignData {
  sub: string;
  email: string;
}
