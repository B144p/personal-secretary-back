import {
  getGoogleReason,
  getHttpStatus,
  isRetryableGoogleError,
  withGoogleRetry,
} from './google-retry';

const httpError = (
  status: number,
  reason?: string,
  headers?: Record<string, string>,
) => ({
  response: {
    status,
    headers,
    data: reason ? { error: { errors: [{ reason }] } } : undefined,
  },
});

describe('isRetryableGoogleError', () => {
  it.each([
    ['429', httpError(429), true],
    ['408', httpError(408), true],
    ['403 rateLimitExceeded', httpError(403, 'rateLimitExceeded'), true],
    [
      '403 userRateLimitExceeded',
      httpError(403, 'userRateLimitExceeded'),
      true,
    ],
    ['403 quotaExceeded (daily cap)', httpError(403, 'quotaExceeded'), false],
    ['400', httpError(400), false],
    ['401', httpError(401), false],
    ['404', httpError(404), false],
    ['409', httpError(409), false],
    ['503', httpError(503), true],
    ['599', httpError(599), true],
    ['ECONNRESET', { code: 'ECONNRESET' }, true],
    ['ETIMEDOUT', { code: 'ETIMEDOUT' }, true],
    ['unknown error shape', new Error('boom'), false],
  ])('%s -> %s', (_name, err, expected) => {
    expect(isRetryableGoogleError(err)).toBe(expected);
  });
});

describe('getHttpStatus / getGoogleReason', () => {
  it('reads status and reason from response.data.error.errors', () => {
    const err = httpError(403, 'rateLimitExceeded');
    expect(getHttpStatus(err)).toBe(403);
    expect(getGoogleReason(err)).toBe('rateLimitExceeded');
  });

  it('reads reason from a top-level errors array as a fallback shape', () => {
    const err = { status: 403, errors: [{ reason: 'userRateLimitExceeded' }] };
    expect(getHttpStatus(err)).toBe(403);
    expect(getGoogleReason(err)).toBe('userRateLimitExceeded');
  });

  it('returns undefined status for a non-numeric code (network error)', () => {
    expect(getHttpStatus({ code: 'ECONNRESET' })).toBeUndefined();
  });
});

describe('withGoogleRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const runWithFakeTimers = async <T>(promise: Promise<T>) => {
    // Drain the fake-timer queue while the promise chain progresses.
    // .then(onFulfilled, onRejected) rather than .finally(): .finally()
    // re-throws, so a bare `void promise.finally(...)` creates a second,
    // unobserved promise chain that Jest reports as an unhandled rejection
    // the instant the retry loop actually fails.
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

  it('returns the result immediately on success without sleeping', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withGoogleRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable error and eventually succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce('ok');

    const result = await runWithFakeTimers(withGoogleRetry(fn));
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-retryable error', async () => {
    const fn = jest.fn().mockRejectedValue(httpError(400));
    await expect(withGoogleRetry(fn)).rejects.toEqual(httpError(400));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops after `attempts` tries', async () => {
    const err = httpError(429);
    const fn = jest.fn().mockRejectedValue(err);
    await expect(
      runWithFakeTimers(withGoogleRetry(fn, { attempts: 3 })),
    ).rejects.toEqual(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('every computed delay stays within maxDelayMs', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.999);
    const delays: number[] = [];
    const err = httpError(429);
    const fn = jest.fn().mockRejectedValue(err);
    await expect(
      runWithFakeTimers(
        withGoogleRetry(fn, {
          attempts: 5,
          maxDelayMs: 2_000,
          onRetry: ({ delayMs }) => delays.push(delayMs),
        }),
      ),
    ).rejects.toEqual(err);
    expect(delays.length).toBeGreaterThan(0);
    for (const d of delays) expect(d).toBeLessThanOrEqual(2_000);
  });

  it('honors Retry-After in seconds over jitter', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0); // jitter would be 0
    const err = httpError(429, undefined, { 'retry-after': '30' });
    const fn = jest.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('ok');
    let observedDelay = 0;
    await runWithFakeTimers(
      withGoogleRetry(fn, {
        onRetry: ({ delayMs }) => {
          observedDelay = delayMs;
        },
      }),
    );
    expect(observedDelay).toBe(30_000);
  });

  it('honors Retry-After as an HTTP-date', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const future = new Date(now + 10_000).toUTCString();
    const err = httpError(429, undefined, { 'retry-after': future });
    const fn = jest.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('ok');
    let observedDelay = 0;
    await runWithFakeTimers(
      withGoogleRetry(fn, {
        onRetry: ({ delayMs }) => {
          observedDelay = delayMs;
        },
      }),
    );
    expect(observedDelay).toBeGreaterThanOrEqual(9_000);
    expect(observedDelay).toBeLessThanOrEqual(10_000);
  });

  it('throws the original error without sleeping when deadlineAt is already in the past', async () => {
    const err = httpError(429);
    const fn = jest.fn().mockRejectedValue(err);
    await expect(
      withGoogleRetry(fn, { deadlineAt: Date.now() - 1 }),
    ).rejects.toEqual(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
