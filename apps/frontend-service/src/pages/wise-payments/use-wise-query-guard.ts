import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/lib/queryClient';

type UseWiseQueryGuardOptions = {
  configured: boolean;
  notify: (params: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;
};

type UseWiseQueryGuardResult = {
  wiseQueryEnabled: boolean;
  handleWiseQueryError: (error: unknown) => void;
};

export function useWiseQueryGuard(options: UseWiseQueryGuardOptions): UseWiseQueryGuardResult {
  const { configured, notify } = options;
  const [wiseBlockedUntil, setWiseBlockedUntil] = useState<number | null>(null);

  const isWiseBlocked = wiseBlockedUntil !== null && Date.now() < wiseBlockedUntil;
  const wiseQueryEnabled = useMemo(() => configured && !isWiseBlocked, [configured, isWiseBlocked]);

  const blockWiseRequests = useCallback((seconds: number, reason: string) => {
    const safeSeconds = Math.max(30, seconds);
    setWiseBlockedUntil(Date.now() + safeSeconds * 1000);
    notify({
      title: 'Wise temporariamente bloqueado',
      description: `${reason} Nova tentativa em ${safeSeconds}s.`,
      variant: 'destructive',
    });
  }, [notify]);

  const handleWiseQueryError = useCallback((error: unknown) => {
    if (!(error instanceof ApiError)) {
      return;
    }

    if (error.status === 401) {
      blockWiseRequests(300, 'Token Wise inválido ou expirado.');
      return;
    }

    if (error.status === 429) {
      const retrySeconds = error.retryAfterSeconds ?? 120;
      blockWiseRequests(retrySeconds, 'Rate limit do Wise atingido.');
    }
  }, [blockWiseRequests]);

  useEffect(() => {
    if (!configured) {
      setWiseBlockedUntil(null);
    }
  }, [configured]);

  useEffect(() => {
    if (wiseBlockedUntil === null) {
      return;
    }

    const remainingMs = wiseBlockedUntil - Date.now();
    if (remainingMs <= 0) {
      setWiseBlockedUntil(null);
      return;
    }

    const timerId = window.setTimeout(() => {
      setWiseBlockedUntil(null);
    }, remainingMs);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [wiseBlockedUntil]);

  return {
    wiseQueryEnabled,
    handleWiseQueryError,
  };
}
