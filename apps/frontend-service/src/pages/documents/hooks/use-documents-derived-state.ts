import { useMemo } from 'react';
import { getDocumentProcessingStatus } from '@/pages/documents/config';
import type {
  Document,
  MediaUpload,
  MediaUploadsResponse,
  Namespace,
} from '@/pages/documents/types';

type UseDocumentsDerivedStateParams = {
  documents: Document[];
  filterStatus: 'all' | 'processed' | 'pending';
  mediaData: MediaUploadsResponse | undefined;
  mediaSearchQuery: string;
  namespaces: Namespace[] | undefined;
  searchQuery: string;
  selectedNamespaceId: string;
};

export function useDocumentsDerivedState({
  documents,
  filterStatus,
  mediaData,
  mediaSearchQuery,
  namespaces,
  searchQuery,
  selectedNamespaceId,
}: UseDocumentsDerivedStateParams) {
  const activeNamespaces = useMemo(
    () => (namespaces ?? []).filter((namespace) => namespace.ativo),
    [namespaces]
  );

  const namespaceMap = useMemo(
    () => new Map((namespaces ?? []).map((namespace) => [namespace.id, namespace.nome])),
    [namespaces]
  );

  const filteredDocuments = useMemo(() => {
    const search = searchQuery.toLowerCase();

    return documents.filter((document) => {
      const processingStatus = getDocumentProcessingStatus(document);
      const matchesSearch = (
        document.titulo.toLowerCase().includes(search) ||
        (document.conteudo?.toLowerCase().includes(search) ?? false)
      );

      const matchesStatus = (
        filterStatus === 'all' ||
        (filterStatus === 'processed' && processingStatus === 'completed') ||
        (filterStatus === 'pending' && processingStatus !== 'completed')
      );

      return matchesSearch && matchesStatus;
    });
  }, [documents, filterStatus, searchQuery]);

  const stats = useMemo(() => ({
    total: documents.length,
    processed: documents.filter((document) => getDocumentProcessingStatus(document) === 'completed').length,
    pending: documents.filter((document) => getDocumentProcessingStatus(document) !== 'completed').length,
  }), [documents]);

  const isNamespaceReady = selectedNamespaceId !== '' && activeNamespaces.length > 0;

  const mediaUploads = useMemo(
    () => (mediaData?.uploads ?? []).filter(
      (upload): upload is MediaUpload => upload.mediaType === 'image' || upload.mediaType === 'audio'
    ),
    [mediaData]
  );

  const filteredMediaUploads = useMemo(() => {
    if (!mediaSearchQuery.trim()) {
      return mediaUploads;
    }

    const search = mediaSearchQuery.toLowerCase();
    return mediaUploads.filter((media) => (
      media.originalFilename.toLowerCase().includes(search) ||
      (media.llmDescription?.toLowerCase().includes(search) ?? false) ||
      (media.transcription?.toLowerCase().includes(search) ?? false)
    ));
  }, [mediaSearchQuery, mediaUploads]);

  const mediaStats = useMemo(
    () => ({ total: mediaUploads.length }),
    [mediaUploads]
  );

  return {
    activeNamespaces,
    filteredDocuments,
    filteredMediaUploads,
    isNamespaceReady,
    mediaStats,
    namespaceMap,
    stats,
  };
}
