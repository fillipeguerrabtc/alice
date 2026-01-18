/**
 * Chat - Alice Enterprise Platform
 * 
 * Interface de chat moderna com streaming de tokens via WebSocket/SSE.
 * Design 2025 com animações Framer Motion e suporte multimodal.
 * Integração com RAG para contexto de documentos.
 * 
 * MOBILE-FIRST 12/01/2026:
 * - Experiência de APP nativa em dispositivos móveis
 * - Sidebar como drawer offcanvas em mobile
 * - Input fixo com safe area para notch
 * - Full-screen chat experience
 * - Gestos e transições nativas
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 * 
 * @author Fillipe Guerra
 * @version 2.0.0
 * @date 12 de Janeiro de 2026
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useParams, useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Send, 
  Loader2, 
  Plus, 
  MessageSquare,
  Paperclip,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Menu,
  FileCheck,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { frontendLogger } from '@/lib/logger';

/**
 * Hook para detectar viewport mobile
 * Breakpoint: 768px (md do Tailwind)
 */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const handleChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    
    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isMobile;
}

import {
  Message,
  MediaAttachment,
  Conversation,
  ConversationsResponse,
  FILE_LIMITS,
  ACCEPTED_TYPES,
  getMediaType,
  formatFileSize,
} from './components/types';

interface Namespace {
  id: string;
  nome: string;
  slug: string;
}
import { MessageBubble } from './components/MessageBubble';
import { ConversationItem } from './components/ConversationItem';
import { MediaPreview } from './components/MediaPreview';
import { WelcomeScreen } from './components/WelcomeScreen';

type StreamMediaAttachmentPayload = {
  id: string;
  filename: string;
  mimeType: string;
  file: string;
};

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Falha ao converter arquivo em base64'));
        return;
      }
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

async function mediaAttachmentToBase64(media: MediaAttachment): Promise<string> {
  if (media.file) {
    return fileToBase64(media.file);
  }
  if (media.url) {
    const response = await fetch(media.url, { credentials: 'include' });
    if (!response.ok) {
      throw new Error('Falha ao baixar arquivo de mídia');
    }
    const blob = await response.blob();
    const file = new File([blob], media.fileName, { type: media.mimeType });
    return fileToBase64(file);
  }
  throw new Error('Arquivo de mídia indisponível para upload');
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
} as const;

const sidebarVariants = {
  hidden: { x: -300, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { type: 'spring' as const, stiffness: 100 } },
  exit: { x: -300, opacity: 0 },
} as const;

/**
 * Componente da lista de conversas - EXTRAÍDO para evitar anti-pattern
 * 
 * CORREÇÃO 12/01/2026: Componente definido FORA do Chat para evitar
 * re-criação a cada re-render. Isso previne:
 * - Reset de animações Framer Motion
 * - Perda de scroll position
 * - Perda de estado interno
 * 
 * @see https://react.dev/learn/your-first-component#defining-a-component
 */
interface ConversationsListProps {
  conversations: Conversation[];
  conversationId?: string;
  isLoading: boolean;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
}

function ConversationsList({
  conversations,
  conversationId,
  isLoading,
  onNewChat,
  onSelectConversation,
  onLoadMore,
  hasMore,
  isLoadingMore,
}: ConversationsListProps) {
  return (
    <>
      <div className="p-3 border-b">
        <Button 
          onClick={onNewChat}
          className="w-full justify-start gap-2"
          data-testid="button-new-chat"
        >
          <Plus className="h-4 w-4" />
          Nova Conversa
        </Button>
      </div>
      
      <ScrollArea className="flex-1 p-2">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-1"
        >
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))
          ) : conversations.length > 0 ? (
            conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === conversationId}
                onClick={() => onSelectConversation(conv.id)}
              />
            ))
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Nenhuma conversa</p>
            </div>
          )}
          {hasMore && (
            <div className="pt-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={onLoadMore}
                disabled={isLoadingMore}
                data-testid="button-load-more-conversations"
              >
                {isLoadingMore ? 'Carregando...' : 'Carregar mais'}
              </Button>
            </div>
          )}
        </motion.div>
      </ScrollArea>
    </>
  );
}

