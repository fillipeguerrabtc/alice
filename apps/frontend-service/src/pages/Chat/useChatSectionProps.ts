import { useMemo } from 'react';
import type { ComponentProps } from 'react';
import { ChatActionsMenu } from './components/ChatActionsMenu';
import { ChatDialogsSection } from './components/ChatDialogsSection';
import { ChatIdentityMenu } from './components/ChatIdentityMenu';
import type { ConversationsListProps } from './components/ConversationsList';

type ChatActionsMenuProps = ComponentProps<typeof ChatActionsMenu>;
type ChatIdentityMenuProps = ComponentProps<typeof ChatIdentityMenu>;
type ChatDialogsSectionProps = ComponentProps<typeof ChatDialogsSection>;

type UseChatSectionPropsOptions = {
  activeConversationCount: number;
  agentOptions: ChatIdentityMenuProps['agentOptions'];
  areaOptions: ChatIdentityMenuProps['areaOptions'];
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
  onAreaChange: ChatIdentityMenuProps['onAreaChange'];
  onReasoningModeChange: ChatIdentityMenuProps['onReasoningModeChange'];
  onAgentChange: ChatIdentityMenuProps['onAgentChange'];
  onSelectConversation: ConversationsListProps['onSelectConversation'];
  onSubmitTraining: ChatDialogsSectionProps['onSubmitTraining'];
  onToggleSelectConversation: ConversationsListProps['onToggleSelectConversation'];
  onToggleSelectionMode: ConversationsListProps['onToggleSelectionMode'];
  onTrainingDialogOpenChange: ChatDialogsSectionProps['onTrainingDialogOpenChange'];
  reasoningOptions: ChatIdentityMenuProps['reasoningOptions'];
  reasoningMode: ChatIdentityMenuProps['reasoningMode'];
  selectedAgentId: ChatIdentityMenuProps['selectedAgentId'];
  selectedAreaNamespaceId: ChatIdentityMenuProps['selectedAreaNamespaceId'];
  selectedConversationIds: ConversationsListProps['selectedIds'];
  selectedMessageCount: number;
  canOverrideReasoningMode: ChatIdentityMenuProps['canOverrideReasoningMode'];
  currentAgentLabel: ChatIdentityMenuProps['currentAgentLabel'];
  currentAreaLabel: ChatIdentityMenuProps['currentAreaLabel'];
  hasManualAgentSelection: ChatIdentityMenuProps['hasManualAgentSelection'];
  hasManualAreaSelection: ChatIdentityMenuProps['hasManualAreaSelection'];
  showConversationActions: ChatActionsMenuProps['showConversationActions'];
  showTrainingDialog: ChatDialogsSectionProps['showTrainingDialog'];
  modelBadgeLabel: ChatIdentityMenuProps['modelBadgeLabel'];
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
  currentAgentLabel,
  currentAreaLabel,
  hasManualAgentSelection,
  hasManualAreaSelection,
  showConversationActions,
  showTrainingDialog,
  modelBadgeLabel,
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

  const chatIdentityMenuProps = useMemo<ChatIdentityMenuProps>(() => ({
    agentOptions,
    areaOptions,
    onAgentChange,
    onAreaChange,
    onReasoningModeChange,
    reasoningMode,
    canOverrideReasoningMode,
    reasoningOptions,
    currentAgentLabel,
    currentAreaLabel,
    hasManualAgentSelection,
    hasManualAreaSelection,
    selectedAgentId,
    selectedAreaNamespaceId,
    modelBadgeLabel,
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
    currentAgentLabel,
    currentAreaLabel,
    hasManualAgentSelection,
    hasManualAreaSelection,
    selectedAgentId,
    selectedAreaNamespaceId,
    modelBadgeLabel,
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
    chatIdentityMenuProps,
    conversationsListProps,
  };
}
