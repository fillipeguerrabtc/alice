import { QueryClient, QueryFunction } from '@tanstack/react-query';

const API_BASE = import.meta.env.VITE_API_URL || '';

// CSRF Token storage (Regra 16 - Segurança Enterprise)
let csrfToken: string | null = null;

export class ApiError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly retryAfterSeconds?: number;
  public readonly body?: unknown;

  constructor(opts: {
    status: number;
    statusText: string;
    message: string;
    retryAfterSeconds?: number;
    body?: unknown;
  }) {
    super(opts.message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.body = opts.body;
  }
}

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = await res.text();
    let message = `${res.status}: ${res.statusText}`;
    let body: unknown = undefined;
    try {
      const json = JSON.parse(text);
      body = json;
      message = json.message || json.error || message;
    } catch {
      if (text) message = text;
    }
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;
    throw new ApiError({
      status: res.status,
      statusText: res.statusText,
      message,
      retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
      body,
    });
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown,
  options?: { signal?: AbortSignal; tenantId?: string }
): Promise<Response> {
  const headers: Record<string, string> = {};
  
  if (data) {
    headers['Content-Type'] = 'application/json';
  }
  
  // Incluir CSRF token em requests mutating (Regra 16 - Segurança Enterprise)
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase()) && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  
  // Incluir Tenant-Id se fornecido (Multi-tenancy Enterprise)
  if (options?.tenantId) {
    headers['X-Tenant-Id'] = options.tenantId;
  }
  
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: data ? JSON.stringify(data) : undefined,
    credentials: 'include',
    signal: options?.signal,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = 'returnNull' | 'throw';

export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey[0] as string;
    const res = await fetch(`${API_BASE}${url}`, {
      credentials: 'include',
    });

    if (unauthorizedBehavior === 'returnNull' && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: 'throw' }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status === 401) {
          return false;
        }
        return failureCount < 3;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
