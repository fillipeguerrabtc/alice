import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';
import type { Message } from './components/types';

type NotifyFn = (params: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;

type UseChatTrainingFeedbackActionsOptions = {
  conversationId?: string;
  notify: NotifyFn;
  selectedMessageIds: Set<string>;
  setMessageSelectionMode: (value: boolean) => void;
  setMessages: (updater: (previous: Message[]) => Message[]) => void;
  setSelectedMessageIds: (value: Set<string>) => void;
  setShowTrainingDialog: (value: boolean) => void;
  setTrainingDialogMode: (value: 'conversation' | 'messages' | null) => void;
  setTrainingNamespaceId: (value: string) => void;
  t: TFunction;
  trainingNamespaceId: string;
};

export function useChatTrainingFeedbackActions(options: UseChatTrainingFeedbackActionsOptions) {
  const {
    conversationId,
    notify,
    selectedMessageIds,
    setMessageSelectionMode,
    setMessages,
    setSelectedMessageIds,
    setShowTrainingDialog,
    setTrainingDialogMode,
    setTrainingNamespaceId,
    t,
    trainingNamespaceId,
  } = options;

  const sendConversationToTraining = useMutation({
    mutationFn: async () => {
      if (!conversationId) {
        throw new Error('Conversa não identificada');
      }
      if (!trainingNamespaceId) {
        throw new Error('Namespace obrigatório');
      }
      const payload = { namespaceId: trainingNamespaceId };
      const res = await apiRequest('POST', `/api/chat/conversations/${conversationId}/training/collect`, payload);
      return res.json() as Promise<{ success: boolean; messages: number }>;
    },
    onSuccess: () => {
      setShowTrainingDialog(false);
      setTrainingDialogMode(null);
      notify({ title: t('chat.training.sent') });
    },
    onError: () => {
      notify({ title: t('chat.training.error'), variant: 'destructive' });
    },
  });

  const sendSelectedMessagesToTraining = useMutation({
    mutationFn: async () => {
      if (!conversationId) {
        throw new Error('Conversa não identificada');
      }
      if (selectedMessageIds.size === 0) {
        throw new Error('Mensagens não selecionadas');
      }
      if (!trainingNamespaceId) {
        throw new Error('Namespace obrigatório');
      }
      const payload = {
        namespaceId: trainingNamespaceId,
        items: [
          {
            conversationId,
            messageIds: Array.from(selectedMessageIds),
          },
        ],
      };
      const res = await apiRequest('POST', '/api/chat/training/collect-batch', payload);
      return res.json() as Promise<{ success: boolean; processed: number; failures: Array<{ conversationId: string; error: string }> }>;
    },
    onSuccess: (result) => {
      setShowTrainingDialog(false);
      setTrainingDialogMode(null);
      if (result.failures?.length) {
        notify({ title: t('chat.training.partial'), variant: 'destructive' });
      } else {
        notify({ title: t('chat.training.sent') });
      }
      setSelectedMessageIds(new Set());
      setMessageSelectionMode(false);
    },
    onError: () => {
      notify({ title: t('chat.training.error'), variant: 'destructive' });
    },
  });

  const openConversationTrainingDialog = useCallback(() => {
    setTrainingNamespaceId('');
    setTrainingDialogMode('conversation');
    setShowTrainingDialog(true);
  }, [setShowTrainingDialog, setTrainingDialogMode, setTrainingNamespaceId]);

  const openMessageTrainingDialog = useCallback(() => {
    if (selectedMessageIds.size === 0) {
      notify({ title: t('chat.selection.empty'), variant: 'destructive' });
      return;
    }
    setTrainingNamespaceId('');
    setTrainingDialogMode('messages');
    setShowTrainingDialog(true);
  }, [notify, selectedMessageIds, setShowTrainingDialog, setTrainingDialogMode, setTrainingNamespaceId, t]);

  const rateImage = useMutation({
    mutationFn: async ({ imageId, score }: { imageId: string; score: number }) => {
      await apiRequest('POST', `/api/chat/images/${imageId}/rate`, { score });
    },
    onSuccess: (_, { imageId, score }) => {
      setMessages((previous) =>
        previous.map((message) => {
          if (message.generatedImage?.id === imageId) {
            return {
              ...message,
              generatedImage: { ...message.generatedImage, feedbackScore: score },
            };
          }
          return message;
        }),
      );
    },
  });

  const rateMessage = useMutation({
    mutationFn: async ({ messageId, isPositive }: { messageId: string; isPositive: boolean }) => {
      const rating = isPositive ? 5 : 1;
      await apiRequest('POST', `/api/chat/messages/${messageId}/rate`, {
        rating,
        isPositive,
      });
    },
    onSuccess: (_, { messageId, isPositive }) => {
      setMessages((previous) =>
        previous.map((message) => {
          if (message.id === messageId) {
            return {
              ...message,
              metadata: {
                ...message.metadata,
                rating: isPositive ? 5 : 1,
                feedback: isPositive ? 'positive' : 'negative',
              },
            };
          }
          return message;
        }),
      );
    },
  });

  const handleRateImage = useCallback((imageId: string, score: number) => {
    rateImage.mutate({ imageId, score });
  }, [rateImage]);

  const handleFeedback = useCallback((messageId: string, isPositive: boolean) => {
    rateMessage.mutate({ messageId, isPositive });
  }, [rateMessage]);

  return {
    handleFeedback,
    handleRateImage,
    openConversationTrainingDialog,
    openMessageTrainingDialog,
    sendConversationToTraining,
    sendSelectedMessagesToTraining,
  };
}
