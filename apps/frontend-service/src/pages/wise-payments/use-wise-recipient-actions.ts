import { useMutation } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest, queryClient } from '@/lib/queryClient';

type NotifyFn = (params: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;

type UseWiseRecipientActionsOptions = {
  notify: NotifyFn;
  t: TFunction;
};

type UseWiseRecipientActionsResult = {
  handleDeleteRecipient: (id: number) => void;
  setShowNewRecipientDialog: (open: boolean) => void;
  showNewRecipientDialog: boolean;
};

export function useWiseRecipientActions(options: UseWiseRecipientActionsOptions): UseWiseRecipientActionsResult {
  const { notify, t } = options;
  const [showNewRecipientDialog, setShowNewRecipientDialog] = useState(false);

  const deleteRecipientMutation = useMutation({
    mutationFn: async (id: number) => apiRequest('DELETE', `/api/integrations/wise/recipients/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/wise/recipients'] });
      notify({ title: t('wise.success.recipientDeleted') });
    },
    onError: () => {
      notify({
        title: t('wise.errors.deleteFailed'),
        variant: 'destructive',
      });
    },
  });

  const handleDeleteRecipient = useCallback((id: number) => {
    if (window.confirm(t('wise.recipients.confirmDelete'))) {
      deleteRecipientMutation.mutate(id);
    }
  }, [deleteRecipientMutation, t]);

  return {
    handleDeleteRecipient,
    setShowNewRecipientDialog,
    showNewRecipientDialog,
  };
}
