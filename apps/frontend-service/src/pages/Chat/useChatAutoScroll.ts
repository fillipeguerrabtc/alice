import { useCallback, useEffect, useRef, type RefObject } from 'react';

type UseChatAutoScrollOptions = {
  conversationId?: string;
  messageCount: number;
  isStreaming: boolean;
};

export function useChatAutoScroll(options: UseChatAutoScrollOptions): {
  messagesEndRef: RefObject<HTMLDivElement | null>;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  enableAutoScroll: () => void;
} {
  const { conversationId, messageCount, isStreaming } = options;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  const resolveScrollViewport = useCallback(() => {
    const root = scrollAreaRef.current;
    if (!root) return null;
    return root.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]');
  }, []);

  const updateAutoScroll = useCallback(() => {
    const viewport = scrollViewportRef.current ?? resolveScrollViewport();
    if (!viewport) return;
    scrollViewportRef.current = viewport;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    autoScrollRef.current = distanceFromBottom <= 80;
  }, [resolveScrollViewport]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    autoScrollRef.current = true;
  }, [conversationId]);

  useEffect(() => {
    const viewport = resolveScrollViewport();
    if (!viewport) return;
    scrollViewportRef.current = viewport;
    updateAutoScroll();

    const handleScroll = () => updateAutoScroll();
    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, [resolveScrollViewport, updateAutoScroll]);

  useEffect(() => {
    if (!autoScrollRef.current) return;
    scrollToBottom(isStreaming ? 'auto' : 'smooth');
  }, [isStreaming, messageCount, scrollToBottom]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (!autoScrollRef.current) return;
      scrollToBottom('auto');
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollToBottom]);

  const enableAutoScroll = useCallback(() => {
    autoScrollRef.current = true;
  }, []);

  return {
    messagesEndRef,
    messagesContainerRef,
    scrollAreaRef,
    enableAutoScroll,
  };
}
