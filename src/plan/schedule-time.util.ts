import { UserState } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

export const getEarliestScheduleTime = (state: UserState): dayjs.Dayjs => {
  const now = dayjs().tz(state.time_zone).add(2, 'minute');
  const [startHour, startMin = 0] = state.working_hours_start
    .split(':')
    .map(Number);
  const [endHour] = state.working_hours_end.split(':').map(Number);

  if (!state.days_off.includes(now.day())) {
    const todayStart = now
      .startOf('day')
      .hour(startHour)
      .minute(startMin)
      .second(0);
    const todayEnd = now.startOf('day').hour(endHour).minute(0).second(0);

    if (now.isBefore(todayStart)) return todayStart; // too early — wait for working hours today
    if (now.isBefore(todayEnd)) return now; // within working hours — start now
  }

  // After working hours or today is a day off — find next working day
  let next = now
    .startOf('day')
    .add(1, 'day')
    .hour(startHour)
    .minute(startMin)
    .second(0);
  while (state.days_off.includes(next.day())) {
    next = next.add(1, 'day');
  }
  return next;
};
