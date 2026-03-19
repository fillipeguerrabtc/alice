import { useMemo } from 'react';
import {
  buildChatAgentOptions,
  CHAT_AUTOMATIC_OPTION_VALUE,
  resolveChatConversationDisplayState,
} from './chat-selection';
import type { Conversation, Message } from './components/types';
import type { ChatAgentOption, ChatAreaOption, ChatReasoningOption } from './chat-selection';
import type { ChatAgentSummary } from './useChatQueryState';
import type { ReasoningMode } from '@/lib/reasoning-mode';

type UseChatConversationSurfaceStateOptions = {
  activeConversation: Conversation | null;
  agentsData?: ChatAgentSummary[];
  areaOptions: ChatAreaOption[];
  reasoningOptions: ChatReasoningOption[];
  routedAgent: Message['agent'] | null;
  selectedAgentId: string | null;
  selectedAreaNamespaceId: string | null;
  selectedReasoningMode: ReasoningMode;
  t: (key: string) => string;
};

type UseChatConversationSurfaceStateResult = {
  conversationDisplayState: ReturnType<typeof resolveChatConversationDisplayState>;
  currentAgentLabel: string;
  currentAreaLabel: string;
  currentReasoningLabel: string;
  summaryAgentOptions: ChatAgentOption[];
};

export function useChatConversationSurfaceState({
  activeConversation,
  agentsData,
  areaOptions,
  reasoningOptions,
  routedAgent,
  selectedAgentId,
  selectedAreaNamespaceId,
  selectedReasoningMode,
  t,
}: UseChatConversationSurfaceStateOptions): UseChatConversationSurfaceStateResult {
  const conversationDisplayState = useMemo(() => resolveChatConversationDisplayState({
    conversation: activeConversation,
    routedAgentId: routedAgent?.id ?? null,
    selectedAgentId,
    selectedAreaNamespaceId,
  }), [
    activeConversation,
    routedAgent,
    selectedAgentId,
    selectedAreaNamespaceId,
  ]);

  const summaryAgentOptions = useMemo(
    () => buildChatAgentOptions(agentsData, {
      automaticLabel: t('chat.selectionControls.automaticAgent'),
    }),
    [agentsData, t],
  );

  const currentAreaLabel = useMemo(() => {
    const effectiveAreaValue = conversationDisplayState.effectiveAreaNamespaceId ?? CHAT_AUTOMATIC_OPTION_VALUE;
    return areaOptions.find((option) => option.value === effectiveAreaValue)?.label
      ?? t('chat.selectionControls.automaticArea');
  }, [areaOptions, conversationDisplayState.effectiveAreaNamespaceId, t]);

  const currentAgentLabel = useMemo(() => {
    const effectiveAgentValue = conversationDisplayState.effectiveAgentId ?? CHAT_AUTOMATIC_OPTION_VALUE;
    return summaryAgentOptions.find((option) => option.value === effectiveAgentValue)?.label
      ?? routedAgent?.preferredName
      ?? routedAgent?.nome
      ?? t('chat.selectionControls.automaticAgent');
  }, [
    conversationDisplayState.effectiveAgentId,
    routedAgent,
    summaryAgentOptions,
    t,
  ]);

  const currentReasoningLabel = useMemo(
    () => reasoningOptions.find((option) => option.value === selectedReasoningMode)?.label
      ?? t('chat.reasoning.auto'),
    [reasoningOptions, selectedReasoningMode, t],
  );

  return {
    conversationDisplayState,
    currentAgentLabel,
    currentAreaLabel,
    currentReasoningLabel,
    summaryAgentOptions,
  };
}
