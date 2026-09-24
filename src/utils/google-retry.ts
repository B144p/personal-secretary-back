// Retry helper for Google API calls. Duck-typed against gaxios' error shape —
// gaxios is a transitive dep of googleapis (not in package.json), so it must
// never be imported directly here.

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
]);

const RETRYABLE_403_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
]);

interface GoogleErrorShape {
  response?: {
    status?: number;
    headers?: unknown;
    data?: { error?: { errors?: Array<{ reason?: string }> } };
  };
  status?: number;
  code?: unknown;
  errors?: Array<{ reason?: string }>;
}

export const getHttpStatus = (err: unknown): number | undefined => {
  const e = err as GoogleErrorShape;
  const status = e?.response?.status ?? e?.status ?? e?.code;
  return typeof status === 'number' ? status : undefined;
};

export const getGoogleReason = (err: unknown): string | undefined => {
  const e = err as GoogleErrorShape;
  return (
    e?.response?.data?.error?.errors?.[0]?.reason ?? e?.errors?.[0]?.reason
  );
};

const isNetworkError = (err: unknown): boolean => {
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' && NETWORK_ERROR_CODES.has(code);
};

export const isRetryableGoogleError = (err: unknown): boolean => {
  const status = getHttpStatus(err);
  if (status === undefined) return isNetworkError(err);
  if (status === 429 || status === 408) return true;
  if (status >= 500 && status <= 599) return true;
  // 403 is overloaded by Google: rateLimitExceeded/userRateLimitExceeded are
  // short-lived bursts worth retrying. quotaExceeded is the daily cap —
  // retrying only burns the remaining budget for no benefit.
  if (status === 403)
    return RETRYABLE_403_REASONS.has(getGoogleReason(err) ?? '');
  return false;
};

const getRetryAfterMs = (err: unknown): number | undefined => {
  const headers = (err as GoogleErrorShape)?.response?.headers;
  if (!headers) return undefined;

  const raw =
    typeof (headers as Headers)?.get === 'function'
      ? (headers as Headers).get('retry-after')
      : (headers as Record<string, string>)['retry-after'];
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (!Number.isNaN(seconds)) return seconds * 1000;

  const dateMs = Date.parse(raw);
  return Number.isNaN(dateMs) ? undefined : dateMs - Date.now();
};

export interface GoogleRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Absolute ms epoch. If the next delay would cross this, the original error is thrown instead. */
  deadlineAt?: number;
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    status?: number;
    reason?: string;
  }) => void;
}

export const withGoogleRetry = async <T>(
  fn: () => Promise<T>,
  {
    attempts = 5,
    baseDelayMs = 500,
    maxDelayMs = 8_000,
    deadlineAt,
    onRetry,
  }: GoogleRetryOptions = {},
): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts - 1 || !isRetryableGoogleError(err)) throw err;

      const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      // Full jitter (AWS "Exponential Backoff and Jitter"): the point is
      // decorrelation — concurrent inserts throttled by the same burst must
      // not wake in lockstep and re-collide against the same quota.
      const jitterMs = Math.random() * exp;
      const delayMs = Math.max(getRetryAfterMs(err) ?? 0, jitterMs);

      if (deadlineAt !== undefined && Date.now() + delayMs > deadlineAt) {
        throw err;
      }

      onRetry?.({
        attempt: attempt + 1,
        delayMs,
        status: getHttpStatus(err),
        reason: getGoogleReason(err),
      });
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
};
