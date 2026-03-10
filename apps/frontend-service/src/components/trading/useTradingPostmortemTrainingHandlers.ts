import { useCallback, type Dispatch, type SetStateAction } from 'react';

type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

type UseTradingPostmortemTrainingHandlersOptions = {
  notify: NotifyFn;
  selectedPostmortemForTraining: string | null;
  selectedTrainingNamespaceId: string;
  setSelectedPostmortemForTraining: Dispatch<SetStateAction<string | null>>;
  setSelectedTrainingNamespaceId: Dispatch<SetStateAction<string>>;
  setShowPostmortemTrainingDialog: Dispatch<SetStateAction<boolean>>;
  submitPostmortemForTraining: (payload: { namespaceId: string; postmortemId: string }) => void;
};

export function useTradingPostmortemTrainingHandlers(options: UseTradingPostmortemTrainingHandlersOptions) {
  const {
    notify,
    selectedPostmortemForTraining,
    selectedTrainingNamespaceId,
    setSelectedPostmortemForTraining,
    setSelectedTrainingNamespaceId,
    setShowPostmortemTrainingDialog,
    submitPostmortemForTraining,
  } = options;

  const handleOpenPostmortemTrainingDialog = useCallback((postmortemId: string) => {
    setSelectedPostmortemForTraining(postmortemId);
    setSelectedTrainingNamespaceId('');
    setShowPostmortemTrainingDialog(true);
  }, [setSelectedPostmortemForTraining, setSelectedTrainingNamespaceId, setShowPostmortemTrainingDialog]);

  const handleCancelPostmortemTrainingDialog = useCallback(() => {
    setShowPostmortemTrainingDialog(false);
    setSelectedPostmortemForTraining(null);
    setSelectedTrainingNamespaceId('');
  }, [setSelectedPostmortemForTraining, setSelectedTrainingNamespaceId, setShowPostmortemTrainingDialog]);

  const handlePostmortemTrainingDialogOpenChange = useCallback((open: boolean) => {
    setShowPostmortemTrainingDialog(open);
    if (open) return;
    setSelectedPostmortemForTraining(null);
    setSelectedTrainingNamespaceId('');
  }, [setSelectedPostmortemForTraining, setSelectedTrainingNamespaceId, setShowPostmortemTrainingDialog]);

  const handleSubmitPostmortemTraining = useCallback(() => {
    if (!selectedPostmortemForTraining || !selectedTrainingNamespaceId) {
      notify({
        title: 'Namespace obrigatório',
        description: 'Selecione um namespace para enviar o post-mortem ao treinamento.',
        variant: 'destructive',
      });
      return;
    }
    submitPostmortemForTraining({
      namespaceId: selectedTrainingNamespaceId,
      postmortemId: selectedPostmortemForTraining,
    });
  }, [notify, selectedPostmortemForTraining, selectedTrainingNamespaceId, submitPostmortemForTraining]);

  return {
    handleCancelPostmortemTrainingDialog,
    handleOpenPostmortemTrainingDialog,
    handlePostmortemTrainingDialogOpenChange,
    handleSubmitPostmortemTraining,
  };
}
