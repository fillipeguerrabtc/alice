/**
 * Chat - Alice Enterprise Platform
 * 
 * Interface de chat moderna com streaming de tokens via WebSocket/SSE.
 * Design 2025 com animações Framer Motion e suporte multimodal.
 * Integração com RAG para contexto de documentos.
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Send, 
  Bot, 
  Loader2, 
  Plus, 
  MessageSquare,
  Sparkles,
  FileText,
  Paperclip,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { frontendLogger } from '@/lib/logger';

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

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const sidebarVariants = {
  hidden: { x: -300, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { type: 'spring', stiffness: 100 } },
  exit: { x: -300, opacity: 0 },
};

function WelcomeScreen() {
  const { t } = useTranslation();
  
  const suggestions = [
    { icon: Sparkles, text: 'Explique um conceito complexo de forma simples' },
    { icon: FileText, text: 'Ajude-me a escrever um documento' },
    { icon: Settings, text: 'Como configurar a plataforma Alice?' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center h-full text-center p-6"
    >
      <motion.div
        initial={{ scale: 0.8 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 100 }}
        className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground mb-6 shadow-lg"
      >
        <Bot className="h-10 w-10" />
      </motion.div>
      
      <h2 className="text-2xl font-bold mb-2">
        {t('chat.welcome') || 'Alice IA Enterprise'}
      </h2>
      <p className="text-muted-foreground max-w-md mb-8">
        {t('chat.welcomeMessage') || 'Olá! Sou a Alice, sua assistente de IA enterprise com Llama 4 Maverick. Como posso ajudar você hoje?'}
      </p>

      <div className="grid gap-3 w-full max-w-lg">
        {suggestions.map((suggestion, index) => (
          <motion.button
            key={index}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 hover-elevate text-left transition-colors"
          >
            <div className="p-2 rounded-md bg-primary/10">
              <suggestion.icon className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm">{suggestion.text}</span>
          </motion.button>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-8">
        <Badge variant="outline" className="text-xs">
          Llama 4 Maverick
        </Badge>
        <Badge variant="outline" className="text-xs">
          400B parâmetros
        </Badge>
        <Badge variant="outline" className="text-xs">
          RAG integrado
        </Badge>
      </div>
    </motion.div>
  );
}

export default function Chat() {
  const { t } = useTranslation();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const [, navigate] = useLocation();
  const queryClientRef = useQueryClient();
  const { toast } = useToast();
  
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pendingMedia, setPendingMedia] = useState<MediaAttachment[]>([]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          title: t('chat.upload.unsupportedType', 'Tipo não suportado'),
          description: t('chat.upload.unsupportedTypeDesc', 'Este tipo de arquivo não é suportado: {{type}}', { type: file.type }),
          variant: 'destructive',
        });
        continue;
      }

      const limit = FILE_LIMITS[mediaType];
      if (file.size > limit) {
        frontendLogger.warn('Upload rejeitado: arquivo muito grande', { 
          fileName: file.name, 
          fileSize: file.size, 
          limit 
        });
        toast({
          title: t('chat.upload.fileTooLarge', 'Arquivo muito grande'),
          description: t('chat.upload.fileTooLargeDesc', 'Tamanho: {{size}}. Limite: {{limit}}', { 
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

      if (mediaType === 'audio' || mediaType === 'video') {
        const mediaElement = document.createElement(mediaType);
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

  const handleNewChat = () => {
    setMessages([]);
    navigate('/chat');
  };

  const conversations = conversationsData?.conversations || [];

  return (
    <div className="flex h-full">
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            variants={sidebarVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="w-64 border-r bg-muted/30 flex flex-col"
          >
            <div className="p-3 border-b">
              <Button 
                onClick={handleNewChat}
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
                {conversationsLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))
                ) : conversations.length > 0 ? (
                  conversations.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conversation={conv}
                      isActive={conv.id === conversationId}
                      onClick={() => navigate(`/chat/${conv.id}`)}
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
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between gap-2 p-3 border-b bg-background/95 backdrop-blur">
          <div className="flex items-center gap-2">
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
            <h1 className="text-lg font-semibold truncate" data-testid="text-chat-title">
              {conversationId ? 'Conversa' : 'Nova Conversa'}
            </h1>
          </div>
          
          <div className="flex items-center gap-1">
            <Badge variant="secondary" className="hidden sm:flex gap-1">
              <Sparkles className="h-3 w-3" />
              Llama 4
            </Badge>
          </div>
        </div>

        <ScrollArea className="flex-1 p-4">
          <AnimatePresence mode="popLayout">
            {messages.length === 0 ? (
              <WelcomeScreen />
            ) : (
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="space-y-4 max-w-4xl mx-auto"
              >
                {messages.map((message, index) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isStreaming={isStreaming}
                    isLast={index === messages.length - 1}
                    onRateImage={handleRateImage}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </ScrollArea>

        <motion.form 
          onSubmit={handleSubmit} 
          className="p-4 border-t bg-background/95 backdrop-blur"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={[...ACCEPTED_TYPES.image, ...ACCEPTED_TYPES.audio, ...ACCEPTED_TYPES.video].join(',')}
            multiple
            onChange={handleFileSelect}
            className="hidden"
            data-testid="input-file-upload"
          />

          {pendingMedia.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3 max-w-4xl mx-auto">
              {pendingMedia.map((media) => (
                <MediaPreview 
                  key={media.id} 
                  media={media} 
                  onRemove={() => removePendingMedia(media.id)} 
                />
              ))}
            </div>
          )}

          <div className="flex gap-2 max-w-4xl mx-auto">
            <div className="flex-1 flex items-end gap-2 p-2 rounded-lg border bg-background shadow-sm">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    disabled={isStreaming}
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="button-attach-file"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Anexar arquivo (imagem, áudio, vídeo)</TooltipContent>
              </Tooltip>
              
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                }}
                onKeyDown={handleKeyDown}
                placeholder={pendingMedia.length > 0 ? 'Adicione uma mensagem (opcional)...' : (t('chat.placeholder') || 'Digite sua mensagem...')}
                className="flex-1 min-h-[36px] max-h-[200px] resize-none bg-transparent text-sm focus-visible:outline-none"
                disabled={isStreaming}
                data-testid="input-chat-message"
              />
              
              <Button
                type="submit"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={(!input.trim() && pendingMedia.length === 0) || isStreaming}
                data-testid="button-send-message"
              >
                {isStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          
          <p className="text-xs text-center text-muted-foreground mt-2">
            Alice pode cometer erros. Verifique informações importantes.
          </p>
        </motion.form>
      </div>
    </div>
  );
}
