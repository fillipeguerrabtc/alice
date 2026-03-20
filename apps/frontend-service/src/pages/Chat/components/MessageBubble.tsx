/**
 * MessageBubble - Bolha de mensagem individual do chat
 * 
 * Suporta mensagens de texto, mídia e imagens geradas.
 * 
 * @module Chat/components/MessageBubble
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Copy, Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { AgentEvent, Message, MessageSources } from './types';
import { InlineImage } from './InlineImage';
import { InlineMediaAttachment } from './InlineMediaAttachment';
import { MessageActions } from './MessageActions';
import { ActionResultCard } from './ActionResultCard';
import { SourcesCard } from './SourcesCard';
import { BiometricCapture } from '@/components/biometrics/BiometricCapture';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
// AudioPlayer disponível via InlineMediaAttachment quando necessário
// REMOVIDO 23/12/2025: VideoPlayer desabilitado (muito pesado para GPU)

/** Número máximo de stream events exibidos simultaneamente no painel de progresso */
const MAX_VISIBLE_STREAM_EVENTS = 8;
const THINK_OPEN_TAG = '<think>';
const THINK_CLOSE_TAG = '</think>';
const THINKING_DISPLAY_LINES = 3;

type ParsedThinkingContent = {
  visibleContent: string;
  thinkingLines: string[];
};

function parseThinkingContent(rawContent: string): ParsedThinkingContent {
  if (!rawContent || rawContent.length === 0) {
    return {
      visibleContent: '',
      thinkingLines: [],
    };
  }

  let cursor = 0;
  let visibleContent = '';
  const thinkingParts: string[] = [];

  while (cursor < rawContent.length) {
    const openIndex = rawContent.indexOf(THINK_OPEN_TAG, cursor);
    if (openIndex === -1) {
      visibleContent += rawContent.slice(cursor);
      break;
    }

    visibleContent += rawContent.slice(cursor, openIndex);
    const thinkingStart = openIndex + THINK_OPEN_TAG.length;
    const closeIndex = rawContent.indexOf(THINK_CLOSE_TAG, thinkingStart);
    if (closeIndex === -1) {
      thinkingParts.push(rawContent.slice(thinkingStart));
      cursor = rawContent.length;
      break;
    }

    thinkingParts.push(rawContent.slice(thinkingStart, closeIndex));
    cursor = closeIndex + THINK_CLOSE_TAG.length;
  }

  const normalizedVisible = visibleContent
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const normalizedThinkingLines = thinkingParts
    .join('\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);

  return {
    visibleContent: normalizedVisible,
    thinkingLines: normalizedThinkingLines,
  };
}

function buildThinkingDisplayLines(lines: string[], slotCount: number): string[] {
  if (slotCount <= 0) return [];
  if (lines.length === 0) {
    return Array.from({ length: slotCount }, () => '');
  }

  // Ao fechar um bloco de 3 linhas, limpa o painel e reinicia o streaming
  // do Thinking sem misturar conteúdo novo com linhas antigas.
  const batchStart = Math.floor((lines.length - 1) / slotCount) * slotCount;
  const visibleLines = lines.slice(batchStart, batchStart + slotCount);
  return Array.from({ length: slotCount }, (_, index) => visibleLines[index] ?? '');
}

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
  streamStatusLabel?: string | null;
  showStreamDiagnostics?: boolean;
  streamEvents?: AgentEvent[] | null;
  typingSpeedMs?: number;
  onRateImage?: (imageId: string, score: number) => void;
  onFeedback?: (messageId: string, isPositive: boolean) => void;
  onRegenerate?: () => void;
  onQuickReply?: (content: string) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (shiftKey: boolean) => void;
}

