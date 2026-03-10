export interface Document {
  id: string;
  titulo: string;
  conteudo: string;
  tipo: string | null;
  fonte: string | null;
  urlOrigem: string | null;
  processado: boolean;
  criadoEm: string;
  atualizadoEm?: string;
  namespaceId: string | null;
  sentToTrainingAt?: string | null;
  metadata?: {
    processingStatus?: 'pending' | 'processing' | 'failed' | 'completed';
    processingError?: string | null;
    processedAt?: string | null;
    chunksCount?: number | null;
    sourceType?: string;
    originalFilename?: string;
    uploadedAt?: string;
    uploadedByUserId?: string | null;
  } | null;
}

export interface DocumentsResponse {
  documents: Document[];
}

export interface Namespace {
  id: string;
  nome: string;
  slug: string;
  ativo: boolean;
}

export interface MediaUpload {
  id: string;
  mediaType: 'image' | 'audio';
  originalFilename: string;
  fileUrl: string | null;
  processingStatus: string;
  namespaceId: string | null;
  criadoEm: string;
  llmDescription?: string | null;
  transcription?: string | null;
  approvedForTraining?: boolean | null;
}

export interface MediaUploadsResponse {
  uploads: MediaUpload[];
  pagination: { limit: number; offset: number; total: number };
}

export type DocumentsTabId = 'documents' | 'media';
export type DocumentsWorkspaceId = 'all' | 'knowledge' | 'media';
export type DocumentProcessingStatus = 'pending' | 'processing' | 'failed' | 'completed';
