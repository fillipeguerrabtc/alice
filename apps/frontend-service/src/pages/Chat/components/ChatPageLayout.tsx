import { type ComponentProps, type FormEvent, type RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChatConversationsSidebar } from './ChatConversationsSidebar';
import { ChatHeaderSection } from './ChatHeaderSection';
import { ChatMessagesViewport, ChatViewportNotices } from './ChatMessagesViewport';
import { ChatComposerSection } from './ChatComposerSection';
import { ChatDialogsSection } from './ChatDialogsSection';
import { WelcomeScreen } from './WelcomeScreen';
import type { AgentEvent, MediaAttachment, Message, RuntimeNotice } from './types';

type ChatActionsMenuProps = ComponentProps<typeof ChatHeaderSection>['chatActionsMenuProps'];
type ChatIdentityMenuProps = ComponentProps<typeof ChatHeaderSection>['chatIdentityMenuProps'];
type ConversationsListProps = ComponentProps<typeof ChatConversationsSidebar>['conversationsListProps'];
type ChatDialogsSectionProps = ComponentProps<typeof ChatDialogsSection>;

type ChatPageLayoutProps = {
  acceptedTypes: string;
  chatActionsMenuProps: ChatActionsMenuProps;
  chatDialogsSectionProps: ChatDialogsSectionProps;
  chatIdentityMenuProps: ChatIdentityMenuProps;
  conversationsListProps: ConversationsListProps;
  currentReasoningLabel: string;
  emptyStateHeadline: string;
  focusNonce: number;
  input: string;
  isComposerDisabled: boolean;
  isMobile: boolean;
  isRecording: boolean;
  isRecordingDisabled: boolean;
  isStreaming: boolean;
  lastResponseUsedFallback: boolean;
  messageSelectionMode: boolean;
  messages: Message[];
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  mobileDrawerOpen: boolean;
  onComposerChange: (value: string) => void;
  onFilesSelected: (files: File[]) => void;
  onFeedback: (messageId: string, isPositive: boolean) => void;
  onOpenMobileDrawer: () => void;
  onMobileDrawerOpenChange: (open: boolean) => void;
  onQuickReply: (content: string) => void;
  onRateImage: (imageId: string, score: number) => void;
  onRegenerate: () => void;
  onRemoveMedia: (id: string) => void;
  onSend: () => void;
  onSendRecording: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onStopStreaming: () => void;
  onSubmitComposer: (event: FormEvent<HTMLFormElement>) => void;
  onToggleMessageSelection: (messageId: string, index: number, shiftKey: boolean) => void;
  onToggleSidebar: () => void;
  pendingMedia: MediaAttachment[];
  runtimeNotice: RuntimeNotice | null;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  selectedMessageIds: Set<string>;
  showDesktopActionMenu: boolean;
  showLoginBanner: boolean;
  showStreamDiagnostics: boolean;
  sidebarOpen: boolean;
  streamEvents: AgentEvent[];
  streamStatusLabel: string | null;
  typingSpeedMs?: number;
};

