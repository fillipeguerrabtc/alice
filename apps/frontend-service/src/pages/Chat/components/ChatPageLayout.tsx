import { type ComponentProps, type FormEvent, type RefObject } from 'react';
import type { ChatWorkspaceKey } from '../chat-page-routing';
import { ChatConversationsSidebar } from './ChatConversationsSidebar';
import { ChatHeaderSection } from './ChatHeaderSection';
import { ChatWorkspaceSection } from './ChatWorkspaceSection';
import { ChatMessagesViewport } from './ChatMessagesViewport';
import { ChatComposerSection } from './ChatComposerSection';
import { ChatDialogsSection } from './ChatDialogsSection';
import type { AgentEvent, MediaAttachment, Message, RuntimeNotice } from './types';

type ChatActionsMenuProps = ComponentProps<typeof ChatHeaderSection>['chatActionsMenuProps'];
type ChatGovernanceControlsProps = ComponentProps<typeof ChatHeaderSection>['chatGovernanceControlsProps'];
type ConversationsListProps = ComponentProps<typeof ChatConversationsSidebar>['conversationsListProps'];
type ChatDialogsSectionProps = ComponentProps<typeof ChatDialogsSection>;
type WorkspaceOption = ComponentProps<typeof ChatWorkspaceSection>['workspaceOptions'][number];
type WorkspaceHint = ComponentProps<typeof ChatMessagesViewport>['workspaceHint'];

type ChatPageLayoutProps = {
  acceptedTypes: string;
  activeWorkspace: ChatWorkspaceKey;
  chatActionsMenuProps: ChatActionsMenuProps;
  chatDialogsSectionProps: ChatDialogsSectionProps;
  chatGovernanceControlsProps: ChatGovernanceControlsProps;
  conversationId?: string;
  conversationsListProps: ConversationsListProps;
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
  modelBadgeLabel: string;
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
  onWorkspaceChange: (workspace: ChatWorkspaceKey) => void;
  pendingMedia: MediaAttachment[];
  runtimeNotice: RuntimeNotice | null;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  selectedMessageIds: Set<string>;
  showConversationWorkspaceHint: boolean;
  showDesktopActionMenu: boolean;
  showLoginBanner: boolean;
  showStreamDiagnostics: boolean;
  sidebarOpen: boolean;
  streamEvents: AgentEvent[];
  streamStatusLabel: string | null;
  typingSpeedMs?: number;
  workspaceHint: WorkspaceHint;
  workspaceOptions: WorkspaceOption[];
};

export function ChatPageLayout({
  acceptedTypes,
  activeWorkspace,
  chatActionsMenuProps,
  chatDialogsSectionProps,
  chatGovernanceControlsProps,
  conversationId,
  conversationsListProps,
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
  modelBadgeLabel,
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
  onWorkspaceChange,
  pendingMedia,
  runtimeNotice,
  scrollAreaRef,
  selectedMessageIds,
  showConversationWorkspaceHint,
  showDesktopActionMenu,
  showLoginBanner,
  showStreamDiagnostics,
  sidebarOpen,
  streamEvents,
  streamStatusLabel,
  typingSpeedMs,
  workspaceHint,
  workspaceOptions,
}: ChatPageLayoutProps) {
  return (
    <div className="flex h-full">
      <ChatConversationsSidebar
        conversationsListProps={conversationsListProps}
        isMobile={isMobile}
        mobileDrawerOpen={mobileDrawerOpen}
        onMobileDrawerOpenChange={onMobileDrawerOpenChange}
        sidebarOpen={sidebarOpen}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <ChatHeaderSection
          chatActionsMenuProps={chatActionsMenuProps}
          chatGovernanceControlsProps={chatGovernanceControlsProps}
          conversationId={conversationId}
          isMobile={isMobile}
          modelBadgeLabel={modelBadgeLabel}
          onOpenMobileDrawer={onOpenMobileDrawer}
          onToggleSidebar={onToggleSidebar}
          showDesktopActionMenu={showDesktopActionMenu}
          sidebarOpen={sidebarOpen}
        />

        <ChatWorkspaceSection
          activeWorkspace={activeWorkspace}
          onWorkspaceChange={onWorkspaceChange}
          workspaceOptions={workspaceOptions}
        />

        <div className="flex-1 flex min-h-0">
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
            showConversationWorkspaceHint={showConversationWorkspaceHint}
            showLoginBanner={showLoginBanner}
            showStreamDiagnostics={showStreamDiagnostics}
            streamEvents={streamEvents}
            streamStatusLabel={streamStatusLabel}
            runtimeNotice={runtimeNotice}
            typingSpeedMs={typingSpeedMs}
            workspaceHint={workspaceHint}
          />
        </div>

        <ChatComposerSection
          acceptedTypes={acceptedTypes}
          focusNonce={focusNonce}
          isDisabled={isComposerDisabled}
          isMobile={isMobile}
          isRecording={isRecording}
          isRecordingDisabled={isRecordingDisabled}
          isStreaming={isStreaming}
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

        <ChatDialogsSection {...chatDialogsSectionProps} />
      </div>
    </div>
  );
}
