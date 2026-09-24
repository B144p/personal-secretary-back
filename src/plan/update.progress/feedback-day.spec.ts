import { UserState } from '@prisma/client';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { resolveFeedbackDay } from './feedback-day';

dayjs.extend(utc);
dayjs.extend(timezone);

const userState = (overrides: Partial<UserState> = {}): UserState =>
  ({
    working_hours_start: '09:00',
    working_hours_end: '18:00',
    time_zone: 'Asia/Bangkok',
    ...overrides,
  }) as UserState;

describe('resolveFeedbackDay', () => {
  it('rolls back to yesterday when submitted before working hours begin (after midnight)', () => {
    const state = userState();
    const now = dayjs.tz('2026-07-13 01:30', state.time_zone);
    const result = resolveFeedbackDay(state, now);
    expect(result.format('YYYY-MM-DD')).toBe('2026-07-12');
  });

  it('stays on today when submitted after working hours end (same-day evening review)', () => {
    const state = userState();
    const now = dayjs.tz('2026-07-13 22:00', state.time_zone);
    const result = resolveFeedbackDay(state, now);
    expect(result.format('YYYY-MM-DD')).toBe('2026-07-13');
  });

  it('stays on today when submitted within working hours', () => {
    const state = userState();
    const now = dayjs.tz('2026-07-13 14:00', state.time_zone);
    const result = resolveFeedbackDay(state, now);
    expect(result.format('YYYY-MM-DD')).toBe('2026-07-13');
  });

  it('rolls back to yesterday for feedback submitted 2+ days late, still before working hours', () => {
    const state = userState();
    const now = dayjs.tz('2026-07-15 01:30', state.time_zone);
    const result = resolveFeedbackDay(state, now);
    expect(result.format('YYYY-MM-DD')).toBe('2026-07-14');
  });

  it('respects the user timezone at the day boundary', () => {
    const state = userState({ time_zone: 'America/New_York' });
    // 08:30 America/New_York is before the 09:00 working-hours start there.
    const now = dayjs.tz('2026-07-13 08:30', state.time_zone);
    const result = resolveFeedbackDay(state, now);
    expect(result.format('YYYY-MM-DD')).toBe('2026-07-12');
  });
});