export function ChatPageLayout({
  acceptedTypes,
  chatActionsMenuProps,
  chatDialogsSectionProps,
  chatIdentityMenuProps,
  conversationsListProps,
  currentReasoningLabel,
  emptyStateHeadline,
  focusNonce,
  input,
  isComposerDisabled,
  isMobile,
  isRecording,
  isRecordingDisabled,
  isStreaming,
  lastResponseUsedFallback,
  messageSelectionMode,
  messages,
  messagesContainerRef,
  messagesEndRef,
  mobileDrawerOpen,
  onComposerChange,
  onFilesSelected,
  onFeedback,
  onOpenMobileDrawer,
  onMobileDrawerOpenChange,
  onQuickReply,
  onRateImage,
  onRegenerate,
  onRemoveMedia,
  onSend,
  onSendRecording,
  onStartRecording,
  onStopRecording,
  onStopStreaming,
  onSubmitComposer,
  onToggleMessageSelection,
  onToggleSidebar,
  pendingMedia,
  runtimeNotice,
  scrollAreaRef,
  selectedMessageIds,
  showDesktopActionMenu,
  showLoginBanner,
  showStreamDiagnostics,
  sidebarOpen,
  streamEvents,
  streamStatusLabel,
  typingSpeedMs,
}: ChatPageLayoutProps) {
  const isEmptyStateMode = messages.length === 0;
  const showEmptyStateNotices = Boolean(runtimeNotice) || showLoginBanner;

  return (
    <div className="flex h-full bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.05),transparent_36%),linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--muted)/0.12)_100%)]">
      <ChatConversationsSidebar
        conversationsListProps={conversationsListProps}
        isMobile={isMobile}
        mobileDrawerOpen={mobileDrawerOpen}
        onMobileDrawerOpenChange={onMobileDrawerOpenChange}
        sidebarOpen={sidebarOpen}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <ChatHeaderSection
          chatActionsMenuProps={chatActionsMenuProps}
          chatIdentityMenuProps={chatIdentityMenuProps}
          isMobile={isMobile}
          onOpenMobileDrawer={onOpenMobileDrawer}
          onToggleSidebar={onToggleSidebar}
          showDesktopActionMenu={showDesktopActionMenu}
          sidebarOpen={sidebarOpen}
        />

        <AnimatePresence mode="wait" initial={false}>
          {isEmptyStateMode ? (
            <motion.div
              key="empty-state"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
              className="flex min-h-0 flex-1"
            >
              <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-3 pb-6 pt-2 md:px-6 md:pb-8 md:pt-4">
                {showEmptyStateNotices && (
                  <div className="space-y-4">
                    <ChatViewportNotices
                      runtimeNotice={runtimeNotice}
                      showLoginBanner={showLoginBanner}
                    />
                  </div>
                )}

                <div className="flex flex-1 flex-col items-center justify-center pb-10 pt-8 md:pb-14">
                  <div className="w-full space-y-6 md:space-y-8">
                    <WelcomeScreen headline={emptyStateHeadline} />
                    <ChatComposerSection
                      acceptedTypes={acceptedTypes}
                      currentReasoningLabel={currentReasoningLabel}
                      focusNonce={focusNonce}
                      isDisabled={isComposerDisabled}
                      isMobile={isMobile}
                      isRecording={isRecording}
                      isRecordingDisabled={isRecordingDisabled}
                      isStreaming={isStreaming}
                      mode="empty"
                      onChange={onComposerChange}
                      onFilesSelected={onFilesSelected}
                      onRemoveMedia={onRemoveMedia}
                      onSend={onSend}
                      onSendRecording={onSendRecording}
                      onStartRecording={onStartRecording}
                      onStopRecording={onStopRecording}
                      onStopStreaming={onStopStreaming}
                      onSubmit={onSubmitComposer}
                      pendingMedia={pendingMedia}
                      value={input}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="conversation-mode"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex min-h-0 flex-1">
                <ChatMessagesViewport
                  isStreaming={isStreaming}
                  lastResponseUsedFallback={lastResponseUsedFallback}
                  messageSelectionMode={messageSelectionMode}
                  messages={messages}
                  messagesContainerRef={messagesContainerRef}
                  messagesEndRef={messagesEndRef}
                  onFeedback={onFeedback}
                  onQuickReply={onQuickReply}
                  onRateImage={onRateImage}
                  onRegenerate={onRegenerate}
                  onToggleMessageSelection={onToggleMessageSelection}
                  scrollAreaRef={scrollAreaRef}
                  selectedMessageIds={selectedMessageIds}
                  showLoginBanner={showLoginBanner}
                  showStreamDiagnostics={showStreamDiagnostics}
                  streamEvents={streamEvents}
                  streamStatusLabel={streamStatusLabel}
                  runtimeNotice={runtimeNotice}
                  typingSpeedMs={typingSpeedMs}
                />
              </div>

              <ChatComposerSection
                acceptedTypes={acceptedTypes}
                currentReasoningLabel={currentReasoningLabel}
                focusNonce={focusNonce}
                isDisabled={isComposerDisabled}
                isMobile={isMobile}
                isRecording={isRecording}
                isRecordingDisabled={isRecordingDisabled}
                isStreaming={isStreaming}
                mode="conversation"
                onChange={onComposerChange}
                onFilesSelected={onFilesSelected}
                onRemoveMedia={onRemoveMedia}
                onSend={onSend}
                onSendRecording={onSendRecording}
                onStartRecording={onStartRecording}
                onStopRecording={onStopRecording}
                onStopStreaming={onStopStreaming}
                onSubmit={onSubmitComposer}
                pendingMedia={pendingMedia}
                value={input}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <ChatDialogsSection {...chatDialogsSectionProps} />
      </div>
    </div>
  );
}
