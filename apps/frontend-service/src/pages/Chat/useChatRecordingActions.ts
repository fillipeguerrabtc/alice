import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';
import { frontendLogger } from '@/lib/logger';
import { fileToBase64 } from './chat-media-attachments';
import { prepareRecordingFile, RecordingPreparationError } from './chat-recording-utils';
import { FILE_LIMITS, type MediaAttachment } from './components/types';

type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

type UseChatRecordingActionsOptions = {
  clearPendingMedia: (options?: { revokeBlobUrls?: boolean }) => void;
  conversationId?: string;
  inputRef: MutableRefObject<string>;
  isRecording: boolean;
  isStreaming: boolean;
  mediaRecorderRef: MutableRefObject<MediaRecorder | null>;
  pendingMediaRef: MutableRefObject<MediaAttachment[]>;
  notify: NotifyFn;
  recordingCancelledRef: MutableRefObject<boolean>;
  recordingChunksRef: MutableRefObject<Blob[]>;
  recordingSendModeRef: MutableRefObject<'review' | 'direct'>;
  recordingStartingRef: MutableRefObject<boolean>;
  recordingStreamRef: MutableRefObject<MediaStream | null>;
  recordingUnmountedRef: MutableRefObject<boolean>;
  sendMessage: (payload: { content: string; mediaAttachments?: MediaAttachment[] }) => void;
  setInput: Dispatch<SetStateAction<string>>;
  setIsRecording: Dispatch<SetStateAction<boolean>>;
  setIsTranscribingRecording: Dispatch<SetStateAction<boolean>>;
  setRecordingStartingState: (value: boolean) => void;
  t: TFunction;
};

