import { google } from 'googleapis';
import { getGoogleClient } from 'src/google/auth/google-auth.client';

export const getCalendarClient = (refreshToken: string) => {
  const googleClient = getGoogleClient();
  googleClient.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth: googleClient });
};