export default function Chat() {
  const { t } = useTranslation();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const [, navigate] = useLocation();
  const queryClientRef = useQueryClient();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const appVersion = __APP_VERSION__;
  const modelBadgeLabel = appVersion ? `Alice ${appVersion} 7B` : 'Alice 7B';
  
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [streamSteps, setStreamSteps] = useState<string[]>([]);
  // Desktop: sidebar aberta por padrão | Mobile: fechada por padrão
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  // Estado separado para drawer mobile
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<MediaAttachment[]>([]);
  const [showTrainingDialog, setShowTrainingDialog] = useState(false);
  const [trainingNamespaceId, setTrainingNamespaceId] = useState<string>('');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fechar drawer mobile ao mudar de conversa
  useEffect(() => {
    if (isMobile) {
      setMobileDrawerOpen(false);
    }
  }, [conversationId, isMobile]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const mediaType = getMediaType(file.type);
      
      if (!mediaType) {
        frontendLogger.warn('Upload rejeitado: tipo não suportado', { 
          fileName: file.name, 
          mimeType: file.type 
        });
        toast({
          title: t('chat.upload.unsupportedType'),
          description: t('chat.upload.unsupportedTypeDesc', { type: file.type }),
          variant: 'destructive',
        });
        continue;
      }

      // BUG FIX 23/12/2025: Verificação defensiva garante que limit não seja undefined
      // Type narrowing após validação garante que mediaType é MediaType
      const limit = FILE_LIMITS[mediaType];
      if (!limit) {
        frontendLogger.error('Limite não definido para tipo de mídia', { 
          fileName: file.name, 
          mediaType 
        });
        toast({
          title: t('chat.upload.unsupportedType'),
          description: `Tipo de mídia não suportado: ${mediaType}`,
          variant: 'destructive',
        });
        continue;
      }
      if (file.size > limit) {
        frontendLogger.warn('Upload rejeitado: arquivo muito grande', { 
          fileName: file.name, 
          fileSize: file.size, 
          limit 
        });
        toast({
          title: t('chat.upload.fileTooLarge'),
          description: t('chat.upload.fileTooLargeDesc', { 
            size: formatFileSize(file.size), 
            limit: formatFileSize(limit) 
          }),
          variant: 'destructive',
        });
        continue;
      }

      const objectUrl = URL.createObjectURL(file);
      const mediaId = crypto.randomUUID();

      const newMedia: MediaAttachment = {
        id: mediaId,
        type: mediaType,
        url: objectUrl,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        status: 'ready',
        file,
      };

      // ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
      if (mediaType === 'audio') {
        const mediaElement = document.createElement('audio');
        mediaElement.src = objectUrl;
        mediaElement.onloadedmetadata = () => {
          setPendingMedia(prev => 
            prev.map(m => m.id === mediaId ? { ...m, duration: mediaElement.duration } : m)
          );
        };
      }

      if (mediaType === 'image') {
        const img = new Image();
        img.src = objectUrl;
        img.onload = () => {
          setPendingMedia(prev => 
            prev.map(m => m.id === mediaId ? { ...m, width: img.width, height: img.height } : m)
          );
        };
      }

      setPendingMedia(prev => [...prev, newMedia]);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [t, toast]);

  const removePendingMedia = useCallback((mediaId: string) => {
    setPendingMedia(prev => {
      const media = prev.find(m => m.id === mediaId);
      if (media) {
        URL.revokeObjectURL(media.url);
      }
      return prev.filter(m => m.id !== mediaId);
    });
  }, []);

  const clearPendingMedia = useCallback(() => {
    pendingMedia.forEach(m => URL.revokeObjectURL(m.url));
    setPendingMedia([]);
  }, [pendingMedia]);

  const fetchConversations = useCallback(async ({ pageParam }: { pageParam?: { updatedAt: string; id: string } }) => {
    const params = new URLSearchParams();
    params.set('limit', '50');
    if (pageParam?.updatedAt && pageParam?.id) {
      params.set('cursorUpdatedAt', pageParam.updatedAt);
      params.set('cursorId', pageParam.id);
    }
    const res = await apiRequest('GET', `/api/chat/conversations?${params.toString()}`);
    return res.json() as Promise<ConversationsResponse>;
  }, []);

  const {
    data: conversationsData,
    isLoading: conversationsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['/api/chat/conversations'],
    queryFn: fetchConversations,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 1000 * 60,
  });

  const { data: conversationMessages } = useQuery<{ messages: Message[] }>({
    queryKey: ['/api/chat/conversations', conversationId, 'messages'],
    enabled: !!conversationId,
  });

  const { data: namespaces } = useQuery<Namespace[]>({
    queryKey: ['/api/namespaces'],
    staleTime: 1000 * 60,
  });

  const createConversation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/chat/conversations', { titulo: 'Nova Conversa' });
      return res.json() as Promise<{ conversation: Conversation }>;
    },
    onSuccess: () => {
      queryClientRef.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
    },
  });

  const mapAnexosToMediaAttachments = useCallback((anexos: Message['anexos']): MediaAttachment[] => {
    if (!anexos || anexos.length === 0) return [];
    return anexos.map((anexo) => ({
      id: anexo.id,
      type: anexo.type,
      url: anexo.url || '',
      fileName: anexo.filename,
      fileSize: anexo.size ?? 0,
      mimeType: anexo.mimeType,
      status: anexo.url ? 'ready' : 'processing',
      thumbnailUrl: anexo.thumbnailUrl,
      transcription: anexo.transcription,
      uploadId: anexo.uploadId,
      visionDescription: anexo.visionDescription,
      visionModel: anexo.visionModel,
    }));
  }, []);

  useEffect(() => {
    if (conversationMessages?.messages) {
      const normalized = conversationMessages.messages.map((message) => {
        if (message.mediaAttachments && message.mediaAttachments.length > 0) {
          return message;
        }
        if (message.anexos && message.anexos.length > 0) {
          return {
            ...message,
            mediaAttachments: mapAnexosToMediaAttachments(message.anexos),
          };
        }
        return message;
      });
      setMessages(normalized);
    }
  }, [conversationMessages, mapAnexosToMediaAttachments]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const STREAM_NO_CHUNK_TIMEOUT_MS = 60000;
  const resolveStreamStatus = useCallback((stage?: string) => {
    switch (stage) {
      case 'rag_internal':
        return t('chat.streaming.status.ragInternal');
      case 'rag_web':
        return t('chat.streaming.status.ragWeb');
      case 'greeting':
        return t('chat.streaming.status.greeting');
      case 'reuse':
        return t('chat.streaming.status.reuse');
      case 'media':
        return t('chat.streaming.status.media');
      case 'llm':
        return t('chat.streaming.status.llm');
      case 'writing':
        return t('chat.streaming.status.writing');
      case 'preparing':
      default:
        return t('chat.streaming.status.preparing');
    }
  }, [t]);
  const pushStreamStep = useCallback((label: string) => {
    setStreamSteps((prev) => {
      if (prev.length === 0) return [label];
      const last = prev[prev.length - 1];
      if (last === label) return prev;
      return [...prev, label];
    });
  }, []);
  const sendMessage = useMutation({
    mutationFn: async ({ content, mediaAttachments }: { content: string; mediaAttachments?: MediaAttachment[] }) => {
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
        tipo: mediaAttachments && mediaAttachments.length > 0 ? 'mixed' : 'text',
        mediaAttachments,
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);
      const preparingLabel = resolveStreamStatus('preparing');
      setStreamStatus(preparingLabel);
      setStreamSteps([preparingLabel]);

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      let activeConversationId = conversationId;
      if (!activeConversationId) {
        const created = await createConversation.mutateAsync();
        activeConversationId = created.conversation.id;
        navigate(`/chat/${activeConversationId}`);
      }

      const controller = new AbortController();
      let streamTimeoutId: ReturnType<typeof setTimeout> | null = null;
      const resetTimeout = () => {
        if (streamTimeoutId) clearTimeout(streamTimeoutId);
        streamTimeoutId = setTimeout(() => {
          controller.abort();
        }, STREAM_NO_CHUNK_TIMEOUT_MS);
      };
      const clearTimeoutSafe = () => {
        if (streamTimeoutId) {
          clearTimeout(streamTimeoutId);
          streamTimeoutId = null;
        }
      };

      const mediaPayload: StreamMediaAttachmentPayload[] | undefined = mediaAttachments?.length
        ? await Promise.all(
          mediaAttachments.map(async (media) => {
            return {
              id: media.id,
              filename: media.fileName,
              mimeType: media.mimeType,
              file: await mediaAttachmentToBase64(media),
            };
          })
        )
        : undefined;

      const payload = {
        conversationId: activeConversationId,
        ...(content.trim().length > 0 ? { message: content } : {}),
        ...(mediaPayload && mediaPayload.length > 0 ? { mediaAttachments: mediaPayload } : {}),
      };

      const res = await apiRequest('POST', '/api/chat/stream', payload, { signal: controller.signal });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';
      resetTimeout();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'conversation' && parsed.conversationId && !conversationId) {
                  navigate(`/chat/${parsed.conversationId}`);
                  queryClientRef.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
                  resetTimeout();
                }

                if (parsed.type === 'status') {
                  const label = resolveStreamStatus(parsed.stage);
                  setStreamStatus(label);
                  pushStreamStep(label);
                  resetTimeout();
                }

                if (parsed.type === 'sources') {
                  resetTimeout();
                }

                if (parsed.type === 'message_saved') {
                  resetTimeout();
                }

                if (parsed.type === 'generated_image' && parsed.message) {
                  const serverMessage = parsed.message as {
                    id?: string;
                    conteudo?: string | null;
                    criadoEm?: string | null;
                    generatedImage?: Message['generatedImage'];
                  };
                  const normalizedMessage: Message = {
                    id: serverMessage.id || crypto.randomUUID(),
                    role: 'assistant',
                    content: serverMessage.conteudo || 'Imagem gerada com sucesso via OpenAI.',
                    createdAt: serverMessage.criadoEm || new Date().toISOString(),
                    generatedImage: serverMessage.generatedImage,
                  };
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIdx = newMessages.length - 1;
                    if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                      newMessages[lastIdx] = { ...newMessages[lastIdx], ...normalizedMessage };
                    } else {
                      newMessages.push(normalizedMessage);
                    }
                    return newMessages;
                  });
                  resetTimeout();
                }

                if (parsed.type === 'media_uploaded' && Array.isArray(parsed.attachments)) {
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastUserIndex = [...newMessages].reverse().findIndex((msg) => msg.role === 'user');
                    if (lastUserIndex >= 0) {
                      const targetIndex = newMessages.length - 1 - lastUserIndex;
                      const target = newMessages[targetIndex];
                      if (target?.mediaAttachments) {
                        const updated = target.mediaAttachments.map((media) => {
                          const serverAttachment = parsed.attachments.find((att: { id: string }) => att.id === media.id);
                          if (!serverAttachment) return media;
                          return {
                            ...media,
                            url: serverAttachment.url ?? media.url,
                            thumbnailUrl: serverAttachment.thumbnailUrl ?? media.thumbnailUrl,
                            status: serverAttachment.processingStatus === 'completed' ? 'ready' : 'processing',
                            uploadId: serverAttachment.uploadId ?? media.uploadId,
                            transcription: serverAttachment.transcription ?? media.transcription,
                            visionDescription: serverAttachment.visionDescription ?? media.visionDescription,
                            visionModel: serverAttachment.visionModel ?? media.visionModel,
                          };
                        });
                        newMessages[targetIndex] = { ...target, mediaAttachments: updated };
                      }
                    }
                    return newMessages;
                  });
                  resetTimeout();
                }

                if (parsed.error) {
                  const errorMessage = typeof parsed.error === 'string' ? parsed.error : t('chat.streaming.error');
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIdx = newMessages.length - 1;
                    if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                      newMessages[lastIdx] = {
                        ...newMessages[lastIdx],
                        content: errorMessage,
                      };
                    } else {
                      newMessages.push({
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: errorMessage,
                        createdAt: new Date().toISOString(),
                      });
                    }
                    return newMessages;
                  });
                  resetTimeout();
                }

                if (parsed.content) {
                  fullContent += parsed.content;
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastIdx = newMessages.length - 1;
                    if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                      newMessages[lastIdx] = { ...newMessages[lastIdx], content: fullContent };
                    }
                    return newMessages;
                  });
                  setStreamStatus(resolveStreamStatus('writing'));
                  pushStreamStep(resolveStreamStatus('writing'));
                  resetTimeout();
                }
              } catch {
                // Ignorar erros de parse
              }
            }
          }
        }
      } finally {
        clearTimeoutSafe();
      }

      setIsStreaming(false);
      setStreamStatus(null);
      setStreamSteps([]);
      queryClientRef.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
      return fullContent;
    },
    onError: (error) => {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const errorMessage = isAbort ? t('chat.streaming.timeout') : t('chat.streaming.error');
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastIdx = newMessages.length - 1;
        if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
          newMessages[lastIdx] = { ...newMessages[lastIdx], content: errorMessage };
        } else {
          newMessages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: errorMessage,
            createdAt: new Date().toISOString(),
          });
        }
        return newMessages;
      });
      setIsStreaming(false);
      setStreamStatus(null);
      setStreamSteps([]);
    },
  });

  const sendConversationToTraining = useMutation({
    mutationFn: async () => {
      if (!conversationId) {
        throw new Error('Conversa não identificada');
      }
      if (!trainingNamespaceId) {
        throw new Error('Namespace obrigatório');
      }
      const res = await apiRequest('POST', `/api/chat/conversations/${conversationId}/training/collect`, {
        namespaceId: trainingNamespaceId,
      });
      return res.json() as Promise<{ success: boolean; messages: number }>;
    },
    onSuccess: () => {
      setShowTrainingDialog(false);
      toast({ title: t('chat.training.sent') });
    },
    onError: () => {
      toast({ title: t('chat.training.error'), variant: 'destructive' });
    },
  });

  const rateImage = useMutation({
    mutationFn: async ({ imageId, score }: { imageId: string; score: number }) => {
      await apiRequest('POST', `/api/chat/images/${imageId}/rate`, { score });
    },
    onSuccess: (_, { imageId, score }) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.generatedImage?.id === imageId) {
            return {
              ...msg,
              generatedImage: { ...msg.generatedImage, feedbackScore: score },
            };
          }
          return msg;
        })
      );
    },
  });

  const handleRateImage = useCallback((imageId: string, score: number) => {
    rateImage.mutate({ imageId, score });
  }, [rateImage]);

  // GAP CRÍTICO #1: Handler para feedback de mensagens de texto
  // Alice MULTIMODAL: coleta feedback de texto, imagens, áudio, vídeo
  const rateMessage = useMutation({
    mutationFn: async ({ messageId, isPositive }: { messageId: string; isPositive: boolean }) => {
      // Converter ThumbsUp/ThumbsDown para rating (5 para positivo, 1 para negativo)
      const rating = isPositive ? 5 : 1;
      await apiRequest('POST', `/api/chat/messages/${messageId}/rate`, { 
        rating,
        isPositive,
      });
    },
    onSuccess: (_, { messageId, isPositive }) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === messageId) {
            return {
              ...msg,
              metadata: {
                ...msg.metadata,
                rating: isPositive ? 5 : 1,
                feedback: isPositive ? 'positive' : 'negative',
              },
            };
          }
          return msg;
        })
      );
    },
  });

  const handleFeedback = useCallback((messageId: string, isPositive: boolean) => {
    rateMessage.mutate({ messageId, isPositive });
  }, [rateMessage]);

  // Handler para regenerar última resposta do assistente
  // Remove a última mensagem do assistente e reenvia a última mensagem do usuário
  const handleRegenerate = useCallback(() => {
    if (isStreaming || messages.length === 0) return;

    // Encontrar última mensagem do usuário (iterar de trás para frente)
    let lastUserMessageIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMessageIndex = i;
        break;
      }
    }

    if (lastUserMessageIndex === -1) return;

    // Remover todas as mensagens após a última mensagem do usuário (incluindo resposta do assistente)
    const messagesUpToUser = messages.slice(0, lastUserMessageIndex + 1);
    setMessages(messagesUpToUser);

    // Reenviar última mensagem do usuário
    const lastUserMessage = messages[lastUserMessageIndex];
    if (lastUserMessage) {
      sendMessage.mutate({
        content: lastUserMessage.content || '',
        mediaAttachments: lastUserMessage.mediaAttachments,
      });
    }
  }, [messages, isStreaming, sendMessage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && pendingMedia.length === 0) || isStreaming) return;

    sendMessage.mutate({ 
      content: input.trim(), 
      mediaAttachments: pendingMedia.length > 0 ? [...pendingMedia] : undefined 
    });
    setInput('');
    clearPendingMedia();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const conversations = conversationsData?.pages.flatMap((page) => page.conversations) || [];

  // Handler para nova conversa com fechamento de drawer mobile
  const handleNewChatWithClose = useCallback(() => {
    setMessages([]);
    navigate('/chat');
    if (isMobile) setMobileDrawerOpen(false);
  }, [navigate, isMobile]);

  // Handler para selecionar conversa (fecha drawer mobile se aberto)
  const handleSelectConversation = useCallback((id: string) => {
    navigate(`/chat/${id}`);
    if (isMobile) setMobileDrawerOpen(false);
  }, [navigate, isMobile]);

  return (
    <div className="flex h-full">
      {/* MOBILE: Drawer offcanvas para lista de conversas */}
      {isMobile && (
        <Sheet open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen}>
          <SheetContent side="left" className="w-[300px] p-0">
            <VisuallyHidden.Root>
              <SheetTitle>Conversas</SheetTitle>
            </VisuallyHidden.Root>
            <div className="flex flex-col h-full bg-muted/30">
              <ConversationsList
                conversations={conversations}
                conversationId={conversationId}
                isLoading={conversationsLoading}
                onNewChat={handleNewChatWithClose}
                onSelectConversation={handleSelectConversation}
                onLoadMore={() => fetchNextPage()}
                hasMore={Boolean(hasNextPage)}
                isLoadingMore={isFetchingNextPage}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* DESKTOP: Sidebar fixa */}
      {!isMobile && (
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div
              variants={sidebarVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="w-64 border-r bg-muted/30 flex flex-col"
            >
              <ConversationsList
                conversations={conversations}
                conversationId={conversationId}
                isLoading={conversationsLoading}
                onNewChat={handleNewChatWithClose}
                onSelectConversation={handleSelectConversation}
                onLoadMore={() => fetchNextPage()}
                hasMore={Boolean(hasNextPage)}
                isLoadingMore={isFetchingNextPage}
              />
            </motion.div>
          )}
        </AnimatePresence>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header responsivo */}
        <div className="flex items-center justify-between gap-2 p-2 md:p-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 safe-area-inset-top">
          <div className="flex items-center gap-2">
            {/* MOBILE: Botão de menu hamburger */}
            {isMobile ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileDrawerOpen(true)}
                className="h-9 w-9"
                data-testid="button-mobile-menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                data-testid="button-toggle-sidebar"
              >
                {sidebarOpen ? (
                  <ChevronLeft className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            )}
            <h1 className="text-base md:text-lg font-semibold truncate" data-testid="text-chat-title">
              {conversationId ? 'Conversa' : 'Nova Conversa'}
            </h1>
          </div>
          
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="hidden md:flex gap-1 text-xs">
              <Sparkles className="h-3 w-3" />
              {modelBadgeLabel}
            </Badge>
            {conversationId && (
              <Button
                variant="outline"
                size="sm"
                className="hidden md:flex"
                onClick={() => setShowTrainingDialog(true)}
                data-testid="button-send-to-training"
              >
                <FileCheck className="h-4 w-4 mr-2" />
                {t('chat.training.send')}
              </Button>
            )}
            {/* Mobile: Badge compacto */}
            {isMobile && (
              <>
                <Badge variant="secondary" className="h-6 px-2 text-[10px] gap-1">
                  <Sparkles className="h-3 w-3" />
                  {modelBadgeLabel}
                </Badge>
                {conversationId && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setShowTrainingDialog(true)}
                    data-testid="button-send-to-training-mobile"
                  >
                    <FileCheck className="h-3 w-3" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Área de mensagens - responsiva */}
        <ScrollArea className="flex-1 p-2 md:p-4">
          <AnimatePresence mode="popLayout">
            {messages.length === 0 ? (
              <WelcomeScreen />
            ) : (
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="space-y-3 md:space-y-4 max-w-4xl mx-auto"
              >
                {messages.map((message, index) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isStreaming={isStreaming}
                    isLast={index === messages.length - 1}
                    streamStatus={isStreaming && index === messages.length - 1 ? streamStatus : null}
                    streamSteps={isStreaming && index === messages.length - 1 ? streamSteps : null}
                    onRateImage={handleRateImage}
                    onFeedback={handleFeedback}
                    onRegenerate={handleRegenerate}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </ScrollArea>

        {/* Input de chat - otimizado para mobile com safe area */}
        <motion.form 
          onSubmit={handleSubmit} 
          className="p-2 md:p-4 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 safe-area-inset-bottom"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={[...ACCEPTED_TYPES.image, ...ACCEPTED_TYPES.audio].join(',')}
            multiple
            onChange={handleFileSelect}
            className="hidden"
            data-testid="input-file-upload"
          />

          {/* Preview de mídia anexada */}
          {pendingMedia.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 md:mb-3 max-w-4xl mx-auto">
              {pendingMedia.map((media) => (
                <MediaPreview 
                  key={media.id} 
                  media={media} 
                  onRemove={() => removePendingMedia(media.id)} 
                />
              ))}
            </div>
          )}

          {/* Container do input - mobile-first */}
          <div className="flex gap-2 max-w-4xl mx-auto">
            <div className="flex-1 flex items-end gap-1.5 md:gap-2 p-1.5 md:p-2 rounded-xl md:rounded-lg border bg-background shadow-sm">
              {/* Botão de anexo - maior em mobile para touch */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 md:h-8 md:w-8 shrink-0 touch-manipulation"
                    disabled={isStreaming}
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="button-attach-file"
                  >
                    <Paperclip className="h-5 w-5 md:h-4 md:w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Anexar arquivo (imagem, áudio)</TooltipContent>
              </Tooltip>
              
              {/* Textarea - altura mínima maior em mobile */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, isMobile ? 120 : 200)}px`;
                }}
                onKeyDown={handleKeyDown}
                placeholder={pendingMedia.length > 0 ? t('chat.placeholderWithMedia') : t('chat.placeholder')}
                className="flex-1 min-h-[40px] md:min-h-[36px] max-h-[120px] md:max-h-[200px] resize-none bg-transparent text-base md:text-sm leading-relaxed focus-visible:outline-none"
                disabled={isStreaming}
                data-testid="input-chat-message"
                // Mobile: desabilitar autocorrect para nomes próprios
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="sentences"
              />
              
              {/* Botão de enviar - maior em mobile para touch */}
              <Button
                type="submit"
                size="icon"
                className="h-9 w-9 md:h-8 md:w-8 shrink-0 rounded-full md:rounded-md touch-manipulation"
                disabled={(!input.trim() && pendingMedia.length === 0) || isStreaming}
                data-testid="button-send-message"
              >
                {isStreaming ? (
                  <Loader2 className="h-5 w-5 md:h-4 md:w-4 animate-spin" />
                ) : (
                  <Send className="h-5 w-5 md:h-4 md:w-4" />
                )}
              </Button>
            </div>
          </div>
          
          {/* Disclaimer - escondido em mobile para economizar espaço */}
          <p className="hidden md:block text-xs text-center text-muted-foreground mt-2">
            Alice pode cometer erros. Verifique informações importantes.
          </p>
        </motion.form>

        <Dialog open={showTrainingDialog} onOpenChange={setShowTrainingDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('chat.training.title')}</DialogTitle>
              <DialogDescription>{t('chat.training.desc')}</DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label>{t('chat.training.namespace')}</Label>
                <Select value={trainingNamespaceId} onValueChange={setTrainingNamespaceId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('chat.training.selectNamespace')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(namespaces || []).map((namespace) => (
                      <SelectItem key={namespace.id} value={namespace.id}>
                        {namespace.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>{t('chat.training.noticeTitle')}</AlertTitle>
                <AlertDescription>{t('chat.training.noticeDesc')}</AlertDescription>
              </Alert>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowTrainingDialog(false)}>
                {t('chat.training.cancel')}
              </Button>
              <Button
                onClick={() => sendConversationToTraining.mutate()}
                disabled={!trainingNamespaceId || sendConversationToTraining.isPending}
              >
                {sendConversationToTraining.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('chat.training.sending')}
                  </>
                ) : (
                  <>
                    <FileCheck className="h-4 w-4 mr-2" />
                    {t('chat.training.confirm')}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
