import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

type SelectableChatMessage = {
  id: string;
  role?: string | null;
};

type UseChatSelectionStateOptions = {
  conversationId?: string;
  messages: SelectableChatMessage[];
};

type UseChatSelectionStateResult = {
  isSelectionMode: boolean;
  selectedConversationIds: Set<string>;
  messageSelectionMode: boolean;
  selectedMessageIds: Set<string>;
  setMessageSelectionMode: Dispatch<SetStateAction<boolean>>;
  setSelectedMessageIds: Dispatch<SetStateAction<Set<string>>>;
  toggleMessageSelection: (messageId: string, index: number, shiftKey: boolean) => void;
  toggleConversationSelectionMode: () => void;
  toggleConversationSelection: (conversationId: string) => void;
  clearConversationSelection: () => void;
};

export function useChatSelectionState(
  options: UseChatSelectionStateOptions,
): UseChatSelectionStateResult {
  const { conversationId, messages } = options;
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
  const [messageSelectionMode, setMessageSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const lastSelectedMessageIndex = useRef<number | null>(null);

  useEffect(() => {
    setSelectedMessageIds(new Set());
    setMessageSelectionMode(false);
    lastSelectedMessageIndex.current = null;
  }, [conversationId]);

  const toggleMessageSelection = useCallback(
    (messageId: string, index: number, shiftKey: boolean) => {
      setSelectedMessageIds((prev) => {
        const next = new Set(prev);
        if (shiftKey && lastSelectedMessageIndex.current !== null) {
          const start = Math.min(lastSelectedMessageIndex.current, index);
          const end = Math.max(lastSelectedMessageIndex.current, index);
          for (let i = start; i <= end; i += 1) {
            const target = messages[i];
            if (target?.id && target.role !== 'system') {
              next.add(target.id);
            }
          }
        } else if (next.has(messageId)) {
          next.delete(messageId);
        } else {
          next.add(messageId);
        }
        lastSelectedMessageIndex.current = index;
        return next;
      });
    },
    [messages],
  );

  const toggleConversationSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => !prev);
    setSelectedConversationIds(new Set());
  }, []);

  const toggleConversationSelection = useCallback((conversationIdToToggle: string) => {
    setSelectedConversationIds((prev) => {
      const next = new Set(prev);
      if (next.has(conversationIdToToggle)) {
        next.delete(conversationIdToToggle);
      } else {
        next.add(conversationIdToToggle);
      }
      return next;
    });
  }, []);

  const clearConversationSelection = useCallback(() => {
    setSelectedConversationIds(new Set());
    setIsSelectionMode(false);
  }, []);

  return {
    isSelectionMode,
    selectedConversationIds,
    messageSelectionMode,
    selectedMessageIds,
    setMessageSelectionMode,
    setSelectedMessageIds,
    toggleMessageSelection,
    toggleConversationSelectionMode,
    toggleConversationSelection,
    clearConversationSelection,
  };
}
