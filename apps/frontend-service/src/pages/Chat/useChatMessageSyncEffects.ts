import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { MediaAttachment, Message } from './components/types';
import { normalizeServerMessage } from './chat-message-normalization';

type UseChatMessageSyncEffectsOptions = {
  conversationMessages?: { messages: Message[] };
  conversationMessagesUpdatedAt: number;
  fallbackMessageAgent: Message['agent'];
  fallbackMessageUser: Message['user'];
  isFetchingConversationMessages: boolean;
  isStreaming: boolean;
  lastMessagesSyncRef: MutableRefObject<number>;
  pendingSendRef: MutableRefObject<{ content: string; mediaAttachments?: MediaAttachment[] } | null>;
  sendMessage: (payload: { content: string; mediaAttachments?: MediaAttachment[] }) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
};

export function useChatMessageSyncEffects({
  conversationMessages,
  conversationMessagesUpdatedAt,
  fallbackMessageAgent,
  fallbackMessageUser,
  isFetchingConversationMessages,
  isStreaming,
  lastMessagesSyncRef,
  pendingSendRef,
  sendMessage,
  setMessages,
}: UseChatMessageSyncEffectsOptions) {
  useEffect(() => {
    if (isStreaming || isFetchingConversationMessages) return;
    if (!conversationMessages?.messages) return;
    if (conversationMessagesUpdatedAt <= lastMessagesSyncRef.current) return;

    setMessages(
      conversationMessages.messages.map((message) => normalizeServerMessage(message, {
        fallbackUser: fallbackMessageUser,
        fallbackAgent: fallbackMessageAgent,
      })),
    );
    lastMessagesSyncRef.current = conversationMessagesUpdatedAt;
  }, [
    conversationMessages,
    conversationMessagesUpdatedAt,
    fallbackMessageAgent,
    fallbackMessageUser,
    isFetchingConversationMessages,
    isStreaming,
    lastMessagesSyncRef,
    setMessages,
  ]);

  useEffect(() => {
    if (isStreaming || !pendingSendRef.current) return;
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    sendMessage(pending);
  }, [isStreaming, pendingSendRef, sendMessage]);
}
