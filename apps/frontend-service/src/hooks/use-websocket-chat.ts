/**
 * useWebSocketChat - Hook para comunicação de chat em tempo real
 * 
 * Gerencia conexão SSE, streaming de tokens, e envio de mídia multimodal.
 * Inclui retry com backoff exponencial e fallback para polling.
 * 
 * Regra 10 - Documentação PT-BR
 * Regra 8 - TypeScript strict
 * Regra 16 - Circuit breaker pattern para resilência
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { frontendLogger } from '@/lib/logger';

// ============================================================================
// CONFIGURAÇÃO DE RESILIÊNCIA (Regra 16 - Best Practices 2025)
// ============================================================================

/** Configuração de retry com exponential backoff */
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;      // ms
  maxDelay: number;       // ms
  backoffFactor: number;  // multiplicador
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,        // 1 segundo
  maxDelay: 30000,        // 30 segundos
  backoffFactor: 2,       // dobra a cada retry
};

/** Calcula delay com exponential backoff + jitter (evita thundering herd) */
function calculateBackoff(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelay * Math.pow(config.backoffFactor, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelay);
  // Adicionar jitter de 0-25% para evitar sincronização de retries
  const jitter = cappedDelay * 0.25 * Math.random();
  return cappedDelay + jitter;
}

/** Estado da conexão SSE */
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

/** Timeout para requisições SSE (ms) */
const SSE_TIMEOUT = 60000; // 60 segundos

/** Base URL da API */
const API_BASE = import.meta.env.VITE_API_URL || '';

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

// Opções do hook - callbacks separados para criação vs atualização
interface UseWebSocketChatOptions {
  conversationId?: string;
  // Callback para ADICIONAR nova mensagem (user ou assistant inicial)
  onMessageCreated?: (message: ChatMessage) => void;
  // Callback para ATUALIZAR mensagem existente (streaming do assistant)
  onMessageUpdated?: (messageId: string, updates: Partial<ChatMessage>) => void;
  onStreamStart?: () => void;
  onStreamEnd?: () => void;
  onError?: (error: Error) => void;
  // Callback para mudança de estado da conexão (Regra 16 - Observability)
  onConnectionStateChange?: (state: ConnectionState) => void;
  // Callback para tentativa de retry
  onRetry?: (attempt: number, maxRetries: number, delay: number) => void;
  // Função para obter mensagens atuais (garante payload completo)
  getMessages?: () => ChatMessage[];
  // Configuração de retry (opcional)
  retryConfig?: Partial<RetryConfig>;
  // Fallback para polling quando SSE falha (Regra 16 - habilitado por padrão)
  enablePollingFallback?: boolean;
}

// Retorno do hook
interface UseWebSocketChatReturn {
  // Estados
  isStreaming: boolean;
  error: Error | null;
  connectionState: ConnectionState;
  retryCount: number;
  
  // Ações
  sendMessage: (content: string, mediaAttachments?: MediaAttachment[]) => Promise<string>;
  rateImage: (imageId: string, score: number) => Promise<void>;
  
  // Helpers
  createMediaAttachment: (file: File) => Promise<MediaAttachment>;
  abortStream: () => void;
  resetConnection: () => void;
}

/**
 * Hook para gerenciar comunicação de chat em tempo real
 * 
 * Suporta:
 * - Streaming de tokens via SSE com retry automático
 * - Exponential backoff com jitter para reconexão
 * - Fallback para polling quando SSE não está disponível
 * - Upload de mídia multimodal (imagens, áudio, vídeo)
 * - Rating de imagens geradas
 * - Cancelamento de streams
 * - Observabilidade de estado de conexão
 * 
 * Callbacks separados para criação (onMessageCreated) e atualização (onMessageUpdated)
 * evitam duplicação de mensagens durante streaming.
 * 
 * @example
 * ```tsx
 * const { sendMessage, isStreaming, connectionState } = useWebSocketChat({
 *   conversationId: 'conv-123',
 *   onMessageCreated: (msg) => setMessages(prev => [...prev, msg]),
 *   onMessageUpdated: (id, updates) => setMessages(prev => 
 *     prev.map(m => m.id === id ? { ...m, ...updates } : m)
 *   ),
 *   getMessages: () => messages,
 *   onConnectionStateChange: (state) => console.log('Conexão:', state),
 *   onRetry: (attempt, max, delay) => toast.info(`Reconectando ${attempt}/${max}...`),
 * });
 * 
 * await sendMessage('Olá Alice!', [imageAttachment]);
 * ```
 */
