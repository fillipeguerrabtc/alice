import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { toast } from '@/hooks/use-toast';
import type { Document, MediaUpload } from '@/pages/documents/types';

type UseDocumentsDialogOrchestrationParams = {
  deleteDocument: Document | null;
  deleteMedia: MediaUpload | null;
  deleteMediaMutation: { mutate: (id: string) => void };
  deleteMutation: { mutate: (id: string) => void };
  namespaceMap: Map<string, string>;
  selectedMediaForTraining: MediaUpload | null;
  selectedNamespaceId: string;
  selectedTrainingNamespaceId: string;
  sendToTrainingMutation: { mutate: (params: { mediaUploadId: string; namespaceId: string }) => void };
  setDeleteDocument: Dispatch<SetStateAction<Document | null>>;
  setDeleteMedia: Dispatch<SetStateAction<MediaUpload | null>>;
  setSelectedMediaForTraining: Dispatch<SetStateAction<MediaUpload | null>>;
  setSelectedTrainingNamespaceId: Dispatch<SetStateAction<string>>;
  setSendTrainingDialogOpen: Dispatch<SetStateAction<boolean>>;
  t: TFunction;
};

export function useDocumentsDialogOrchestration({
  deleteDocument,
  deleteMedia,
  deleteMediaMutation,
  deleteMutation,
  namespaceMap,
  selectedMediaForTraining,
  selectedNamespaceId,
  selectedTrainingNamespaceId,
  sendToTrainingMutation,
  setDeleteDocument,
  setDeleteMedia,
  setSelectedMediaForTraining,
  setSelectedTrainingNamespaceId,
  setSendTrainingDialogOpen,
  t,
}: UseDocumentsDialogOrchestrationParams) {
  const uploadNamespaceHelperText = useMemo(
    () => (
      selectedNamespaceId
        ? `${t('documents.namespace.label')}: ${namespaceMap.get(selectedNamespaceId) ?? '-'}`
        : t('documents.uploadZone.selectNamespaceFirst')
    ),
    [namespaceMap, selectedNamespaceId, t]
  );

  const openSendToTrainingDialog = useCallback((media: MediaUpload) => {
    setSelectedMediaForTraining(media);
    setSelectedTrainingNamespaceId(media.namespaceId ?? '');
    setSendTrainingDialogOpen(true);
  }, [setSelectedMediaForTraining, setSelectedTrainingNamespaceId, setSendTrainingDialogOpen]);

  const handleDeleteDocumentDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDeleteDocument(null);
    }
  }, [setDeleteDocument]);

  const handleDeleteMediaDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setDeleteMedia(null);
    }
  }, [setDeleteMedia]);

  const handleConfirmDeleteDocument = useCallback(() => {
    if (!deleteDocument) return;
    deleteMutation.mutate(deleteDocument.id);
  }, [deleteDocument, deleteMutation]);

  const handleConfirmDeleteMedia = useCallback(() => {
    if (!deleteMedia) return;
    deleteMediaMutation.mutate(deleteMedia.id);
  }, [deleteMedia, deleteMediaMutation]);

  const handleSendTrainingDialogClose = useCallback(() => {
    setSendTrainingDialogOpen(false);
    setSelectedMediaForTraining(null);
    setSelectedTrainingNamespaceId('');
  }, [setSelectedMediaForTraining, setSelectedTrainingNamespaceId, setSendTrainingDialogOpen]);

  const handleSendTrainingDialogOpenChange = useCallback((open: boolean) => {
    setSendTrainingDialogOpen(open);
    if (!open) {
      setSelectedMediaForTraining(null);
      setSelectedTrainingNamespaceId('');
    }
  }, [setSelectedMediaForTraining, setSelectedTrainingNamespaceId, setSendTrainingDialogOpen]);

  const handleConfirmSendToTraining = useCallback(() => {
    if (!selectedMediaForTraining || !selectedTrainingNamespaceId) {
      toast({ title: 'Namespace obrigatório', variant: 'destructive' });
      return;
    }
    sendToTrainingMutation.mutate({
      mediaUploadId: selectedMediaForTraining.id,
      namespaceId: selectedTrainingNamespaceId,
    });
  }, [selectedMediaForTraining, selectedTrainingNamespaceId, sendToTrainingMutation]);

  return {
    handleConfirmDeleteDocument,
    handleConfirmDeleteMedia,
    handleConfirmSendToTraining,
    handleDeleteDocumentDialogOpenChange,
    handleDeleteMediaDialogOpenChange,
    handleSendTrainingDialogClose,
    handleSendTrainingDialogOpenChange,
    openSendToTrainingDialog,
    uploadNamespaceHelperText,
  };
}
