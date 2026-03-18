import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { Conversation } from './components/types';
import { readConversationSelection } from './chat-selection';
import { isManualReasoningMode, type ReasoningMode } from '@/lib/reasoning-mode';
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
    const nextConversationSelection = readConversationSelection(activeConversation);
    const nextReasoningMode = !canOverrideReasoningMode
      && isManualReasoningMode(nextConversationSelection.selectedReasoningMode)
      ? 'auto'
      : nextConversationSelection.selectedReasoningMode;

    setSelectedAreaNamespaceId(nextConversationSelection.selectedAreaNamespaceId);
    setSelectedAgentId(nextConversationSelection.selectedAgentId);
    setSelectedReasoningMode(nextReasoningMode);
    setRoutingMode(nextConversationSelection.selectedAgentId ? 'manual' : 'auto');
    setRoutingAgentIds(nextConversationSelection.selectedAgentId ? [nextConversationSelection.selectedAgentId] : []);
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
