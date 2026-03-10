import { useMutation } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import type { Document, MediaUpload } from '@/pages/documents/types';

type UseDocumentsMutationsParams = {
  queryClient: QueryClient;
  selectedNamespaceId: string;
  setDeleteDocument: Dispatch<SetStateAction<Document | null>>;
  setDeleteMedia: Dispatch<SetStateAction<MediaUpload | null>>;
  setSelectedMediaForTraining: Dispatch<SetStateAction<MediaUpload | null>>;
  setSelectedTrainingNamespaceId: Dispatch<SetStateAction<string>>;
  setSendTrainingDialogOpen: Dispatch<SetStateAction<boolean>>;
  setUploadDialogOpen: Dispatch<SetStateAction<boolean>>;
  t: TFunction;
};

export function useDocumentsMutations({
  queryClient,
  selectedNamespaceId,
  setDeleteDocument,
  setDeleteMedia,
  setSelectedMediaForTraining,
  setSelectedTrainingNamespaceId,
  setSendTrainingDialogOpen,
  setUploadDialogOpen,
  t,
}: UseDocumentsMutationsParams) {
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedNamespaceId) {
        throw new Error(t('documents.errors.namespaceRequired'));
      }
      const formData = new FormData();
      formData.append('file', file);
      formData.append('titulo', file.name);
      formData.append('namespaceId', selectedNamespaceId);

      const response = await fetch('/api/rag/documents/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(t('documents.errors.uploadFailed'));
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] });
      setUploadDialogOpen(false);
      toast({ title: t('documents.success.uploaded') });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t('documents.errors.uploadFailed');
      toast({ title: message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/rag/documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] });
      setDeleteDocument(null);
      toast({ title: t('documents.success.deleted') });
    },
    onError: () => {
      toast({ title: t('documents.errors.deleteFailed'), variant: 'destructive' });
    },
  });

  const deleteMediaMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/media/uploads/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/media/uploads'] });
      setDeleteMedia(null);
      toast({ title: t('documents.success.deleted') });
    },
    onError: () => {
      toast({ title: t('documents.media.loadFailed'), variant: 'destructive' });
    },
  });

  const sendToTrainingMutation = useMutation({
    mutationFn: async (params: { mediaUploadId: string; namespaceId: string }) => {
      const response = await apiRequest('POST', `/api/media/uploads/${params.mediaUploadId}/send-to-training`, {
        namespaceId: params.namespaceId,
      });
      return response.json() as Promise<{ success: boolean; data?: { trainingDataId?: string } }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/media/uploads'] });
      setSendTrainingDialogOpen(false);
      setSelectedMediaForTraining(null);
      setSelectedTrainingNamespaceId('');
      toast({ title: t('documents.media.sentToTraining') });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t('documents.media.loadFailed');
      toast({ title: message, variant: 'destructive' });
    },
  });

  const reprocessDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const response = await apiRequest('POST', `/api/rag/documents/${documentId}/reprocess`, {});
      return response.json() as Promise<{ jobId: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] });
      toast({ title: t('documents.success.reprocessQueued') });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t('documents.errors.reprocessFailed');
      toast({ title: message, variant: 'destructive' });
    },
  });

  const sendDocumentToTrainingMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const response = await apiRequest('POST', `/api/rag/documents/${documentId}/send-to-training`, {});
      return response.json() as Promise<{ success: boolean; message?: string }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/rag/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      toast({
        title: t('documents.success.sentToTraining'),
        description: result.message,
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t('documents.errors.sendToTrainingFailed');
      toast({ title: message, variant: 'destructive' });
    },
  });

  return {
    deleteMediaMutation,
    deleteMutation,
    reprocessDocumentMutation,
    sendDocumentToTrainingMutation,
    sendToTrainingMutation,
    uploadMutation,
  };
}
