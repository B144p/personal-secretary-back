import { google } from 'googleapis';

export function CreateOAuthClient(redirectUri: string): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri,
  );
}

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
