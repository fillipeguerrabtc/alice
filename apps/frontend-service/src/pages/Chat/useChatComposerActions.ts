import { useCallback, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from 'react';
import type { Message, MediaAttachment } from './components/types';

type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

type SendMessageFn = (payload: { content: string; mediaAttachments?: MediaAttachment[] }) => void;

type UseChatComposerActionsOptions = {
  clearPendingMedia: (options?: { revokeBlobUrls?: boolean }) => void;
  enableAutoScroll: () => void;
  input: string;
  isAuthenticated: boolean;
  isRecording: boolean;
  isStreaming: boolean;
  messages: Message[];
  notify: NotifyFn;
  pendingMedia: MediaAttachment[];
  pendingSendRef: MutableRefObject<{ content: string; mediaAttachments?: MediaAttachment[] } | null>;
  sendMessage: SendMessageFn;
  setInput: Dispatch<SetStateAction<string>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  stopRequestedRef: MutableRefObject<boolean>;
  streamControllerRef: MutableRefObject<AbortController | null>;
};

export function useChatComposerActions(options: UseChatComposerActionsOptions) {
  const {
    clearPendingMedia,
    enableAutoScroll,
    input,
    isAuthenticated,
    isRecording,
    isStreaming,
    messages,
    notify,
    pendingMedia,
    pendingSendRef,
    sendMessage,
    setInput,
    setMessages,
    stopRequestedRef,
    streamControllerRef,
  } = options;

  const handleStopStreaming = useCallback(() => {
    if (!streamControllerRef.current) return;
    stopRequestedRef.current = true;
    streamControllerRef.current.abort('user_stop');
  }, [stopRequestedRef, streamControllerRef]);

  const handleRegenerate = useCallback(() => {
    if (isStreaming || messages.length === 0) return;
    if (!isAuthenticated) {
      notify({
        title: 'Faça login para continuar',
        description: 'O chat em tempo real está disponível apenas para usuários autenticados.',
      });
      return;
    }

    let lastUserMessageIndex = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') {
        lastUserMessageIndex = i;
        break;
      }
    }

    if (lastUserMessageIndex === -1) return;

    const messagesUpToUser = messages.slice(0, lastUserMessageIndex + 1);
    setMessages(messagesUpToUser);

    const lastUserMessage = messages[lastUserMessageIndex];
    if (lastUserMessage) {
      sendMessage({
        content: lastUserMessage.content || '',
        mediaAttachments: lastUserMessage.mediaAttachments,
      });
    }
  }, [isAuthenticated, isStreaming, messages, notify, sendMessage, setMessages]);

  const handleSend = useCallback(() => {
    if ((!input.trim() && pendingMedia.length === 0) || isRecording) return;
    if (!isAuthenticated) {
      notify({
        title: 'Faça login para continuar',
        description: 'O chat em tempo real está disponível apenas para usuários autenticados.',
      });
      return;
    }

    enableAutoScroll();

    if (isStreaming) {
      pendingSendRef.current = {
        content: input.trim(),
        mediaAttachments: pendingMedia.length > 0 ? [...pendingMedia] : undefined,
      };
      handleStopStreaming();
      setInput('');
      clearPendingMedia({ revokeBlobUrls: false });
      return;
    }

    sendMessage({
      content: input.trim(),
      mediaAttachments: pendingMedia.length > 0 ? [...pendingMedia] : undefined,
    });
    setInput('');
    clearPendingMedia({ revokeBlobUrls: false });
  }, [
    clearPendingMedia,
    enableAutoScroll,
    handleStopStreaming,
    input,
    isAuthenticated,
    isRecording,
    isStreaming,
    notify,
    pendingMedia,
    pendingSendRef,
    sendMessage,
    setInput,
  ]);

  const handleSubmit = useCallback((event: FormEvent) => {
    event.preventDefault();
  }, []);

  return {
    handleRegenerate,
    handleSend,
    handleStopStreaming,
    handleSubmit,
  };
}
