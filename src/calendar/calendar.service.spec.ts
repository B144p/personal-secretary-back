import { CryptoService } from '../crypto/crypto.service';
import { OpenAIService } from '../openai/openai.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../user/user.service';
import { AppException } from '../common/errors/app-exception';
import { CalendarService } from './calendar.service';

// p-limit@7 ships ESM-only; ts-jest's CJS transform can't parse it when it's
// pulled in transitively via CalendarService. Replace it with a trivial
// synchronous pass-through — these tests don't depend on real concurrency
// limiting.
jest.mock('p-limit', () => ({
  __esModule: true,
  default: () => (fn: () => Promise<unknown>) => fn(),
}));

interface FakeGoogleError extends Error {
  response?: { status: number; data?: unknown };
}

const httpError = (status: number, reason?: string): FakeGoogleError =>
  Object.assign(new Error(`HTTP ${status}`), {
    response: {
      status,
      data: reason ? { error: { errors: [{ reason }] } } : undefined,
    },
  });

const networkError = (code: string): FakeGoogleError =>
  Object.assign(new Error(code), { code });

interface InsertCallArgs {
  requestBody: { id: string };
}

describe('CalendarService', () => {
  let service: CalendarService;
  let insertMock: jest.Mock<Promise<unknown>, [InsertCallArgs]>;
  let getMock: jest.Mock;
  let deleteMock: jest.Mock;

  const insertedId = (callIndex: number): string =>
    insertMock.mock.calls[callIndex][0].requestBody.id;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);

    service = new CalendarService(
      {} as unknown as PrismaService,
      {} as unknown as UserService,
      {} as unknown as OpenAIService,
      {} as unknown as CryptoService,
    );

    insertMock = jest.fn<Promise<unknown>, [InsertCallArgs]>();
    getMock = jest.fn();
    deleteMock = jest.fn();
    const fakeClient = {
      events: { insert: insertMock, get: getMock, delete: deleteMock },
    };
    jest
      .spyOn(service, 'getClient')
      .mockResolvedValue(
        fakeClient as unknown as Awaited<
          ReturnType<CalendarService['getClient']>
        >,
      );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const runWithFakeTimers = async <T>(promise: Promise<T>) => {
    let settled = false;
    // .then(onFulfilled, onRejected) rather than .finally(): .finally()
    // re-throws, so a bare `void promise.finally(...)` creates a second,
    // unobserved promise chain that Jest reports as an unhandled rejection
    // the instant the retry loop actually fails.
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

  describe('insertEvent', () => {
    it('generates one event id and sends it in the insert request', async () => {
      insertMock.mockResolvedValue({ data: { id: 'irrelevant' } });

      await service.insertEvent({
        userId: 'u1',
        request: { params: { requestBody: {} } },
      });

      expect(insertedId(0)).toMatch(/^[0-9a-f]{32}$/);
    });

    it('resolves a 409 by fetching and returning the existing (already-created) event', async () => {
      insertMock.mockRejectedValueOnce(httpError(409));
      getMock.mockResolvedValueOnce({
        data: { id: 'evt-1', status: 'confirmed' },
      });

      const result = await service.insertEvent({
        userId: 'u1',
        request: { params: { requestBody: {} } },
      });

      expect(result).toEqual({ id: 'evt-1', status: 'confirmed' });
      expect(insertMock).toHaveBeenCalledTimes(1);
      expect(getMock).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: insertedId(0) }),
      );
    });

    it('rethrows (as GOOGLE_CALENDAR_ERROR) when the 409 id belongs to a cancelled event', async () => {
      insertMock.mockRejectedValue(httpError(409));
      getMock.mockResolvedValue({
        data: { id: 'evt-1', status: 'cancelled' },
      });

      await expect(
        runWithFakeTimers(
          service.insertEvent({
            userId: 'u1',
            request: { params: { requestBody: {} } },
          }),
        ),
      ).rejects.toBeInstanceOf(AppException);
      // 409 is not in the retryable set, so the internal retry loop gives up
      // after the first attempt — insert is called exactly once.
      expect(insertMock).toHaveBeenCalledTimes(1);
    });

    it('retries a lost-response case with the SAME event id, then resolves via the 409 path', async () => {
      // Attempt 1: request reached Google and created the event, but the
      // response was lost (e.g. connection reset) before we saw it.
      insertMock
        .mockRejectedValueOnce(networkError('ECONNRESET'))
        // Attempt 2: same id we generated — Google reports it already exists.
        .mockRejectedValueOnce(httpError(409));
      getMock.mockResolvedValueOnce({
        data: { id: 'evt-1', status: 'confirmed' },
      });

      const result = await runWithFakeTimers(
        service.insertEvent({
          userId: 'u1',
          request: { params: { requestBody: {} } },
        }),
      );

      expect(result).toEqual({ id: 'evt-1', status: 'confirmed' });
      expect(insertMock).toHaveBeenCalledTimes(2);
      expect(insertedId(0)).toBe(insertedId(1));
    });

    it('maps a persistent rate-limit failure to GOOGLE_CALENDAR_ERROR', async () => {
      insertMock.mockRejectedValue(httpError(403, 'rateLimitExceeded'));

      await expect(
        runWithFakeTimers(
          service.insertEvent({
            userId: 'u1',
            request: { params: { requestBody: {} } },
          }),
        ),
      ).rejects.toMatchObject({ code: 'GOOGLE_CALENDAR_ERROR' });
    });

    it('maps a 401 to GOOGLE_REAUTH_REQUIRED', async () => {
      insertMock.mockRejectedValue(httpError(401));

      await expect(
        service.insertEvent({
          userId: 'u1',
          request: { params: { requestBody: {} } },
        }),
      ).rejects.toMatchObject({ code: 'GOOGLE_REAUTH_REQUIRED' });
    });
  });

  describe('removeEvents', () => {
    it('treats a 404 (already deleted) as success', async () => {
      deleteMock.mockRejectedValue(httpError(404));

      await expect(
        service.removeEvents({
          client: { events: { delete: deleteMock } } as never,
          events: ['evt-1'],
        }),
      ).resolves.toBe('Remove events success.');
    });

    it('treats a 410 (gone) as success', async () => {
      deleteMock.mockRejectedValue(httpError(410));

      await expect(
        service.removeEvents({
          client: { events: { delete: deleteMock } } as never,
          events: ['evt-1'],
        }),
      ).resolves.toBe('Remove events success.');
    });

    it('still deletes every id even when one fails, then throws', async () => {
      deleteMock.mockImplementation((args: unknown) => {
        const { eventId } = args as { eventId: string };
        // 400 is not in the retryable set, so this fails on the first
        // attempt — isolates "one non-retryable failure among a batch"
        // from retry behavior, which is covered separately above.
        return eventId === 'bad'
          ? Promise.reject(httpError(400))
          : Promise.resolve({});
      });

      await expect(
        service.removeEvents({
          client: { events: { delete: deleteMock } } as never,
          events: ['good-1', 'bad', 'good-2'],
        }),
      ).rejects.toBeTruthy();

      expect(deleteMock).toHaveBeenCalledTimes(3);
    });
  });
});
