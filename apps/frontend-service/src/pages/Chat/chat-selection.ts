import { DEFAULT_REASONING_MODE, type ReasoningMode } from '../../lib/reasoning-mode';
import type { Conversation } from './components/types';
import type { ChatAgentSummary, ChatNamespace } from './useChatQueryState';

export const CHAT_AUTOMATIC_OPTION_VALUE = '__auto__';

export type ChatSelectionState = {
  selectedAgentId: string | null;
  selectedAreaNamespaceId: string | null;
  selectedReasoningMode: ReasoningMode;
};

export type ChatAreaOption = {
  label: string;
  namespaceId: string | null;
  value: string;
};

export type ChatAgentOption = {
  agentId: string | null;
  label: string;
  namespaceId: string | null;
  value: string;
};

export type ChatReasoningOption = {
  label: string;
  value: ReasoningMode;
};

type ChatSelectionLabels = {
  automaticArea: string;
  automaticAgent: string;
  reasoningAuto: string;
  reasoningFast: string;
  reasoningDeep: string;
};

type NormalizeChatSelectionOptions = {
  agentsData?: ChatAgentSummary[];
  namespaces?: ChatNamespace[];
  selectedAgentId: string | null;
  selectedAreaNamespaceId: string | null;
};

type NormalizeChatSelectionResult = {
  filteredAgents: ChatAgentSummary[];
  selectedAgent: ChatAgentSummary | null;
  selectedAgentId: string | null;
  selectedAreaNamespaceId: string | null;
};

type ApplyAgentSelectionOptions = {
  agentsData?: ChatAgentSummary[];
  namespaces?: ChatNamespace[];
  nextAgentId: string | null;
  selectedAreaNamespaceId: string | null;
};

export function normalizeAutomaticSelectionValue(value: string | null | undefined): string | null {
  if (!value || value === CHAT_AUTOMATIC_OPTION_VALUE) {
    return null;
  }
  return value;
}

export function getFilteredAgentsByArea(
  agentsData: ChatAgentSummary[] | undefined,
  selectedAreaNamespaceId: string | null,
): ChatAgentSummary[] {
  if (!selectedAreaNamespaceId) {
    return agentsData ?? [];
  }

  return (agentsData ?? []).filter((agent) => agent.namespaceId === selectedAreaNamespaceId);
}

export function normalizeChatSelection({
  agentsData,
  namespaces,
  selectedAgentId,
  selectedAreaNamespaceId,
}: NormalizeChatSelectionOptions): NormalizeChatSelectionResult {
  const validNamespaceIds = new Set((namespaces ?? []).map((namespace) => namespace.id));
  const validAgentMap = new Map((agentsData ?? []).map((agent) => [agent.id, agent]));
  const hasLoadedAgents = Array.isArray(agentsData);

  let nextAreaNamespaceId =
    selectedAreaNamespaceId && validNamespaceIds.size > 0 && !validNamespaceIds.has(selectedAreaNamespaceId)
      ? null
      : selectedAreaNamespaceId;
  let nextSelectedAgentId = selectedAgentId && (!hasLoadedAgents || validAgentMap.has(selectedAgentId))
    ? selectedAgentId
    : null;

  const selectedAgent = nextSelectedAgentId ? validAgentMap.get(nextSelectedAgentId) ?? null : null;
  const selectedAgentNamespaceId = selectedAgent?.namespaceId ?? null;

  if (selectedAgent) {
    if (selectedAgentNamespaceId) {
      nextAreaNamespaceId = selectedAgentNamespaceId;
    } else if (nextAreaNamespaceId) {
      nextAreaNamespaceId = null;
    }
  }

  const filteredAgents = getFilteredAgentsByArea(agentsData, nextAreaNamespaceId);

  if (nextSelectedAgentId && hasLoadedAgents && !filteredAgents.some((agent) => agent.id === nextSelectedAgentId)) {
    nextSelectedAgentId = null;
  }

  return {
    filteredAgents,
    selectedAgent: nextSelectedAgentId ? validAgentMap.get(nextSelectedAgentId) ?? null : null,
    selectedAgentId: nextSelectedAgentId,
    selectedAreaNamespaceId: nextAreaNamespaceId,
  };
}

export function applyAreaSelectionChange(selectedAreaNamespaceId: string | null): Pick<ChatSelectionState, 'selectedAreaNamespaceId' | 'selectedAgentId'> {
  return {
    selectedAreaNamespaceId,
    selectedAgentId: null,
  };
}

