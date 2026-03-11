/**
 * Controlador principal da página de Chat.
 * Mantém a composição dos hooks de estado/queries/transporte e entrega props para ChatPageLayout.
 *
 * Author: Fillipe Guerra
 * Data: 10 de Março de 2026
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useParams, useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';

import {
  ACCEPTED_TYPES,
} from './components/types';
import { useIsMobileViewport } from './useIsMobileViewport';
import { useChatAutoScroll } from './useChatAutoScroll';
import { useChatSelectionState } from './useChatSelectionState';
import { useChatConversationLifecycle } from './useChatConversationLifecycle';
import { useChatTrainingFeedbackActions } from './useChatTrainingFeedbackActions';
import { useChatRecordingActions } from './useChatRecordingActions';
import { useChatMediaAttachmentActions } from './useChatMediaAttachmentActions';
import { useChatStreamDiagnostics } from './useChatStreamDiagnostics';
import { useChatConversationFilters } from './useChatConversationFilters';
import { useChatConversationsQueryState } from './useChatConversationsQueryState';
import { useChatComposerActions } from './useChatComposerActions';
import { useChatRoutingState } from './useChatRoutingState';
import { useChatPageLifecycle } from './useChatPageLifecycle';
import { useChatUiInteractionHandlers } from './useChatUiInteractionHandlers';
import { useChatMessageSyncEffects } from './useChatMessageSyncEffects';
import { useChatWorkspacePresentation } from './useChatWorkspacePresentation';
import { useChatSectionProps } from './useChatSectionProps';
import { useChatQueryState } from './useChatQueryState';
import { useChatLocalState } from './useChatLocalState';
import { useChatContainerBindings } from './useChatContainerBindings';
import { useChatSendMessageMutation } from './useChatSendMessageMutation';
import { buildChatPageLayoutProps } from './chat-page-layout-props-builder';
import { useAuth } from '@/hooks/use-auth';
import { isManualReasoningMode } from '@/lib/reasoning-mode';

const CHAT_ACCEPTED_MEDIA_TYPES = [...ACCEPTED_TYPES.image, ...ACCEPTED_TYPES.audio].join(',');

export function useChatPageLayoutController() {
  const { t } = useTranslation();
  const { user: currentUser, isAuthenticated, isLoading: authLoading } = useAuth();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const [location, navigate] = useLocation();
  const queryClientRef = useQueryClient();
  const { toast } = useToast();
  const isMobile = useIsMobileViewport();
  const appVersion = __APP_VERSION__;
  const showLoginBanner = !authLoading && !isAuthenticated;
  const userRoles = currentUser?.roles ?? (currentUser?.role ? [currentUser.role] : []);
  const canOverrideReasoningMode = userRoles.some((role) => role === 'admin' || role === 'super_admin');
  const {
    activeWorkspace,
    deleteAllOpen,
    deleteSelectedOpen,
    deleteTargetId,
    input,
    inputRef,
    isRecording,
    isRecordingStarting,
    isStreaming,
    isTranscribingRecording,
    lastMessagesSyncRef,
    lastResponseUsedFallback,
    mediaRecorderRef,
    messages,
    mobileDrawerOpen,
    pendingMedia,
    pendingMediaRef,
    pendingSendRef,
    recordingCancelledRef,
    recordingChunksRef,
    recordingSendModeRef,
    recordingStartingRef,
    recordingStreamRef,
    recordingUnmountedRef,
    reasoningMode,
    runtimeNotice,
    setActiveWorkspace,
    setDeleteAllOpen,
    setDeleteSelectedOpen,
    setDeleteTargetId,
    setInput,
    setIsRecording,
    setIsRecordingStarting,
    setIsStreaming,
    setIsTranscribingRecording,
    setLastResponseUsedFallback,
    setMessages,
    setMobileDrawerOpen,
    setPendingMedia,
    setReasoningMode,
    setRuntimeNotice,
    setShowStreamDiagnostics,
    setShowTrainingDialog,
    setSidebarOpen,
    setStreamEvents,
    setStreamStatusLabel,
    setTrainingDialogMode,
    setTrainingNamespaceId,
    showStreamDiagnostics,
    showTrainingDialog,
    sidebarOpen,
    stopRequestedRef,
    streamControllerRef,
    streamEvents,
    streamStatusLabel,
    trainingDialogMode,
    trainingNamespaceId,
  } = useChatLocalState(isMobile);

  const {
    clearConversationFilter,
    conversationFilter,
    conversationFilterLabel,
    routeContextFromQuery,
  } = useChatConversationFilters({
    location,
    navigate,
    t,
  });
  
  const {
    messagesEndRef,
    messagesContainerRef,
    scrollAreaRef,
    enableAutoScroll,
  } = useChatAutoScroll({
    conversationId,
    messageCount: messages.length,
    isStreaming,
  });
  const { setRecordingStartingState } = useChatPageLifecycle({
    conversationId,
    input,
    inputRef,
    isMobile,
    lastMessagesSyncRef,
    mediaRecorderRef,
    pendingMedia,
    pendingMediaRef,
    recordingCancelledRef,
    recordingStartingRef,
    recordingStreamRef,
    recordingUnmountedRef,
    setIsRecordingStarting,
    setMobileDrawerOpen,
  });

  const {
    clearPendingMedia,
    handleFileSelect,
    removePendingMedia,
  } = useChatMediaAttachmentActions({
    notify: toast,
    pendingMedia,
    setPendingMedia,
    t,
  });

  const {
    activeConversation,
    conversations,
    conversationsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useChatConversationsQueryState({
    conversationFilter,
    conversationId,
  });

  const {
    agentsData,
    approvalPolicy,
    conversationMessages,
    conversationMessagesUpdatedAt,
    isFetchingConversationMessages,
    namespaces,
    typingSpeedMs,
    versionData,
  } = useChatQueryState({
    conversationId,
  });

  const {
    isSelectionMode,
    selectedConversationIds,
    messageSelectionMode,
    selectedMessageIds,
    setMessageSelectionMode,
    setSelectedMessageIds,
    toggleMessageSelection,
    toggleConversationSelectionMode,
    toggleConversationSelection,
    clearConversationSelection,
  } = useChatSelectionState({
    conversationId,
    messages,
  });

  const {
    bumpInputFocus,
    createConversation,
    deleteConversation,
    focusNonce,
    handleCloseConversationsSidebar,
    handleConfirmDeleteAll,
    handleConfirmDeleteSelected,
    handleNewChatWithClose,
    handleSelectConversation,
    updateApprovalPolicy,
  } = useChatConversationLifecycle({
    clearConversationSelection,
    conversationId,
    isMobile,
    navigate,
    notify: toast,
    queryClient: queryClientRef,
    selectedConversationIds,
    setDeleteAllOpen,
    setDeleteSelectedOpen,
    setMessages,
    setMobileDrawerOpen,
    setSidebarOpen,
    t,
  });
  const {
    fallbackMessageUser,
    handleApprovalPolicyChange,
    handleConfirmDeleteTarget,
    workspaceOptions,
  } = useChatContainerBindings({
    bumpInputFocus,
    conversationId,
    currentUser,
    deleteTargetId,
    onDeleteConversation: deleteConversation.mutate,
    onUpdateApprovalPolicy: updateApprovalPolicy.mutate,
    setDeleteTargetId,
  });

  const {
    agentOptions,
    approvalPolicyForSelect,
    approvalPolicyOptions,
    modelBadgeLabel,
    showConversationWorkspaceHint,
    showDesktopActionMenu,
    showDiagnosticsControls,
    showGovernanceControls,
    showOperationsControls,
    workspaceHint,
  } = useChatWorkspacePresentation({
    activeWorkspace,
    agentsData,
    appVersion,
    approvalPolicy,
    conversationId,
    t,
    versionData,
  });
  const fallbackMessageAgent = activeConversation?.agent ?? null;
  const {
    ensureRoutingSelection,
    routedAgent,
    routingAgentIds,
    routingDebug,
    routingKey,
    routingLabel,
    routingMode,
    routingSourceLabel,
    setRoutedAgentByConversation,
    setRoutingAgentIds,
    setRoutingAgentIdsByConversation,
    setRoutingDebugByConversation,
    setRoutingMode,
    setRoutingModeByConversation,
    setRoutingSourceByConversation,
  } = useChatRoutingState({
    activeConversationAgent: fallbackMessageAgent,
    agentsData,
    conversationId,
    messages,
    notify: toast,
    t,
  });

  const {
    createStatusEvent,
    pushStreamEvent,
    resolveStreamStatus,
  } = useChatStreamDiagnostics({
    setStreamEvents,
    t,
  });
  const { sendMessage } = useChatSendMessageMutation({
    activeConversationAgent: activeConversation?.agent ?? null,
    approvalPolicy,
    conversationId,
    createConversation: (payload) => createConversation.mutateAsync(payload),
    createStatusEvent,
    ensureRoutingSelection,
    fallbackMessageAgent,
    fallbackMessageUser,
    isAuthenticated,
    navigate,
    notify: toast,
    pushStreamEvent,
    queryClient: queryClientRef,
    resolveStreamStatus,
    routeContextFromQuery,
    routedAgent,
    routingAgentIds,
    routingKey,
    routingMode,
    reasoningMode,
    setIsStreaming,
    setLastResponseUsedFallback,
    setMessages,
    setRuntimeNotice,
    setRoutedAgentByConversation,
    setRoutingAgentIdsByConversation,
    setRoutingDebugByConversation,
    setRoutingModeByConversation,
    setRoutingSourceByConversation,
    setStreamEvents,
    setStreamStatusLabel,
    showStreamDiagnostics,
    stopRequestedRef,
    streamControllerRef,
    t,
  });
  useChatMessageSyncEffects({
    conversationMessages,
    conversationMessagesUpdatedAt,
    fallbackMessageAgent,
    fallbackMessageUser,
    isFetchingConversationMessages,
    isStreaming,
    lastMessagesSyncRef,
    pendingSendRef,
    sendMessage,
    setMessages,
  });
  const handleSendQuickReply = useCallback((content: string) => {
    sendMessage({ content });
  }, [sendMessage]);

  const {
    handleSendRecordingNow,
    handleStartRecording,
    handleStopRecordingReview,
  } = useChatRecordingActions({
    clearPendingMedia,
    conversationId,
    inputRef,
    isRecording,
    isStreaming,
    mediaRecorderRef,
    pendingMediaRef,
    notify: toast,
    recordingCancelledRef,
    recordingChunksRef,
    recordingSendModeRef,
    recordingStartingRef,
    recordingStreamRef,
    recordingUnmountedRef,
    sendMessage,
    setInput,
    setIsRecording,
    setIsTranscribingRecording,
    setRecordingStartingState,
    t,
  });

  const {
    handleFeedback,
    handleRateImage,
    openConversationTrainingDialog,
    openMessageTrainingDialog,
    sendConversationToTraining,
    sendSelectedMessagesToTraining,
  } = useChatTrainingFeedbackActions({
    conversationId,
    notify: toast,
    selectedMessageIds,
    setMessageSelectionMode,
    setMessages,
    setSelectedMessageIds,
    setShowTrainingDialog,
    setTrainingDialogMode,
    setTrainingNamespaceId,
    t,
    trainingNamespaceId,
  });

  const {
    handleRegenerate,
    handleSend,
    handleStopStreaming,
    handleSubmit,
  } = useChatComposerActions({
    clearPendingMedia,
    enableAutoScroll,
    input,
    isAuthenticated,
    isRecording,
    isStreaming,
    messages,
    notify: toast,
    pendingMedia,
    pendingSendRef,
    sendMessage,
    setInput,
    setMessages,
    stopRequestedRef,
    streamControllerRef,
  });

  const {
    handleDeleteCurrentConversation,
    handleDeleteTargetOpenChange,
    handleLoadMoreConversations,
    handleOpenMobileDrawer,
    handleQuickReply,
    handleSubmitTraining,
    handleToggleSelectionMode,
    handleToggleSidebar,
    handleToggleStreamDiagnostics,
    handleTrainingDialogOpenChange,
    isSubmitTrainingPending,
  } = useChatUiInteractionHandlers({
    conversationId,
    fetchNextPage,
    isAuthenticated,
    isStreaming,
    notify: toast,
    sendQuickReply: handleSendQuickReply,
    setDeleteTargetId,
    setMessageSelectionMode,
    setMobileDrawerOpen,
    setShowStreamDiagnostics,
    setShowTrainingDialog,
    setSidebarOpen,
    setTrainingDialogMode,
    submitConversationToTraining: sendConversationToTraining.mutate,
    isSubmitConversationTrainingPending: sendConversationToTraining.isPending,
    submitSelectedMessagesToTraining: sendSelectedMessagesToTraining.mutate,
    isSubmitSelectedMessagesToTrainingPending: sendSelectedMessagesToTraining.isPending,
    trainingDialogMode,
    trainingNamespaceId,
  });
  const handleOpenDeleteAllDialog = useCallback(() => {
    setDeleteAllOpen(true);
  }, [setDeleteAllOpen]);
  const handleOpenDeleteSelectedDialog = useCallback(() => {
    setDeleteSelectedOpen(true);
  }, [setDeleteSelectedOpen]);
  const isRecordingDisabled = isStreaming || isRecording || isRecordingStarting || isTranscribingRecording;
  const {
    chatActionsMenuProps,
    chatDialogsSectionProps,
    chatGovernanceControlsProps,
    conversationsListProps,
  } = useChatSectionProps({
    activeConversationCount: selectedConversationIds.size,
    agentOptions,
    approvalPolicyForSelect,
    approvalPolicyOptions,
    conversationFilterActive: conversationFilter.isActive,
    conversationFilterLabel,
    conversationId,
    conversations,
    conversationsLoading,
    deleteAllOpen,
    deleteSelectedOpen,
    deleteTargetId,
    hasNextPage: Boolean(hasNextPage),
    isFetchingNextPage,
    isSelectionMode,
    isSubmitTrainingPending,
    messageSelectionMode,
    messagesCount: messages.length,
    namespaces,
    onApprovalPolicyChange: handleApprovalPolicyChange,
    onClearFilter: clearConversationFilter,
    onCloseSidebar: handleCloseConversationsSidebar,
    onConfirmDeleteAll: handleConfirmDeleteAll,
    onConfirmDeleteSelected: handleConfirmDeleteSelected,
    onConfirmDeleteTarget: handleConfirmDeleteTarget,
    onDeleteAllOpenChange: setDeleteAllOpen,
    onDeleteAllRequest: handleOpenDeleteAllDialog,
    onDeleteConversationRequest: setDeleteTargetId,
    onDeleteCurrentConversation: handleDeleteCurrentConversation,
    onDeleteSelectedOpenChange: setDeleteSelectedOpen,
    onDeleteSelectedRequest: handleOpenDeleteSelectedDialog,
    onDeleteTargetOpenChange: handleDeleteTargetOpenChange,
    onLoadMore: handleLoadMoreConversations,
    onNamespaceChange: setTrainingNamespaceId,
    onNewChat: handleNewChatWithClose,
    onOpenConversationTrainingDialog: openConversationTrainingDialog,
    onOpenMessageTrainingDialog: openMessageTrainingDialog,
    onReasoningModeChange: (nextMode) => {
      if (!canOverrideReasoningMode && isManualReasoningMode(nextMode)) {
        return;
      }
      setReasoningMode(nextMode);
    },
    onRoutingAgentIdsChange: setRoutingAgentIds,
    onRoutingModeChange: setRoutingMode,
    onSelectConversation: handleSelectConversation,
    onSubmitTraining: handleSubmitTraining,
    onToggleMessageSelectionMode: handleToggleSelectionMode,
    onToggleSelectConversation: toggleConversationSelection,
    onToggleSelectionMode: toggleConversationSelectionMode,
    onToggleStreamDiagnostics: handleToggleStreamDiagnostics,
    onTrainingDialogOpenChange: handleTrainingDialogOpenChange,
    routingAgentIds,
    routingDebug,
    routingLabel,
    routingMode,
    routingSourceLabel,
    reasoningMode,
    selectedConversationIds,
    selectedMessageCount: selectedMessageIds.size,
    canOverrideReasoningMode,
    showDesktopActionMenu,
    showDiagnosticsControls,
    showGovernanceControls,
    showOperationsControls,
    showStreamDiagnostics,
    showTrainingDialog,
    t,
    trainingDialogMode,
    trainingNamespaceId,
  });

  const chatPageLayoutProps = buildChatPageLayoutProps({
    state: {
      acceptedTypes: CHAT_ACCEPTED_MEDIA_TYPES,
      activeWorkspace,
      conversationId,
      focusNonce,
      input,
      isComposerDisabled: showLoginBanner,
      isMobile,
      isRecording,
      isRecordingDisabled,
      isStreaming,
      lastResponseUsedFallback,
      messageSelectionMode,
      mobileDrawerOpen,
      modelBadgeLabel,
      pendingMedia,
      runtimeNotice,
      showConversationWorkspaceHint,
      showDesktopActionMenu,
      showLoginBanner,
      showStreamDiagnostics,
      sidebarOpen,
      streamEvents,
      streamStatusLabel,
      typingSpeedMs,
    },
    sections: {
      chatActionsMenuProps,
      chatDialogsSectionProps,
      chatGovernanceControlsProps,
      conversationsListProps,
      workspaceHint,
      workspaceOptions,
    },
    viewport: {
      messages,
      messagesContainerRef,
      messagesEndRef,
      scrollAreaRef,
      selectedMessageIds,
    },
    handlers: {
      onComposerChange: setInput,
      onFeedback: handleFeedback,
      onFilesSelected: handleFileSelect,
      onMobileDrawerOpenChange: setMobileDrawerOpen,
      onOpenMobileDrawer: handleOpenMobileDrawer,
      onQuickReply: handleQuickReply,
      onRateImage: handleRateImage,
      onRegenerate: handleRegenerate,
      onRemoveMedia: removePendingMedia,
      onSend: handleSend,
      onSendRecording: handleSendRecordingNow,
      onStartRecording: handleStartRecording,
      onStopRecording: handleStopRecordingReview,
      onStopStreaming: handleStopStreaming,
      onSubmitComposer: handleSubmit,
      onToggleMessageSelection: toggleMessageSelection,
      onToggleSidebar: handleToggleSidebar,
      onWorkspaceChange: setActiveWorkspace,
    },
  });

  return chatPageLayoutProps;
}
