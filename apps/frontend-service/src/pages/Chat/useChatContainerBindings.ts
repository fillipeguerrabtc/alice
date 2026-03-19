import { useCallback, useEffect, useMemo } from 'react';
import {
  applyAgentSelectionChange,
  applyAreaSelectionChange,
  buildCanonicalChatSelectionPayload,
  buildChatAgentOptions,
  buildChatAreaOptionsWithLabels,
  buildChatReasoningOptionsWithLabels,
  normalizeChatSelection,
} from './chat-selection';
import { buildMessageUserSnapshot } from './chat-message-normalization';
import type { RoutingMode } from './useChatRoutingState';
import type { ReasoningMode } from '@/lib/reasoning-mode';
import type { ChatAgentSummary, ChatNamespace } from './useChatQueryState';
import type { Dispatch, SetStateAction } from 'react';

type MessageUserSnapshotInput = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  email?: string | null;
} | null | undefined;

type UseChatContainerBindingsOptions = {
  agentsData?: ChatAgentSummary[];
  bumpInputFocus: () => void;
  conversationId?: string;
  currentUser: MessageUserSnapshotInput;
  deleteTargetId: string | null;
  namespaces?: ChatNamespace[];
  onDeleteConversation: (conversationId: string) => void;
  onRoutingAgentIdsChange: (values: string[]) => void;
  onRoutingModeChange: (value: RoutingMode) => void;
  routingAgentIds: string[];
  routingMode: RoutingMode;
  selectedAgentId: string | null;
  selectedAreaNamespaceId: string | null;
  selectedReasoningMode: ReasoningMode;
  setDeleteTargetId: Dispatch<SetStateAction<string | null>>;
  setSelectedAgentId: Dispatch<SetStateAction<string | null>>;
  setSelectedAreaNamespaceId: Dispatch<SetStateAction<string | null>>;
  setSelectedReasoningMode: Dispatch<SetStateAction<ReasoningMode>>;
  t: (key: string) => string;
};

type ResolveLegacyRoutingSelectionSyncOptions = {
  agentsData?: ChatAgentSummary[];
  namespaces?: ChatNamespace[];
  normalizedSelectedAgentId: string | null;
  normalizedSelectedAreaNamespaceId: string | null;
  routingAgentIds: string[];
  routingMode: RoutingMode;
};

export function resolveLegacyRoutingSelectionSync({
  agentsData,
  namespaces,
  normalizedSelectedAgentId,
  normalizedSelectedAreaNamespaceId,
  routingAgentIds,
  routingMode,
}: ResolveLegacyRoutingSelectionSyncOptions): Pick<UseChatContainerBindingsOptions, 'selectedAgentId' | 'selectedAreaNamespaceId'> | null {
  const legacySelectedAgentId = routingMode === 'manual'
    ? routingAgentIds[0] ?? null
    : null;

  if (!legacySelectedAgentId) {
    return normalizedSelectedAgentId
      ? {
          selectedAgentId: null,
          selectedAreaNamespaceId: normalizedSelectedAreaNamespaceId,
        }
      : null;
  }

  const nextSelection = applyAgentSelectionChange({
    agentsData,
    namespaces,
    nextAgentId: legacySelectedAgentId,
    selectedAreaNamespaceId: normalizedSelectedAreaNamespaceId,
  });

  if (
    nextSelection.selectedAgentId === normalizedSelectedAgentId
    && nextSelection.selectedAreaNamespaceId === normalizedSelectedAreaNamespaceId
  ) {
    return null;
  }

  return nextSelection;
}

