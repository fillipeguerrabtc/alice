import { type RefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Info } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { MessageBubble } from './MessageBubble';
import type { AgentEvent, Message, RuntimeNotice } from './types';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
} as const;

type ChatMessagesViewportProps = {
  isStreaming: boolean;
  lastResponseUsedFallback: boolean;
  messageSelectionMode: boolean;
  messages: Message[];
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onFeedback: (messageId: string, isPositive: boolean) => void;
  onQuickReply: (content: string) => void;
  onRateImage: (imageId: string, score: number) => void;
  onRegenerate: () => void;
  onToggleMessageSelection: (messageId: string, index: number, shiftKey: boolean) => void;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  selectedMessageIds: Set<string>;
  showLoginBanner: boolean;
  showStreamDiagnostics: boolean;
  streamEvents: AgentEvent[];
  streamStatusLabel: string | null;
  runtimeNotice: RuntimeNotice | null;
  typingSpeedMs?: number;
};

type ChatViewportNoticesProps = Pick<
  ChatMessagesViewportProps,
  | 'runtimeNotice'
  | 'showLoginBanner'
>;

export function ChatViewportNotices({
  showLoginBanner,
  runtimeNotice,
}: ChatViewportNoticesProps) {
  const { t } = useTranslation();
  const isRuntimeRestored = runtimeNotice?.code === 'serving_restored';
  const runtimeNoticeTitleKey = isRuntimeRestored
    ? 'chat.runtimeNotice.restored.title'
    : 'chat.runtimeNotice.interruption.title';
  const runtimeNoticeDescriptionKey = isRuntimeRestored
    ? 'chat.runtimeNotice.restored.description'
    : 'chat.runtimeNotice.interruption.description';

  return (
    <>
      {runtimeNotice && (
        <Alert
          variant="default"
          className={`rounded-2xl ${isRuntimeRestored ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-amber-500/50 bg-amber-500/10'}`}
        >
          {isRuntimeRestored ? (
            <Info className="h-4 w-4 text-emerald-700" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          )}
          <AlertTitle>{t(runtimeNoticeTitleKey)}</AlertTitle>
          <AlertDescription>{t(runtimeNoticeDescriptionKey)}</AlertDescription>
        </Alert>
      )}
      {showLoginBanner && (
        <Alert variant="default" className="rounded-2xl border-amber-500/50 bg-amber-500/10">
          <Info className="h-4 w-4 text-amber-600" />
          <AlertTitle>Faça login para chat em tempo real</AlertTitle>
          <AlertDescription>
            Usuários anônimos não iniciam WebSocket nem streaming. Entre com sua conta para conversar em tempo real.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

export function ChatMessagesViewport({
  isStreaming,
  lastResponseUsedFallback,
  messageSelectionMode,
  messages,
  messagesContainerRef,
  messagesEndRef,
  onFeedback,
  onQuickReply,
  onRateImage,
  onRegenerate,
  onToggleMessageSelection,
  scrollAreaRef,
  selectedMessageIds,
  showLoginBanner,
  showStreamDiagnostics,
  streamEvents,
  streamStatusLabel,
  runtimeNotice,
  typingSpeedMs,
}: ChatMessagesViewportProps) {
  const { t } = useTranslation();
  const showViewportNotices = Boolean(runtimeNotice) || showLoginBanner;

  return (
    <ScrollArea ref={scrollAreaRef} className="flex-1 min-w-0 overflow-x-hidden">
      <div
        ref={messagesContainerRef}
        className="mx-auto min-h-full w-full max-w-3xl min-w-0 overflow-x-hidden px-3 pb-6 pt-4 md:px-6 md:pb-8 md:pt-6"
      >
        {showViewportNotices && (
          <div className="mb-4 space-y-4">
            <ChatViewportNotices
              runtimeNotice={runtimeNotice}
              showLoginBanner={showLoginBanner}
            />
          </div>
        )}
        <AnimatePresence mode="popLayout">
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="mx-auto w-full min-w-0 space-y-4"
          >
            {messages.map((message, index) => (
              <MessageBubble
                key={message.id}
                message={message}
                isStreaming={isStreaming}
                isLast={index === messages.length - 1}
                showStreamDiagnostics={showStreamDiagnostics}
                streamEvents={showStreamDiagnostics && isStreaming && index === messages.length - 1 ? streamEvents : null}
                streamStatusLabel={isStreaming && index === messages.length - 1 && message.role === 'assistant' ? streamStatusLabel : null}
                typingSpeedMs={typingSpeedMs}
                onRateImage={onRateImage}
                onFeedback={onFeedback}
                onRegenerate={onRegenerate}
                onQuickReply={onQuickReply}
                selectionMode={messageSelectionMode}
                isSelected={selectedMessageIds.has(message.id)}
                onToggleSelect={(shiftKey) => onToggleMessageSelection(message.id, index, shiftKey)}
              />
            ))}
            {lastResponseUsedFallback && messages.length > 0 && (
              <Alert variant="default" className="mt-4 rounded-2xl border-amber-500/50 bg-amber-500/10">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertTitle>{t('chat.fallbackBanner.title')}</AlertTitle>
                <AlertDescription>{t('chat.fallbackBanner.desc')}</AlertDescription>
              </Alert>
            )}
          </motion.div>
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
  );
}
