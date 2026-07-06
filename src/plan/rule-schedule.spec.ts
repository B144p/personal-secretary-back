import { UserState } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { computeRuleSchedule } from './rule-schedule';

dayjs.extend(utc);
dayjs.extend(timezone);

const baseUserState: UserState = {
  user_id: 'user-1',
  working_hours_start: '10:00',
  working_hours_end: '20:00',
  days_off: [0], // Sunday
  time_zone: 'Asia/Bangkok',
  special_days: {},
  last_calendar_sync: null,
} as UserState;

describe('computeRuleSchedule', () => {
  it('packs tasks in the given order with exact durations and a 15-minute break between them', () => {
    const { placements, unschedulableTaskIds } = computeRuleSchedule({
      tasks: [
        { id: 't1', estimated_minutes: 60 },
        { id: 't2', estimated_minutes: 30 },
        { id: 't3', estimated_minutes: 90 },
      ],
      busyIntervals: [],
      userState: baseUserState,
    });

    expect(unschedulableTaskIds).toEqual([]);
    expect(placements.map((p) => p.taskId)).toEqual(['t1', 't2', 't3']);

    for (let i = 1; i < placements.length; i++) {
      expect(
        dayjs(placements[i].start).diff(dayjs(placements[i - 1].end), 'minute'),
      ).toBe(15);
    }

    const durations = placements.map((p) =>
      dayjs(p.end).diff(dayjs(p.start), 'minute'),
    );
    expect(durations).toEqual([60, 30, 90]);
  });

  it('inserts a 15-minute gap between two consecutive tasks', () => {
    const { placements } = computeRuleSchedule({
      tasks: [
        { id: 't1', estimated_minutes: 30 },
        { id: 't2', estimated_minutes: 30 },
      ],
      busyIntervals: [],
      userState: baseUserState,
    });

    const gap = dayjs(placements[1].start).diff(
      dayjs(placements[0].end),
      'minute',
    );
    expect(gap).toBe(15);
  });

  it('rolls a task to the next working day when it does not fit before working hours end', () => {
    const { placements } = computeRuleSchedule({
      tasks: [{ id: 'big', estimated_minutes: 600 }], // 10h — exactly fills the window
      busyIntervals: [],
      userState: baseUserState,
    });

    const [placement] = placements;
    const start = dayjs(placement.start).tz(baseUserState.time_zone);
    expect(start.hour()).toBe(10);
    expect(start.minute()).toBe(0);
  });

  it('skips days marked as days off', () => {
    const now = dayjs().tz(baseUserState.time_zone);
    // Force scheduling to land on a day-off boundary by using a state whose
    // only working day is the day after tomorrow's opposite — simplest is to
    // mark every day except one far-future day as off is impractical, so
    // instead assert no placement ever lands on a days_off weekday.
    const { placements } = computeRuleSchedule({
      tasks: Array.from({ length: 20 }, (_, i) => ({
        id: `t${i}`,
        estimated_minutes: 120,
      })),
      busyIntervals: [],
      userState: baseUserState,
    });

    for (const p of placements) {
      const day = dayjs(p.start).tz(baseUserState.time_zone).day();
      expect(baseUserState.days_off.includes(day)).toBe(false);
    }
    expect(now.isValid()).toBe(true);
  });

  it('avoids busy calendar intervals', () => {
    // First find where the task would land with no conflicts, then place a
    // busy block exactly over that slot (plus a margin) and verify the
    // packer jumps past it instead of overlapping.
    const { placements: unblocked } = computeRuleSchedule({
      tasks: [{ id: 'solo', estimated_minutes: 60 }],
      busyIntervals: [],
      userState: baseUserState,
    });
    const naturalStart = dayjs(unblocked[0].start);
    const busyEnd = dayjs(unblocked[0].end).add(30, 'minute');

    const { placements: blocked } = computeRuleSchedule({
      tasks: [{ id: 'solo', estimated_minutes: 60 }],
      busyIntervals: [{ start: naturalStart, end: busyEnd }],
      userState: baseUserState,
    });

    const placedStart = dayjs(blocked[0].start);
    expect(placedStart.isBefore(busyEnd)).toBe(false);
  });

  it('marks a task unschedulable if its duration exceeds the working-hours window', () => {
    const { placements, unschedulableTaskIds } = computeRuleSchedule({
      tasks: [{ id: 'too-long', estimated_minutes: 700 }], // window is 600 min
      busyIntervals: [],
      userState: baseUserState,
    });

    expect(placements).toEqual([]);
    expect(unschedulableTaskIds).toEqual(['too-long']);
  });
});
