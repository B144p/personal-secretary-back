import { google } from 'googleapis';
import { getRequiredEnv } from 'src/utils';
import { getGoogleAuthRedirectUri } from '../google.constants';

export const CreateOAuthClient = (): OAuth2Client => {
  return new google.auth.OAuth2(
    getRequiredEnv('GOOGLE_CLIENT_ID'),
    getRequiredEnv('GOOGLE_CLIENT_SECRET'),
    getGoogleAuthRedirectUri(),
  );
};

export const getGoogleClient = (): OAuth2Client => {
  return new google.auth.OAuth2(
    getRequiredEnv('GOOGLE_CLIENT_ID'),
    getRequiredEnv('GOOGLE_CLIENT_SECRET'),
  );
};

export const getGoogleProfile = async (client: OAuth2Client) => {
  const { data } = await google.oauth2('v2').userinfo.get({ auth: client });
  return data;
};

export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
