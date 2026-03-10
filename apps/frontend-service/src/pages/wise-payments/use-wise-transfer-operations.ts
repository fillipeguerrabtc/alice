import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';
import type { NotifyFn } from './wise-transfer-and-card-types';

type UseWiseTransferOperationsOptions = {
  notify: NotifyFn;
  setTransferActionResult: (value: string | null) => void;
  t: TFunction;
  transferActionId: string;
};

export function useWiseTransferOperations(options: UseWiseTransferOperationsOptions) {
  const { notify, setTransferActionResult, t, transferActionId } = options;

  const handleFundTransfer = useCallback(async () => {
    const transferId = transferActionId.trim();
    if (!transferId) {
      notify({ title: t('wise.transfers.missingId'), variant: 'destructive' });
      return;
    }

    try {
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/transfers/${encodeURIComponent(transferId)}/fund`
      );
      const data = (await response.json()) as Record<string, unknown>;
      setTransferActionResult(JSON.stringify(data.result ?? data, null, 2));
      notify({ title: t('wise.transfers.funded') });
    } catch {
      notify({ title: t('wise.errors.updateFailed'), variant: 'destructive' });
    }
  }, [notify, setTransferActionResult, t, transferActionId]);

  const handleCancelTransfer = useCallback(async () => {
    const transferId = transferActionId.trim();
    if (!transferId) {
      notify({ title: t('wise.transfers.missingId'), variant: 'destructive' });
      return;
    }

    try {
      const response = await apiRequest(
        'POST',
        `/api/integrations/wise/transfers/${encodeURIComponent(transferId)}/cancel`
      );
      const data = (await response.json()) as Record<string, unknown>;
      setTransferActionResult(JSON.stringify(data.result ?? data, null, 2));
      notify({ title: t('wise.transfers.cancelled') });
    } catch {
      notify({ title: t('wise.errors.updateFailed'), variant: 'destructive' });
    }
  }, [notify, setTransferActionResult, t, transferActionId]);

  return { handleFundTransfer, handleCancelTransfer };
}
