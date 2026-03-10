import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { SignalProfilePayload, TradingProfileForm } from './TradingDomainTypes';

type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

type RefetchFn = () => unknown;

type UseTradingProfilePostmortemMutationsOptions = {
  autoSaveSignalContextRef: MutableRefObject<boolean>;
  autoSaveSignalLastPayloadRef: MutableRefObject<string>;
  notify: NotifyFn;
  refetchSignalProfile: RefetchFn;
  setSelectedPostmortemForTraining: Dispatch<SetStateAction<string | null>>;
  setSelectedTrainingNamespaceId: Dispatch<SetStateAction<string>>;
  setShowPostmortemTrainingDialog: Dispatch<SetStateAction<boolean>>;
  setSignalProfileForm: Dispatch<SetStateAction<TradingProfileForm>>;
  t: TFunction;
};

type SendPostMortemResponse = { success: boolean; data?: { datasetId: string } };

type UpdateSignalProfileResponse = {
  success?: boolean;
  error?: string;
  data?: TradingProfileForm;
};

export function useTradingProfilePostmortemMutations(options: UseTradingProfilePostmortemMutationsOptions) {
  const {
    autoSaveSignalContextRef,
    autoSaveSignalLastPayloadRef,
    notify,
    refetchSignalProfile,
    setSelectedPostmortemForTraining,
    setSelectedTrainingNamespaceId,
    setShowPostmortemTrainingDialog,
    setSignalProfileForm,
    t,
  } = options;

  const sendPostMortemToTrainingMutation = useMutation({
    mutationFn: async (params: { postmortemId: string; namespaceId: string }) => {
      const response = await apiRequest('POST', '/api/integrations/postmortem/send-to-training', {
        postmortemId: params.postmortemId,
        namespaceId: params.namespaceId,
      });
      return (await response.json()) as SendPostMortemResponse;
    },
    onSuccess: () => {
      setShowPostmortemTrainingDialog(false);
      setSelectedPostmortemForTraining(null);
      setSelectedTrainingNamespaceId('');
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/datasets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/datasets/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/postmortem'] });
      notify({
        title: 'Post-mortem enviado para treinamento',
        description: 'Dataset criado e enviado para aprovação na página Training.',
      });
    },
    onError: (error: Error) => {
      notify({
        title: 'Erro ao enviar post-mortem',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateSignalProfileMutation = useMutation({
    mutationFn: async (payload: SignalProfilePayload) => {
      const response = await apiRequest('PUT', '/api/integrations/trading/analysis-profile', payload);
      return (await response.json()) as UpdateSignalProfileResponse;
    },
    onSuccess: (data, variables) => {
      if (!data?.success || !data.data) {
        throw new Error(data?.error || t('trading.errors.profileUpdateFailed'));
      }
      setSignalProfileForm(data.data);
      autoSaveSignalLastPayloadRef.current = JSON.stringify(variables);
      if (!autoSaveSignalContextRef.current) {
        notify({ title: t('trading.success.profileUpdated') });
      }
      refetchSignalProfile();
    },
    onError: (error: Error) => {
      if (!autoSaveSignalContextRef.current) {
        notify({
          title: t('trading.errors.profileUpdateFailed'),
          description: error.message,
          variant: 'destructive',
        });
      }
    },
    onSettled: () => {
      autoSaveSignalContextRef.current = false;
    },
  });

  return {
    sendPostMortemToTrainingMutation,
    updateSignalProfileMutation,
  };
}