export function useChatRecordingActions(options: UseChatRecordingActionsOptions) {
  const {
    clearPendingMedia,
    conversationId,
    inputRef,
    isRecording,
    isStreaming,
    mediaRecorderRef,
    pendingMediaRef,
    notify,
    recordingCancelledRef,
    recordingChunksRef,
    recordingSendModeRef,
    recordingStartingRef,
    recordingStreamRef,
    recordingUnmountedRef,
    sendMessage,
    setInput,
    setIsRecording,
    setIsTranscribingRecording,
    setRecordingStartingState,
    t,
  } = options;

  const resolveRecordingMimeType = useCallback(() => {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/wav',
      'audio/mpeg',
      'audio/mp4',
    ];
    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
  }, []);

  const waitForRecordingTranscription = useCallback(async (uploadId: string, attemptsLeft = 30) => {
    for (let attempt = 0; attempt < attemptsLeft; attempt += 1) {
      if (recordingUnmountedRef.current) {
        throw new Error('Transcrição cancelada');
      }
      const response = await apiRequest('GET', `/api/media/${uploadId}`);
      if (!response.ok) {
        throw new Error('Falha ao buscar status do áudio');
      }
      const data = await response.json() as {
        processingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
        transcription?: string | null;
      };
      const status = data.processingStatus ?? 'processing';
      const transcriptionText = data.transcription?.trim() ?? '';
      const hasErrorMarker = transcriptionText.startsWith('[Transcrição não disponível');

      if (status === 'completed') {
        if (transcriptionText && !hasErrorMarker) {
          return transcriptionText;
        }
        if (hasErrorMarker) {
          throw new Error('Falha ao transcrever o áudio');
        }
        throw new Error('Transcrição vazia retornada pelo servidor');
      }
      if (status === 'failed' || hasErrorMarker) {
        throw new Error('Falha ao transcrever o áudio');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('Timeout ao aguardar transcrição do áudio');
  }, [recordingUnmountedRef]);

  const transcribeRecordingAudio = useCallback(async (file: File) => {
    const base64 = await fileToBase64(file);
    const resolvedMimeType = file.type || resolveRecordingMimeType() || 'audio/webm';
    const response = await apiRequest('POST', '/api/media/upload/json', {
      file: base64,
      filename: file.name,
      mimeType: resolvedMimeType,
      conversationId: conversationId ?? undefined,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Falha ao enviar áudio para transcrição');
    }

    const result = await response.json() as {
      uploadId: string;
      processingStatus?: 'pending' | 'processing' | 'completed' | 'failed';
      transcription?: string | null;
    };
    if (result.processingStatus === 'completed' && result.transcription?.trim()) {
      return result.transcription.trim();
    }
    return waitForRecordingTranscription(result.uploadId);
  }, [conversationId, resolveRecordingMimeType, waitForRecordingTranscription]);

  const finalizeRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    const stream = recordingStreamRef.current;
    const cancelled = recordingCancelledRef.current;
    const unmounted = recordingUnmountedRef.current;
    recordingCancelledRef.current = false;

    const mimeType = recorder?.mimeType || 'audio/webm';
    const chunks = recordingChunksRef.current;
    recordingChunksRef.current = [];

    stream?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
    mediaRecorderRef.current = null;

    if (!unmounted) {
      setIsRecording(false);
    }

    if (cancelled || unmounted || chunks.length === 0) {
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size === 0) {
      return;
    }

    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let file: File;

    setIsTranscribingRecording(true);
    try {
      file = await prepareRecordingFile(blob, mimeType, safeTimestamp, FILE_LIMITS.audio);
      const transcription = await transcribeRecordingAudio(file);
      if (recordingUnmountedRef.current) return;
      if (recordingSendModeRef.current === 'direct') {
        const base = inputRef.current.trim();
        const content = base ? `${base}\n${transcription}` : transcription;
        const currentPending = pendingMediaRef.current;
        sendMessage({
          content,
          mediaAttachments: currentPending.length > 0 ? currentPending : undefined,
        });
        setInput('');
        clearPendingMedia({ revokeBlobUrls: false });
      } else {
        setInput((previous) => {
          const base = previous.trim();
          return base.length > 0 ? `${base}\n${transcription}` : transcription;
        });
      }
    } catch (error) {
      if (error instanceof RecordingPreparationError) {
        if (error.code === 'size') {
          notify({
            title: t('chat.recordingConversionTooLarge'),
            description: t('chat.recordingConversionTooLargeDesc'),
            variant: 'destructive',
          });
          return;
        }
        notify({
          title: t('chat.recordingConversionFailed'),
          description: t('chat.recordingConversionFailedDesc'),
          variant: 'destructive',
        });
        frontendLogger.error('Falha ao preparar áudio gravado', { error });
        return;
      }
      const logLabel = recordingSendModeRef.current === 'direct'
        ? 'Falha ao transcrever áudio para envio direto'
        : 'Falha ao transcrever áudio para revisão';
      frontendLogger.error(logLabel, { error });
      notify({
        title: t('chat.recordingTranscriptionFailed'),
        description: t('chat.recordingTranscriptionFailedDesc'),
        variant: 'destructive',
      });
    } finally {
      if (!recordingUnmountedRef.current) {
        setIsTranscribingRecording(false);
      }
    }

    recordingSendModeRef.current = 'review';
  }, [
    clearPendingMedia,
    inputRef,
    mediaRecorderRef,
    notify,
    pendingMediaRef,
    recordingCancelledRef,
    recordingChunksRef,
    recordingSendModeRef,
    recordingStreamRef,
    recordingUnmountedRef,
    sendMessage,
    setInput,
    setIsRecording,
    setIsTranscribingRecording,
    t,
    transcribeRecordingAudio,
  ]);

  const handleStartRecording = useCallback(async () => {
    if (isStreaming || isRecording || recordingStartingRef.current) {
      return;
    }
    setRecordingStartingState(true);

    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingStartingState(false);
      notify({
        title: t('chat.recordingUnsupported'),
        description: t('chat.recordingUnsupportedDesc'),
        variant: 'destructive',
      });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (recordingUnmountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        setRecordingStartingState(false);
        return;
      }
      if (recordingStreamRef.current) {
        recordingStreamRef.current.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      const mimeType = resolveRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        frontendLogger.error('Falha ao gravar áudio', { error: event });
        setRecordingStartingState(false);
        recordingCancelledRef.current = true;
        recorder.stop();
      };

      recorder.onstop = () => {
        void finalizeRecording();
      };

      recorder.start();
      setIsRecording(true);
      setRecordingStartingState(false);
    } catch (error) {
      frontendLogger.error('Permissão negada ou erro ao iniciar gravação', { error });
      setRecordingStartingState(false);
      notify({
        title: t('chat.recordingPermissionDenied'),
        description: t('chat.recordingPermissionDeniedDesc'),
        variant: 'destructive',
      });
    }
  }, [
    finalizeRecording,
    isRecording,
    isStreaming,
    mediaRecorderRef,
    notify,
    recordingCancelledRef,
    recordingChunksRef,
    recordingStartingRef,
    recordingStreamRef,
    recordingUnmountedRef,
    resolveRecordingMimeType,
    setIsRecording,
    setRecordingStartingState,
    t,
  ]);

  const handleStopRecordingReview = useCallback(() => {
    if (!isRecording) return;
    recordingSendModeRef.current = 'review';
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else if (!recordingUnmountedRef.current) {
      setIsRecording(false);
    }
  }, [isRecording, mediaRecorderRef, recordingSendModeRef, recordingUnmountedRef, setIsRecording]);

  const handleSendRecordingNow = useCallback(() => {
    if (!isRecording || isStreaming) return;
    recordingSendModeRef.current = 'direct';
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    } else if (!recordingUnmountedRef.current) {
      setIsRecording(false);
    }
  }, [isRecording, isStreaming, mediaRecorderRef, recordingSendModeRef, recordingUnmountedRef, setIsRecording]);

  return {
    handleSendRecordingNow,
    handleStartRecording,
    handleStopRecordingReview,
  };
}
