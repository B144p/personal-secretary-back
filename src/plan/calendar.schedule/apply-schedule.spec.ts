import { Logger } from '@nestjs/common';
import { CalendarService } from '../../calendar/calendar.service';

// p-limit@7 ships ESM-only; ts-jest's CJS transform can't parse it when it's
// pulled in transitively via ./index's module-level `pLimit(2)`. Replace it
// with a trivial synchronous pass-through — these tests assert on the
// allSettled/rollback behavior, not real concurrency limiting.
jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => (fn: () => Promise<unknown>) => fn(),
}));

import { applySchedule, rollbackEvents } from './index';

interface FakeLeaf {
  id: string;
  title: string;
  description: string | null;
  start: string;
  end: string;
}

interface InsertEventArgs {
  request: {
    params: {
      requestBody: { extendedProperties?: { private?: { task_id?: string } } };
    };
  };
}

interface RemoveEventsArgs {
  events: string[];
}

const leaf = (id: string): FakeLeaf => ({
  id,
  title: `Task ${id}`,
  description: null,
  start: '2026-07-16T09:00:00.000Z',
  end: '2026-07-16T09:30:00.000Z',
});

const taskIdOf = (args: InsertEventArgs): string | undefined =>
  args.request.params.requestBody.extendedProperties?.private?.task_id;

const silentLogger = { error: jest.fn(), warn: jest.fn() } as unknown as Logger;

const runWithFakeTimers = async <T>(promise: Promise<T>) => {
  // .then(onFulfilled, onRejected) rather than .finally(): .finally()
  // re-throws, so a bare `void promise.finally(...)` creates a second,
  // unobserved promise chain that Jest reports as an unhandled rejection
  // the instant the underlying promise actually fails.
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  while (!settled) {
    await jest.advanceTimersByTimeAsync(60_000);
  }
  return promise;
};

describe('applySchedule', () => {
  let insertMock: jest.Mock<Promise<unknown>, [InsertEventArgs]>;
  let getClientMock: jest.Mock;
  let removeEventsMock: jest.Mock<Promise<unknown>, [RemoveEventsArgs]>;
  let fakeCalendarService: CalendarService;

  beforeEach(() => {
    jest.useFakeTimers();
    insertMock = jest.fn<Promise<unknown>, [InsertEventArgs]>();
    getClientMock = jest.fn().mockResolvedValue({});
    removeEventsMock = jest
      .fn<Promise<unknown>, [RemoveEventsArgs]>()
      .mockResolvedValue('Remove events success.');
    fakeCalendarService = {
      insertEvent: insertMock,
      getClient: getClientMock,
      removeEvents: removeEventsMock,
    } as unknown as CalendarService;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('rolls back exactly the events that succeeded when a sibling insert fails', async () => {
    // Task 3 fails immediately; the others resolve slightly later — they are
    // still in flight at the moment task 3 rejects. Promise.all would bail
    // out right then and leave them dangling; allSettled must wait for all
    // five to settle before deciding what to roll back.
    const schedule = ['t1', 't2', 't3', 't4', 't5'].map(leaf);
    const failure = Object.assign(new Error('rate limited'), {
      code: 'GOOGLE_CALENDAR_ERROR',
    });

    insertMock.mockImplementation((args: InsertEventArgs) => {
      const taskId = taskIdOf(args);
      if (taskId === 't3') return Promise.reject(failure);
      return new Promise((resolve) =>
        setTimeout(() => resolve({ id: `evt-${taskId}` }), 1000),
      );
    });

    await expect(
      runWithFakeTimers(
        applySchedule({
          userId: 'u1',
          planId: 'p1',
          client: fakeCalendarService,
          timeZone: 'UTC',
          schedule,
          logger: silentLogger,
        }),
      ),
    ).rejects.toBe(failure);

    expect(removeEventsMock).toHaveBeenCalledTimes(1);
    const { events: rolledBackIds } = removeEventsMock.mock.calls[0][0];
    expect(new Set(rolledBackIds)).toEqual(
      new Set(['evt-t1', 'evt-t2', 'evt-t4', 'evt-t5']),
    );
  });

  it('throws the original failure, not the rollback failure, when cleanup itself fails', async () => {
    const schedule = ['t1', 't2'].map(leaf);
    const insertFailure = new Error('rate limited');
    const cleanupFailure = new Error('cleanup also failed');

    insertMock.mockImplementation((args: InsertEventArgs) => {
      const taskId = taskIdOf(args);
      if (taskId === 't1') return Promise.resolve({ id: 'evt-t1' });
      return Promise.reject(insertFailure);
    });
    removeEventsMock.mockRejectedValue(cleanupFailure);

    await expect(
      runWithFakeTimers(
        applySchedule({
          userId: 'u1',
          planId: 'p1',
          client: fakeCalendarService,
          timeZone: 'UTC',
          schedule,
          logger: silentLogger,
        }),
      ),
    ).rejects.toBe(insertFailure);
  });

  it('never calls removeEvents when every insert succeeds', async () => {
    const schedule = ['t1', 't2'].map(leaf);
    insertMock.mockImplementation((args: InsertEventArgs) =>
      Promise.resolve({ id: `evt-${taskIdOf(args)}` }),
    );

    const { taskEvents } = await applySchedule({
      userId: 'u1',
      planId: 'p1',
      client: fakeCalendarService,
      timeZone: 'UTC',
      schedule,
      logger: silentLogger,
    });

    expect(taskEvents.map((e) => e.googleEventId).sort()).toEqual([
      'evt-t1',
      'evt-t2',
    ]);
    expect(removeEventsMock).not.toHaveBeenCalled();
  });
});

describe('rollbackEvents', () => {
  it('is a no-op for an empty id list', async () => {
    const getClientMock = jest.fn();
    const calendarService = {
      getClient: getClientMock,
      removeEvents: jest.fn(),
    } as unknown as CalendarService;

    await rollbackEvents({
      calendarService,
      userId: 'u1',
      eventIds: [],
      logger: silentLogger,
      context: {},
    });

    expect(getClientMock).not.toHaveBeenCalled();
  });

  it('swallows and logs its own failure instead of throwing', async () => {
    const errorMock = jest.fn();
    const calendarService = {
      getClient: jest.fn().mockResolvedValue({}),
      removeEvents: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as CalendarService;
    const logger = { error: errorMock } as unknown as Logger;

    await expect(
      rollbackEvents({
        calendarService,
        userId: 'u1',
        eventIds: ['evt-1'],
        logger,
        context: { planId: 'p1' },
      }),
    ).resolves.toBeUndefined();
    expect(errorMock).toHaveBeenCalled();
  });
});