export function applyAgentSelectionChange({
  agentsData,
  namespaces,
  nextAgentId,
  selectedAreaNamespaceId,
}: ApplyAgentSelectionOptions): Pick<ChatSelectionState, 'selectedAreaNamespaceId' | 'selectedAgentId'> {
  if (!nextAgentId) {
    return {
      selectedAreaNamespaceId,
      selectedAgentId: null,
    };
  }

  const normalizedSelection = normalizeChatSelection({
    agentsData,
    namespaces,
    selectedAgentId: nextAgentId,
    selectedAreaNamespaceId,
  });

  return {
    selectedAreaNamespaceId: normalizedSelection.selectedAreaNamespaceId,
    selectedAgentId: normalizedSelection.selectedAgentId,
  };
}

export function buildChatAreaOptions(namespaces?: ChatNamespace[]): ChatAreaOption[] {
  return buildChatAreaOptionsWithLabels(namespaces);
}

export function buildChatAreaOptionsWithLabels(
  namespaces?: ChatNamespace[],
  automaticLabel = 'Automática',
): ChatAreaOption[] {
  return [
    {
      value: CHAT_AUTOMATIC_OPTION_VALUE,
      label: automaticLabel,
      namespaceId: null,
    },
    ...(namespaces ?? []).map((namespace) => ({
      value: namespace.id,
      label: namespace.nome,
      namespaceId: namespace.id,
    })),
  ];
}

export function buildChatAgentOptions(
  agentsData?: ChatAgentSummary[],
  options?: { includeAutomatic?: boolean; automaticLabel?: string },
): ChatAgentOption[] {
  const agentOptions = (agentsData ?? []).map((agent) => ({
    value: agent.id,
    label: `${agent.preferredName ?? agent.nome}${agent.slug ? ` (@${agent.slug})` : ''}`,
    agentId: agent.id,
    namespaceId: agent.namespaceId ?? null,
  }));

  if (options?.includeAutomatic === false) {
    return agentOptions;
  }

  return [
    {
      value: CHAT_AUTOMATIC_OPTION_VALUE,
      label: options?.automaticLabel ?? 'Automático',
      agentId: null,
      namespaceId: null,
    },
    ...agentOptions,
  ];
}

export function buildChatReasoningOptions(): ChatReasoningOption[] {
  return buildChatReasoningOptionsWithLabels();
}

export function buildChatReasoningOptionsWithLabels(labels?: Partial<ChatSelectionLabels>): ChatReasoningOption[] {
  return [
    { value: 'auto', label: labels?.reasoningAuto ?? 'Automático' },
    { value: 'non_thinking', label: labels?.reasoningFast ?? 'Rápido' },
    { value: 'thinking', label: labels?.reasoningDeep ?? 'Mais Profundo' },
  ];
}

type BuildChatSelectionPayloadOptions = {
  agentId: string | null;
  namespaceId: string | null;
  reasoningMode: ReasoningMode;
};

type ConversationMetadataSelection = NonNullable<NonNullable<Conversation['metadata']>['selection']>;

function normalizeSelectionString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function normalizeSelectionReasoningMode(value: unknown): ReasoningMode {
  return value === 'thinking' || value === 'non_thinking' || value === 'auto'
    ? value
    : DEFAULT_REASONING_MODE;
}

function hasSelectionKey(
  selection: ConversationMetadataSelection | null | undefined,
  key: 'selectedAgentId' | 'selectedNamespaceId' | 'reasoningMode',
): boolean {
  return Boolean(selection && typeof selection === 'object' && Object.prototype.hasOwnProperty.call(selection, key));
}

export function readConversationSelection(
  conversation?: Pick<Conversation, 'agentId' | 'namespaceId' | 'metadata'> | null,
): ChatSelectionState {
  const metadataSelection = conversation?.metadata?.selection;

  return {
    selectedAgentId: normalizeSelectionString(
      hasSelectionKey(metadataSelection, 'selectedAgentId')
        ? metadataSelection?.selectedAgentId
        : conversation?.agentId ?? null,
    ),
    selectedAreaNamespaceId: normalizeSelectionString(
      hasSelectionKey(metadataSelection, 'selectedNamespaceId')
        ? metadataSelection?.selectedNamespaceId
        : conversation?.namespaceId ?? null,
    ),
    selectedReasoningMode: normalizeSelectionReasoningMode(
      hasSelectionKey(metadataSelection, 'reasoningMode')
        ? metadataSelection?.reasoningMode
        : DEFAULT_REASONING_MODE,
    ),
  };
}

export function buildCanonicalChatSelectionPayload({
  agentId,
  namespaceId,
  reasoningMode,
}: BuildChatSelectionPayloadOptions) {
  return {
    agentId,
    namespaceId,
    reasoningMode,
  };
}
