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
import { useAuth } from '@/hooks/use-auth';

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
const SSE_TIMEOUT = 120000; // 120 segundos (vision/web podem levar mais tempo)

/** Base URL da API */
const API_BASE = import.meta.env.VITE_API_URL || '';

// Tipos de mídia suportados
// ATUALIZADO 23/12/2025: 'video' REMOVIDO (muito pesado para GPU)
export type MediaType = 'image' | 'audio';

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
  // ATUALIZADO 23/12/2025: Removido 'video' (muito pesado para GPU)
  tipo?: 'text' | 'image' | 'audio' | 'mixed';
  anexos?: unknown[];
  sources?: unknown[];
  llmMetadata?: Record<string, unknown>;
  generatedImage?: GeneratedImageData;
  mediaAttachments?: MediaAttachment[];
}

interface StreamSsePayload {
  content?: string;
  type?: string;
  messageId?: string;
  generatedImage?: GeneratedImageData;
  sources?: unknown[];
  usedFallback?: boolean;
}

function parseSseEvents(chunk: string): { events: string[]; rest: string } {
  const normalized = chunk.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  if (parts.length <= 1) {
    return { events: [], rest: normalized };
  }
  const rest = parts.pop() ?? '';
  return { events: parts, rest };
}

// Limites de arquivo (em bytes)
// ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
// BUG FIX 23/12/2025: Tipo explícito garante que todas as chaves de MediaType existam
// Isso previne acesso a undefined e NaN em cálculos de limite
// REMOVIDO 23/12/2025: video desabilitado (muito pesado para GPU)
export const FILE_LIMITS: Record<MediaType, number> = {
  image: 10 * 1024 * 1024,  // 10MB
  audio: 25 * 1024 * 1024,  // 25MB
} as const;

// Tipos MIME suportados
// ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
export const ACCEPTED_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/webm'],
  // video removido
} as const;

// Helper para determinar tipo de mídia pelo MIME type
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
  
  // BUG FIX 23/12/2025: Verificação defensiva garante que limit não seja undefined
  // Type narrowing após validação garante que mediaType é MediaType
  const limit = FILE_LIMITS[mediaType];
  if (!limit) {
    return { valid: false, error: `Limite não definido para tipo de mídia: ${mediaType}` };
  }
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
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [retryCount, setRetryCount] = useState(0);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sseParseLogRef = useRef<{ count: number; windowStart: number }>({ count: 0, windowStart: 0 });
  const queryClient = useQueryClient();
  
  // Atualizar estado de conexão com callback
  const updateConnectionState = useCallback((state: ConnectionState) => {
    setConnectionState(state);
    onConnectionStateChange?.(state);
  }, [onConnectionStateChange]);

  const logSseParseError = useCallback((payload: string, error: Error) => {
    const now = Date.now();
    const current = sseParseLogRef.current;
    if (now - current.windowStart > 30000) {
      current.windowStart = now;
      current.count = 0;
    }
    if (current.count >= 5) return;
    current.count += 1;
    frontendLogger.warn('Falha ao parsear payload SSE', {
      error: error.message,
      sample: payload.slice(0, 200),
    });
  }, []);
  
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
    } else if (mediaType === 'audio') {
      // ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
      const media = document.createElement('audio');
      await new Promise<void>((resolve) => {
        media.onloadedmetadata = () => {
          attachment.duration = media.duration;
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
      updateConnectionState('disconnected');
    }
  }, [updateConnectionState]);

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
      const timeoutSignal = AbortSignal.timeout(SSE_TIMEOUT);
      const combinedSignal = AbortSignal.any([
        abortControllerRef.current.signal,
        timeoutSignal,
      ]);
      
      const res = await fetch(`${API_BASE}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
        signal: combinedSignal,
      });
      
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
      let streamAssistantMessageId = assistantMessageId;
      let buffer = '';
      
      // Processar stream de tokens
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSseEvents(buffer);
        buffer = rest;

        for (const eventChunk of events) {
          const dataLines = eventChunk
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart());
          if (dataLines.length === 0) continue;
          const data = dataLines.join('\n');
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as StreamSsePayload;
            if (typeof parsed.messageId === 'string' && parsed.messageId.trim().length > 0) {
              streamAssistantMessageId = parsed.messageId;
            }
            if (typeof parsed.content === 'string') {
              fullContent += parsed.content;
              onMessageUpdated?.(streamAssistantMessageId, { content: fullContent });
            }
            if (parsed.type === 'final_message' && typeof parsed.content === 'string') {
              fullContent = parsed.content;
              onMessageUpdated?.(streamAssistantMessageId, { content: fullContent });
            }
            if (parsed.type === 'sources' && Array.isArray(parsed.sources)) {
              onMessageUpdated?.(streamAssistantMessageId, { sources: parsed.sources });
            }
            if (parsed.type === 'llm_metadata') {
              onMessageUpdated?.(streamAssistantMessageId, {
                llmMetadata: { usedFallback: parsed.usedFallback === true },
              });
            }
            if (parsed.type === 'message_saved' && typeof parsed.messageId === 'string') {
              onMessageUpdated?.(streamAssistantMessageId, { id: parsed.messageId });
            }
            if (parsed.generatedImage) {
              onMessageUpdated?.(streamAssistantMessageId, { 
                content: fullContent,
                generatedImage: parsed.generatedImage,
              });
            }
          } catch (parseError) {
            logSseParseError(data, parseError instanceof Error ? parseError : new Error(String(parseError)));
          }
        }
      }
      
      const trailingChunk = decoder.decode();
      if (trailingChunk) {
        buffer += trailingChunk;
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
        if (error.name === 'AbortError') {
          updateConnectionState('disconnected');
        } else {
          updateConnectionState('failed');
        }
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
    } finally {
      if (attempt === 0) {
        abortControllerRef.current = null;
      }
    }
  }, [retryConfig, onRetry, onMessageUpdated, updateConnectionState, logSseParseError]);
  
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
      if (isAuthLoading || !isAuthenticated) {
        throw new Error('Faça login para continuar');
      }
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
      updateConnectionState(err.name === 'AbortError' ? 'disconnected' : 'failed');
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
