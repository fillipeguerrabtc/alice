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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
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
  ConversationsResponse,
  FILE_LIMITS,
  ACCEPTED_TYPES,
  getMediaType,
  formatFileSize,
} from './components/types';
import { MessageBubble } from './components/MessageBubble';
import { ConversationItem } from './components/ConversationItem';
import { MediaPreview } from './components/MediaPreview';
import { WelcomeScreen } from './components/WelcomeScreen';

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
  conversations: Array<{
    id: string;
    titulo: string | null;
    ultimaMensagem: string | null;
    atualizadoEm: string;
  }>;
  conversationId?: string;
  isLoading: boolean;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
}

function ConversationsList({
  conversations,
  conversationId,
  isLoading,
  onNewChat,
  onSelectConversation,
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
  
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  // Desktop: sidebar aberta por padrão | Mobile: fechada por padrão
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  // Estado separado para drawer mobile
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<MediaAttachment[]>([]);
  
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

  const { data: conversationsData, isLoading: conversationsLoading } = useQuery<ConversationsResponse>({
    queryKey: ['/api/chat/conversations'],
    staleTime: 1000 * 60,
  });

  const { data: conversationMessages } = useQuery<{ messages: Message[] }>({
    queryKey: ['/api/chat/conversations', conversationId, 'messages'],
    enabled: !!conversationId,
  });

  useEffect(() => {
    if (conversationMessages?.messages) {
      setMessages(conversationMessages.messages);
    }
  }, [conversationMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

      const res = await apiRequest('POST', '/api/chat/stream', {
        conversationId,
        messages: [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

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
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMsg = newMessages[newMessages.length - 1];
                  if (lastMsg.role === 'assistant') {
                    lastMsg.content = fullContent;
                  }
                  return newMessages;
                });
              }
            } catch {
              // Ignorar erros de parse
            }
          }
        }
      }

      setIsStreaming(false);
      queryClientRef.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
      return fullContent;
    },
    onError: () => {
      setIsStreaming(false);
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

  const conversations = conversationsData?.conversations || [];

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
              Qwen2.5-VL
            </Badge>
            {/* Mobile: Badge compacto */}
            {isMobile && (
              <Badge variant="secondary" className="h-6 px-2">
                <Sparkles className="h-3 w-3" />
              </Badge>
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
      </div>
    </div>
  );
}
