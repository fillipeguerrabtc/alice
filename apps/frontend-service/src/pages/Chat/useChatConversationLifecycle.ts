import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';
import type { Conversation, Message } from './components/types';
import type { ReasoningMode } from '@/lib/reasoning-mode';

type ApprovalPolicy = 'always_confirm' | 'confirm_risky' | 'never_confirm';

type NotifyFn = (params: { title: string; description?: string; variant?: 'default' | 'destructive' }) => void;

type UseChatConversationLifecycleOptions = {
  clearConversationSelection: () => void;
  conversationId?: string;
  isMobile: boolean;
  navigate: (path: string) => void;
  notify: NotifyFn;
  queryClient: QueryClient;
  selectedConversationIds: Set<string>;
  setDeleteAllOpen: (value: boolean) => void;
  setDeleteSelectedOpen: (value: boolean) => void;
  setMessages: (updater: (previous: Message[]) => Message[]) => void;
  setMobileDrawerOpen: (value: boolean) => void;
  setSidebarOpen: (value: boolean) => void;
  t: TFunction;
};

type CreateConversationPayload = {
  agentId?: string | null;
  namespaceId?: string | null;
  reasoningMode?: ReasoningMode;
  context?: 'trading' | 'sales' | 'support' | 'cambio' | 'default';
  route?: string;
};

export function useChatConversationLifecycle(options: UseChatConversationLifecycleOptions) {
  const {
    clearConversationSelection,
    conversationId,
    isMobile,
    navigate,
    notify,
    queryClient,
    selectedConversationIds,
    setDeleteAllOpen,
    setDeleteSelectedOpen,
    setMessages,
    setMobileDrawerOpen,
    setSidebarOpen,
    t,
  } = options;

  const [focusNonce, setFocusNonce] = useState(0);

  const bumpInputFocus = useCallback(() => {
    setFocusNonce((previous) => previous + 1);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages(() => []);
  }, [setMessages]);

  const createConversation = useMutation({
    mutationFn: async (payload?: CreateConversationPayload) => {
      const body: Record<string, unknown> = { titulo: 'Nova Conversa' };
      if (payload && Object.prototype.hasOwnProperty.call(payload, 'agentId')) body.agentId = payload.agentId ?? null;
      if (payload && Object.prototype.hasOwnProperty.call(payload, 'namespaceId')) body.namespaceId = payload.namespaceId ?? null;
      if (payload?.reasoningMode) body.reasoningMode = payload.reasoningMode;
      if (payload?.context) body.context = payload.context;
      if (payload?.route) body.route = payload.route;
      const res = await apiRequest('POST', '/api/chat/conversations', body);
      return res.json() as Promise<{ conversation: Conversation }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
    },
  });

  const deleteConversation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/chat/conversations/${id}`);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
      if (conversationId === id) {
        clearMessages();
        navigate('/chat');
      }
    },
  });

  const updateApprovalPolicy = useMutation({
    mutationFn: async (policy: ApprovalPolicy) => {
      if (!conversationId) {
        throw new Error('ConversationId ausente para atualização de política');
      }
      await apiRequest('PATCH', `/api/chat/conversations/${conversationId}/approval-policy`, {
        approvalPolicy: policy,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/chat/conversations', conversationId, 'approval-policy'] });
      notify({ title: t('chat.approvalPolicy.updated') });
    },
    onError: () => {
      notify({ title: t('chat.approvalPolicy.error'), variant: 'destructive' });
    },
  });

  const deleteConversationsBulk = useMutation({
    mutationFn: async (ids: string[]) => {
      await apiRequest('POST', '/api/chat/conversations/bulk-delete', { ids });
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
      if (conversationId && ids.includes(conversationId)) {
        clearMessages();
        navigate('/chat');
      }
    },
  });

  const deleteAllConversations = useMutation({
    mutationFn: async () => {
      await apiRequest('POST', '/api/chat/conversations/delete-all');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/chat/conversations'] });
      clearMessages();
      navigate('/chat');
    },
  });

  const handleNewChatWithClose = useCallback(() => {
    clearMessages();
    navigate('/chat');
    bumpInputFocus();
    if (isMobile) {
      setMobileDrawerOpen(false);
    }
  }, [bumpInputFocus, clearMessages, isMobile, navigate, setMobileDrawerOpen]);

  const handleSelectConversation = useCallback((id: string) => {
    navigate(`/chat/${id}`);
    bumpInputFocus();
    if (isMobile) {
      setMobileDrawerOpen(false);
    }
  }, [bumpInputFocus, isMobile, navigate, setMobileDrawerOpen]);

  const handleConfirmDeleteSelected = useCallback(() => {
    if (selectedConversationIds.size === 0) return;
    deleteConversationsBulk.mutate(Array.from(selectedConversationIds));
    clearConversationSelection();
    setDeleteSelectedOpen(false);
  }, [clearConversationSelection, deleteConversationsBulk, selectedConversationIds, setDeleteSelectedOpen]);

  const handleConfirmDeleteAll = useCallback(() => {
    deleteAllConversations.mutate();
    clearConversationSelection();
    setDeleteAllOpen(false);
  }, [clearConversationSelection, deleteAllConversations, setDeleteAllOpen]);

  const handleCloseConversationsSidebar = useCallback(() => {
    if (isMobile) {
      setMobileDrawerOpen(false);
      return;
    }
    setSidebarOpen(false);
  }, [isMobile, setMobileDrawerOpen, setSidebarOpen]);

  return {
    bumpInputFocus,
    createConversation,
    deleteAllConversations,
    deleteConversation,
    deleteConversationsBulk,
    focusNonce,
    handleCloseConversationsSidebar,
    handleConfirmDeleteAll,
    handleConfirmDeleteSelected,
    handleNewChatWithClose,
    handleSelectConversation,
    updateApprovalPolicy,
  };
}
