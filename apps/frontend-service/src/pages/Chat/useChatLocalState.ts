import { useRef, useState } from 'react';
import type { AgentEvent, MediaAttachment, Message, RuntimeNotice } from './components/types';
import { DEFAULT_REASONING_MODE, type ReasoningMode } from '@/lib/reasoning-mode';

type TrainingDialogMode = 'conversation' | 'messages' | null;

export function useChatLocalState(isMobile: boolean) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStatusLabel, setStreamStatusLabel] = useState<string | null>(null);
  const [streamEvents, setStreamEvents] = useState<AgentEvent[]>([]);
  const [showStreamDiagnostics, setShowStreamDiagnostics] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<MediaAttachment[]>([]);
  const [showTrainingDialog, setShowTrainingDialog] = useState(false);
  const [trainingDialogMode, setTrainingDialogMode] = useState<TrainingDialogMode>(null);
  const [trainingNamespaceId, setTrainingNamespaceId] = useState<string>('');
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteSelectedOpen, setDeleteSelectedOpen] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingStarting, setIsRecordingStarting] = useState(false);
  const [isTranscribingRecording, setIsTranscribingRecording] = useState(false);
  const [lastResponseUsedFallback, setLastResponseUsedFallback] = useState(false);
  const [runtimeNotice, setRuntimeNotice] = useState<RuntimeNotice | null>(null);
  const [selectedAreaNamespaceId, setSelectedAreaNamespaceId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedReasoningMode, setSelectedReasoningMode] = useState<ReasoningMode>(DEFAULT_REASONING_MODE);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingCancelledRef = useRef(false);
  const recordingUnmountedRef = useRef(false);
  const recordingSendModeRef = useRef<'review' | 'direct'>('review');
  const pendingMediaRef = useRef<MediaAttachment[]>([]);
  const inputRef = useRef('');
  const recordingStartingRef = useRef(false);
  const streamControllerRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const pendingSendRef = useRef<{ content: string; mediaAttachments?: MediaAttachment[] } | null>(null);
  const lastMessagesSyncRef = useRef(0);

  return {
    deleteAllOpen,
    deleteSelectedOpen,
    deleteTargetId,
    input,
    inputRef,
    isRecording,
    isRecordingStarting,
    isStreaming,
    isTranscribingRecording,
    lastMessagesSyncRef,
    lastResponseUsedFallback,
    mediaRecorderRef,
    messages,
    mobileDrawerOpen,
    pendingMedia,
    pendingMediaRef,
    pendingSendRef,
    recordingCancelledRef,
    recordingChunksRef,
    recordingSendModeRef,
    recordingStartingRef,
    recordingStreamRef,
    recordingUnmountedRef,
    runtimeNotice,
    setDeleteAllOpen,
    setDeleteSelectedOpen,
    setDeleteTargetId,
    setInput,
    setIsRecording,
    setIsRecordingStarting,
    setIsStreaming,
    setIsTranscribingRecording,
    setLastResponseUsedFallback,
    setMessages,
    setMobileDrawerOpen,
    setPendingMedia,
    setSelectedAgentId,
    setSelectedAreaNamespaceId,
    setSelectedReasoningMode,
    setRuntimeNotice,
    setShowStreamDiagnostics,
    setShowTrainingDialog,
    setSidebarOpen,
    setStreamEvents,
    setStreamStatusLabel,
    setTrainingDialogMode,
    setTrainingNamespaceId,
    showStreamDiagnostics,
    showTrainingDialog,
    sidebarOpen,
    selectedAgentId,
    selectedAreaNamespaceId,
    selectedReasoningMode,
    stopRequestedRef,
    streamControllerRef,
    streamEvents,
    streamStatusLabel,
    trainingDialogMode,
    trainingNamespaceId,
  };
}
