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

export type MediaType = 'image' | 'audio' | 'video';

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
  tipo?: 'text' | 'image' | 'audio' | 'video' | 'mixed';
  anexos?: unknown[];
  generatedImage?: GeneratedImageData;
  mediaAttachments?: MediaAttachment[];
}

export interface Conversation {
  id: string;
  titulo: string;
  criadoEm: string;
  atualizadoEm: string;
}

export interface ConversationsResponse {
  conversations: Conversation[];
}

export const FILE_LIMITS = {
  image: 10 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  video: 100 * 1024 * 1024,
} as const;

export const ACCEPTED_TYPES: Record<MediaType, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/webm'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
};

export function getMediaType(mimeType: string): MediaType | null {
  if (ACCEPTED_TYPES.image.includes(mimeType)) return 'image';
  if (ACCEPTED_TYPES.audio.includes(mimeType)) return 'audio';
  if (ACCEPTED_TYPES.video.includes(mimeType)) return 'video';
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