export function useWebSocketChat(options: UseWebSocketChatOptions = {}): UseWebSocketChatReturn {
  const { 
    conversationId, 
    onMessageCreated,
    onMessageUpdated,
    onStreamStart,
    onStreamEnd,
    onError,
    onConnectionStateChange,
    onRetry,
    getMessages,
    retryConfig: userRetryConfig,
    // REGRA 16: Fallback para polling HABILITADO por padrão para garantir resiliência
    enablePollingFallback = true,
  } = options;
  
  // Merge user config with defaults
  const retryConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...userRetryConfig };
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [retryCount, setRetryCount] = useState(0);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queryClient = useQueryClient();
  
  // Atualizar estado de conexão com callback
  const updateConnectionState = useCallback((state: ConnectionState) => {
    setConnectionState(state);
    onConnectionStateChange?.(state);
  }, [onConnectionStateChange]);
  
  // Limpar timeouts/intervals ao desmontar
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      abortControllerRef.current?.abort();
    };
  }, []);
  
  // Reset do estado de conexão
  const resetConnection = useCallback(() => {
    setRetryCount(0);
    setError(null);
    updateConnectionState('disconnected');
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, [updateConnectionState]);

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

  // ============================================================================
  // FUNÇÃO DE STREAMING SSE COM RETRY (Regra 16 - Best Practices 2025)
  // ============================================================================
  
  /**
   * Executa streaming SSE com retry automático e exponential backoff.
   * Falhas de rede disparam reconexão; erros de aplicação não.
   */
  const executeStreamWithRetry = useCallback(async (
    payload: { conversationId?: string; messages: Array<{ role: string; content: string }> },
    assistantMessageId: string,
    attempt: number = 0,
  ): Promise<string> => {
    // Configurar abort controller para esta tentativa
    abortControllerRef.current = new AbortController();
    
    try {
      updateConnectionState(attempt > 0 ? 'reconnecting' : 'connecting');
      
      // Fazer requisição SSE com timeout usando fetch diretamente
      // (apiRequest não suporta abort signal)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SSE_TIMEOUT);
      
      const res = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!res.ok) {
        throw new Error(`Erro na requisição SSE: ${res.status} ${res.statusText}`);
      }
      
      if (!res.body) {
        throw new Error('Resposta sem corpo - SSE não disponível');
      }
      
      updateConnectionState('connected');
      setRetryCount(0); // Reset retry count on success
      
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
                // ATUALIZAR mensagem existente (não criar nova)
                onMessageUpdated?.(assistantMessageId, { content: fullContent });
              }
              // Verificar se há imagem gerada
              if (parsed.generatedImage) {
                onMessageUpdated?.(assistantMessageId, { 
                  content: fullContent,
                  generatedImage: parsed.generatedImage,
                });
              }
            } catch {
              // Ignorar erros de parse de linhas inválidas
            }
          }
        }
      }
      
      updateConnectionState('disconnected');
      return fullContent;
      
    } catch (err) {
      const error = err as Error;
      
      // Verificar se é erro de rede (retry) ou erro de aplicação (não retry)
      const isNetworkError = 
        error.name === 'AbortError' ||
        error.name === 'TypeError' ||
        error.message.includes('network') ||
        error.message.includes('fetch') ||
        error.message.includes('SSE não disponível');
      
      // Se não é erro de rede ou atingiu max retries, propagar erro
      if (!isNetworkError || attempt >= retryConfig.maxRetries) {
        updateConnectionState('failed');
        throw error;
      }
      
      // Calcular delay com exponential backoff + jitter
      const delay = calculateBackoff(attempt, retryConfig);
      setRetryCount(attempt + 1);
      onRetry?.(attempt + 1, retryConfig.maxRetries, delay);
      
      // Aguardar antes de retry
      await new Promise<void>((resolve) => {
        retryTimeoutRef.current = setTimeout(resolve, delay);
      });
      
      // Tentar novamente
      return executeStreamWithRetry(payload, assistantMessageId, attempt + 1);
    }
  }, [retryConfig, onRetry, onMessageUpdated, updateConnectionState]);
  
  /**
   * Fallback para polling quando SSE não está disponível.
   * Usado apenas se enablePollingFallback === true.
   */
  const executePollingFallback = useCallback(async (
    payload: { conversationId?: string; messages: Array<{ role: string; content: string }> },
    assistantMessageId: string,
  ): Promise<string> => {
    updateConnectionState('connecting');
    
    // Fazer requisição normal (não-streaming)
    const res = await apiRequest('POST', '/api/chat/message', payload);
    const data = await res.json();
    
    updateConnectionState('connected');
    
    // Atualizar mensagem com resposta completa
    const content = data.content || data.message || '';
    onMessageUpdated?.(assistantMessageId, { 
      content,
      generatedImage: data.generatedImage,
    });
    
    updateConnectionState('disconnected');
    return content;
  }, [onMessageUpdated, updateConnectionState]);
  
  // Enviar mensagem com streaming SSE + retry + fallback
  const sendMessageMutation = useMutation({
    mutationFn: async ({ 
      content, 
      mediaAttachments,
    }: { 
      content: string; 
      mediaAttachments?: MediaAttachment[];
    }): Promise<string> => {
      // Obter mensagens atuais do consumidor
      const currentMessages = getMessages?.() ?? [];
      
      // Criar mensagem do usuário
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
        tipo: mediaAttachments && mediaAttachments.length > 0 ? 'mixed' : 'text',
        mediaAttachments,
      };

      // Notificar criação da mensagem do usuário
      onMessageCreated?.(userMessage);
      
      setIsStreaming(true);
      onStreamStart?.();
      setError(null);

      // Criar placeholder para resposta do assistente
      const assistantMessageId = crypto.randomUUID();
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      };
      
      // Notificar criação da mensagem do assistente (placeholder vazio)
      onMessageCreated?.(assistantMessage);

      // Construir histórico completo para o payload
      const messagesForPayload = [...currentMessages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      
      const payload = {
        conversationId,
        messages: messagesForPayload,
      };

      let fullContent: string;
      
      try {
        // Tentar SSE com retry
        fullContent = await executeStreamWithRetry(payload, assistantMessageId);
      } catch (sseError) {
        // Se fallback para polling está habilitado, tentar polling
        if (enablePollingFallback) {
          frontendLogger.warn('SSE falhou, usando fallback para polling', { error: String(sseError) });
          fullContent = await executePollingFallback(payload, assistantMessageId);
        } else {
          throw sseError;
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
      updateConnectionState('failed');
    },
  });

  // Função wrapper para enviar mensagem
  const sendMessage = useCallback(async (
    content: string, 
    mediaAttachments?: MediaAttachment[],
  ): Promise<string> => {
    return sendMessageMutation.mutateAsync({ 
      content, 
      mediaAttachments,
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
    // Estados
    isStreaming,
    error,
    connectionState,
    retryCount,
    // Ações
    sendMessage,
    rateImage,
    // Helpers
    createMediaAttachment,
    abortStream,
    resetConnection,
  };
}

export default useWebSocketChat;

// Re-exportar tipo para uso externo
export type { ConnectionState };
