import { useCallback } from 'react';
import { queryClient } from '@/lib/queryClient';

export function useTradingKlineInvalidation() {
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/klines'] });
  }, []);
}
