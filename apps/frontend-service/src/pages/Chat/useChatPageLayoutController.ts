/**
 * Controlador principal da página de Chat.
 * Mantém a composição dos hooks de estado/queries/transporte e entrega props para ChatPageLayout.
 *
 * Author: Fillipe Guerra
 * Data: 10 de Março de 2026
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useParams, useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
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
import { useChatQueryState } from './useChatQueryState';
import { useChatLocalState } from './useChatLocalState';
import { useChatContainerBindings } from './useChatContainerBindings';
import { useChatConversationSelectionSync } from './useChatConversationSelectionSync';
import { useChatSendMessageMutation } from './useChatSendMessageMutation';
import { useChatConversationSurfaceState } from './useChatConversationSurfaceState';
import { useChatPagePresentationModel } from './useChatPagePresentationModel';
import { useAuth } from '@/hooks/use-auth';
import { isManualReasoningMode } from '@/lib/reasoning-mode';
import {
  buildFallbackChatEmptyStateHeadline,
  type ChatEmptyStateHeadlinePayload,
} from './chat-empty-state-headline';

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
    optimisticConversationSyncRef,
    pendingMedia,
    pendingMediaRef,
    pendingSendRef,
    recordingCancelledRef,
    recordingChunksRef,
    recordingSendModeRef,
    recordingStartingRef,
    recordingStreamRef,
    recordingUnmountedRef,
    runtimeNotice,
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
    setSelectedAgentId,
    setSelectedAreaNamespaceId,
    setSelectedReasoningMode,
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
    selectedAgentId,
    selectedAreaNamespaceId,
    selectedReasoningMode,
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
    optimisticConversationSyncRef,
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
    modelBadgeLabel,
    showDesktopActionMenu,
    showOperationsControls,
  } = useChatWorkspacePresentation({
    appVersion,
    conversationId,
    t,
    versionData,
  });
  const fallbackMessageAgent = activeConversation?.agent ?? null;
  const {
    ensureRoutingSelection,
    routedAgent,
    routingAgentIds,
    routingKey,
    routingMode,
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
    fallbackMessageUser,
    areaOptions,
    handleSelectedAgentIdChange,
    handleSelectedAreaNamespaceIdChange,
    handleSelectedReasoningModeChange,
    handleConfirmDeleteTarget,
    agentOptions,
    reasoningOptions,
    selectedAgentId: normalizedSelectedAgentId,
    selectedAreaNamespaceId: normalizedSelectedAreaNamespaceId,
    selectedReasoningMode: normalizedSelectedReasoningMode,
    selectedSelectionPayload,
  } = useChatContainerBindings({
    agentsData,
    bumpInputFocus,
    conversationId,
    currentUser,
    deleteTargetId,
    namespaces,
    onDeleteConversation: deleteConversation.mutate,
    onRoutingAgentIdsChange: setRoutingAgentIds,
    onRoutingModeChange: setRoutingMode,
    routingAgentIds,
    routingMode,
    selectedAgentId,
    selectedAreaNamespaceId,
    selectedReasoningMode,
    setDeleteTargetId,
    setSelectedAgentId,
    setSelectedAreaNamespaceId,
    setSelectedReasoningMode,
    t,
  });
  const {
    conversationDisplayState,
    currentAgentLabel,
    currentAreaLabel,
    currentReasoningLabel,
  } = useChatConversationSurfaceState({
    activeConversation,
    agentsData,
    areaOptions,
    reasoningOptions,
    routedAgent,
    selectedAgentId: normalizedSelectedAgentId,
    selectedAreaNamespaceId: normalizedSelectedAreaNamespaceId,
    selectedReasoningMode: normalizedSelectedReasoningMode,
    t,
  });
  useChatConversationSelectionSync({
    activeConversation,
    canOverrideReasoningMode,
    conversationId,
    setRoutingMode,
    setSelectedAgentId,
    setSelectedAreaNamespaceId,
    setSelectedReasoningMode,
    setRoutingAgentIds,
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
    selectedAgentId: selectedSelectionPayload.agentId ?? null,
    selectedNamespaceId: selectedSelectionPayload.namespaceId ?? null,
    selectedReasoningMode: selectedSelectionPayload.reasoningMode,
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
    optimisticConversationSyncRef,
    t,
  });
  useChatMessageSyncEffects({
    conversationId,
    conversationMessages,
    conversationMessagesUpdatedAt,
    fallbackMessageAgent,
    fallbackMessageUser,
    isFetchingConversationMessages,
    isStreaming,
    lastMessagesSyncRef,
    optimisticConversationSyncRef,
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
    handleToggleSidebar,
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
  const handleReasoningModeChange = useCallback((nextMode: typeof normalizedSelectedReasoningMode) => {
    if (!canOverrideReasoningMode && isManualReasoningMode(nextMode)) {
      return;
    }

    handleSelectedReasoningModeChange(nextMode);
  }, [
    canOverrideReasoningMode,
    handleSelectedReasoningModeChange,
    normalizedSelectedReasoningMode,
  ]);
  const { data: emptyStateHeadlineData } = useQuery<ChatEmptyStateHeadlinePayload>({
    queryKey: ['/api/chat/empty-state-headline', currentUser?.id ?? 'anonymous', focusNonce],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/chat/empty-state-headline');
      return response.json() as Promise<ChatEmptyStateHeadlinePayload>;
    },
    enabled: !authLoading && messages.length === 0,
    staleTime: 0,
  });
  const emptyStateHeadline = emptyStateHeadlineData?.headline
    ?? buildFallbackChatEmptyStateHeadline(currentUser).headline;
  const isRecordingDisabled = isStreaming || isRecording || isRecordingStarting || isTranscribingRecording;
  return useChatPagePresentationModel({
    acceptedTypes: CHAT_ACCEPTED_MEDIA_TYPES,
    activeConversationCount: selectedConversationIds.size,
    agentOptions,
    areaOptions,
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
    messagesCount: messages.length,
    namespaces,
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
    onReasoningModeChange: handleReasoningModeChange,
    onAreaChange: handleSelectedAreaNamespaceIdChange,
    onAgentChange: handleSelectedAgentIdChange,
    onSelectConversation: handleSelectConversation,
    onSubmitTraining: handleSubmitTraining,
    onToggleSelectConversation: toggleConversationSelection,
    onToggleSelectionMode: toggleConversationSelectionMode,
    onTrainingDialogOpenChange: handleTrainingDialogOpenChange,
    reasoningOptions,
    reasoningMode: normalizedSelectedReasoningMode,
    selectedAgentId: normalizedSelectedAgentId,
    selectedAreaNamespaceId: normalizedSelectedAreaNamespaceId,
    selectedConversationIds,
    selectedMessageCount: selectedMessageIds.size,
    canOverrideReasoningMode,
    currentAgentLabel,
    currentAreaLabel,
    hasManualAgentSelection: conversationDisplayState.hasManualAgentSelection,
    hasManualAreaSelection: conversationDisplayState.hasManualAreaSelection,
    showConversationActions: showOperationsControls,
    showTrainingDialog,
    modelBadgeLabel,
    t,
    trainingDialogMode,
    trainingNamespaceId,
    currentReasoningLabel,
    emptyStateHeadline,
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
  });
}
