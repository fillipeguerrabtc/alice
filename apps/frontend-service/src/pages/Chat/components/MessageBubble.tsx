/**
 * MessageBubble - Bolha de mensagem individual do chat
 * 
 * Suporta mensagens de texto, mídia e imagens geradas.
 * 
 * @module Chat/components/MessageBubble
 */

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Bot, User, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Message } from './types';
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
  streamStatus?: string | null;
  streamSteps?: string[] | null;
  onRateImage?: (imageId: string, score: number) => void;
  onFeedback?: (messageId: string, isPositive: boolean) => void;
  onRegenerate?: () => void;
}

export function MessageBubble({ 
  message, 
  isStreaming, 
  isLast,
  streamStatus,
  streamSteps,
  onRateImage,
  onFeedback,
  onRegenerate,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Falha silenciosa - clipboard pode não estar disponível em alguns contextos
    }
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
          {message.mediaAttachments && message.mediaAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {message.mediaAttachments.map((media) => (
                <InlineMediaAttachment key={media.id} media={media} />
              ))}
            </div>
          )}

          {isStreaming && isLast && message.role === 'assistant' && (
            <div className="text-xs text-muted-foreground mb-1 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span>{streamStatus || t('chat.streaming.thinking')}</span>
                <span className="inline-flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse delay-150" />
                  <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse delay-300" />
                </span>
              </div>
              {streamSteps && streamSteps.length > 1 && (
                <div className="text-[11px] text-muted-foreground/80">
                  {t('chat.streaming.steps')} {streamSteps.join(' → ')}
                </div>
              )}
            </div>
          )}

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
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <User className="h-4 w-4" />
        </div>
      )}
    </motion.div>
  );
}
