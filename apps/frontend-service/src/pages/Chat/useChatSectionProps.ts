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
  areaOptions: ChatGovernanceControlsProps['areaOptions'];
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
  messagesCount: ChatDialogsSectionProps['messagesCount'];
  namespaces: ChatDialogsSectionProps['namespaces'];
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
  onAreaChange: ChatGovernanceControlsProps['onAreaChange'];
  onReasoningModeChange: ChatGovernanceControlsProps['onReasoningModeChange'];
  onAgentChange: ChatGovernanceControlsProps['onAgentChange'];
  onSelectConversation: ConversationsListProps['onSelectConversation'];
  onSubmitTraining: ChatDialogsSectionProps['onSubmitTraining'];
  onToggleSelectConversation: ConversationsListProps['onToggleSelectConversation'];
  onToggleSelectionMode: ConversationsListProps['onToggleSelectionMode'];
  onTrainingDialogOpenChange: ChatDialogsSectionProps['onTrainingDialogOpenChange'];
  reasoningOptions: ChatGovernanceControlsProps['reasoningOptions'];
  reasoningMode: ChatGovernanceControlsProps['reasoningMode'];
  selectedAgentId: ChatGovernanceControlsProps['selectedAgentId'];
  selectedAreaNamespaceId: ChatGovernanceControlsProps['selectedAreaNamespaceId'];
  selectedConversationIds: ConversationsListProps['selectedIds'];
  selectedMessageCount: number;
  canOverrideReasoningMode: ChatGovernanceControlsProps['canOverrideReasoningMode'];
  showConversationActions: ChatActionsMenuProps['showConversationActions'];
  showTrainingDialog: ChatDialogsSectionProps['showTrainingDialog'];
  t: (key: string) => string;
  trainingDialogMode: ChatDialogsSectionProps['trainingDialogMode'];
  trainingNamespaceId: ChatDialogsSectionProps['trainingNamespaceId'];
};

export function useChatSectionProps({
  activeConversationCount,
  agentOptions,
  areaOptions,
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
  messagesCount,
  namespaces,
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
  onAreaChange,
  onReasoningModeChange,
  onAgentChange,
  onSelectConversation,
  onSubmitTraining,
  onToggleSelectConversation,
  onToggleSelectionMode,
  onTrainingDialogOpenChange,
  reasoningOptions,
  reasoningMode,
  selectedAgentId,
  selectedAreaNamespaceId,
  selectedConversationIds,
  selectedMessageCount,
  canOverrideReasoningMode,
  showConversationActions,
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
    onDeleteConversation: onDeleteCurrentConversation,
    showConversationActions,
  }), [
    onDeleteCurrentConversation,
    showConversationActions,
  ]);

  const chatGovernanceControlsProps = useMemo<ChatGovernanceControlsProps>(() => ({
    agentOptions,
    areaOptions,
    onAgentChange,
    onAreaChange,
    onReasoningModeChange,
    reasoningMode,
    canOverrideReasoningMode,
    reasoningOptions,
    selectedAgentId,
    selectedAreaNamespaceId,
    t,
  }), [
    agentOptions,
    areaOptions,
    onAgentChange,
    onAreaChange,
    onReasoningModeChange,
    reasoningMode,
    canOverrideReasoningMode,
    reasoningOptions,
    selectedAgentId,
    selectedAreaNamespaceId,
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
  };
}
