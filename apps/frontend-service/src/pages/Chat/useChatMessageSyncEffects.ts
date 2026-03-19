import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { MediaAttachment, Message } from './components/types';
import { normalizeServerMessage } from './chat-message-normalization';

export type OptimisticConversationSyncState = {
  conversationId: string;
  minimumMessageCount: number;
};

type ShouldDeferConversationMessagesSyncOptions = {
  conversationId?: string;
  optimisticConversationSyncState: OptimisticConversationSyncState | null;
  serverMessagesCount: number;
};

export function shouldDeferConversationMessagesSync({
  conversationId,
  optimisticConversationSyncState,
  serverMessagesCount,
}: ShouldDeferConversationMessagesSyncOptions): boolean {
  if (!conversationId || !optimisticConversationSyncState) {
    return false;
  }

  if (optimisticConversationSyncState.conversationId !== conversationId) {
    return false;
  }

  return serverMessagesCount < optimisticConversationSyncState.minimumMessageCount;
}

type UseChatMessageSyncEffectsOptions = {
  conversationId?: string;
  conversationMessages?: { messages: Message[] };
  conversationMessagesUpdatedAt: number;
  fallbackMessageAgent: Message['agent'];
  fallbackMessageUser: Message['user'];
  isFetchingConversationMessages: boolean;
  isStreaming: boolean;
  lastMessagesSyncRef: MutableRefObject<number>;
  optimisticConversationSyncRef: MutableRefObject<OptimisticConversationSyncState | null>;
  pendingSendRef: MutableRefObject<{ content: string; mediaAttachments?: MediaAttachment[] } | null>;
  sendMessage: (payload: { content: string; mediaAttachments?: MediaAttachment[] }) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
};

export function useChatMessageSyncEffects({
  conversationId,
  conversationMessages,
  conversationMessagesUpdatedAt,
  fallbackMessageAgent,
  fallbackMessageUser,
  isFetchingConversationMessages,
  isStreaming,
  lastMessagesSyncRef,
  optimisticConversationSyncRef,
  pendingSendRef,
  sendMessage,
  setMessages,
}: UseChatMessageSyncEffectsOptions) {
  useEffect(() => {
    if (isStreaming || isFetchingConversationMessages) return;
    if (!conversationMessages?.messages) return;
    if (conversationMessagesUpdatedAt <= lastMessagesSyncRef.current) return;
    const serverMessagesCount = conversationMessages.messages.length;
    const optimisticConversationSyncState = optimisticConversationSyncRef.current;

    if (shouldDeferConversationMessagesSync({
      conversationId,
      optimisticConversationSyncState,
      serverMessagesCount,
    })) {
      return;
    }

    if (
      conversationId
      && optimisticConversationSyncState
      && optimisticConversationSyncState.conversationId === conversationId
      && serverMessagesCount >= optimisticConversationSyncState.minimumMessageCount
    ) {
      optimisticConversationSyncRef.current = null;
    }

    setMessages(
      conversationMessages.messages.map((message) => normalizeServerMessage(message, {
        fallbackUser: fallbackMessageUser,
        fallbackAgent: fallbackMessageAgent,
      })),
    );
    lastMessagesSyncRef.current = conversationMessagesUpdatedAt;
  }, [
    conversationId,
    conversationMessages,
    conversationMessagesUpdatedAt,
    fallbackMessageAgent,
    fallbackMessageUser,
    isFetchingConversationMessages,
    isStreaming,
    lastMessagesSyncRef,
    optimisticConversationSyncRef,
    setMessages,
  ]);

  useEffect(() => {
    if (isStreaming || !pendingSendRef.current) return;
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    sendMessage(pending);
  }, [isStreaming, pendingSendRef, sendMessage]);
}
