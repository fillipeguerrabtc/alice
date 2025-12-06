/**
 * MessageActions - Ações de mensagem (copiar, regenerar, feedback)
 * 
 * Barra de ações para cada mensagem do chat.
 * 
 * @module Chat/components/MessageActions
 */

import { useState, useCallback } from 'react';
import { Copy, Check, RefreshCw, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface MessageActionsProps {
  content: string;
  messageId: string;
  isAssistant: boolean;
  onRegenerate?: () => void;
  onFeedback?: (messageId: string, isPositive: boolean) => void;
}

export function MessageActions({ 
  content, 
  messageId, 
  isAssistant,
  onRegenerate,
  onFeedback,
}: MessageActionsProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Falha silenciosa - clipboard pode não estar disponível em alguns contextos
    }
  }, [content]);

  const handleFeedback = useCallback((isPositive: boolean) => {
    setFeedback(isPositive ? 'positive' : 'negative');
    onFeedback?.(messageId, isPositive);
  }, [messageId, onFeedback]);

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleCopy}
            data-testid={`button-copy-message-${messageId}`}
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {copied 
            ? t('chat.actions.copied') 
            : t('chat.actions.copy')}
        </TooltipContent>
      </Tooltip>

      {isAssistant && onRegenerate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onRegenerate}
              data-testid={`button-regenerate-${messageId}`}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t('chat.actions.regenerate')}
          </TooltipContent>
        </Tooltip>
      )}

      {isAssistant && onFeedback && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 ${feedback === 'positive' ? 'text-green-500' : ''}`}
                onClick={() => handleFeedback(true)}
                data-testid={`button-thumbsup-${messageId}`}
              >
                <ThumbsUp className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t('chat.actions.helpful')}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 ${feedback === 'negative' ? 'text-red-500' : ''}`}
                onClick={() => handleFeedback(false)}
                data-testid={`button-thumbsdown-${messageId}`}
              >
                <ThumbsDown className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t('chat.actions.notHelpful')}
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}
