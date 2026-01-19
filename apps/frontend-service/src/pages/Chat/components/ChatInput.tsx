/**
 * ChatInput - Campo de entrada do Chat
 * 
 * Campo de texto com suporte a upload de mídia e envio de mensagens.
 * 
 * @module Chat/components/ChatInput
 */

import { useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send, Loader2, Paperclip, Mic, Square, Camera } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MediaAttachment } from './types';
import { MediaPreview } from './MediaPreview';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onFilesSelected: (files: File[]) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onSendRecording: () => void;
  onStopStreaming: () => void;
  onRemoveMedia: (mediaId: string) => void;
  pendingMedia: MediaAttachment[];
  isStreaming: boolean;
  isRecording: boolean;
  isRecordingDisabled: boolean;
  isMobile: boolean;
  acceptedTypes: string;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  onFilesSelected,
  onStartRecording,
  onStopRecording,
  onSendRecording,
  onStopStreaming,
  onRemoveMedia,
  pendingMedia,
  isStreaming,
  isRecording,
  isRecordingDisabled,
  isMobile,
  acceptedTypes,
}: ChatInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, isMobile ? 120 : 200)}px`;
    }
  }, [isMobile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    adjustTextareaHeight();
  }, [onChange, adjustTextareaHeight]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [adjustTextareaHeight, value]);

  useEffect(() => {
    if (!isRecording) {
      textareaRef.current?.focus();
    }
  }, [isRecording]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length > 0) {
      onFilesSelected(files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onFilesSelected]);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      {pendingMedia.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 md:mb-3 max-w-4xl mx-auto">
          {pendingMedia.map((media) => (
            <MediaPreview
              key={media.id}
              media={media}
              onRemove={() => onRemoveMedia(media.id)}
            />
          ))}
        </div>
      )}

      <div className="flex gap-2 max-w-4xl mx-auto">
        <div className="flex-1 flex items-end gap-1.5 md:gap-2 p-1.5 md:p-2 rounded-xl md:rounded-lg border bg-background shadow-sm">
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedTypes}
            multiple
            className="hidden"
            onChange={handleFileChange}
            data-testid="input-file-upload"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileChange}
            data-testid="input-camera-upload"
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 md:h-8 md:w-8 shrink-0 touch-manipulation"
                disabled={isRecording}
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-attach-file"
              >
                <Paperclip className="h-5 w-5 md:h-4 md:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('chat.attachFile')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 md:h-8 md:w-8 shrink-0 touch-manipulation"
                disabled={isRecording}
                onClick={() => cameraInputRef.current?.click()}
                data-testid="button-open-camera"
              >
                <Camera className="h-5 w-5 md:h-4 md:w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('chat.openCamera')}</TooltipContent>
          </Tooltip>

          {!isRecording ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 md:h-8 md:w-8 shrink-0 touch-manipulation"
                  disabled={isRecordingDisabled}
                  onClick={onStartRecording}
                  data-testid="button-record-audio"
                >
                  <Mic className="h-5 w-5 md:h-4 md:w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('chat.recordAudio')}</TooltipContent>
            </Tooltip>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="h-9 w-9 md:h-8 md:w-8 shrink-0 touch-manipulation"
                    disabled={isStreaming}
                    onClick={onStopRecording}
                    data-testid="button-stop-recording"
                  >
                    <Square className="h-5 w-5 md:h-4 md:w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('chat.stopRecordingReview')}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="default"
                    size="icon"
                    className="h-9 w-9 md:h-8 md:w-8 shrink-0 touch-manipulation"
                    disabled={isStreaming}
                    onClick={onSendRecording}
                    data-testid="button-send-recording"
                  >
                    <Send className="h-5 w-5 md:h-4 md:w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('chat.sendAudioNow')}</TooltipContent>
              </Tooltip>
            </>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={pendingMedia.length > 0 ? t('chat.placeholderWithMedia') : t('chat.placeholder')}
            className="flex-1 min-h-[40px] md:min-h-[36px] max-h-[120px] md:max-h-[200px] resize-none bg-transparent text-base md:text-sm leading-relaxed focus-visible:outline-none"
            disabled={isRecording}
            data-testid="input-chat-message"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="sentences"
          />

          {isStreaming && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  className="h-9 w-9 md:h-8 md:w-8 shrink-0 rounded-full md:rounded-md touch-manipulation"
                  onClick={onStopStreaming}
                  data-testid="button-stop-streaming"
                >
                  <Square className="h-5 w-5 md:h-4 md:w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('chat.stopGenerating')}</TooltipContent>
            </Tooltip>
          )}
          <Button
            type="button"
            size="icon"
            className="h-9 w-9 md:h-8 md:w-8 shrink-0 rounded-full md:rounded-md touch-manipulation"
            disabled={(!value.trim() && pendingMedia.length === 0) || isRecording}
            onClick={onSend}
            data-testid="button-send-message"
          >
            <Send className="h-5 w-5 md:h-4 md:w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground max-w-4xl mx-auto">
        <span>{t('chat.enterToSend')}</span>
        {isStreaming && (
          <span className="flex items-center gap-1 text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('chat.generating')}
          </span>
        )}
        {isRecording && (
          <span className="flex items-center gap-1 text-destructive">
            <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
            {t('chat.recording')}
          </span>
        )}
      </div>

      <p className="hidden md:block text-xs text-center text-muted-foreground mt-2">
        Alice pode cometer erros. Verifique informações importantes.
      </p>
    </motion.div>
  );
}
