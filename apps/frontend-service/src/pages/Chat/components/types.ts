/**
 * Tipos compartilhados para componentes do Chat
 * 
 * @module Chat/components/types
 */

export interface GeneratedImageData {
  id: string;
  prompt: string;
  imageUrl?: string;
  imagePath?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  width?: number;
  height?: number;
  feedbackScore?: number;
}

// ATUALIZADO 23/12/2025: 'video' REMOVIDO (muito pesado para GPU)
// Plataforma suporta apenas: texto, áudio e imagem
export type MediaType = 'image' | 'audio';

export interface MediaAttachment {
  id: string;
  type: MediaType;
  url: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  duration?: number;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  transcription?: string;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  progress?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  tokensUsados?: number;
  // ATUALIZADO 23/12/2025: Removido 'video' (muito pesado para GPU)
  tipo?: 'text' | 'image' | 'audio' | 'mixed';
  anexos?: unknown[];
  generatedImage?: GeneratedImageData;
  mediaAttachments?: MediaAttachment[];
  metadata?: {
    rating?: number;
    feedback?: 'positive' | 'negative';
    [key: string]: unknown;
  };
}

export interface Conversation {
  id: string;
  titulo: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

export interface ConversationsResponse {
  conversations: Conversation[];
  nextCursor?: {
    updatedAt: string;
    id: string;
  } | null;
  hasMore?: boolean;
  total?: number;
}

// BUG FIX 23/12/2025: Tipo explícito garante que todas as chaves de MediaType existam
// Isso previne acesso a undefined e NaN em cálculos de limite
// REMOVIDO 23/12/2025: video desabilitado (muito pesado para GPU)
// BUG FIX 23/12/2025: Tipo explícito 'image' | 'audio' ao invés de MediaType para garantir type safety
export const FILE_LIMITS: Record<'image' | 'audio', number> = {
  image: 10 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
} as const;

// ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
export const ACCEPTED_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/webm'],
  // video removido - não aceitar uploads de vídeo
} as const;

// BUG FIX 23/12/2025: Normalização robusta de mimeType para suportar variações de case e espaços
// MIME types são case-insensitive segundo RFC 2045, mas podem vir com variações (ex: "Image/JPEG", "Audio/MPEG")
// .toLowerCase() e .trim() garantem matching correto mesmo com variações
// Extrair apenas o tipo base (antes de ;) para suportar parâmetros adicionais (ex: "audio/mpeg; codecs=mp3")
// Consistente com normalização em Training.tsx, rag-service, chat-service e integrations-service para evitar rejeição de tipos legítimos
// BUG FIX 23/12/2025: Type assertion segura seguindo padrão da plataforma (chat-service, rag-service)
// includes() faz validação real em runtime, type assertion apenas informa TypeScript sobre tipos possíveis
export function getMediaType(mimeType: string): MediaType | null {
  const normalizedMimeType = mimeType.toLowerCase().trim().split(';')[0].trim();
  if (ACCEPTED_TYPES.image.includes(normalizedMimeType as typeof ACCEPTED_TYPES.image[number])) return 'image';
  if (ACCEPTED_TYPES.audio.includes(normalizedMimeType as typeof ACCEPTED_TYPES.audio[number])) return 'audio';
  // REMOVIDO 23/12/2025: video não é mais aceito
  // if (ACCEPTED_TYPES.video.includes(normalizedMimeType)) return 'video';
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
