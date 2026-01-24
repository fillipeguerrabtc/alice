/**
 * MessageBubble - Bolha de mensagem individual do chat
 * 
 * Suporta mensagens de texto, mídia e imagens geradas.
 * 
 * @module Chat/components/MessageBubble
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AgentEvent, Message } from './types';
import { InlineImage } from './InlineImage';
import { InlineMediaAttachment } from './InlineMediaAttachment';
import { MessageActions } from './MessageActions';
// AudioPlayer disponível via InlineMediaAttachment quando necessário
// REMOVIDO 23/12/2025: VideoPlayer desabilitado (muito pesado para GPU)

const messageVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: { 
    opacity: 1, 
    y: 0, 
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 100, damping: 15 },
  },
  exit: { opacity: 0, y: -10, scale: 0.95 },
} as const;

interface MessageBubbleProps {
  message: Message;
  isStreaming: boolean;
  isLast: boolean;
  streamEvents?: AgentEvent[] | null;
  typingSpeedMs?: number;
  onRateImage?: (imageId: string, score: number) => void;
  onFeedback?: (messageId: string, isPositive: boolean) => void;
  onRegenerate?: () => void;
}

export function MessageBubble({ 
  message, 
  isStreaming, 
  isLast,
  streamEvents: _streamEvents,
  typingSpeedMs,
  onRateImage,
  onFeedback,
  onRegenerate,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [displayedContent, setDisplayedContent] = useState(message.content ?? '');
  const latestTargetRef = useRef(message.content ?? '');
  const displayedContentRef = useRef(displayedContent);
  const isUser = message.role === 'user';
  const hasMediaAttachments = Boolean(message.mediaAttachments && message.mediaAttachments.length > 0);
  const hasTextContent = Boolean(message.content && message.content.trim().length > 0);
  const hasGeneratedImage = Boolean(message.generatedImage);
  const isMediaOnly = hasMediaAttachments && !hasTextContent && !hasGeneratedImage;
  const assistantDisplayName = message.agent?.nome?.trim() || t('chat.agent.fallbackName');
  const userDisplayName = (() => {
    if (message.user?.preferredName) return message.user.preferredName;
    const firstName = message.user?.firstName?.trim() ?? '';
    const lastName = message.user?.lastName?.trim() ?? '';
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;
    if (message.user?.email) return message.user.email;
    return t('chat.user.fallbackName');
  })();
  const assistantAvatarSrc = !isUser && isStreaming && (isLast || (message.content ?? '').length === 0)
    ? '/packman.gif'
    : (message.agent?.avatar || '/gato.gif');
  const typingIntervalMs = Math.min(400, Math.max(40, typingSpeedMs ?? 60));
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Falha silenciosa - clipboard pode não estar disponível em alguns contextos
    }
  }, [message.content]);

  useEffect(() => {
    const target = message.content ?? '';
    latestTargetRef.current = target;

    displayedContentRef.current = displayedContent;
    const isAssistantLast = isLast && message.role === 'assistant';
    if (!isAssistantLast) {
      setDisplayedContent(target);
      displayedContentRef.current = target;
      return;
    }

    // Se o conteúdo foi reescrito (não é prefixo do anterior), sincroniza imediatamente
    if (!target.startsWith(displayedContent) || target.length < displayedContent.length) {
      setDisplayedContent(target);
      displayedContentRef.current = target;
      return;
    }

    const shouldAnimate = isStreaming || displayedContent.length < target.length;
    if (!shouldAnimate) {
      setDisplayedContent(target);
      return;
    }

    let rafId: number | null = null;
    let lastTick = 0;

    const stepTyping = (timestamp: number) => {
      const currentTarget = latestTargetRef.current;
      if (timestamp - lastTick < typingIntervalMs) {
        rafId = window.requestAnimationFrame(stepTyping);
        return;
      }
      lastTick = timestamp;
      setDisplayedContent((prev) => {
        let next = prev;
        if (!currentTarget.startsWith(prev)) {
          next = currentTarget;
        } else if (prev.length < currentTarget.length) {
          next = currentTarget.slice(0, prev.length + 1);
        }
        displayedContentRef.current = next;
        return next;
      });
      const hasPendingChars = displayedContentRef.current.length < latestTargetRef.current.length;
      if (hasPendingChars || isStreaming) {
        rafId = window.requestAnimationFrame(stepTyping);
      }
    };

    rafId = window.requestAnimationFrame(stepTyping);
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [displayedContent, isLast, isStreaming, message.content, message.role, typingIntervalMs]);

  const shouldShowTypingCursor = isLast && message.role === 'assistant' && (isStreaming || displayedContent.length < (message.content ?? '').length);
  const shouldShowThinking = shouldShowTypingCursor && displayedContent.trim().length === 0;

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
        <div className="flex flex-col items-center gap-1">
          <Avatar className="h-12 w-12 shadow-sm">
            <AvatarImage src={assistantAvatarSrc} alt={assistantDisplayName} />
            <AvatarFallback>{assistantDisplayName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-[11px] text-muted-foreground">{assistantDisplayName}</span>
        </div>
      )}
      
      <div className={cn(
        'flex flex-col max-w-[80%]',
        isUser ? 'items-end' : 'items-start'
      )}>
        <Card
          className={cn(
            'p-3 shadow-sm transition-all',
            isMediaOnly
              ? 'bg-transparent p-0 shadow-none border-0'
              : isUser
                ? 'bg-muted text-foreground rounded-br-sm'
                : 'bg-muted text-foreground rounded-bl-sm'
          )}
          data-testid={`message-${message.role}-${message.id}`}
        >
          {message.mediaAttachments && message.mediaAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {message.mediaAttachments.map((media) => (
                <InlineMediaAttachment key={media.id} media={media} />
              ))}
            </div>
          )}

          <div className="whitespace-pre-wrap text-sm leading-relaxed min-h-[1.25rem]">
            {shouldShowThinking ? t('chat.thinking') : displayedContent}
            {shouldShowTypingCursor && (
              <span className="inline-block w-2 h-4 ml-0.5 bg-current animate-pulse rounded-sm" />
            )}
          </div>
          
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
          {!isUser ? (
            // Mensagens do assistente: usar MessageActions (inclui copiar, regenerar, feedback)
            <MessageActions
              content={message.content}
              messageId={message.id}
              isAssistant={true}
              onFeedback={onFeedback}
              onRegenerate={onRegenerate}
            />
          ) : (
            // Mensagens do usuário: apenas botão de copiar (sem ações de feedback/regenerate)
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleCopy}
                  data-testid={`button-copy-message-${message.id}`}
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {copied 
                  ? t('chat.actions.copied') 
                  : t('chat.actions.copy')}
              </TooltipContent>
            </Tooltip>
          )}
          
          {message.tokensUsados && (
            <span className="text-xs text-muted-foreground">
              {message.tokensUsados} tokens
            </span>
          )}
        </div>
      </div>

      {isUser && (
        <div className="flex flex-col items-center gap-1">
          <Avatar className="h-12 w-12 shadow-sm">
            <AvatarImage src={message.user?.profileImageUrl || undefined} alt={userDisplayName} />
            <AvatarFallback>{userDisplayName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-[11px] text-muted-foreground">{userDisplayName}</span>
        </div>
      )}

    </motion.div>
  );
}
