import { QueryClient, QueryFunction } from '@tanstack/react-query';

const API_BASE = import.meta.env.VITE_API_URL || '';

// CSRF Token storage (Regra 16 - Segurança Enterprise)
let csrfToken: string | null = null;

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
    try {
      const json = JSON.parse(text);
      message = json.message || json.error || message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {};
  
  if (data) {
    headers['Content-Type'] = 'application/json';
  }
  
  // Incluir CSRF token em requests mutating (Regra 16 - Segurança Enterprise)
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase()) && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: data ? JSON.stringify(data) : undefined,
    credentials: 'include',
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
        if (error instanceof Error && error.message.startsWith('401')) {
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
