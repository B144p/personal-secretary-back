import { UserState } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { getEarliestScheduleTime } from './schedule-time.util';

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_DURATION_MINUTES = 30;
// Safety bound on cursor advances per task, guarding against a hang if
// UserState is misconfigured (e.g. every weekday marked as a day off).
const MAX_PLACEMENT_ITERATIONS = 500;

export interface IRuleScheduleTask {
  id: string;
  estimated_minutes: number | null;
}

export interface IBusyInterval {
  start: dayjs.Dayjs;
  end: dayjs.Dayjs;
}

export interface IRuleSchedulePlacement {
  taskId: string;
  start: string;
  end: string;
}

const atWorkingStart = (day: dayjs.Dayjs, state: UserState): dayjs.Dayjs => {
  const [startHour, startMin = 0] = state.working_hours_start
    .split(':')
    .map(Number);
  return day.startOf('day').hour(startHour).minute(startMin).second(0);
};

// Rolls a cursor forward past days off and clamps it to today's working-hours
// start if it's too early. Leaves an already-valid mid-day cursor untouched.
const normalizeCursor = (time: dayjs.Dayjs, state: UserState): dayjs.Dayjs => {
  let cursor = time;
  let rolls = 0;
  for (;;) {
    if (state.days_off.includes(cursor.day())) {
      cursor = atWorkingStart(cursor.add(1, 'day'), state);
    } else {
      const dayStart = atWorkingStart(cursor, state);
      if (cursor.isBefore(dayStart)) cursor = dayStart;
      return cursor;
    }
    if (++rolls > MAX_PLACEMENT_ITERATIONS) {
      throw new Error(
        'Unable to find a working day — check UserState working_hours/days_off configuration',
      );
    }
  }
};

// Deterministically packs tasks back-to-back, in the order given, starting
// from the earliest legal time. Honors working hours, days off, and exact
// estimated_minutes durations, and skips past busy calendar intervals.
export const computeRuleSchedule = ({
  tasks,
  busyIntervals,
  userState,
}: {
  tasks: IRuleScheduleTask[];
  busyIntervals: IBusyInterval[];
  userState: UserState;
}): {
  placements: IRuleSchedulePlacement[];
  unschedulableTaskIds: string[];
} => {
  const [startHour, startMin = 0] = userState.working_hours_start
    .split(':')
    .map(Number);
  const [endHour, endMin = 0] = userState.working_hours_end
    .split(':')
    .map(Number);
  const windowMinutes = endHour * 60 + endMin - (startHour * 60 + startMin);

  const sortedBusy = [...busyIntervals].sort(
    (a, b) => a.start.valueOf() - b.start.valueOf(),
  );

  const placements: IRuleSchedulePlacement[] = [];
  const unschedulableTaskIds: string[] = [];
  let cursor = getEarliestScheduleTime(userState);

  for (const task of tasks) {
    const duration = task.estimated_minutes ?? DEFAULT_DURATION_MINUTES;
    // A task longer than the working-hours window can never fit in one day.
    if (duration > windowMinutes) {
      unschedulableTaskIds.push(task.id);
      continue;
    }

    let rolls = 0;
    for (;;) {
      cursor = normalizeCursor(cursor, userState);
      const dayEnd = cursor
        .startOf('day')
        .hour(endHour)
        .minute(endMin)
        .second(0);
      const blockEnd = cursor.add(duration, 'minute');

      if (blockEnd.isAfter(dayEnd)) {
        cursor = atWorkingStart(cursor.add(1, 'day'), userState);
        if (++rolls > MAX_PLACEMENT_ITERATIONS) {
          throw new Error(
            'Unable to place task within search bound — check UserState working_hours/days_off configuration',
          );
        }
        continue;
      }

      const conflict = sortedBusy.find(
        (busy) => cursor.isBefore(busy.end) && blockEnd.isAfter(busy.start),
      );
      if (conflict) {
        cursor = conflict.end;
        if (++rolls > MAX_PLACEMENT_ITERATIONS) {
          throw new Error(
            'Unable to place task within search bound — check UserState working_hours/days_off configuration',
          );
        }
        continue;
      }

      placements.push({
        taskId: task.id,
        start: cursor.format(),
        end: blockEnd.format(),
      });
      cursor = blockEnd;
      break;
    }
  }

  return { placements, unschedulableTaskIds };
};
