import { google } from 'googleapis';

export const getCalendarClient = (refreshToken: string) => {
  const googleClient = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  googleClient.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth: googleClient });
};
