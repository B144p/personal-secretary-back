import { google } from 'googleapis';

export const CreateOAuthClient = (redirectUri: string): OAuth2Client => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri,
  );
};

export const getGoogleProfile = async (client: OAuth2Client) => {
  const { data } = await google.oauth2('v2').userinfo.get({ auth: client });
  return data;
};

export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
export type IGoogleProfile = Awaited<ReturnType<typeof getGoogleProfile>>;
