import { getRequiredEnv } from 'src/utils';

export const GOOGLE_AUTH_PREFIX = 'auth/google';
export const GOOGLE_AUTH_CALLBACK_PATH = 'callback';
export const GOOGLE_LOGIN_SUCCESS_URL = 'https://example.com/';
export const GOOGLE_STRATEGY_NAME = 'google';
export const JWT_STRATEGY_NAME = 'jwt';

export const getGoogleAuthRedirectUri = () => {
  return `${getRequiredEnv('BACKEND_DOMAIN_NAME')}/${GOOGLE_AUTH_PREFIX}/${GOOGLE_AUTH_CALLBACK_PATH}`;
};
