/**
 * ChatInput - Campo de entrada do Chat
 * 
 * Campo de texto com suporte a upload de mídia e envio de mensagens.
 * 
 * @module Chat/components/ChatInput
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Loader2, Mic, Square, Camera, Plus, FileText, Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
  focusNonce: number;
  isDisabled?: boolean;
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
  focusNonce,
  isDisabled = false,
}: ChatInputProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [userBlurred, setUserBlurred] = useState(false);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isDisabled) return;
    if (!isMobile && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [isDisabled, isMobile, onSend]);

  const adjustTextareaHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, isMobile ? 120 : 200)}px`;
    }
  }, [isMobile]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isDisabled) return;
    onChange(e.target.value);
    adjustTextareaHeight();
  }, [isDisabled, onChange, adjustTextareaHeight]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (isDisabled) return;
    const items = e.clipboardData?.items ? Array.from(e.clipboardData.items) : [];
    if (items.length === 0) return;
    const imageFiles = items
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (imageFiles.length > 0) {
      e.preventDefault();
      onFilesSelected(imageFiles);
    }
  }, [onFilesSelected]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [adjustTextareaHeight, value]);

  useEffect(() => {
    if (!isRecording && !isDisabled) {
      textareaRef.current?.focus();
    }
  }, [isRecording, isDisabled]);

  useEffect(() => {
    if (!userBlurred && !isRecording && !isDisabled) {
      textareaRef.current?.focus();
    }
  }, [isRecording, userBlurred, value, isDisabled]);

  useEffect(() => {
    if (!userBlurred && !isRecording && !isDisabled) {
      textareaRef.current?.focus();
    }
  }, [focusNonce, isRecording, userBlurred, isDisabled]);

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

      <div className="flex gap-2 max-w-3xl mx-auto">
        <div
          ref={containerRef}
          className="flex flex-1 items-end gap-1.5 rounded-[1.6rem] border border-border/60 bg-background/90 p-1.5 shadow-[0_20px_48px_-32px_rgba(15,23,42,0.55)] backdrop-blur-xl"
        >
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
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileChange}
            data-testid="input-gallery-upload"
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

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 rounded-full text-muted-foreground touch-manipulation"
                    disabled={isRecording || isDisabled}
                    data-testid="button-attach-menu"
                  >
                    <Plus className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('chat.attachMenu')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="min-w-[220px] rounded-2xl border-border/60 bg-background/95 p-2 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.55)] backdrop-blur-xl">
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  if (isDisabled) return;
                  cameraInputRef.current?.click();
                }}
                disabled={isDisabled}
              >
                <Camera className="mr-2 h-4 w-4" />
                {t('chat.openCamera')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  if (isDisabled) return;
                  galleryInputRef.current?.click();
                }}
                disabled={isDisabled}
              >
                <ImageIcon className="mr-2 h-4 w-4" />
                {t('chat.attachGallery')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  if (isDisabled) return;
                  fileInputRef.current?.click();
                }}
                disabled={isDisabled}
              >
                <FileText className="mr-2 h-4 w-4" />
                {t('chat.attachFile')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setUserBlurred(false)}
            onBlur={(event) => {
              const nextTarget = event.relatedTarget as Node | null;
              if (nextTarget && containerRef.current?.contains(nextTarget)) {
                setUserBlurred(false);
                requestAnimationFrame(() => textareaRef.current?.focus());
                return;
              }
              setUserBlurred(true);
            }}
            placeholder={pendingMedia.length > 0 ? t('chat.placeholderWithMedia') : t('chat.placeholder')}
            className="flex-1 min-h-[40px] max-h-[120px] resize-none bg-transparent px-1 text-sm leading-relaxed text-foreground focus-visible:outline-none md:max-h-[200px]"
            disabled={isRecording || isDisabled}
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
                  className="h-9 w-9 shrink-0 rounded-full touch-manipulation"
                  onClick={onStopStreaming}
                  data-testid="button-stop-streaming"
                >
                  <Square className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('chat.stopGenerating')}</TooltipContent>
            </Tooltip>
          )}
          {!isRecording ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-full text-muted-foreground touch-manipulation"
                  disabled={isRecordingDisabled || isDisabled}
                  onClick={onStartRecording}
                  data-testid="button-record-audio"
                >
                  <Mic className="h-5 w-5" />
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
                    className="h-9 w-9 shrink-0 rounded-full touch-manipulation"
                    disabled={isStreaming || isDisabled}
                    onClick={onStopRecording}
                    data-testid="button-stop-recording"
                >
                    <Square className="h-5 w-5" />
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
                    className="h-9 w-9 shrink-0 rounded-full touch-manipulation"
                    disabled={isStreaming || isDisabled}
                    onClick={onSendRecording}
                    data-testid="button-send-recording"
                >
                    <Send className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('chat.sendAudioNow')}</TooltipContent>
              </Tooltip>
            </>
          )}
          <Button
            type="button"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full touch-manipulation"
            disabled={isDisabled || (!value.trim() && pendingMedia.length === 0) || isRecording}
            onClick={onSend}
            data-testid="button-send-message"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {(isStreaming || isRecording) && (
        <div className="mt-2 flex items-center justify-end text-xs text-muted-foreground max-w-4xl mx-auto">
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
      )}

      <p className="mt-2 hidden text-center text-xs text-muted-foreground md:block">
        Alice pode cometer erros. Verifique informações importantes.
      </p>
    </motion.div>
  );
}
