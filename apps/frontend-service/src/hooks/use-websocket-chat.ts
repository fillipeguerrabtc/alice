/**
 * useWebSocketChat - Hook para comunicação de chat em tempo real
 * 
 * Gerencia conexão WebSocket/SSE, streaming de tokens, e envio de mídia multimodal.
 * Extração do Chat.tsx para melhor organização e reutilização.
 * 
 * Regra 10 - Documentação PT-BR
 * Regra 8 - TypeScript strict
 */

import { useState, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

// Tipos de mídia suportados
export type MediaType = 'image' | 'audio' | 'video';

// Anexo de mídia
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

// Imagem gerada pela IA
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

// Mensagem de chat
export interface ChatMessage {
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

// Limites de arquivo (em bytes)
export const FILE_LIMITS: Record<MediaType, number> = {
  image: 10 * 1024 * 1024,  // 10MB
  audio: 25 * 1024 * 1024,  // 25MB
  video: 100 * 1024 * 1024, // 100MB
};

// Tipos MIME suportados
export const ACCEPTED_TYPES: Record<MediaType, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/webm'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
};

// Helper para determinar tipo de mídia pelo MIME type
export function getMediaType(mimeType: string): MediaType | null {
  if (ACCEPTED_TYPES.image.includes(mimeType)) return 'image';
  if (ACCEPTED_TYPES.audio.includes(mimeType)) return 'audio';
  if (ACCEPTED_TYPES.video.includes(mimeType)) return 'video';
  return null;
}

// Helper para formatar tamanho de arquivo
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Helper para formatar duração de áudio/vídeo
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Validar arquivo antes de upload
export function validateFile(file: File): { valid: boolean; error?: string } {
  const mediaType = getMediaType(file.type);
  
  if (!mediaType) {
    return { valid: false, error: 'Tipo de arquivo não suportado' };
  }
  
  const limit = FILE_LIMITS[mediaType];
  if (file.size > limit) {
    return { 
      valid: false, 
      error: `Arquivo muito grande. Máximo: ${formatFileSize(limit)}` 
    };
  }
  
  return { valid: true };
}

// Opções do hook
interface UseWebSocketChatOptions {
  conversationId?: string;
  onMessageReceived?: (message: ChatMessage) => void;
  onStreamStart?: () => void;
  onStreamEnd?: () => void;
  onError?: (error: Error) => void;
}

// Retorno do hook
interface UseWebSocketChatReturn {
  // Estados
  isStreaming: boolean;
  error: Error | null;
  
  // Ações
  sendMessage: (content: string, mediaAttachments?: MediaAttachment[]) => Promise<string>;
  rateImage: (imageId: string, score: number) => Promise<void>;
  
  // Helpers
  createMediaAttachment: (file: File) => Promise<MediaAttachment>;
  abortStream: () => void;
}

/**
 * Hook para gerenciar comunicação de chat em tempo real
 * 
 * Suporta:
 * - Streaming de tokens via SSE
 * - Upload de mídia multimodal (imagens, áudio, vídeo)
 * - Rating de imagens geradas
 * - Cancelamento de streams
 * 
 * @example
 * ```tsx
 * const { sendMessage, isStreaming } = useWebSocketChat({
 *   conversationId: 'conv-123',
 *   onMessageReceived: (msg) => setMessages(prev => [...prev, msg]),
 * });
 * 
 * await sendMessage('Olá Alice!', [imageAttachment]);
 * ```
 */
export function useWebSocketChat(options: UseWebSocketChatOptions = {}): UseWebSocketChatReturn {
  const { 
    conversationId, 
    onMessageReceived,
    onStreamStart,
    onStreamEnd,
    onError,
  } = options;
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  // Criar anexo de mídia a partir de arquivo
  const createMediaAttachment = useCallback(async (file: File): Promise<MediaAttachment> => {
    const validation = validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const mediaType = getMediaType(file.type);
    if (!mediaType) {
      throw new Error('Tipo de arquivo não suportado');
    }

    const attachment: MediaAttachment = {
      id: crypto.randomUUID(),
      type: mediaType,
      url: URL.createObjectURL(file),
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      status: 'ready',
      progress: 100,
    };

    // Extrair metadados de mídia
    if (mediaType === 'image') {
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => {
          attachment.width = img.naturalWidth;
          attachment.height = img.naturalHeight;
          resolve();
        };
        img.src = attachment.url;
      });
    } else if (mediaType === 'audio' || mediaType === 'video') {
      const media = document.createElement(mediaType === 'audio' ? 'audio' : 'video');
      await new Promise<void>((resolve) => {
        media.onloadedmetadata = () => {
          attachment.duration = media.duration;
          if (mediaType === 'video') {
            attachment.width = (media as HTMLVideoElement).videoWidth;
            attachment.height = (media as HTMLVideoElement).videoHeight;
          }
          resolve();
        };
        media.src = attachment.url;
      });
    }

    return attachment;
  }, []);

  // Abortar stream em andamento
  const abortStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  // Enviar mensagem com streaming SSE
  const sendMessageMutation = useMutation({
    mutationFn: async ({ 
      content, 
      mediaAttachments,
      existingMessages,
    }: { 
      content: string; 
      mediaAttachments?: MediaAttachment[];
      existingMessages: ChatMessage[];
    }): Promise<string> => {
      // Criar mensagem do usuário
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
        tipo: mediaAttachments && mediaAttachments.length > 0 ? 'mixed' : 'text',
        mediaAttachments,
      };

      onMessageReceived?.(userMessage);
      setIsStreaming(true);
      onStreamStart?.();
      setError(null);

      // Criar placeholder para resposta do assistente
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      };
      onMessageReceived?.(assistantMessage);

      // Configurar abort controller
      abortControllerRef.current = new AbortController();

      // Fazer requisição SSE
      const res = await apiRequest('POST', '/api/chat/stream', {
        conversationId,
        messages: [...existingMessages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      if (!res.body) throw new Error('Sem corpo na resposta');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      // Processar stream de tokens
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullContent += parsed.content;
                // Atualizar mensagem do assistente
                const updatedAssistant: ChatMessage = {
                  ...assistantMessage,
                  content: fullContent,
                };
                onMessageReceived?.(updatedAssistant);
              }
              // Verificar se há imagem gerada
              if (parsed.generatedImage) {
                const updatedAssistant: ChatMessage = {
                  ...assistantMessage,
                  content: fullContent,
                  generatedImage: parsed.generatedImage,
                };
                onMessageReceived?.(updatedAssistant);
              }
            } catch {
              // Ignorar erros de parse de linhas inválidas
            }
          }
        }
      }

      setIsStreaming(false);
      onStreamEnd?.();
      queryClient.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
      
      return fullContent;
    },
    onError: (err: Error) => {
      setIsStreaming(false);
      setError(err);
      onError?.(err);
      onStreamEnd?.();
    },
  });

  // Função wrapper para enviar mensagem
  const sendMessage = useCallback(async (
    content: string, 
    mediaAttachments?: MediaAttachment[],
    existingMessages: ChatMessage[] = [],
  ): Promise<string> => {
    return sendMessageMutation.mutateAsync({ 
      content, 
      mediaAttachments,
      existingMessages,
    });
  }, [sendMessageMutation]);

  // Mutation para avaliar imagem
  const rateImageMutation = useMutation({
    mutationFn: async ({ imageId, score }: { imageId: string; score: number }) => {
      await apiRequest('POST', `/api/chat/images/${imageId}/rate`, { score });
    },
  });

  // Função wrapper para avaliar imagem
  const rateImage = useCallback(async (imageId: string, score: number): Promise<void> => {
    await rateImageMutation.mutateAsync({ imageId, score });
  }, [rateImageMutation]);

  return {
    isStreaming,
    error,
    sendMessage,
    rateImage,
    createMediaAttachment,
    abortStream,
  };
}

export default useWebSocketChat;
