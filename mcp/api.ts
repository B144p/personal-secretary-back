// Thin HTTP client for the Personal Secretary backend. The MCP process never
// touches the DB — every rule stays in the Nest API.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

interface CallOptions {
  timeoutMs?: number;
}

// Same as the web app's limit for scheduling and feedback.
export const CALENDAR_CALL_TIMEOUT_MS = 120_000;

export const createApi = ({
  baseUrl,
  token,
  timeoutMs = 30_000,
}: {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}) => {
  const request = async <T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    // Calls that book or move calendar events can take a while.
    callTimeoutMs = timeoutMs,
  ): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(callTimeoutMs),
      });
    } catch (err) {
      throw new ApiError(
        0,
        'NETWORK_ERROR',
        `Cannot reach backend at ${baseUrl}: ${(err as Error).message}`,
      );
    }

    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const err = (json ?? {}) as { code?: string; message?: unknown };
      const message = Array.isArray(err.message)
        ? err.message.join('; ')
        : typeof err.message === 'string'
          ? err.message
          : res.statusText;
      throw new ApiError(res.status, err.code, message);
    }
    return json as T;
  };

  return {
    get: <T>(path: string, opts?: CallOptions) =>
      request<T>('GET', path, undefined, opts?.timeoutMs),
    post: <T>(path: string, body: unknown, opts?: CallOptions) =>
      request<T>('POST', path, body, opts?.timeoutMs),
    patch: <T>(path: string, body: unknown, opts?: CallOptions) =>
      request<T>('PATCH', path, body, opts?.timeoutMs),
  };
};

export type Api = ReturnType<typeof createApi>;
