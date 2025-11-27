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
  User, 
  Loader2, 
  Plus, 
  MessageSquare,
  Sparkles,
  FileText,
  Paperclip,
  Copy,
  Check,
  Settings,
  ChevronLeft,
  ChevronRight,
  Download,
  X,
  Star,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';

interface GeneratedImageData {
  id: string;
  prompt: string;
  imageUrl?: string;
  imagePath?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  width?: number;
  height?: number;
  feedbackScore?: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  tokensUsados?: number;
  tipo?: 'text' | 'image' | 'audio' | 'video';
  anexos?: unknown[];
  generatedImage?: GeneratedImageData;
}

interface Conversation {
  id: string;
  titulo: string;
  criadoEm: string;
  atualizadoEm: string;
}

interface ConversationsResponse {
  conversations: Conversation[];
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const messageVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: { 
    opacity: 1, 
    y: 0, 
    scale: 1,
    transition: { type: 'spring', stiffness: 100, damping: 15 },
  },
  exit: { opacity: 0, y: -10, scale: 0.95 },
};

const sidebarVariants = {
  hidden: { x: -300, opacity: 0 },
  visible: { x: 0, opacity: 1, transition: { type: 'spring', stiffness: 100 } },
  exit: { x: -300, opacity: 0 },
};

function InlineImage({ image, onRate }: { image: GeneratedImageData; onRate?: (score: number) => void }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [hoveredStar, setHoveredStar] = useState(0);

  const imageSource = image.imageUrl || image.imagePath;

  if (image.status === 'pending' || image.status === 'processing') {
    return (
      <div className="flex items-center justify-center bg-muted rounded-lg p-4 min-h-[200px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
          <p className="text-sm text-muted-foreground">
            {image.status === 'pending' ? 'Aguardando processamento...' : 'Gerando imagem...'}
          </p>
        </div>
      </div>
    );
  }

  if (image.status === 'failed' || !imageSource) {
    return (
      <div className="flex items-center justify-center bg-destructive/10 rounded-lg p-4 min-h-[100px]">
        <div className="text-center">
          <X className="h-6 w-6 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive">Falha ao gerar imagem</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative group">
        {!imageLoaded && (
          <Skeleton className="w-full aspect-square max-w-[300px] rounded-lg" />
        )}
        <img
          src={imageSource}
          alt={image.prompt}
          className={cn(
            "rounded-lg max-w-[300px] w-full object-cover cursor-pointer transition-transform",
            !imageLoaded && "hidden"
          )}
          onLoad={() => setImageLoaded(true)}
          onClick={() => setShowFullscreen(true)}
          data-testid={`image-generated-${image.id}`}
        />
        
        <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              const link = document.createElement('a');
              link.href = imageSource;
              link.download = `alice-${image.id}.png`;
              link.click();
            }}
            data-testid={`button-download-image-${image.id}`}
          >
            <Download className="h-3 w-3" />
          </Button>
        </div>

        {onRate && (
          <div className="flex items-center gap-0.5 mt-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => onRate(star)}
                onMouseEnter={() => setHoveredStar(star)}
                onMouseLeave={() => setHoveredStar(0)}
                className="p-0.5 transition-colors"
                data-testid={`button-rate-image-${image.id}-${star}`}
              >
                <Star
                  className={cn(
                    "h-4 w-4 transition-colors",
                    (hoveredStar >= star || (image.feedbackScore && image.feedbackScore >= star))
                      ? "text-yellow-500 fill-yellow-500"
                      : "text-muted-foreground"
                  )}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={showFullscreen} onOpenChange={setShowFullscreen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Imagem Gerada</DialogTitle>
            <DialogDescription className="text-sm truncate">{image.prompt}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center">
            <img
              src={imageSource}
              alt={image.prompt}
              className="max-h-[70vh] rounded-lg object-contain"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                const link = document.createElement('a');
                link.href = imageSource;
                link.download = `alice-${image.id}.png`;
                link.click();
              }}
              data-testid="button-download-fullscreen"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MessageBubble({ 
  message, 
  isStreaming, 
  isLast,
  onRateImage,
}: { 
  message: Message; 
  isStreaming: boolean;
  isLast: boolean;
  onRateImage?: (imageId: string, score: number) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  const isUser = message.role === 'user';

  return (
    <motion.div
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={cn(
        'flex gap-3 group',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-sm">
          <Bot className="h-4 w-4" />
        </div>
      )}
      
      <div className={cn(
        'flex flex-col max-w-[80%]',
        isUser ? 'items-end' : 'items-start'
      )}>
        <Card
          className={cn(
            'p-3 shadow-sm transition-all',
            isUser
              ? 'bg-primary text-primary-foreground rounded-br-sm'
              : 'bg-muted rounded-bl-sm'
          )}
          data-testid={`message-${message.role}-${message.id}`}
        >
          {message.content && (
            <div className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.content}
              {isStreaming && isLast && message.role === 'assistant' && (
                <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse rounded-sm" />
              )}
            </div>
          )}
          
          {message.generatedImage && (
            <div className={cn(message.content && "mt-3")}>
              <InlineImage 
                image={message.generatedImage} 
                onRate={onRateImage ? (score) => onRateImage(message.generatedImage!.id, score) : undefined}
              />
            </div>
          )}
        </Card>
        
        <div className={cn(
          'flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity',
          isUser ? 'flex-row-reverse' : ''
        )}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {copied ? 'Copiado!' : 'Copiar'}
            </TooltipContent>
          </Tooltip>
          
          {message.tokensUsados && (
            <span className="text-xs text-muted-foreground">
              {message.tokensUsados} tokens
            </span>
          )}
        </div>
      </div>

      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <User className="h-4 w-4" />
        </div>
      )}
    </motion.div>
  );
}

function ConversationItem({ 
  conversation, 
  isActive, 
  onClick 
}: { 
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      variants={messageVariants}
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 rounded-lg transition-colors hover-elevate',
        isActive ? 'bg-primary/10 border border-primary/20' : 'hover:bg-muted'
      )}
    >
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate">{conversation.titulo}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {new Date(conversation.criadoEm).toLocaleDateString('pt-BR')}
      </p>
    </motion.button>
  );
}

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
  
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    mutationFn: async (content: string) => {
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
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
    if (!input.trim() || isStreaming) return;

    sendMessage.mutate(input.trim());
    setInput('');
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
                    data-testid="button-attach-file"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Anexar arquivo</TooltipContent>
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
                placeholder={t('chat.placeholder') || 'Digite sua mensagem...'}
                className="flex-1 min-h-[36px] max-h-[200px] resize-none bg-transparent text-sm focus-visible:outline-none"
                disabled={isStreaming}
                data-testid="input-chat-message"
              />
              
              <Button
                type="submit"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={!input.trim() || isStreaming}
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
