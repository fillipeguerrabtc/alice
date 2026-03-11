import { useMemo } from 'react';
import type { ComponentProps } from 'react';
import { ChatActionsMenu } from './components/ChatActionsMenu';
import { ChatDialogsSection } from './components/ChatDialogsSection';
import { ChatGovernanceControls } from './components/ChatGovernanceControls';
import type { ConversationsListProps } from './components/ConversationsList';

type ChatActionsMenuProps = ComponentProps<typeof ChatActionsMenu>;
type ChatGovernanceControlsProps = ComponentProps<typeof ChatGovernanceControls>;
type ChatDialogsSectionProps = ComponentProps<typeof ChatDialogsSection>;

type UseChatSectionPropsOptions = {
  activeConversationCount: number;
  agentOptions: ChatGovernanceControlsProps['agentOptions'];
  approvalPolicyForSelect: ChatGovernanceControlsProps['approvalPolicyForSelect'];
  approvalPolicyOptions: ChatGovernanceControlsProps['approvalPolicyOptions'];
  conversationFilterActive: boolean;
  conversationFilterLabel?: string;
  conversationId?: string;
  conversations: ConversationsListProps['conversations'];
  conversationsLoading: ConversationsListProps['isLoading'];
  deleteAllOpen: ChatDialogsSectionProps['deleteAllOpen'];
  deleteSelectedOpen: ChatDialogsSectionProps['deleteSelectedOpen'];
  deleteTargetId: ChatDialogsSectionProps['deleteTargetId'];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isSelectionMode: ConversationsListProps['isSelectionMode'];
  isSubmitTrainingPending: ChatDialogsSectionProps['isSubmitTrainingPending'];
  messageSelectionMode: ChatActionsMenuProps['messageSelectionMode'];
  messagesCount: ChatDialogsSectionProps['messagesCount'];
  namespaces: ChatDialogsSectionProps['namespaces'];
  onApprovalPolicyChange: ChatGovernanceControlsProps['onApprovalPolicyChange'];
  onClearFilter: () => void;
  onCloseSidebar: ConversationsListProps['onCloseSidebar'];
  onConfirmDeleteAll: ChatDialogsSectionProps['onConfirmDeleteAll'];
  onConfirmDeleteSelected: ChatDialogsSectionProps['onConfirmDeleteSelected'];
  onConfirmDeleteTarget: ChatDialogsSectionProps['onConfirmDeleteTarget'];
  onDeleteAllOpenChange: ChatDialogsSectionProps['onDeleteAllOpenChange'];
  onDeleteSelectedOpenChange: ChatDialogsSectionProps['onDeleteSelectedOpenChange'];
  onDeleteTargetOpenChange: ChatDialogsSectionProps['onDeleteTargetOpenChange'];
  onDeleteAllRequest: () => void;
  onDeleteConversationRequest: (id: string) => void;
  onDeleteCurrentConversation: ChatActionsMenuProps['onDeleteConversation'];
  onDeleteSelectedRequest: () => void;
  onLoadMore: ConversationsListProps['onLoadMore'];
  onNamespaceChange: ChatDialogsSectionProps['onTrainingNamespaceChange'];
  onNewChat: ConversationsListProps['onNewChat'];
  onOpenConversationTrainingDialog: ChatActionsMenuProps['onOpenConversationTrainingDialog'];
  onOpenMessageTrainingDialog: ChatActionsMenuProps['onOpenMessageTrainingDialog'];
  onReasoningModeChange: ChatGovernanceControlsProps['onReasoningModeChange'];
  onRoutingAgentIdsChange: ChatGovernanceControlsProps['onRoutingAgentIdsChange'];
  onRoutingModeChange: ChatGovernanceControlsProps['onRoutingModeChange'];
  onSelectConversation: ConversationsListProps['onSelectConversation'];
  onSubmitTraining: ChatDialogsSectionProps['onSubmitTraining'];
  onToggleMessageSelectionMode: ChatActionsMenuProps['onToggleMessageSelectionMode'];
  onToggleSelectConversation: ConversationsListProps['onToggleSelectConversation'];
  onToggleSelectionMode: ConversationsListProps['onToggleSelectionMode'];
  onToggleStreamDiagnostics: ChatActionsMenuProps['onToggleStreamDiagnostics'];
  onTrainingDialogOpenChange: ChatDialogsSectionProps['onTrainingDialogOpenChange'];
  routingAgentIds: ChatGovernanceControlsProps['routingAgentIds'];
  routingDebug: ChatGovernanceControlsProps['routingDebug'];
  routingLabel: ChatGovernanceControlsProps['routingLabel'];
  reasoningMode: ChatGovernanceControlsProps['reasoningMode'];
  routingMode: ChatGovernanceControlsProps['routingMode'];
  routingSourceLabel: ChatGovernanceControlsProps['routingSourceLabel'];
  selectedConversationIds: ConversationsListProps['selectedIds'];
  selectedMessageCount: ChatActionsMenuProps['selectedMessageCount'];
  canOverrideReasoningMode: ChatGovernanceControlsProps['canOverrideReasoningMode'];
  showDesktopActionMenu: boolean;
  showDiagnosticsControls: ChatActionsMenuProps['showDiagnosticsControls'];
  showGovernanceControls: ChatGovernanceControlsProps['showGovernanceControls'];
  showOperationsControls: ChatActionsMenuProps['showOperationsControls'];
  showStreamDiagnostics: ChatActionsMenuProps['showStreamDiagnostics'];
  showTrainingDialog: ChatDialogsSectionProps['showTrainingDialog'];
  t: ChatActionsMenuProps['t'];
  trainingDialogMode: ChatDialogsSectionProps['trainingDialogMode'];
  trainingNamespaceId: ChatDialogsSectionProps['trainingNamespaceId'];
};

