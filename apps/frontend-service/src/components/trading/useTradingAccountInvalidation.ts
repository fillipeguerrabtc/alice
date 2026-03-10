import { useCallback } from 'react';
import { queryClient } from '@/lib/queryClient';

export function useTradingAccountInvalidation() {
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['account'] });
  }, []);
}
