/**
 * ChatInput - Campo de entrada do Chat
 * 
 * Campo de texto com suporte a upload de mídia e envio de mensagens.
 * 
 * @module Chat/components/ChatInput
 */

import { useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Send, Loader2, Paperclip } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MediaAttachment } from './types';
import { MediaPreview } from './MediaPreview';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveMedia: (index: number) => void;
  pendingMedia: MediaAttachment[];
  isStreaming: boolean;
  acceptedTypes: string;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  onFileSelect,
  onRemoveMedia,
  pendingMedia,
  isStreaming,
  acceptedTypes,
}: ChatInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    adjustTextareaHeight();
  }, [onChange, adjustTextareaHeight]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-shrink-0 border-t bg-background/80 backdrop-blur-sm p-4"
    >
      {pendingMedia.length > 0 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {pendingMedia.map((media, index) => (
            <MediaPreview
              key={index}
              media={media}
              onRemove={() => onRemoveMedia(index)}
            />
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptedTypes}
          multiple
          className="hidden"
          onChange={onFileSelect}
          data-testid="input-file-upload"
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              data-testid="button-attach-file"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t('chat.attachFile')}
          </TooltipContent>
        </Tooltip>

        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.placeholder')}
            disabled={isStreaming}
            rows={1}
            className="w-full resize-none rounded-lg border bg-background px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            data-testid="input-chat-message"
          />
        </div>

        <Button
          onClick={onSend}
          disabled={isStreaming || (!value.trim() && pendingMedia.length === 0)}
          size="icon"
          data-testid="button-send-message"
        >
          {isStreaming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
        <span>
          {t('chat.enterToSend')}
        </span>
        {isStreaming && (
          <span className="flex items-center gap-1 text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('chat.generating')}
          </span>
        )}
      </div>
    </motion.div>
  );
}
