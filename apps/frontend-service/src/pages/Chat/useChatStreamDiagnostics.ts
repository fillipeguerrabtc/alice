import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import type { AgentEvent } from './components/types';

type UseChatStreamDiagnosticsOptions = {
  setStreamEvents: Dispatch<SetStateAction<AgentEvent[]>>;
  t: TFunction;
};

export function useChatStreamDiagnostics(options: UseChatStreamDiagnosticsOptions) {
  const { setStreamEvents, t } = options;

  const resolveStreamStatus = useCallback((stage?: string) => {
    switch (stage) {
      case 'routing':
        return t('chat.streaming.status.routing');
      case 'history':
        return t('chat.streaming.status.history');
      case 'prompt':
        return t('chat.streaming.status.prompt');
      case 'finalizing':
        return t('chat.streaming.status.finalizing');
      case 'rag_internal':
        return t('chat.streaming.status.ragInternal');
      case 'rag_web':
        return t('chat.streaming.status.ragWeb');
      case 'greeting':
        return t('chat.streaming.status.greeting');
      case 'reuse':
        return t('chat.streaming.status.reuse');
      case 'media':
        return t('chat.streaming.status.media');
      case 'llm':
        return t('chat.streaming.status.llm');
      case 'writing':
        return t('chat.streaming.status.writing');
      case 'refining':
        return t('chat.streaming.status.refining');
      case 'preparing':
      default:
        return t('chat.streaming.status.preparing');
    }
  }, [t]);

  const pushStreamEvent = useCallback((event: AgentEvent) => {
    setStreamEvents((previous) => {
      const next = [...previous, event];
      return next.length > 200 ? next.slice(-200) : next;
    });
  }, [setStreamEvents]);

  const createStatusEvent = useCallback((stage?: string, message?: string): AgentEvent => {
    const resolvedStage = stage?.trim() || 'preparing';
    return {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      phase: 'system',
      action: resolvedStage,
      status: 'in_progress',
      message: message ?? resolveStreamStatus(resolvedStage),
    };
  }, [resolveStreamStatus]);

  return {
    createStatusEvent,
    pushStreamEvent,
    resolveStreamStatus,
  };
}
