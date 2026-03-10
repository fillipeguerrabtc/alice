import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { Toast } from '@/hooks/use-toast';

type TrainingDialogMode = 'conversation' | 'messages' | null;

type UseChatUiInteractionHandlersOptions = {
  conversationId?: string;
  fetchNextPage: () => Promise<unknown>;
  isAuthenticated: boolean;
  isStreaming: boolean;
  notify: (props: Omit<Toast, 'id'>) => string;
  sendQuickReply: (content: string) => void;
  setDeleteTargetId: Dispatch<SetStateAction<string | null>>;
  setMessageSelectionMode: Dispatch<SetStateAction<boolean>>;
  setMobileDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setShowStreamDiagnostics: Dispatch<SetStateAction<boolean>>;
  setShowTrainingDialog: Dispatch<SetStateAction<boolean>>;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setTrainingDialogMode: Dispatch<SetStateAction<TrainingDialogMode>>;
  submitConversationToTraining: () => void;
  isSubmitConversationTrainingPending: boolean;
  submitSelectedMessagesToTraining: () => void;
  isSubmitSelectedMessagesToTrainingPending: boolean;
  trainingDialogMode: TrainingDialogMode;
  trainingNamespaceId: string;
};

export function useChatUiInteractionHandlers({
  conversationId,
  fetchNextPage,
  isAuthenticated,
  isStreaming,
  notify,
  sendQuickReply,
  setDeleteTargetId,
  setMessageSelectionMode,
  setMobileDrawerOpen,
  setShowStreamDiagnostics,
  setShowTrainingDialog,
  setSidebarOpen,
  setTrainingDialogMode,
  submitConversationToTraining,
  isSubmitConversationTrainingPending,
  submitSelectedMessagesToTraining,
  isSubmitSelectedMessagesToTrainingPending,
  trainingDialogMode,
  trainingNamespaceId,
}: UseChatUiInteractionHandlersOptions) {
  const handleOpenMobileDrawer = useCallback(() => {
    setMobileDrawerOpen(true);
  }, [setMobileDrawerOpen]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((previous) => !previous);
  }, [setSidebarOpen]);

  const handleLoadMoreConversations = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  const handleToggleSelectionMode = useCallback(() => {
    setMessageSelectionMode((previous) => !previous);
  }, [setMessageSelectionMode]);

  const handleToggleStreamDiagnostics = useCallback(() => {
    setShowStreamDiagnostics((previous) => !previous);
  }, [setShowStreamDiagnostics]);

  const handleDeleteCurrentConversation = useCallback(() => {
    if (!conversationId) return;
    setDeleteTargetId(conversationId);
  }, [conversationId, setDeleteTargetId]);

  const handleDeleteTargetOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDeleteTargetId(null);
    }
  }, [setDeleteTargetId]);

  const handleTrainingDialogOpenChange = useCallback((open: boolean) => {
    setShowTrainingDialog(open);
    if (!open) {
      setTrainingDialogMode(null);
    }
  }, [setShowTrainingDialog, setTrainingDialogMode]);

  const handleSubmitTraining = useCallback(() => {
    if (!trainingNamespaceId) {
      notify({
        title: 'Namespace obrigatório',
        description: 'Selecione um namespace para enviar os dados ao treinamento.',
        variant: 'destructive',
      });
      return;
    }

    if (trainingDialogMode === 'messages') {
      submitSelectedMessagesToTraining();
      return;
    }

    submitConversationToTraining();
  }, [
    notify,
    submitConversationToTraining,
    submitSelectedMessagesToTraining,
    trainingDialogMode,
    trainingNamespaceId,
  ]);

  const isSubmitTrainingPending =
    trainingDialogMode === 'messages'
      ? isSubmitSelectedMessagesToTrainingPending
      : isSubmitConversationTrainingPending;

  const handleQuickReply = useCallback((content: string) => {
    if (isStreaming) return;

    if (!isAuthenticated) {
      notify({
        title: 'Faça login para continuar',
        description: 'O chat em tempo real está disponível apenas para usuários autenticados.',
      });
      return;
    }

    sendQuickReply(content);
  }, [isAuthenticated, isStreaming, notify, sendQuickReply]);

  return {
    handleDeleteCurrentConversation,
    handleDeleteTargetOpenChange,
    handleLoadMoreConversations,
    handleOpenMobileDrawer,
    handleQuickReply,
    handleSubmitTraining,
    handleToggleSelectionMode,
    handleToggleSidebar,
    handleToggleStreamDiagnostics,
    handleTrainingDialogOpenChange,
    isSubmitTrainingPending,
  };
}
