import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { Message } from './components/types';

export type ChatAgentSummary = {
  id: string;
  nome: string;
  preferredName?: string | null;
  slug?: string | null;
  status?: string | null;
};

export type ChatNamespace = {
  id: string;
  nome: string;
  slug: string;
};

export type ChatApprovalPolicy = 'always_confirm' | 'confirm_risky' | 'never_confirm';
export type ChatVersionPayload = {
  version: string | null;
  publicModelName?: string | null;
  servingModelId?: string | null;
};

type AssistantSettingsPreview = {
  settings?: {
    typingSpeedMs?: number | null;
  } | null;
  defaults: {
    typingSpeedMs: number;
  };
};

type UseChatQueryStateOptions = {
  conversationId?: string;
};

export function useChatQueryState({
  conversationId,
}: UseChatQueryStateOptions) {
  const {
    data: conversationMessages,
    dataUpdatedAt: conversationMessagesUpdatedAt,
    isFetching: isFetchingConversationMessages,
  } = useQuery<{ messages: Message[] }>({
    queryKey: ['/api/chat/conversations', conversationId, 'messages'],
    queryFn: async () => {
      if (!conversationId) {
        throw new Error('ConversationId ausente para carregamento de mensagens');
      }
      const res = await apiRequest('GET', `/api/chat/conversations/${conversationId}/messages`);
      return res.json() as Promise<{ messages: Message[] }>;
    },
    enabled: Boolean(conversationId),
  });

  const { data: approvalPolicyData } = useQuery<{
    approvalPolicy: ChatApprovalPolicy;
    allowWebSearchWithoutApproval: boolean;
  }>({
    queryKey: ['/api/chat/conversations', conversationId, 'approval-policy'],
    queryFn: async () => {
      if (!conversationId) {
        throw new Error('ConversationId ausente');
      }
      const res = await apiRequest('GET', `/api/chat/conversations/${conversationId}/approval-policy`);
      return res.json() as Promise<{
        approvalPolicy: ChatApprovalPolicy;
        allowWebSearchWithoutApproval: boolean;
      }>;
    },
    enabled: Boolean(conversationId),
  });

  const { data: versionData } = useQuery<ChatVersionPayload>({
    queryKey: ['/api/chat/version'],
    staleTime: 1000 * 60 * 5,
  });

  const { data: assistantSettingsData } = useQuery<AssistantSettingsPreview>({
    queryKey: ['/api/assistant-settings'],
    staleTime: 1000 * 60,
  });

  const { data: namespaces } = useQuery<ChatNamespace[]>({
    queryKey: ['/api/namespaces'],
    staleTime: 1000 * 60,
  });

  const { data: agentsData } = useQuery<ChatAgentSummary[]>({
    queryKey: ['/api/agents'],
    staleTime: 1000 * 60,
  });

  const approvalPolicy: ChatApprovalPolicy = approvalPolicyData?.approvalPolicy ?? 'always_confirm';
  const typingSpeedMs = assistantSettingsData?.settings?.typingSpeedMs ?? assistantSettingsData?.defaults?.typingSpeedMs;

  return {
    agentsData,
    approvalPolicy,
    conversationMessages,
    conversationMessagesUpdatedAt,
    isFetchingConversationMessages,
    namespaces,
    typingSpeedMs,
    versionData,
  };
}
