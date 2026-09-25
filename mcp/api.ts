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

export const createApi = ({
  baseUrl,
  token,
}: {
  baseUrl: string;
  token: string;
}) => {
  const request = async <T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
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
        signal: AbortSignal.timeout(30_000),
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
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  };
};

export type Api = ReturnType<typeof createApi>;
