import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Conversation } from './components/types';
import { readConversationSelection } from './chat-selection';
import { isManualReasoningMode, type ReasoningMode } from '../../lib/reasoning-mode';
import type { RoutingMode } from './useChatRoutingState';

type UseChatConversationSelectionSyncOptions = {
  activeConversation: Conversation | null;
  canOverrideReasoningMode: boolean;
  conversationId?: string;
  setRoutingAgentIds: (agentIds: string[]) => void;
  setRoutingMode: (mode: RoutingMode) => void;
  setSelectedAgentId: Dispatch<SetStateAction<string | null>>;
  setSelectedAreaNamespaceId: Dispatch<SetStateAction<string | null>>;
  setSelectedReasoningMode: Dispatch<SetStateAction<ReasoningMode>>;
};

export type ConversationSelectionSyncState = {
  routingAgentIds: string[];
  routingMode: RoutingMode;
  selectedAgentId: string | null;
  selectedAreaNamespaceId: string | null;
  selectedReasoningMode: ReasoningMode;
};

type ResolveConversationSelectionSyncStateOptions = Pick<
  UseChatConversationSelectionSyncOptions,
  'activeConversation' | 'canOverrideReasoningMode'
>;

export function resolveConversationSelectionSyncState({
  activeConversation,
  canOverrideReasoningMode,
}: ResolveConversationSelectionSyncStateOptions): ConversationSelectionSyncState {
  const nextConversationSelection = readConversationSelection(activeConversation);
  const nextReasoningMode = !canOverrideReasoningMode
    && isManualReasoningMode(nextConversationSelection.selectedReasoningMode)
    ? 'auto'
    : nextConversationSelection.selectedReasoningMode;

  return {
    selectedAreaNamespaceId: nextConversationSelection.selectedAreaNamespaceId,
    selectedAgentId: nextConversationSelection.selectedAgentId,
    selectedReasoningMode: nextReasoningMode,
    routingMode: nextConversationSelection.selectedAgentId ? 'manual' : 'auto',
    routingAgentIds: nextConversationSelection.selectedAgentId ? [nextConversationSelection.selectedAgentId] : [],
  };
}

export function useChatConversationSelectionSync({
  activeConversation,
  canOverrideReasoningMode,
  conversationId,
  setRoutingAgentIds,
  setRoutingMode,
  setSelectedAgentId,
  setSelectedAreaNamespaceId,
  setSelectedReasoningMode,
}: UseChatConversationSelectionSyncOptions) {
  const selectionConversationSyncRef = useRef<string | null>(null);

  useEffect(() => {
    const nextConversationKey = conversationId ?? 'new';
    if (selectionConversationSyncRef.current === nextConversationKey) {
      return;
    }
    if (conversationId && !activeConversation) {
      return;
    }

    selectionConversationSyncRef.current = nextConversationKey;
    const nextSyncState = resolveConversationSelectionSyncState({
      activeConversation,
      canOverrideReasoningMode,
    });

    setSelectedAreaNamespaceId(nextSyncState.selectedAreaNamespaceId);
    setSelectedAgentId(nextSyncState.selectedAgentId);
    setSelectedReasoningMode(nextSyncState.selectedReasoningMode);
    setRoutingMode(nextSyncState.routingMode);
    setRoutingAgentIds(nextSyncState.routingAgentIds);
  }, [
    activeConversation,
    canOverrideReasoningMode,
    conversationId,
    setRoutingAgentIds,
    setRoutingMode,
    setSelectedAgentId,
    setSelectedAreaNamespaceId,
    setSelectedReasoningMode,
  ]);
}
