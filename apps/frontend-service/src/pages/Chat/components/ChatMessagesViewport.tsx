import { type RefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Info } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { MessageBubble } from './MessageBubble';
import { WelcomeScreen } from './WelcomeScreen';
import type { AgentEvent, Message } from './types';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
} as const;

type WorkspaceHint = {
  title: string;
  description: string;
};

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
  showConversationWorkspaceHint: boolean;
  showLoginBanner: boolean;
  showStreamDiagnostics: boolean;
  streamEvents: AgentEvent[];
  streamStatusLabel: string | null;
  typingSpeedMs?: number;
  workspaceHint: WorkspaceHint | null;
};

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
  showConversationWorkspaceHint,
  showLoginBanner,
  showStreamDiagnostics,
  streamEvents,
  streamStatusLabel,
  typingSpeedMs,
  workspaceHint,
}: ChatMessagesViewportProps) {
  const { t } = useTranslation();

  return (
    <ScrollArea ref={scrollAreaRef} className="flex-1 p-2 md:p-4">
      <div ref={messagesContainerRef} className="min-h-full">
        {showConversationWorkspaceHint && workspaceHint && (
          <Alert className="mb-3">
            <Info className="h-4 w-4" />
            <AlertTitle>{workspaceHint.title}</AlertTitle>
            <AlertDescription>{workspaceHint.description}</AlertDescription>
          </Alert>
        )}
        {showLoginBanner && (
          <Alert variant="default" className="mb-3 border-amber-500/50 bg-amber-500/10">
            <Info className="h-4 w-4 text-amber-600" />
            <AlertTitle>Faça login para chat em tempo real</AlertTitle>
            <AlertDescription>
              Usuários anônimos não iniciam WebSocket nem streaming. Entre com sua conta para conversar em tempo real.
            </AlertDescription>
          </Alert>
        )}
        <AnimatePresence mode="popLayout">
          {messages.length === 0 ? (
            <WelcomeScreen />
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="space-y-3 md:space-y-4 max-w-4xl mx-auto"
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
                <Alert variant="default" className="mt-3 border-amber-500/50 bg-amber-500/10">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertTitle>{t('chat.fallbackBanner.title')}</AlertTitle>
                  <AlertDescription>{t('chat.fallbackBanner.desc')}</AlertDescription>
                </Alert>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
  );
}
