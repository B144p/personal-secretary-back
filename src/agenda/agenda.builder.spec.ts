import {
  type AgendaCalendarEvent,
  type AgendaTaskEvent,
  buildAgenda,
  clampDays,
} from './agenda.builder';

const userState = {
  time_zone: 'Asia/Bangkok',
  working_hours_start: '10:00',
  working_hours_end: '20:00',
  days_off: [0], // Sunday
};
// Saturday 2026-10-03, 09:00 in Bangkok.
const NOW = new Date('2026-10-03T02:00:00Z');

const taskEvent = (start: string, end: string): AgendaTaskEvent => ({
  start: new Date(start),
  end: new Date(end),
  task: {
    id: 't1',
    title: 'Write hero copy',
    status: 'PENDING',
    estimated_minutes: 45,
    parent_title: 'Content',
  },
  plan: { id: 'p1', title: 'Landing page' },
});

const build = (over: Partial<Parameters<typeof buildAgenda>[0]> = {}) =>
  buildAgenda({
    userState,
    now: NOW,
    taskEvents: [],
    calendarEvents: [],
    slipped: [],
    claudeCodeInProgress: [],
    calendarError: null,
    ...over,
  });

describe('buildAgenda', () => {
  it('puts a 23:30 Bangkok event on its own day, not the next UTC day', () => {
    const late: AgendaCalendarEvent = {
      summary: 'Late call',
      start: { dateTime: '2026-10-03T23:30:00+07:00' },
      end: { dateTime: '2026-10-04T00:15:00+07:00' },
    };
    const agenda = build({ calendarEvents: [late], days: 2 });
    expect(agenda.days.map((d) => d.items.length)).toEqual([1, 0]);
    expect(agenda.days[0].items[0]).toMatchObject({
      kind: 'event',
      start: '2026-10-03T23:30:00+07:00',
    });
  });

  it('flags days off in the user timezone', () => {
    const agenda = build({ days: 2 });
    expect(agenda.days).toMatchObject([
      { date: '2026-10-03', is_day_off: false },
      { date: '2026-10-04', is_day_off: true },
    ]);
  });

  it('lists plan steps once and drops plan-tagged and marker events', () => {
    const agenda = build({
      taskEvents: [taskEvent('2026-10-03T03:00:00Z', '2026-10-03T03:45:00Z')],
      calendarEvents: [
        {
          summary: 'Write hero copy',
          start: { dateTime: '2026-10-03T10:00:00+07:00' },
          end: { dateTime: '2026-10-03T10:45:00+07:00' },
          extendedProperties: { private: { plan_id: 'p1', task_id: 't1' } },
        },
        {
          summary: '[DONE] Early task',
          start: { dateTime: '2026-10-03T20:00:00+07:00' },
          end: { dateTime: '2026-10-03T20:15:00+07:00' },
          extendedProperties: { private: { early_marker: 'true' } },
        },
        {
          summary: 'Team sync',
          location: 'Chiang Mai',
          start: { dateTime: '2026-10-03T14:00:00+07:00' },
          end: { dateTime: '2026-10-03T14:30:00+07:00' },
        },
      ],
    });
    expect(agenda.days[0].items).toEqual([
      expect.objectContaining({
        kind: 'task',
        start: '2026-10-03T10:00:00+07:00',
        path: ['Content', 'Write hero copy'],
      }),
      expect.objectContaining({
        kind: 'event',
        summary: 'Team sync',
        location: 'Chiang Mai',
      }),
    ]);
  });

  it('keeps all-day events on their date, first in the day', () => {
    const agenda = build({
      taskEvents: [taskEvent('2026-10-03T03:00:00Z', '2026-10-03T03:45:00Z')],
      calendarEvents: [
        {
          summary: 'Holiday',
          start: { date: '2026-10-03' },
          end: { date: '2026-10-04' },
        },
      ],
    });
    expect(agenda.days[0].items[0]).toMatchObject({
      kind: 'event',
      all_day: true,
      start: '2026-10-03',
    });
  });

  it('still returns the plan side when the calendar failed', () => {
    const agenda = build({
      taskEvents: [taskEvent('2026-10-03T03:00:00Z', '2026-10-03T03:45:00Z')],
      calendarError: 'GOOGLE_REAUTH_REQUIRED',
      slipped: [
        {
          plan_id: 'p1',
          task_id: 't0',
          title: 'Draft FAQ',
          scheduled_end: new Date('2026-10-02T08:00:00Z'),
          status: 'PENDING',
        },
      ],
    });
    expect(agenda.calendar_error).toBe('GOOGLE_REAUTH_REQUIRED');
    expect(agenda.days[0].items).toHaveLength(1);
    expect(agenda.slipped[0].scheduled_end).toBe('2026-10-02T15:00:00+07:00');
  });

  it('starts at the given date and clamps days to 1..7', () => {
    expect(build({ date: '2026-10-10' }).days[0].date).toBe('2026-10-10');
    expect(clampDays(0)).toBe(1);
    expect(clampDays(30)).toBe(7);
    expect(clampDays(undefined)).toBe(1);
    expect(build({ days: 7 }).days).toHaveLength(7);
  });
});
