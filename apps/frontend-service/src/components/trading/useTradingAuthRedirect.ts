import { useCallback } from 'react';

export function useTradingAuthRedirect() {
  return useCallback(() => {
    window.location.href = '/login';
  }, []);
}
