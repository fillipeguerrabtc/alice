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
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { AgentEvent, Message } from './types';
import { InlineImage } from './InlineImage';
import { InlineMediaAttachment } from './InlineMediaAttachment';
import { MessageActions } from './MessageActions';
import { ActionResultCard } from './ActionResultCard';
import { BiometricCapture } from '@/components/biometrics/BiometricCapture';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
// AudioPlayer disponível via InlineMediaAttachment quando necessário
// REMOVIDO 23/12/2025: VideoPlayer desabilitado (muito pesado para GPU)

/** Número máximo de stream events exibidos simultaneamente no painel de progresso */
const MAX_VISIBLE_STREAM_EVENTS = 8;

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
  onQuickReply?: (content: string) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (shiftKey: boolean) => void;
}

export function MessageBubble({ 
  message, 
  isStreaming, 
  isLast,
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
  const [displayedContent, setDisplayedContent] = useState(message.content ?? '');
  const [biometricOpen, setBiometricOpen] = useState(false);
  const [biometricPending, setBiometricPending] = useState(false);
  const [passwordApproval, setPasswordApproval] = useState('');
  const [biometricStatus, setBiometricStatus] = useState<{ enrolled?: boolean } | null>(null);
  const [biometricStatusLoading, setBiometricStatusLoading] = useState(false);
  const latestTargetRef = useRef(message.content ?? '');
  const displayedContentRef = useRef(displayedContent);
  const isUser = message.role === 'user';
  const canSelect = selectionMode && message.role !== 'system';
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
  const typingIntervalMs = Math.min(5000, Math.max(100, typingSpeedMs ?? 100));
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

  const shouldShowTypingCursor = isLast && message.role === 'assistant' && (isStreaming || displayedContent.length < (message.content ?? '').length);
  const shouldShowThinking = shouldShowTypingCursor && displayedContent.trim().length === 0;
  const hasStreamEvents = Boolean(streamEvents && streamEvents.length > 0);
  const requiresConfirmation = Boolean(message.metadata?.requiresConfirmation);
  const shouldShowActionCard = Boolean(message.metadata?.actionType || message.metadata?.actionStatus || message.metadata?.actionResult);

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
            {/* Painel de etapas: visível durante todo o streaming (tokens + status lado a lado) */}
            {isLast && isStreaming && message.role === 'assistant' && hasStreamEvents && (
              <div className="space-y-0.5 text-xs text-muted-foreground mb-2">
                {streamEvents.slice(-MAX_VISIBLE_STREAM_EVENTS).map((ev) => (
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
              </div>
            )}
            {shouldShowThinking && !hasStreamEvents ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
                {t('chat.thinking')}
              </span>
            ) : displayedContent}
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

          {shouldShowActionCard && (
            <ActionResultCard
              actionType={message.metadata?.actionType as string | undefined}
              actionOperation={message.metadata?.actionOperation as string | undefined}
              actionSummary={message.metadata?.actionSummary as string | undefined}
              actionStatus={message.metadata?.actionStatus as string | undefined}
              actionResult={message.metadata?.actionResult as Record<string, unknown> | undefined}
            />
          )}
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
                <BiometricCapture
                  autoStart={true}
                  onCapture={handleBiometricCapture}
                  onError={(message) => {
                    toast({ title: 'Falha na câmera', description: message, variant: 'destructive' });
                  }}
                />
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
