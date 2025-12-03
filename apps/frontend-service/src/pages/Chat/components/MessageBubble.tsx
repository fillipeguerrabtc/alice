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
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Message } from './types';
import { InlineImage } from './InlineImage';
import { InlineMediaAttachment } from './InlineMediaAttachment';
// AudioPlayer e VideoPlayer disponíveis via InlineMediaAttachment quando necessário

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

interface MessageBubbleProps {
  message: Message;
  isStreaming: boolean;
  isLast: boolean;
  onRateImage?: (imageId: string, score: number) => void;
}

export function MessageBubble({ 
  message, 
  isStreaming, 
  isLast,
  onRateImage,
}: MessageBubbleProps) {
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
          {message.mediaAttachments && message.mediaAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {message.mediaAttachments.map((media) => (
                <InlineMediaAttachment key={media.id} media={media} />
              ))}
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
