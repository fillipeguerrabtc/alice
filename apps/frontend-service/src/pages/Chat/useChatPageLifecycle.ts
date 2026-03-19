import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { MediaAttachment } from './components/types';

type UseChatPageLifecycleOptions = {
  conversationId?: string;
  input: string;
  inputRef: MutableRefObject<string>;
  isMobile: boolean;
  lastMessagesSyncRef: MutableRefObject<number>;
  mediaRecorderRef: MutableRefObject<MediaRecorder | null>;
  pendingMedia: MediaAttachment[];
  pendingMediaRef: MutableRefObject<MediaAttachment[]>;
  optimisticConversationSyncRef: MutableRefObject<{ conversationId: string; minimumMessageCount: number } | null>;
  recordingCancelledRef: MutableRefObject<boolean>;
  recordingStartingRef: MutableRefObject<boolean>;
  recordingStreamRef: MutableRefObject<MediaStream | null>;
  recordingUnmountedRef: MutableRefObject<boolean>;
  setIsRecordingStarting: Dispatch<SetStateAction<boolean>>;
  setMobileDrawerOpen: Dispatch<SetStateAction<boolean>>;
};

export function useChatPageLifecycle(options: UseChatPageLifecycleOptions) {
  const {
    conversationId,
    input,
    inputRef,
    isMobile,
    lastMessagesSyncRef,
    mediaRecorderRef,
    pendingMedia,
    pendingMediaRef,
    optimisticConversationSyncRef,
    recordingCancelledRef,
    recordingStartingRef,
    recordingStreamRef,
    recordingUnmountedRef,
    setIsRecordingStarting,
    setMobileDrawerOpen,
  } = options;

  useEffect(() => {
    if (!isMobile) return;
    setMobileDrawerOpen(false);
  }, [conversationId, isMobile, setMobileDrawerOpen]);

  useEffect(() => {
    pendingMediaRef.current = pendingMedia;
  }, [pendingMedia, pendingMediaRef]);

  useEffect(() => {
    inputRef.current = input;
  }, [input, inputRef]);

  useEffect(() => {
    lastMessagesSyncRef.current = 0;
  }, [conversationId, lastMessagesSyncRef]);

  useEffect(() => {
    if (!conversationId) {
      optimisticConversationSyncRef.current = null;
      return;
    }

    if (
      optimisticConversationSyncRef.current
      && optimisticConversationSyncRef.current.conversationId !== conversationId
    ) {
      optimisticConversationSyncRef.current = null;
    }
  }, [conversationId, optimisticConversationSyncRef]);

  const setRecordingStartingState = useCallback((value: boolean) => {
    recordingStartingRef.current = value;
    setIsRecordingStarting(value);
  }, [recordingStartingRef, setIsRecordingStarting]);

  useEffect(() => {
    return () => {
      recordingUnmountedRef.current = true;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        recordingCancelledRef.current = true;
        mediaRecorderRef.current.stop();
      }
      if (recordingStreamRef.current) {
        recordingStreamRef.current.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
      }
    };
  }, [mediaRecorderRef, recordingCancelledRef, recordingStreamRef, recordingUnmountedRef]);

  return {
    setRecordingStartingState,
  };
}
