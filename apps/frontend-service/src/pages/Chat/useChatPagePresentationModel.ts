import { buildChatPageLayoutProps } from './chat-page-layout-props-builder';
import { useChatSectionProps } from './useChatSectionProps';

type UseChatSectionOptions = Parameters<typeof useChatSectionProps>[0];
type ChatPageLayoutModel = Parameters<typeof buildChatPageLayoutProps>[0];

type UseChatPagePresentationModelOptions = UseChatSectionOptions & {
  acceptedTypes: string;
  currentReasoningLabel: string;
  focusNonce: number;
  input: string;
  isComposerDisabled: boolean;
  isMobile: boolean;
  isRecording: boolean;
  isRecordingDisabled: boolean;
  isStreaming: boolean;
  lastResponseUsedFallback: boolean;
  messageSelectionMode: boolean;
  mobileDrawerOpen: boolean;
  pendingMedia: ChatPageLayoutModel['state']['pendingMedia'];
  runtimeNotice: ChatPageLayoutModel['state']['runtimeNotice'];
  showDesktopActionMenu: boolean;
  showLoginBanner: boolean;
  showStreamDiagnostics: boolean;
  sidebarOpen: boolean;
  streamEvents: ChatPageLayoutModel['state']['streamEvents'];
  streamStatusLabel: string | null;
  typingSpeedMs?: number;
  messages: ChatPageLayoutModel['viewport']['messages'];
  messagesContainerRef: ChatPageLayoutModel['viewport']['messagesContainerRef'];
  messagesEndRef: ChatPageLayoutModel['viewport']['messagesEndRef'];
  scrollAreaRef: ChatPageLayoutModel['viewport']['scrollAreaRef'];
  selectedMessageIds: ChatPageLayoutModel['viewport']['selectedMessageIds'];
  onComposerChange: ChatPageLayoutModel['handlers']['onComposerChange'];
  onFeedback: ChatPageLayoutModel['handlers']['onFeedback'];
  onFilesSelected: ChatPageLayoutModel['handlers']['onFilesSelected'];
  onMobileDrawerOpenChange: ChatPageLayoutModel['handlers']['onMobileDrawerOpenChange'];
  onOpenMobileDrawer: ChatPageLayoutModel['handlers']['onOpenMobileDrawer'];
  onQuickReply: ChatPageLayoutModel['handlers']['onQuickReply'];
  onRateImage: ChatPageLayoutModel['handlers']['onRateImage'];
  onRegenerate: ChatPageLayoutModel['handlers']['onRegenerate'];
  onRemoveMedia: ChatPageLayoutModel['handlers']['onRemoveMedia'];
  onSend: ChatPageLayoutModel['handlers']['onSend'];
  onSendRecording: ChatPageLayoutModel['handlers']['onSendRecording'];
  onStartRecording: ChatPageLayoutModel['handlers']['onStartRecording'];
  onStopRecording: ChatPageLayoutModel['handlers']['onStopRecording'];
  onStopStreaming: ChatPageLayoutModel['handlers']['onStopStreaming'];
  onSubmitComposer: ChatPageLayoutModel['handlers']['onSubmitComposer'];
  onToggleMessageSelection: ChatPageLayoutModel['handlers']['onToggleMessageSelection'];
  onToggleSidebar: ChatPageLayoutModel['handlers']['onToggleSidebar'];
};

export function useChatPagePresentationModel({
  acceptedTypes,
  currentReasoningLabel,
  focusNonce,
  input,
  isComposerDisabled,
  isMobile,
  isRecording,
  isRecordingDisabled,
  isStreaming,
  lastResponseUsedFallback,
  messageSelectionMode,
  mobileDrawerOpen,
  pendingMedia,
  runtimeNotice,
  showDesktopActionMenu,
  showLoginBanner,
  showStreamDiagnostics,
  sidebarOpen,
  streamEvents,
  streamStatusLabel,
  typingSpeedMs,
  messages,
  messagesContainerRef,
  messagesEndRef,
  scrollAreaRef,
  selectedMessageIds,
  onComposerChange,
  onFeedback,
  onFilesSelected,
  onMobileDrawerOpenChange,
  onOpenMobileDrawer,
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
  ...sectionOptions
}: UseChatPagePresentationModelOptions) {
  const sectionProps = useChatSectionProps(sectionOptions);

  return buildChatPageLayoutProps({
    state: {
      acceptedTypes,
      currentReasoningLabel,
      focusNonce,
      input,
      isComposerDisabled,
      isMobile,
      isRecording,
      isRecordingDisabled,
      isStreaming,
      lastResponseUsedFallback,
      messageSelectionMode,
      mobileDrawerOpen,
      pendingMedia,
      runtimeNotice,
      showDesktopActionMenu,
      showLoginBanner,
      showStreamDiagnostics,
      sidebarOpen,
      streamEvents,
      streamStatusLabel,
      typingSpeedMs,
    },
    sections: sectionProps,
    viewport: {
      messages,
      messagesContainerRef,
      messagesEndRef,
      scrollAreaRef,
      selectedMessageIds,
    },
    handlers: {
      onComposerChange,
      onFeedback,
      onFilesSelected,
      onMobileDrawerOpenChange,
      onOpenMobileDrawer,
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
    },
  });
}
