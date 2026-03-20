import type { ComponentProps } from 'react';
import { ChatPageLayout } from './components/ChatPageLayout';

type ChatPageLayoutProps = ComponentProps<typeof ChatPageLayout>;

type ChatPageLayoutSections = Pick<
  ChatPageLayoutProps,
  | 'chatActionsMenuProps'
  | 'chatDialogsSectionProps'
  | 'chatIdentityMenuProps'
  | 'conversationsListProps'
>;

type ChatPageLayoutState = Pick<
  ChatPageLayoutProps,
  | 'acceptedTypes'
  | 'currentReasoningLabel'
  | 'emptyStateHeadline'
  | 'focusNonce'
  | 'input'
  | 'isComposerDisabled'
  | 'isMobile'
  | 'isRecording'
  | 'isRecordingDisabled'
  | 'isStreaming'
  | 'lastResponseUsedFallback'
  | 'messageSelectionMode'
  | 'mobileDrawerOpen'
  | 'pendingMedia'
  | 'runtimeNotice'
  | 'showDesktopActionMenu'
  | 'showLoginBanner'
  | 'showStreamDiagnostics'
  | 'sidebarOpen'
  | 'streamEvents'
  | 'streamStatusLabel'
  | 'typingSpeedMs'
>;

type ChatPageLayoutViewport = Pick<
  ChatPageLayoutProps,
  | 'messages'
  | 'messagesContainerRef'
  | 'messagesEndRef'
  | 'scrollAreaRef'
  | 'selectedMessageIds'
>;

type ChatPageLayoutHandlers = Pick<
  ChatPageLayoutProps,
  | 'onComposerChange'
  | 'onFeedback'
  | 'onFilesSelected'
  | 'onMobileDrawerOpenChange'
  | 'onOpenMobileDrawer'
  | 'onQuickReply'
  | 'onRateImage'
  | 'onRegenerate'
  | 'onRemoveMedia'
  | 'onSend'
  | 'onSendRecording'
  | 'onStartRecording'
  | 'onStopRecording'
  | 'onStopStreaming'
  | 'onSubmitComposer'
  | 'onToggleMessageSelection'
  | 'onToggleSidebar'
>;

type BuildChatPageLayoutPropsOptions = {
  handlers: ChatPageLayoutHandlers;
  sections: ChatPageLayoutSections;
  state: ChatPageLayoutState;
  viewport: ChatPageLayoutViewport;
};

export function buildChatPageLayoutProps({
  handlers,
  sections,
  state,
  viewport,
}: BuildChatPageLayoutPropsOptions): ChatPageLayoutProps {
  return {
    ...state,
    ...sections,
    ...viewport,
    ...handlers,
  };
}