export function MessageBubble({ 
  message, 
  isStreaming, 
  isLast,
  streamStatusLabel = null,
  showStreamDiagnostics = false,
  streamEvents,
  typingSpeedMs,
  onRateImage,
  onFeedback,
  onRegenerate,
  onQuickReply,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [renderedText, setRenderedText] = useState(message.content ?? '');
  const [biometricOpen, setBiometricOpen] = useState(false);
  const [biometricPending, setBiometricPending] = useState(false);
  const [passwordApproval, setPasswordApproval] = useState('');
  const [biometricStatus, setBiometricStatus] = useState<{ enrolled?: boolean } | null>(null);
  const [biometricStatusLoading, setBiometricStatusLoading] = useState(false);
  const [streamDetailsOpen, setStreamDetailsOpen] = useState(false);
  const fullTextRef = useRef(message.content ?? '');
  const renderedTextRef = useRef(renderedText);
  const isUser = message.role === 'user';
  const canSelect = selectionMode && message.role !== 'system';
  const hasMediaAttachments = Boolean(message.mediaAttachments && message.mediaAttachments.length > 0);
  const hasTextContent = Boolean(message.content && message.content.trim().length > 0);
  const hasGeneratedImage = Boolean(message.generatedImage);
  const isMediaOnly = hasMediaAttachments && !hasTextContent && !hasGeneratedImage;
  const assistantDisplayName = message.agent?.preferredName?.trim() || message.agent?.nome?.trim() || t('chat.agent.fallbackName');
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
  const typingIntervalMs = Math.min(5000, Math.max(1, typingSpeedMs ?? 12));
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
    const fullText = message.content ?? '';
    fullTextRef.current = fullText;

    renderedTextRef.current = renderedText;
    const isAssistantLast = isLast && message.role === 'assistant';
    if (!isAssistantLast) {
      setRenderedText(fullText);
      renderedTextRef.current = fullText;
      return;
    }

    // Se o conteúdo foi reescrito (não é prefixo do anterior), sincroniza imediatamente
    if (!fullText.startsWith(renderedText) || fullText.length < renderedText.length) {
      setRenderedText(fullText);
      renderedTextRef.current = fullText;
      return;
    }

    const shouldAnimate = !isStreaming && renderedText.length < fullText.length;
    if (!shouldAnimate) {
      setRenderedText(fullText);
      return;
    }

    let rafId: number | null = null;
    let lastTick = 0;

    const stepTyping = (timestamp: number) => {
      const currentTarget = fullTextRef.current;
      if (timestamp - lastTick < typingIntervalMs) {
        rafId = window.requestAnimationFrame(stepTyping);
        return;
      }
      lastTick = timestamp;
      setRenderedText((prev) => {
        let next = prev;
        if (!currentTarget.startsWith(prev)) {
          next = currentTarget;
        } else if (prev.length < currentTarget.length) {
          next = currentTarget.slice(0, prev.length + 1);
        }
        renderedTextRef.current = next;
        return next;
      });
      const hasPendingChars = renderedTextRef.current.length < fullTextRef.current.length;
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
  }, [isLast, isStreaming, message.content, message.role, renderedText, typingIntervalMs]);

  useEffect(() => {
    if (!isStreaming) {
      setStreamDetailsOpen(false);
    }
  }, [isStreaming, message.id]);

  const handleOpenBiometricApproval = async () => {
    setBiometricOpen(true);
    setBiometricStatusLoading(true);
    try {
      const response = await apiRequest('POST', '/api/auth/biometrics/status');
      const status = await response.json();
      setBiometricStatus(status);
    } catch (error) {
      toast({
        title: 'Falha ao verificar biometria',
        description: error instanceof Error ? error.message : 'Não foi possível validar o status da biometria.',
        variant: 'destructive',
      });
      setBiometricStatus(null);
    } finally {
      setBiometricStatusLoading(false);
    }
  };

  const handleBiometricCapture = async (imageBase64: string) => {
    if (biometricStatus && biometricStatus.enrolled === false) {
      toast({
        title: 'Biometria não cadastrada',
        description: 'Cadastre a biometria nas configurações para usar esta opção.',
        variant: 'destructive',
      });
      return;
    }
    try {
      setBiometricPending(true);
      const response = await apiRequest('POST', '/api/auth/biometrics/verify', {
        imageBase64,
        actionType: 'approval',
        actionContext: {
          actionRequestId: message.metadata?.actionRequestId,
        },
      });
      const result = await response.json();
      if (!result?.match) {
        toast({
          title: 'Biometria não reconhecida',
          description: 'Não foi possível confirmar sua identidade.',
          variant: 'destructive',
        });
        return;
      }
      setBiometricOpen(false);
      onQuickReply?.('confirmar');
    } catch (error) {
      toast({
        title: 'Falha na verificação biométrica',
        description: error instanceof Error ? error.message : 'Erro ao validar biometria.',
        variant: 'destructive',
      });
    } finally {
      setBiometricPending(false);
    }
  };

  const handlePasswordApproval = async () => {
    if (!passwordApproval.trim()) {
      toast({
        title: 'Senha obrigatória',
        description: 'Informe sua senha para aprovar.',
        variant: 'destructive',
      });
      return;
    }
    try {
      setBiometricPending(true);
      await apiRequest('POST', '/api/auth/verify-password', {
        password: passwordApproval,
        actionContext: {
          actionRequestId: message.metadata?.actionRequestId,
        },
      });
      setBiometricOpen(false);
      setPasswordApproval('');
      onQuickReply?.('confirmar');
    } catch (error) {
      toast({
        title: 'Senha inválida',
        description: error instanceof Error ? error.message : 'Não foi possível validar a senha.',
        variant: 'destructive',
      });
    } finally {
      setBiometricPending(false);
    }
  };

  const shouldShowTypingCursor = isLast && message.role === 'assistant' && (isStreaming || renderedText.length < (message.content ?? '').length);
  const hasStreamEvents = Boolean(streamEvents && streamEvents.length > 0);
  const requiresConfirmation = Boolean(message.metadata?.requiresConfirmation);
  const shouldShowActionCard = Boolean(message.metadata?.actionType || message.metadata?.actionStatus || message.metadata?.actionResult);
  const messageSources = (message.metadata?.sources as MessageSources | undefined) ?? undefined;
  const parsedRenderedContent = parseThinkingContent(renderedText);
  const parsedMessageContent = parseThinkingContent(message.content ?? '');
  const thinkingDisplayLines = buildThinkingDisplayLines(parsedRenderedContent.thinkingLines, THINKING_DISPLAY_LINES);
  const shouldShowThinkingBox = !isUser && isLast && isStreaming && parsedRenderedContent.thinkingLines.length > 0;

  // Se há actionResult no metadata, exibir apenas o resumo humano; suprimir JSON bruto no texto
  const sanitizedDisplayContent = (() => {
    const displayContent = parsedRenderedContent.visibleContent;
    if (!shouldShowActionCard || !displayContent) return displayContent;
    const trimmed = displayContent.trim();
    // Detectar JSON bruto via tentativa de parse; apenas suprimir objetos/arrays válidos
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length > 2) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) {
          return '';
        }
      } catch {
        // Não é JSON válido — manter conteúdo original
      }
    }
    return displayContent;
  })();
  const shouldShowStreamingPlaceholder = shouldShowTypingCursor && sanitizedDisplayContent.trim().length === 0;

  return (
    <motion.div
      variants={messageVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={cn(
        'group flex w-full min-w-0 gap-3 overflow-x-hidden',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {canSelect && (
        <div className={cn('flex items-start pt-2', isUser ? 'order-2' : 'order-none')}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => undefined}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelect?.(event.shiftKey);
            }}
            aria-label={t('chat.selection.selectMessage')}
          />
        </div>
      )}
      {!isUser && (
        <div className="flex shrink-0 flex-col items-center gap-1">
          <Avatar className="h-12 w-12 shadow-sm">
            <AvatarImage src={assistantAvatarSrc} alt={assistantDisplayName} />
            <AvatarFallback>{assistantDisplayName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-[11px] text-muted-foreground">{assistantDisplayName}</span>
        </div>
      )}
      
      <div className={cn(
        'flex min-w-0 flex-1 flex-col',
        isUser ? 'items-end' : 'items-start'
      )}>
        <Card
          className={cn(
            'w-fit max-w-full min-w-0 overflow-hidden p-3 shadow-sm transition-all',
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

          {!isUser && isLast && isStreaming && streamStatusLabel && (
            <p className="mb-1 text-[11px] text-muted-foreground">{streamStatusLabel}</p>
          )}

          {shouldShowThinkingBox && (
            <div className="mb-2 overflow-hidden rounded-md border border-border/70 bg-background/50 p-2">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {t('chat.streaming.thinking')}
              </p>
              <div className="space-y-1 font-mono text-[11px] leading-4 text-muted-foreground">
                {thinkingDisplayLines.map((line, index) => (
                  <p
                    key={`${message.id}-thinking-${index}`}
                    className="h-4 truncate pr-2"
                  >
                    {line || ' '}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-wrap-anywhere min-h-[1.25rem] min-w-0 whitespace-pre-wrap break-words text-sm leading-relaxed">
            {sanitizedDisplayContent}
            {shouldShowStreamingPlaceholder && <span className="sr-only">{t('chat.thinking')}</span>}
            {shouldShowTypingCursor && (
              <span className="ml-0.5 inline-block animate-pulse align-middle text-base leading-none">▍</span>
            )}
          </div>

          {showStreamDiagnostics && isLast && isStreaming && message.role === 'assistant' && hasStreamEvents && (
            <Collapsible
              open={streamDetailsOpen}
              onOpenChange={setStreamDetailsOpen}
              className="mt-2 rounded-md border border-border/60 p-2"
            >
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-full justify-between px-2 text-xs">
                  Detalhes do stream
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', streamDetailsOpen && 'rotate-180')} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-1 text-xs text-muted-foreground">
                {(streamEvents ?? []).slice(-MAX_VISIBLE_STREAM_EVENTS).map((ev) => (
                  <div key={ev.id} className="flex items-center gap-1.5">
                    <span className={cn(
                      'inline-block h-1.5 w-1.5 rounded-full shrink-0',
                      ev.status === 'success' ? 'bg-green-500' :
                      ev.status === 'error' ? 'bg-red-500' :
                      ev.status === 'in_progress' ? 'bg-yellow-500 animate-pulse' :
                      'bg-muted-foreground/50'
                    )} />
                    <span className="truncate">{ev.message ?? ev.action}</span>
                    {ev.durationMs != null && (
                      <span className="shrink-0 text-muted-foreground/60">{ev.durationMs}ms</span>
                    )}
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}

          {message.generatedImage && (
            <div className={cn(message.content && "mt-3")}>
              <InlineImage 
                image={message.generatedImage} 
                onRate={onRateImage ? (score) => onRateImage(message.generatedImage!.id, score) : undefined}
              />
            </div>
          )}

          {shouldShowActionCard && (
            <ActionResultCard
              actionType={message.metadata?.actionType as string | undefined}
              actionOperation={message.metadata?.actionOperation as string | undefined}
              actionSummary={message.metadata?.actionSummary as string | undefined}
              actionStatus={message.metadata?.actionStatus as string | undefined}
              actionResult={message.metadata?.actionResult as Record<string, unknown> | undefined}
            />
          )}

          {messageSources && <SourcesCard sources={messageSources} />}
        </Card>

        {!isUser && requiresConfirmation && (
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={handleOpenBiometricApproval}
            >
              Aprovar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onQuickReply?.('cancelar')}
            >
              Rejeitar
            </Button>
          </div>
        )}

        <Dialog open={biometricOpen} onOpenChange={setBiometricOpen}>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle>Aprovação segura</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Escolha uma forma de aprovação. Você pode usar senha ou biometria.
              </p>
              <div className="space-y-2 rounded border p-3">
                <div className="text-xs font-semibold uppercase text-muted-foreground">Aprovar com senha</div>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="Sua senha"
                    value={passwordApproval}
                    onChange={(event) => setPasswordApproval(event.target.value)}
                  />
                  <Button onClick={handlePasswordApproval} disabled={biometricPending}>
                    Aprovar
                  </Button>
                </div>
              </div>
              <div className="space-y-2 rounded border p-3">
                <div className="text-xs font-semibold uppercase text-muted-foreground">Aprovar com biometria</div>
                {biometricStatusLoading && (
                  <p className="text-xs text-muted-foreground">Verificando status da biometria...</p>
                )}
                {!biometricStatusLoading && biometricStatus && !biometricStatus.enrolled && (
                  <p className="text-xs text-amber-600">
                    Biometria não cadastrada. Cadastre nas configurações para usar esta opção.
                  </p>
                )}
                {biometricOpen && (
                <BiometricCapture
                  autoStart={true}
                  onCapture={handleBiometricCapture}
                  onError={(message) => {
                    toast({ title: 'Falha na câmera', description: message, variant: 'destructive' });
                  }}
                />
                )}
              </div>
              {biometricPending && (
                <p className="text-xs text-muted-foreground">Validando aprovação...</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
        
        <div className={cn(
          'flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity',
          isUser ? 'flex-row-reverse' : ''
        )}>
          {!isUser ? (
            // Mensagens do assistente: usar MessageActions (inclui copiar, regenerar, feedback)
            <MessageActions
              content={parsedMessageContent.visibleContent}
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
