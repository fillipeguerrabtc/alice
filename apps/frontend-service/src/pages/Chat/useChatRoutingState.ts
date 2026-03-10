import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { Message } from './components/types';

type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

type AgentSummary = {
  id: string;
  nome: string;
  preferredName?: string | null;
  slug?: string | null;
  status?: string | null;
};

export type RoutingMode = 'auto' | 'manual';

export type RoutingDebugData = {
  selectedAgentId: string | null;
  selectedNamespaceId: string | null;
  score: number | null;
  threshold: number | null;
  profile: string | null;
  source: string | null;
  mode: RoutingMode | null;
};

type UseChatRoutingStateOptions = {
  activeConversationAgent: Message['agent'] | null;
  agentsData?: AgentSummary[];
  conversationId?: string;
  messages: Message[];
  notify: NotifyFn;
  t: (key: string) => string;
};

type UseChatRoutingStateResult = {
  ensureRoutingSelection: () => boolean;
  routedAgent: Message['agent'] | null;
  routingAgentIds: string[];
  routingDebug: RoutingDebugData | null;
  routingKey: string;
  routingLabel: string;
  routingMode: RoutingMode;
  routingSource: string;
  routingSourceLabel: string;
  setRoutedAgentByConversation: Dispatch<SetStateAction<Record<string, Message['agent'] | null>>>;
  setRoutingAgentIds: (agentIds: string[]) => void;
  setRoutingAgentIdsByConversation: Dispatch<SetStateAction<Record<string, string[]>>>;
  setRoutingDebugByConversation: Dispatch<SetStateAction<Record<string, RoutingDebugData>>>;
  setRoutingMode: (mode: RoutingMode) => void;
  setRoutingModeByConversation: Dispatch<SetStateAction<Record<string, RoutingMode>>>;
  setRoutingSourceByConversation: Dispatch<SetStateAction<Record<string, string>>>;
};

export function useChatRoutingState(options: UseChatRoutingStateOptions): UseChatRoutingStateResult {
  const {
    activeConversationAgent,
    agentsData,
    conversationId,
    messages,
    notify,
    t,
  } = options;

  const [routingModeByConversation, setRoutingModeByConversation] = useState<Record<string, RoutingMode>>({});
  const [routingAgentIdsByConversation, setRoutingAgentIdsByConversation] = useState<Record<string, string[]>>({});
  const [routedAgentByConversation, setRoutedAgentByConversation] = useState<Record<string, Message['agent'] | null>>({});
  const [routingSourceByConversation, setRoutingSourceByConversation] = useState<Record<string, string>>({});
  const [routingDebugByConversation, setRoutingDebugByConversation] = useState<Record<string, RoutingDebugData>>({});

  const routingKey = conversationId ?? 'new';
  const routingMode = routingModeByConversation[routingKey] ?? 'auto';
  const routingAgentIds = routingAgentIdsByConversation[routingKey] ?? [];
  const routedAgent = routedAgentByConversation[routingKey] ?? activeConversationAgent ?? null;
  const routingSource = routingSourceByConversation[routingKey] ?? 'none';
  const routingDebug = routingDebugByConversation[routingKey] ?? null;
  const routingLabel =
    routedAgent?.preferredName ??
    routedAgent?.nome ??
    (routingMode === 'manual' ? t('chat.routing.manual') : t('chat.routing.auto'));
  const routingSourceLabel =
    routingSource === 'none'
      ? routingMode === 'manual'
        ? t('chat.routing.manual')
        : t('chat.routing.auto')
      : routingSource;

  const validAgentIds = useMemo(() => new Set((agentsData ?? []).map((agent) => agent.id)), [agentsData]);

  useEffect(() => {
    if (validAgentIds.size === 0) return;
    setRoutingAgentIdsByConversation((prev) => {
      const current = prev[routingKey] ?? [];
      const filtered = current.filter((id) => validAgentIds.has(id));
      if (filtered.length === current.length) return prev;
      return { ...prev, [routingKey]: filtered };
    });
  }, [routingKey, validAgentIds]);

  useEffect(() => {
    if (!conversationId || !activeConversationAgent) return;
    setRoutedAgentByConversation((prev) => {
      if (prev[conversationId]?.id === activeConversationAgent.id) return prev;
      return { ...prev, [conversationId]: activeConversationAgent };
    });
  }, [activeConversationAgent, conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const lastAssistantWithAgent = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant' && message.agent?.id);
    if (!lastAssistantWithAgent?.agent) return;

    setRoutedAgentByConversation((prev) => {
      if (prev[conversationId]?.id === lastAssistantWithAgent.agent?.id) return prev;
      return { ...prev, [conversationId]: lastAssistantWithAgent.agent ?? null };
    });
  }, [conversationId, messages]);

  const ensureRoutingSelection = useCallback(() => {
    if (routingMode === 'manual' && routingAgentIds.length === 0) {
      notify({ title: t('chat.routing.missingAgents'), variant: 'destructive' });
      return false;
    }
    return true;
  }, [notify, routingAgentIds.length, routingMode, t]);

  const setRoutingMode = useCallback((mode: RoutingMode) => {
    setRoutingModeByConversation((prev) => ({ ...prev, [routingKey]: mode }));
  }, [routingKey]);

  const setRoutingAgentIds = useCallback((agentIds: string[]) => {
    setRoutingAgentIdsByConversation((prev) => ({ ...prev, [routingKey]: agentIds }));
  }, [routingKey]);

  return {
    ensureRoutingSelection,
    routedAgent,
    routingAgentIds,
    routingDebug,
    routingKey,
    routingLabel,
    routingMode,
    routingSource,
    routingSourceLabel,
    setRoutedAgentByConversation,
    setRoutingAgentIds,
    setRoutingAgentIdsByConversation,
    setRoutingDebugByConversation,
    setRoutingMode,
    setRoutingModeByConversation,
    setRoutingSourceByConversation,
  };
}
