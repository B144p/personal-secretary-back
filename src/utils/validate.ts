import { Request } from 'express';

export const getRequiredEnv = (envName: string) => {
  const value = process.env[envName];
  if (!value) {
    throw new Error(`Environment variable ${envName} is required but not set.`);
  }
  return value;
};

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
