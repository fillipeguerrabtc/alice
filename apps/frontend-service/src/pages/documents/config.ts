import type {
  Document,
  DocumentProcessingStatus,
  DocumentsTabId,
  DocumentsWorkspaceId,
} from '@/pages/documents/types';

export const DOCUMENTS_WORKSPACE_OPTIONS: Array<{ id: DocumentsWorkspaceId; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'knowledge', label: 'Conhecimento' },
  { id: 'media', label: 'Mídia' },
];

export const DOCUMENTS_TAB_CONFIG: Array<{
  id: DocumentsTabId;
  workspace: Exclude<DocumentsWorkspaceId, 'all'>;
  labelKey: 'documents.tabs.documents' | 'documents.tabs.media';
  testId: string;
}> = [
  {
    id: 'documents',
    workspace: 'knowledge',
    labelKey: 'documents.tabs.documents',
    testId: 'tab-documents',
  },
  {
    id: 'media',
    workspace: 'media',
    labelKey: 'documents.tabs.media',
    testId: 'tab-media',
  },
];

export function getDocumentProcessingStatus(document: Document): DocumentProcessingStatus {
  const metadataStatus = document.metadata?.processingStatus;
  if (document.processado) {
    return 'completed';
  }
  if (
    metadataStatus === 'pending' ||
    metadataStatus === 'processing' ||
    metadataStatus === 'failed' ||
    metadataStatus === 'completed'
  ) {
    return metadataStatus;
  }
  return 'pending';
}
