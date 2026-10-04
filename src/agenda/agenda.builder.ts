import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

// Pure: turns plan task events, Google Calendar events and slipped steps into
// the flat agenda agents read (GET /agenda). All times are ISO strings with
// the user's offset; days are calendar days in the user's timezone.

export const AGENDA_MAX_DAYS = 7;

export interface AgendaUserState {
  time_zone: string;
  working_hours_start: string;
  working_hours_end: string;
  days_off: number[];
}

export interface AgendaTaskEvent {
  start: Date;
  end: Date;
  task: {
    id: string;
    title: string;
    status: string;
    estimated_minutes: number | null;
    parent_title: string | null;
  };
  plan: { id: string; title: string };
}

// The parts of a Google Calendar event the agenda uses.
export interface AgendaCalendarEvent {
  summary?: string | null;
  location?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  extendedProperties?: { private?: Record<string, string | undefined> } | null;
}

export interface AgendaSlipped {
  plan_id: string;
  task_id: string;
  title: string;
  scheduled_end: Date;
  status: string;
}

export interface AgendaInProgress {
  plan_id: string;
  plan_title: string;
  task_id: string;
  title: string;
  repo_key: string | null;
  branch: string | null;
}

export type AgendaItem =
  | {
      kind: 'task';
      start: string;
      end: string;
      plan_id: string;
      plan_title: string;
      task_id: string;
      title: string;
      path: string[];
      status: string;
      estimated_minutes: number | null;
    }
  | {
      kind: 'event';
      start: string;
      end: string;
      summary: string;
      all_day: boolean;
      location: string | null;
    };

export interface Agenda {
  time_zone: string;
  working_hours: { start: string; end: string };
  days: { date: string; is_day_off: boolean; items: AgendaItem[] }[];
  slipped: (Omit<AgendaSlipped, 'scheduled_end'> & { scheduled_end: string })[];
  claude_code_in_progress: AgendaInProgress[];
  calendar_error: string | null;
}

export const clampDays = (days: number | undefined) =>
  Math.min(Math.max(Math.trunc(days ?? 1) || 1, 1), AGENDA_MAX_DAYS);

// First instant of `date` (YYYY-MM-DD, default today) and of the day after
// the last one, in the user's timezone.
export const agendaRange = ({
  timeZone,
  date,
  days,
  now,
}: {
  timeZone: string;
  date?: string;
  days: number;
  now: Date;
}) => {
  const start = date
    ? dayjs.tz(date, timeZone).startOf('day')
    : dayjs(now).tz(timeZone).startOf('day');
  return { start, end: start.add(days, 'day') };
};

// Plan task events already show as task items, and early-task markers are
// bookkeeping; both carry a plan_id.
const isPlanEvent = (e: AgendaCalendarEvent) =>
  !!e.extendedProperties?.private?.plan_id ||
  !!e.extendedProperties?.private?.early_marker;

export const buildAgenda = ({
  userState,
  date,
  days,
  now,
  taskEvents,
  calendarEvents,
  slipped,
  claudeCodeInProgress,
  calendarError,
}: {
  userState: AgendaUserState;
  date?: string;
  days?: number;
  now: Date;
  taskEvents: AgendaTaskEvent[];
  calendarEvents: AgendaCalendarEvent[];
  slipped: AgendaSlipped[];
  claudeCodeInProgress: AgendaInProgress[];
  calendarError: string | null;
}): Agenda => {
  const tz = userState.time_zone;
  const count = clampDays(days);
  const { start } = agendaRange({ timeZone: tz, date, days: count, now });
  const iso = (d: Date | string) => dayjs(d).tz(tz).format();

  const byDay = Array.from({ length: count }, (_, i) => {
    const day = start.add(i, 'day');
    return {
      begin: day,
      end: start.add(i + 1, 'day'),
      date: day.format('YYYY-MM-DD'),
      is_day_off: userState.days_off.includes(day.day()),
      items: [] as (AgendaItem & { sort: number })[],
    };
  });
  const dayOf = (d: dayjs.Dayjs) =>
    byDay.find((b) => b.date === d.tz(tz).format('YYYY-MM-DD'));

  for (const te of taskEvents) {
    const s = dayjs(te.start);
    dayOf(s)?.items.push({
      kind: 'task',
      start: iso(te.start),
      end: iso(te.end),
      plan_id: te.plan.id,
      plan_title: te.plan.title,
      task_id: te.task.id,
      title: te.task.title,
      path: te.task.parent_title
        ? [te.task.parent_title, te.task.title]
        : [te.task.title],
      status: te.task.status,
      estimated_minutes: te.task.estimated_minutes,
      sort: s.valueOf(),
    });
  }

  for (const e of calendarEvents) {
    if (isPlanEvent(e)) continue;
    const allDay = !e.start?.dateTime && !!e.start?.date;
    // All-day dates are calendar dates, not instants: read them in the
    // user's zone so they don't shift a day. Their end date is exclusive.
    const s = allDay
      ? dayjs.tz(e.start!.date!, tz)
      : e.start?.dateTime
        ? dayjs(e.start.dateTime)
        : null;
    if (!s) continue;
    const endRaw = allDay ? e.end?.date : e.end?.dateTime;
    const end = endRaw
      ? allDay
        ? dayjs.tz(endRaw, tz)
        : dayjs(endRaw)
      : s.add(allDay ? 1 : 0, 'day');
    // Google returns events that overlap the range, so an event can start
    // before the first day (yesterday's trip, a meeting past midnight). It
    // shows on every day it covers.
    for (const day of byDay) {
      const overlaps =
        s.isBefore(day.end) && (end.isAfter(day.begin) || s.isSame(day.begin));
      if (!overlaps) continue;
      day.items.push({
        kind: 'event',
        start: allDay ? e.start!.date! : iso(s.toDate()),
        end: allDay ? (e.end?.date ?? e.start!.date!) : iso(end.toDate()),
        summary: e.summary ?? '(no title)',
        all_day: allDay,
        location: e.location ?? null,
        // All-day items first, then by start time (carried-over ones at the
        // top of the day).
        sort: allDay ? -Infinity : Math.max(s.valueOf(), day.begin.valueOf()),
      });
    }
  }

  return {
    time_zone: tz,
    working_hours: {
      start: userState.working_hours_start,
      end: userState.working_hours_end,
    },
    days: byDay.map((d) => ({
      date: d.date,
      is_day_off: d.is_day_off,
      items: d.items
        .sort((a, b) => a.sort - b.sort)
        .map(({ sort: _sort, ...item }) => item as AgendaItem),
    })),
    slipped: slipped.map((s) => ({
      ...s,
      scheduled_end: iso(s.scheduled_end),
    })),
    claude_code_in_progress: claudeCodeInProgress,
    calendar_error: calendarError,
  };
};