export function useChatSectionProps({
  activeConversationCount,
  agentOptions,
  approvalPolicyForSelect,
  approvalPolicyOptions,
  conversationFilterActive,
  conversationFilterLabel,
  conversationId,
  conversations,
  conversationsLoading,
  deleteAllOpen,
  deleteSelectedOpen,
  deleteTargetId,
  hasNextPage,
  isFetchingNextPage,
  isSelectionMode,
  isSubmitTrainingPending,
  messageSelectionMode,
  messagesCount,
  namespaces,
  onApprovalPolicyChange,
  onClearFilter,
  onCloseSidebar,
  onConfirmDeleteAll,
  onConfirmDeleteSelected,
  onConfirmDeleteTarget,
  onDeleteAllOpenChange,
  onDeleteAllRequest,
  onDeleteConversationRequest,
  onDeleteCurrentConversation,
  onDeleteSelectedOpenChange,
  onDeleteSelectedRequest,
  onDeleteTargetOpenChange,
  onLoadMore,
  onNamespaceChange,
  onNewChat,
  onOpenConversationTrainingDialog,
  onOpenMessageTrainingDialog,
  onReasoningModeChange,
  onRoutingAgentIdsChange,
  onRoutingModeChange,
  onSelectConversation,
  onSubmitTraining,
  onToggleMessageSelectionMode,
  onToggleSelectConversation,
  onToggleSelectionMode,
  onToggleStreamDiagnostics,
  onTrainingDialogOpenChange,
  routingAgentIds,
  routingDebug,
  routingLabel,
  reasoningMode,
  routingMode,
  routingSourceLabel,
  selectedConversationIds,
  selectedMessageCount,
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
}: UseChatSectionPropsOptions) {
  const conversationsListProps = useMemo<ConversationsListProps>(() => ({
    conversations,
    conversationId,
    filterLabel: conversationFilterLabel,
    hasMore: hasNextPage,
    isLoading: conversationsLoading,
    isLoadingMore: isFetchingNextPage,
    isSelectionMode,
    onClearFilter: conversationFilterActive ? onClearFilter : undefined,
    onCloseSidebar,
    onDeleteAll: onDeleteAllRequest,
    onDeleteConversation: onDeleteConversationRequest,
    onDeleteSelected: onDeleteSelectedRequest,
    onLoadMore,
    onNewChat,
    onSelectConversation,
    onToggleSelectConversation,
    onToggleSelectionMode,
    selectedIds: selectedConversationIds,
  }), [
    conversationFilterActive,
    conversationFilterLabel,
    conversationId,
    conversations,
    conversationsLoading,
    hasNextPage,
    isFetchingNextPage,
    isSelectionMode,
    onClearFilter,
    onCloseSidebar,
    onDeleteAllRequest,
    onDeleteConversationRequest,
    onDeleteSelectedRequest,
    onLoadMore,
    onNewChat,
    onSelectConversation,
    onToggleSelectConversation,
    onToggleSelectionMode,
    selectedConversationIds,
  ]);

  const chatActionsMenuProps = useMemo<ChatActionsMenuProps>(() => ({
    messageSelectionMode,
    onDeleteConversation: onDeleteCurrentConversation,
    onOpenConversationTrainingDialog,
    onOpenMessageTrainingDialog,
    onToggleMessageSelectionMode,
    onToggleStreamDiagnostics,
    selectedMessageCount,
    showDiagnosticsControls,
    showOperationsControls,
    showStreamDiagnostics,
    t,
  }), [
    messageSelectionMode,
    onDeleteCurrentConversation,
    onOpenConversationTrainingDialog,
    onOpenMessageTrainingDialog,
    onToggleMessageSelectionMode,
    onToggleStreamDiagnostics,
    selectedMessageCount,
    showDiagnosticsControls,
    showOperationsControls,
    showStreamDiagnostics,
    t,
  ]);

  const chatGovernanceControlsProps = useMemo<ChatGovernanceControlsProps>(() => ({
    agentOptions,
    approvalPolicyForSelect,
    approvalPolicyOptions,
    conversationId,
    onApprovalPolicyChange,
    onReasoningModeChange,
    onRoutingAgentIdsChange,
    onRoutingModeChange,
    reasoningMode,
    routingAgentIds,
    canOverrideReasoningMode,
    routingDebug,
    routingLabel,
    routingMode,
    routingSourceLabel,
    showGovernanceControls,
    t,
  }), [
    agentOptions,
    approvalPolicyForSelect,
    approvalPolicyOptions,
    conversationId,
    onApprovalPolicyChange,
    onReasoningModeChange,
    onRoutingAgentIdsChange,
    onRoutingModeChange,
    reasoningMode,
    routingAgentIds,
    canOverrideReasoningMode,
    routingDebug,
    routingLabel,
    routingMode,
    routingSourceLabel,
    showGovernanceControls,
    t,
  ]);

  const chatDialogsSectionProps = useMemo<ChatDialogsSectionProps>(() => ({
    deleteAllOpen,
    deleteSelectedOpen,
    deleteTargetId,
    isSubmitTrainingPending,
    messagesCount,
    namespaces,
    onConfirmDeleteAll,
    onConfirmDeleteSelected,
    onConfirmDeleteTarget,
    onDeleteAllOpenChange,
    onDeleteSelectedOpenChange,
    onDeleteTargetOpenChange,
    onSubmitTraining,
    onTrainingDialogOpenChange,
    onTrainingNamespaceChange: onNamespaceChange,
    selectedConversationCount: activeConversationCount,
    selectedMessageCount,
    showTrainingDialog,
    t,
    trainingDialogMode,
    trainingNamespaceId,
  }), [
    activeConversationCount,
    deleteAllOpen,
    deleteSelectedOpen,
    deleteTargetId,
    isSubmitTrainingPending,
    messagesCount,
    namespaces,
    onConfirmDeleteAll,
    onConfirmDeleteSelected,
    onConfirmDeleteTarget,
    onDeleteAllOpenChange,
    onDeleteSelectedOpenChange,
    onDeleteTargetOpenChange,
    onNamespaceChange,
    onSubmitTraining,
    onTrainingDialogOpenChange,
    selectedMessageCount,
    showTrainingDialog,
    t,
    trainingDialogMode,
    trainingNamespaceId,
  ]);

  return {
    chatActionsMenuProps,
    chatDialogsSectionProps,
    chatGovernanceControlsProps,
    conversationsListProps,
    showDesktopActionMenu,
  };
}
