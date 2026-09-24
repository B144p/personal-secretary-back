import { Logger } from '@nestjs/common';
import { CalendarService } from '../../calendar/calendar.service';
import { PrismaService } from '../../prisma/prisma.service';

// See apply-schedule.spec.ts for why p-limit needs this stub under ts-jest.
jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => (fn: () => Promise<unknown>) => fn(),
}));

import { cleanupCompletedEarly, cleanupHeldLeaves } from './helpers';
import type { LeafTask } from './interface';

const silentLogger = {
  error: jest.fn(),
  warn: jest.fn(),
} as unknown as Logger;

const leaf = (id: string, eventIds: string[]): LeafTask =>
  ({
    id,
    events: eventIds.map((google_event_id, i) => ({
      id: `${id}-ev${i}`,
      google_event_id,
    })),
  }) as unknown as LeafTask;

describe.each([
  ['cleanupHeldLeaves', cleanupHeldLeaves],
  ['cleanupCompletedEarly', cleanupCompletedEarly],
])('%s', (_name, cleanup) => {
  let removeEventsMock: jest.Mock;
  let getClientMock: jest.Mock;
  let updateManyMock: jest.Mock;
  let fakeCalendarService: CalendarService;
  let fakePrisma: PrismaService;

  beforeEach(() => {
    getClientMock = jest.fn().mockResolvedValue({});
    removeEventsMock = jest.fn();
    updateManyMock = jest.fn().mockResolvedValue({ count: 0 });
    fakeCalendarService = {
      getClient: getClientMock,
      removeEvents: removeEventsMock,
    } as unknown as CalendarService;
    fakePrisma = {
      taskEvent: { updateMany: updateManyMock },
    } as unknown as PrismaService;
  });

  it('deactivates task_event rows only for tasks whose calendar delete succeeded', async () => {
    // t1's delete succeeds, t2's fails (e.g. permanent 400) — t1's row must
    // still be deactivated even though the batch as a whole had a failure.
    removeEventsMock.mockImplementation(({ events }: { events: string[] }) =>
      events.includes('evt-t2')
        ? Promise.reject(new Error('permanent failure'))
        : Promise.resolve('Remove events success.'),
    );

    await cleanup(
      'user1',
      [leaf('t1', ['evt-t1']), leaf('t2', ['evt-t2'])],
      {
        prisma: fakePrisma,
        calendarService: fakeCalendarService,
        logger: silentLogger,
      },
    );

    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          task_id: { in: ['t1'] },
          is_active: true,
        }),
      }),
    );
  });

  it('skips the DB update entirely when every delete fails', async () => {
    removeEventsMock.mockRejectedValue(new Error('permanent failure'));

    await cleanup('user1', [leaf('t1', ['evt-t1'])], {
      prisma: fakePrisma,
      calendarService: fakeCalendarService,
      logger: silentLogger,
    });

    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it('deactivates every task when every delete succeeds', async () => {
    removeEventsMock.mockResolvedValue('Remove events success.');

    await cleanup(
      'user1',
      [leaf('t1', ['evt-t1']), leaf('t2', ['evt-t2'])],
      {
        prisma: fakePrisma,
        calendarService: fakeCalendarService,
        logger: silentLogger,
      },
    );

    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          task_id: { in: expect.arrayContaining(['t1', 't2']) },
        }),
      }),
    );
  });

  it('is a no-op when the leaf list is empty', async () => {
    await cleanup('user1', [], {
      prisma: fakePrisma,
      calendarService: fakeCalendarService,
      logger: silentLogger,
    });

    expect(getClientMock).not.toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
