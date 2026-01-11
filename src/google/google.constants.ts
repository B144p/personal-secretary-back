export const GOOGLE_AUTH_PREFIX = 'auth/google';
export const GOOGLE_AUTH_CALLBACK_PATH = 'callback';
export const GOOGLE_AUTH_REDIRECT_URI = `${process.env.BACKEND_DOMAIN_NAME}/${GOOGLE_AUTH_PREFIX}/${GOOGLE_AUTH_CALLBACK_PATH}`;
export const GOOGLE_LOGIN_SUCCESS_URL = 'https://example.com/';
