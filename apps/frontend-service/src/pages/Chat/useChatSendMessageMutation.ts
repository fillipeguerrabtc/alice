import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  createChatStreamMutationConfig,
  type ChatStreamMutationOptions,
  type SendMessagePayload,
} from './chat-stream-mutation';

/**
 * Encapsula a mutação principal de streaming para manter o container
 * de Chat focado em composição de hooks.
 */
export function useChatSendMessageMutation(options: ChatStreamMutationOptions) {
  const sendMessageMutation = useMutation(createChatStreamMutationConfig(options));
  const sendMessage = useCallback((payload: SendMessagePayload) => {
    sendMessageMutation.mutate(payload);
  }, [sendMessageMutation]);

  return {
    sendMessage,
    sendMessageMutation,
  };
}