export function useChatContainerBindings({
  agentsData,
  bumpInputFocus,
  conversationId,
  currentUser,
  deleteTargetId,
  namespaces,
  onDeleteConversation,
  onRoutingAgentIdsChange,
  onRoutingModeChange,
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
}: UseChatContainerBindingsOptions) {
  const normalizedSelection = useMemo(() => normalizeChatSelection({
    agentsData,
    namespaces,
    selectedAgentId,
    selectedAreaNamespaceId,
  }), [
    agentsData,
    namespaces,
    selectedAgentId,
    selectedAreaNamespaceId,
  ]);
  const areaOptions = useMemo(
    () => buildChatAreaOptionsWithLabels(
      namespaces,
      t('chat.selectionControls.automaticArea'),
    ),
    [namespaces, t],
  );
  const agentOptions = useMemo(
    () => buildChatAgentOptions(normalizedSelection.filteredAgents, {
      automaticLabel: t('chat.selectionControls.automaticAgent'),
    }),
    [normalizedSelection.filteredAgents, t],
  );
  const reasoningOptions = useMemo(
    () => buildChatReasoningOptionsWithLabels({
      reasoningAuto: t('chat.reasoning.auto'),
      reasoningFast: t('chat.reasoning.nonThinking'),
      reasoningDeep: t('chat.reasoning.thinking'),
    }),
    [t],
  );

  const fallbackMessageUser = useMemo(
    () => buildMessageUserSnapshot(currentUser),
    [currentUser],
  );

  useEffect(() => {
    if (normalizedSelection.selectedAreaNamespaceId !== selectedAreaNamespaceId) {
      setSelectedAreaNamespaceId(normalizedSelection.selectedAreaNamespaceId);
    }
    if (normalizedSelection.selectedAgentId !== selectedAgentId) {
      setSelectedAgentId(normalizedSelection.selectedAgentId);
    }
  }, [
    normalizedSelection.selectedAgentId,
    normalizedSelection.selectedAreaNamespaceId,
    selectedAgentId,
    selectedAreaNamespaceId,
    setSelectedAgentId,
    setSelectedAreaNamespaceId,
  ]);

  useEffect(() => {
    if (routingAgentIds.length <= 1) {
      return;
    }
    onRoutingAgentIdsChange(routingAgentIds.slice(0, 1));
  }, [onRoutingAgentIdsChange, routingAgentIds]);

  useEffect(() => {
    const nextSelection = resolveLegacyRoutingSelectionSync({
      agentsData,
      namespaces,
      normalizedSelectedAgentId: normalizedSelection.selectedAgentId,
      normalizedSelectedAreaNamespaceId: normalizedSelection.selectedAreaNamespaceId,
      routingAgentIds,
      routingMode,
    });

    if (!nextSelection) {
      return;
    }

    setSelectedAgentId(nextSelection.selectedAgentId);
    setSelectedAreaNamespaceId(nextSelection.selectedAreaNamespaceId);
  }, [
    agentsData,
    namespaces,
    normalizedSelection.selectedAgentId,
    normalizedSelection.selectedAreaNamespaceId,
    routingAgentIds,
    routingMode,
    setSelectedAgentId,
    setSelectedAreaNamespaceId,
  ]);

  useEffect(() => {
    bumpInputFocus();
  }, [bumpInputFocus, conversationId]);

  const handleConfirmDeleteTarget = useCallback(() => {
    if (deleteTargetId) {
      onDeleteConversation(deleteTargetId);
    }
    setDeleteTargetId(null);
  }, [deleteTargetId, onDeleteConversation, setDeleteTargetId]);

  const handleSelectedAreaNamespaceIdChange = useCallback((namespaceId: string | null) => {
    const nextSelection = applyAreaSelectionChange(namespaceId);
    setSelectedAreaNamespaceId(nextSelection.selectedAreaNamespaceId);
    setSelectedAgentId(nextSelection.selectedAgentId);
    onRoutingModeChange('auto');
    onRoutingAgentIdsChange([]);
  }, [
    onRoutingAgentIdsChange,
    onRoutingModeChange,
    setSelectedAgentId,
    setSelectedAreaNamespaceId,
  ]);

  const handleSelectedAgentIdChange = useCallback((agentId: string | null) => {
    const nextSelection = applyAgentSelectionChange({
      agentsData,
      namespaces,
      nextAgentId: agentId,
      selectedAreaNamespaceId,
    });

    setSelectedAreaNamespaceId(nextSelection.selectedAreaNamespaceId);
    setSelectedAgentId(nextSelection.selectedAgentId);
    onRoutingModeChange(nextSelection.selectedAgentId ? 'manual' : 'auto');
    onRoutingAgentIdsChange(nextSelection.selectedAgentId ? [nextSelection.selectedAgentId] : []);
  }, [
    agentsData,
    namespaces,
    onRoutingAgentIdsChange,
    onRoutingModeChange,
    selectedAreaNamespaceId,
    setSelectedAgentId,
    setSelectedAreaNamespaceId,
  ]);

  const handleSelectedReasoningModeChange = useCallback((reasoningMode: ReasoningMode) => {
    setSelectedReasoningMode(reasoningMode);
  }, [setSelectedReasoningMode]);

  const selectedSelectionPayload = useMemo(() => buildCanonicalChatSelectionPayload({
    agentId: normalizedSelection.selectedAgentId,
    namespaceId: normalizedSelection.selectedAreaNamespaceId,
    reasoningMode: selectedReasoningMode,
  }), [
    normalizedSelection.selectedAgentId,
    normalizedSelection.selectedAreaNamespaceId,
    selectedReasoningMode,
  ]);

  return {
    agentOptions,
    areaOptions,
    fallbackMessageUser,
    handleConfirmDeleteTarget,
    handleSelectedAgentIdChange,
    handleSelectedAreaNamespaceIdChange,
    handleSelectedReasoningModeChange,
    reasoningOptions,
    selectedAgentId: normalizedSelection.selectedAgentId,
    selectedAreaNamespaceId: normalizedSelection.selectedAreaNamespaceId,
    selectedReasoningMode,
    selectedSelectionPayload,
  };
}
