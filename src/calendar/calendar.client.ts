import { google } from 'googleapis';
import { getGoogleClient } from 'src/google/auth/google-auth.client';

// Retry authority for Google Calendar calls is CalendarService.googleCall
// (src/calendar/calendar.service.ts), not this client. Do not add a gaxios
// retryConfig here — two retry layers would multiply attempts and can blow
// the request's client-side timeout.
export const getCalendarClient = (refreshToken: string) => {
  const googleClient = getGoogleClient();
  googleClient.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth: googleClient });
};
