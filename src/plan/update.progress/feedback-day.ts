import { UserState } from '@prisma/client';
import type { Dayjs } from 'dayjs';

// The working day the current feedback pertains to: today, or yesterday when
// submitted before today's working hours begin (e.g. an after-midnight
// review). Returned in the user's timezone so callers can pin to
// working_hours_end.
export const resolveFeedbackDay = (userState: UserState, now: Dayjs): Dayjs => {
  const [startH, startM = 0] = userState.working_hours_start
    .split(':')
    .map(Number);
  const tzNow = now.tz(userState.time_zone);
  const workStartToday = tzNow
    .hour(startH)
    .minute(startM)
    .second(0)
    .millisecond(0);
  return tzNow.isBefore(workStartToday) ? tzNow.subtract(1, 'day') : tzNow;
};
