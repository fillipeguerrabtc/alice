/**
 * Training - Gestão de Fine-tuning
 * 
 * Gate 2 (16/01/2026):
 * Página para gerenciar dados de treinamento e jobs de fine-tuning (QLoRA)
 * usando o MESMO modelo base do LLM (texto) em produção (Qwen3 8B),
 * com execução via Training Service + gpu-trainer (sob demanda).
 * 
 * Funcionalidades:
 * - Gestão de dados de treinamento
 * - Jobs de fine-tuning (QLoRA)
 * - Schedule semanal (domingo 3:00 AM)
 * - Treinamento on-demand
 * - Bulk import de dados
 * - Upload multimodal (imagens, áudio)
 * 
 * Regra 6 - SEM MOCKS: Apenas dados reais da API
 * Regra 10 - Documentação PT-BR
 * Regra 13 - Internacionalização i18next
 * 
 * Autor: Fillipe Guerra
 * Data: 16 de Janeiro de 2026
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { z } from 'zod';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/use-auth';
import { TIMEZONE } from '@/lib/i18n';
import {
  Brain,
  Play,
  CheckCircle2,
  Clock,
  RefreshCw,
  Zap,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WorkspaceFilterBar } from '@/components/ui/workspace-filter-bar';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError, apiRequest } from '@/lib/queryClient';
import { formatDateTime } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { frontendLogger } from '@/lib/logger';
import { TrainingAutoLearningTabContent } from './training/components/training-auto-learning-tab-content';
import { TrainingBatchReviewDialog } from './training/components/training-batch-review-dialog';
import { TrainingBulkImportTabContent } from './training/components/training-bulk-import-tab-content';
import { TrainingCreateJobDialog } from './training/components/training-create-job-dialog';
import { TrainingDataCard } from './training/components/training-data-card';
import { TrainingDataTabContent } from './training/components/training-data-tab-content';
import { TrainingJobDetailModal } from './training/components/training-job-detail-modal';
import { TrainingJobCard } from './training/components/training-job-card';
import { TrainingJobsTabContent } from './training/components/training-jobs-tab-content';
import { TrainingMultimodalTabContent } from './training/components/training-multimodal-tab-content';
import { TrainingOnDemandRunDialog } from './training/components/training-on-demand-run-dialog';
import { TrainingOrchestratorControlsCard } from './training/components/training-orchestrator-controls-card';
import { TrainingPostTrainingDialog } from './training/components/training-post-training-dialog';
import { TrainingPromoteDialog } from './training/components/training-promote-dialog';
import { TrainingResolveScopeDialog } from './training/components/training-resolve-scope-dialog';
import { TrainingRuntimeBanner } from './training/components/training-runtime-banner';
import { TrainingRuntimeCard } from './training/components/training-runtime-card';
import { TrainingRollbackDialog } from './training/components/training-rollback-dialog';
import { TrainingReviewDialog } from './training/components/training-review-dialog';
import {
  type TrainingHyperparams,
} from '../../../../packages/shared-utils/src/training-config';
import {
  TRADING_TRAINING_DOMAIN,
  TRADING_TRAINING_EXTERNAL_SOURCE_TYPE,
  TRADING_TRAINING_SOURCE_TYPES,
} from '../../../../packages/shared/src/trading-training';
import {
  parseTrainingHyperparamsConfig,
  TRAINING_SYSTEM_CONFIG_DEFAULTS,
  type TrainingHyperparamsPreset,
} from './training/training-hyperparams-config';
import {
  TRAINING_TAB_DESCRIPTORS,
  TRAINING_WORKSPACE_LABELS,
  TRAINING_WORKSPACE_TABS,
  type TrainingTabKey,
  type TrainingWorkspaceKey,
} from './training/training-navigation-config';
import {
  buildTrainingIdempotencyFingerprint,
  generateTrainingIdempotencyKey,
  getRetryAfterHint,
} from './training/training-request-utils';

interface TrainingData {
  id: string;
  source: string;
  sourceType?: string | null;
  sourceId?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
  namespaceId?: string | null;
  agentId?: string | null;
  inferredNamespaceId?: string | null;
  inferredAgentId?: string | null;
  inferredDomain?: string | null;
  inferenceConfidence?: number | null;
  needsHumanReview?: boolean | null;
  quarantineReason?: string | null;
  inferenceTrace?: { suggestedNewNamespace?: { name: string; theme: string } } | null;
  messages: Array<{ role: string; content: string }>;
  rating: number | null;
  qualityScore?: number | null;
  status: 'pending' | 'approved' | 'rejected' | 'reserved' | 'used';
  isDuplicate: boolean;
  duplicateOfId?: string | null;
  similarityScore: number | null;
  profileVersion?: number | null;
  createdBy?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  criadoEm: string;
}

interface FineTuningJob {
  id: string;
  name: string;
  baseModel: string;
  status: 'pending' | 'preparing' | 'training' | 'validating' | 'completed' | 'failed' | 'cancelled';
  runSource?: 'custom_job' | 'on_demand' | 'scheduled';
  trainingDataCount: number | null;
  validationDataCount?: number | null;
  evaluationStatus?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  promotionStatus?: 'candidate' | 'staged' | 'activating' | 'active' | 'rollback_pending' | 'failed_activation' | 'archived' | 'rejected' | 'rolled_back';
  modelVersionId?: string | null;
  scopeNamespaceId?: string | null;
  scopeAgentId?: string | null;
  hyperparameters: {
    epochs?: number;
    learningRate?: number;
    batchSize?: number;
    gradientAccumulationSteps?: number;
    warmupSteps?: number;
    maxSeqLen?: number;
    loraRank?: number;
    loraAlpha?: number;
    loraDropout?: number;
    lrSchedulerType?: string;
    maxGradNorm?: number;
    targetModules?: string[];
  };
  configSnapshot?: {
    priority?: 'low' | 'normal' | 'high';
    execution?: {
      trigger?: 'manual' | 'schedule';
      profile?: 'quick_run' | 'advanced_job' | 'scheduled_policy';
    };
  } | null;
  progress: number | null;
  metrics: Record<string, unknown> | null;
  iniciadoEm: string | null;
  completadoEm?: string | null;
  criadoEm: string;
  errorMessage?: string | null;
}

interface TrainingDataResponse {
  trainingData: TrainingData[];
}

interface JobsResponse {
  jobs: FineTuningJob[];
}

interface Namespace {
  id: string;
  nome: string;
  slug: string;
}

type AutoLearningStatusResponse = {
  activeModel: {
    version: number;
    name: string;
    improvementPercent: number;
    trainingDataUsed: number;
    imagesUsed: number;
  };
  pendingData: {
    trainingEntries: number;
    images: number;
  };
  recentVersions: Array<{
    version: number;
    status: string;
    createdAt: string;
  }>;
  upcomingSchedules: Array<{
    id: string;
    type: 'incremental_fine_tuning' | 'complete_fine_tuning';
    scheduledFor: string;
    status: string;
    namespaceId: string | null;
  }>;
};

type TrainingRunStatusResponse =
  | {
      hasRunningTraining: false;
      status: 'idle';
      message: string;
    }
  | {
      hasRunningTraining: true;
      status: 'training';
      currentJob: {
        id: string;
        name: string;
        baseModel: string;
        trainingDataCount: number | null;
        progress: number;
        elapsedSeconds: number;
        startedAt: string | null;
      };
    };

type TrainingQueueStatusResponse = {
  queues: Array<{
    queue: string;
    pending: number;
    lag: number;
    dlq: number;
  }>;
  governance: {
    maxInflightRunsPerTenant: number;
    requireEvalPassedForPromotion: boolean;
    requireDualApprovalForPromotion: boolean;
    promotionMinApprovals: number;
    requireIdempotencyKeyForRunStart?: boolean;
    requireStrictApprovedDataForAutoEngine?: boolean;
    enforceMinInferenceConfidence?: boolean;
    tradingMinInferenceConfidence?: number;
  };
  tenant: {
    id: string;
    inflightCount: number;
  };
};

type TrainingExecutionModesResponse = {
  tenantId: string;
  modes: Array<{
    id: 'quick_run' | 'advanced_job' | 'auto_schedule';
    runSource: 'on_demand' | 'custom_job' | 'scheduled';
    endpoint: string;
    scope: 'tenant_or_namespace' | 'namespace_required';
    trigger: 'manual_immediate' | 'cron_recurring';
    datasetPolicy: {
      source: string;
      minApprovedData?: number;
      minApprovedDataIncremental?: number;
      minApprovedDataFull?: number;
    };
    hyperparametersPolicy: string;
    schedulePolicy: string;
  }>;
  governance: {
    maxInflightRunsPerTenant: number;
    requireEvalPassedForPromotion: boolean;
    requireDualApprovalForPromotion: boolean;
    promotionMinApprovals: number;
    requireIdempotencyKeyForRunStart?: boolean;
    requireStrictApprovedDataForAutoEngine?: boolean;
    enforceMinInferenceConfidence?: boolean;
    tradingMinInferenceConfidence?: number;
  };
};

type TrainingHyperparamsForm = TrainingHyperparams;

type TrainingSystemConfigRuntime = {
  minOndemandDatasetSize: number;
  minScheduledDatasetSizeIncremental: number;
  minScheduledDatasetSizeFull: number;
  qualityMinRatio: number;
  datasetMaxRows: number;
  trainEvalSplitRatio: number;
  sliceSteps: number;
  gpuTimeoutMs: number;
  maxSeqLen: number;
  autoLearningCronIncremental: string;
  autoLearningCronFull: string;
  autoLearningIncludeImages: boolean;
  defaultHyperparams: TrainingHyperparamsForm;
  presets: Record<TrainingHyperparamsPreset, TrainingHyperparamsForm>;
};

const TRAINING_OPERATOR_ROLES = new Set(['admin', 'super_admin', 'superadmin']);
const ORCHESTRATOR_TRANSITION_STATES = new Set([
  'serving_draining',
  'training_starting',
  'training_finishing',
  'serving_restoring',
]);

const ORCHESTRATOR_STABLE_STATES = new Set([
  'serving_ready',
  'training_active',
]);

const orchestratorStateSchema = z.enum([
  'serving_ready',
  'serving_draining',
  'training_starting',
  'training_active',
  'training_finishing',
  'serving_restoring',
  'error',
]);

const runtimeModeSchema = z.enum([
  'serving',
  'switching_to_training',
  'training',
  'switching_to_serving',
]);

type OrchestratorFsmState = z.infer<typeof orchestratorStateSchema>;
type InferenceAvailability = 'available' | 'unavailable' | 'unknown';

const gpuOrchestratorStateResponseSchema = z.object({
  state: orchestratorStateSchema.optional(),
  fsmState: orchestratorStateSchema.optional(),
  orchestratorAvailable: z.boolean().optional(),
  orchestrationMode: z.enum(['preemptive', 'simultaneous']).optional(),
  durableState: z.object({
    runtimeMode: runtimeModeSchema,
    orchestratorState: orchestratorStateSchema,
    lastReason: z.string().nullable().optional(),
    updatedAt: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }).nullable().optional(),
  recentEvents: z.array(
    z.object({
      eventType: z.string(),
      reason: z.string().nullable().optional(),
      createdAt: z.string().optional(),
      requestId: z.string().nullable().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
  ).optional(),
});

type GpuOrchestratorStateResponse = z.infer<typeof gpuOrchestratorStateResponseSchema>;

const trainingSystemConfigSchema = z.object({
  MIN_ONDEMAND_DATASET_SIZE: z.coerce.number().int().min(1),
  MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL: z.coerce.number().int().min(1),
  MIN_SCHEDULED_DATASET_SIZE_FULL: z.coerce.number().int().min(1),
  TRAINING_QUALITY_MIN_RATIO: z.coerce.number().min(0).max(1),
  TRAINING_DATASET_MAX_ROWS: z.coerce.number().int().min(100),
  TRAINING_TRAIN_EVAL_SPLIT_RATIO: z.coerce.number().min(0.5).max(0.99),
  TRAINING_SLICE_STEPS: z.coerce.number().int().min(1),
  TRAINING_GPU_TIMEOUT_MS: z.coerce.number().int().min(10000),
  maxSeqLen: z.coerce.number().int().min(256).max(32768),
  AUTO_LEARNING_CRON_INCREMENTAL: z.string().min(1),
  AUTO_LEARNING_CRON_FULL: z.string().min(1),
  AUTO_LEARNING_INCLUDE_IMAGES: z.string().transform((raw) => raw.trim().toLowerCase() === 'true'),
  TRAINING_DEFAULT_HYPERPARAMS_JSON: z.string().min(2),
  TRAINING_PRESET_SAFE_JSON: z.string().min(2).optional(),
  TRAINING_PRESET_STANDARD_JSON: z.string().min(2).optional(),
  TRAINING_PRESET_LARGE_JSON: z.string().min(2).optional(),
});

function getScopeLabel(job: FineTuningJob, namespacesById: Map<string, string>, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (job.scopeAgentId) {
    return t('training.scope.agent', { id: job.scopeAgentId.slice(0, 8) });
  }
  if (job.scopeNamespaceId) {
    return t('training.scope.namespace', {
      name: namespacesById.get(job.scopeNamespaceId) ?? job.scopeNamespaceId.slice(0, 8),
    });
  }
  return t('training.scope.tenant');
}

function getScheduleScopeLabel(
  namespaceId: string | null | undefined,
  namespacesById: Map<string, string>,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (!namespaceId) {
    return t('training.scope.tenant');
  }
  return t('training.scope.namespace', {
    name: namespacesById.get(namespaceId) ?? namespaceId.slice(0, 8),
  });
}

function normalizeUserRole(role: string | null | undefined): string | null {
  if (!role) {
    return null;
  }
  const normalized = role.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function inferRuntimeModeFromFsmState(state: OrchestratorFsmState | null): z.infer<typeof runtimeModeSchema> | null {
  if (!state) {
    return null;
  }
  if (state === 'serving_ready' || state === 'serving_draining' || state === 'serving_restoring') {
    return 'serving';
  }
  if (state === 'training_active' || state === 'training_starting' || state === 'training_finishing') {
    return 'training';
  }
  return null;
}

function extractStringFromMetadata(
  metadata: Record<string, unknown> | undefined,
  candidates: string[],
): string | null {
  if (!metadata) {
    return null;
  }

  for (const key of candidates) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function resolveLinkedRunFromRecentEvents(
  runtimeState: GpuOrchestratorStateResponse | undefined,
): { linkedRunId: string | null; linkedRunName: string | null } {
  if (!runtimeState?.recentEvents?.length) {
    return { linkedRunId: null, linkedRunName: null };
  }

  const runIdKeys = ['runId', 'trainingRunId', 'fineTuningRunId', 'fineTuningJobId', 'jobId'];
  const runNameKeys = ['runName', 'jobName'];
  for (const event of runtimeState.recentEvents) {
    const linkedRunId = extractStringFromMetadata(event.metadata, runIdKeys);
    if (!linkedRunId) {
      continue;
    }
    return {
      linkedRunId,
      linkedRunName: extractStringFromMetadata(event.metadata, runNameKeys),
    };
  }

  return { linkedRunId: null, linkedRunName: null };
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { type: 'spring' as const, stiffness: 100, damping: 15 },
  },
} as const;

export default function Training() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const locale = user?.idioma ?? 'pt-BR';
  const timeZone = user?.timezone ?? TIMEZONE;
  const queryClient = useQueryClient();
  const tenantId = user?.tenantId;
  const normalizedUserRoles = useMemo(() => {
    const roleSet = new Set<string>();
    const primaryRole = normalizeUserRole(user?.role);
    if (primaryRole) {
      roleSet.add(primaryRole);
    }
    for (const role of user?.roles ?? []) {
      const normalizedRole = normalizeUserRole(role);
      if (normalizedRole) {
        roleSet.add(normalizedRole);
      }
    }
    return Array.from(roleSet);
  }, [user?.role, user?.roles]);
  const isTrainingOperatorRole = useMemo(
    () => normalizedUserRoles.some((role) => TRAINING_OPERATOR_ROLES.has(role)),
    [normalizedUserRoles],
  );
  
  const [activeTab, setActiveTab] = useState<TrainingTabKey>('data');
  const [activeWorkspace, setActiveWorkspace] = useState<TrainingWorkspaceKey>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [namespaceFilter, setNamespaceFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>('all');
  const [quarantineFilter, setQuarantineFilter] = useState<string>('all');
  const [duplicateFilter, setDuplicateFilter] = useState<string>('all');
  const [autoCollectFilter, setAutoCollectFilter] = useState<string>('all');
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [createJobNamespaceId, setCreateJobNamespaceId] = useState<string>('');
  const [showOnDemandRun, setShowOnDemandRun] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{ id: string; status: 'approved' | 'rejected'; entry: TrainingData } | null>(null);
  const [selectedDataIds, setSelectedDataIds] = useState<Set<string>>(new Set());
  const [batchReviewDialogOpen, setBatchReviewDialogOpen] = useState(false);
  const [batchReviewAction, setBatchReviewAction] = useState<'approve' | 'reject'>('approve');
  const [batchReviewNotes, setBatchReviewNotes] = useState('');

  const [resolveScopeDialogOpen, setResolveScopeDialogOpen] = useState(false);
  const [resolveScopeEntry, setResolveScopeEntry] = useState<TrainingData | null>(null);
  const [resolveScopeNamespaceId, setResolveScopeNamespaceId] = useState('');
  const [resolveScopeReason, setResolveScopeReason] = useState('Correção manual do escopo inferido');
  const [resolveScopeDomain, setResolveScopeDomain] = useState('');
  const [resolveScopeAgentId, setResolveScopeAgentId] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [overrideScopeEnabled, setOverrideScopeEnabled] = useState(false);
  const [overrideNamespaceId, setOverrideNamespaceId] = useState('');
  const [overrideAgentId, setOverrideAgentId] = useState('');
  const [overrideDomain, setOverrideDomain] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const visibleTabs = useMemo(() => {
    const allowed = TRAINING_WORKSPACE_TABS[activeWorkspace];
    return TRAINING_TAB_DESCRIPTORS.filter((tab) => allowed.includes(tab.value));
  }, [activeWorkspace]);

  const handleTrainingWorkspaceChange = useCallback((workspace: TrainingWorkspaceKey) => {
    setActiveWorkspace(workspace);
    if (workspace === 'all') return;
    const allowed = TRAINING_WORKSPACE_TABS[workspace];
    if (!allowed.includes(activeTab)) {
      setActiveTab(allowed[0] ?? 'data');
    }
  }, [activeTab]);

  const handleTrainingTabChange = useCallback((nextTab: string) => {
    const normalized = TRAINING_TAB_DESCRIPTORS.find((tab) => tab.value === nextTab)?.value;
    if (!normalized) return;
    setActiveTab(normalized);
    if (activeWorkspace !== 'all' && !TRAINING_WORKSPACE_TABS[activeWorkspace].includes(normalized)) {
      setActiveWorkspace('all');
    }
  }, [activeWorkspace]);

  const systemConfigQueryKey = ['training', 'system-config'] as const;
  const { data: systemConfigRaw } = useQuery<Record<string, string>>({
    queryKey: systemConfigQueryKey,
    queryFn: async () => {
      try {
        const response = await apiRequest('GET', '/api/training/system-config');
        if (!response.ok) {
          throw new Error(`status=${response.status}`);
        }
        return response.json() as Promise<Record<string, string>>;
      } catch (error) {
        frontendLogger.warn('Falha ao obter system config de training; aplicando defaults locais', {
          error: error instanceof Error ? error.message : String(error),
        });
        return { ...TRAINING_SYSTEM_CONFIG_DEFAULTS };
      }
    },
    staleTime: 1000 * 30,
  });

  const trainingSystemConfig = useMemo<TrainingSystemConfigRuntime>(() => {
    const source: Record<string, string> = {
      ...TRAINING_SYSTEM_CONFIG_DEFAULTS,
      ...(systemConfigRaw ?? {}),
    };
    const parsedResult = trainingSystemConfigSchema.safeParse(source);
    const parsed = parsedResult.success
      ? parsedResult.data
      : trainingSystemConfigSchema.parse(TRAINING_SYSTEM_CONFIG_DEFAULTS);

    if (!parsedResult.success) {
      frontendLogger.warn('Shape invalido de training system config; aplicando defaults seguros', {
        errors: parsedResult.error.flatten(),
      });
    }

    const defaultHyperparams = parseTrainingHyperparamsConfig(
      parsed.TRAINING_DEFAULT_HYPERPARAMS_JSON,
      'TRAINING_DEFAULT_HYPERPARAMS_JSON',
    );
    const safePreset = parseTrainingHyperparamsConfig(
      parsed.TRAINING_PRESET_SAFE_JSON ?? parsed.TRAINING_DEFAULT_HYPERPARAMS_JSON,
      'TRAINING_PRESET_SAFE_JSON',
    );
    const standardPreset = parseTrainingHyperparamsConfig(
      parsed.TRAINING_PRESET_STANDARD_JSON ?? parsed.TRAINING_DEFAULT_HYPERPARAMS_JSON,
      'TRAINING_PRESET_STANDARD_JSON',
    );
    const largePreset = parseTrainingHyperparamsConfig(
      parsed.TRAINING_PRESET_LARGE_JSON ?? parsed.TRAINING_DEFAULT_HYPERPARAMS_JSON,
      'TRAINING_PRESET_LARGE_JSON',
    );

    return {
      minOndemandDatasetSize: parsed.MIN_ONDEMAND_DATASET_SIZE,
      minScheduledDatasetSizeIncremental: parsed.MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL,
      minScheduledDatasetSizeFull: parsed.MIN_SCHEDULED_DATASET_SIZE_FULL,
      qualityMinRatio: parsed.TRAINING_QUALITY_MIN_RATIO,
      datasetMaxRows: parsed.TRAINING_DATASET_MAX_ROWS,
      trainEvalSplitRatio: parsed.TRAINING_TRAIN_EVAL_SPLIT_RATIO,
      sliceSteps: parsed.TRAINING_SLICE_STEPS,
      gpuTimeoutMs: parsed.TRAINING_GPU_TIMEOUT_MS,
      maxSeqLen: parsed.maxSeqLen,
      autoLearningCronIncremental: parsed.AUTO_LEARNING_CRON_INCREMENTAL,
      autoLearningCronFull: parsed.AUTO_LEARNING_CRON_FULL,
      autoLearningIncludeImages: parsed.AUTO_LEARNING_INCLUDE_IMAGES,
      defaultHyperparams,
      presets: {
        safe: safePreset,
        standard: standardPreset,
        large: largePreset,
      },
    };
  }, [systemConfigRaw]);

  // Auto-learning (status + schedules) - Gate 2
  const autoLearningQueryKey = [
    'training',
    'auto-learning',
    'status',
    tenantId ?? null,
  ] as const;

  const { data: autoLearning, isLoading: autoLearningLoading } = useQuery<AutoLearningStatusResponse>({
    queryKey: autoLearningQueryKey,
    queryFn: async () => {
      const url = tenantId
        ? `/api/training/auto-learning/status?tenantId=${encodeURIComponent(tenantId)}`
        : '/api/training/auto-learning/status';
      const res = await apiRequest('GET', url);
      return res.json();
    },
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60,
  });

  const runStatusQueryKey = ['training', 'run', 'status', tenantId ?? null] as const;

  const { data: runStatus, isLoading: runStatusLoading } = useQuery<TrainingRunStatusResponse>({
    queryKey: runStatusQueryKey,
    queryFn: async () => {
      const url = tenantId
        ? `/api/training/run/status?tenantId=${encodeURIComponent(tenantId)}`
        : '/api/training/run/status';
      const res = await apiRequest('GET', url);
      return res.json();
    },
    staleTime: 1000 * 15,
    refetchInterval: 1000 * 15,
  });

  const orchestratorStateQueryKey = ['training', 'gpu-orchestrator', 'state'] as const;
  const {
    data: orchestratorState,
    isLoading: orchestratorStateLoading,
    isError: orchestratorStateError,
  } = useQuery<GpuOrchestratorStateResponse | undefined>({
    queryKey: orchestratorStateQueryKey,
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/training/gpu-orchestrator/state');
      const payload = (await response.json()) as unknown;
      const parsed = gpuOrchestratorStateResponseSchema.safeParse(payload);
      if (!parsed.success) {
        frontendLogger.warn('Payload invalido em /api/training/gpu-orchestrator/state', {
          issues: parsed.error.issues,
        });
        return undefined;
      }
      return parsed.data;
    },
    staleTime: 1000 * 5,
    refetchInterval: (query) => {
      const payload = query.state.data;
      const fsmState = payload?.fsmState ?? payload?.state ?? payload?.durableState?.orchestratorState;
      if (fsmState && ORCHESTRATOR_TRANSITION_STATES.has(fsmState)) {
        return 2000;
      }
      return 10000;
    },
  });

  const runtimeFsmState = useMemo<OrchestratorFsmState | null>(() => {
    return orchestratorState?.fsmState
      ?? orchestratorState?.state
      ?? orchestratorState?.durableState?.orchestratorState
      ?? null;
  }, [orchestratorState]);

  const runtimeMode = useMemo(() => {
    return orchestratorState?.durableState?.runtimeMode
      ?? inferRuntimeModeFromFsmState(runtimeFsmState);
  }, [orchestratorState?.durableState?.runtimeMode, runtimeFsmState]);

  const runtimeTransitionState = useMemo(() => {
    if (!runtimeFsmState) {
      return null;
    }
    if (ORCHESTRATOR_STABLE_STATES.has(runtimeFsmState)) {
      return null;
    }
    return runtimeFsmState;
  }, [runtimeFsmState]);

  const runtimeReason = useMemo(() => {
    return orchestratorState?.durableState?.lastReason
      ?? orchestratorState?.recentEvents?.[0]?.reason
      ?? null;
  }, [orchestratorState?.durableState?.lastReason, orchestratorState?.recentEvents]);

  const linkedRunFromEvents = useMemo(
    () => resolveLinkedRunFromRecentEvents(orchestratorState),
    [orchestratorState],
  );

  const linkedRuntimeRun = useMemo(() => {
    if (runStatus?.hasRunningTraining) {
      return {
        linkedRunId: runStatus.currentJob.id,
        linkedRunName: runStatus.currentJob.name,
      };
    }
    return linkedRunFromEvents;
  }, [linkedRunFromEvents, runStatus]);

  const hasRunningTraining = runStatus?.hasRunningTraining === true;

  const inferenceAvailability = useMemo<InferenceAvailability>(() => {
    const orchestratorAvailable = orchestratorState?.orchestratorAvailable;

    if (runtimeFsmState === 'serving_ready' && orchestratorAvailable !== false) {
      return 'available';
    }

    if (!runtimeFsmState) {
      return hasRunningTraining ? 'unavailable' : 'unknown';
    }

    if (orchestratorAvailable === false) {
      return 'unavailable';
    }

    if (runtimeFsmState === 'error') {
      return 'unavailable';
    }

    if (runtimeFsmState === 'training_active' || ORCHESTRATOR_TRANSITION_STATES.has(runtimeFsmState)) {
      return 'unavailable';
    }

    return orchestratorStateError ? 'unknown' : 'unavailable';
  }, [hasRunningTraining, orchestratorState?.orchestratorAvailable, orchestratorStateError, runtimeFsmState]);

  const queueStatusQueryKey = ['training', 'queue', 'status', tenantId ?? null] as const;
  const { data: queueStatus, isLoading: queueStatusLoading } = useQuery<TrainingQueueStatusResponse>({
    queryKey: queueStatusQueryKey,
    queryFn: async () => {
      const url = tenantId
        ? `/api/training/queue/status?tenantId=${encodeURIComponent(tenantId)}`
        : '/api/training/queue/status';
      const res = await apiRequest('GET', url);
      return res.json();
    },
    staleTime: 1000 * 15,
    refetchInterval: 1000 * 15,
    enabled: Boolean(tenantId),
  });

  const executionModesQueryKey = ['training', 'execution-modes', tenantId ?? null] as const;
  const { data: executionModes } = useQuery<TrainingExecutionModesResponse>({
    queryKey: executionModesQueryKey,
    queryFn: async () => {
      const url = tenantId
        ? `/api/training/execution-modes?tenantId=${encodeURIComponent(tenantId)}`
        : '/api/training/execution-modes';
      const res = await apiRequest('GET', url);
      return res.json();
    },
    staleTime: 1000 * 60,
    enabled: Boolean(tenantId),
  });

  const executionModesHint = useMemo(() => {
    const quickMode = executionModes?.modes.find((mode) => mode.id === 'quick_run');
    const advancedMode = executionModes?.modes.find((mode) => mode.id === 'advanced_job');
    const scheduleMode = executionModes?.modes.find((mode) => mode.id === 'auto_schedule');
    const quickMin = quickMode?.datasetPolicy.minApprovedData;
    const advancedMin = advancedMode?.datasetPolicy.minApprovedData;
    const scheduleIncMin = scheduleMode?.datasetPolicy.minApprovedDataIncremental;
    const scheduleFullMin = scheduleMode?.datasetPolicy.minApprovedDataFull;

    if (
      typeof quickMin === 'number'
      && typeof advancedMin === 'number'
      && typeof scheduleIncMin === 'number'
      && typeof scheduleFullMin === 'number'
    ) {
      return t('training.executionModesHintDynamic', {
        quickMin,
        advancedMin,
        scheduleIncMin,
        scheduleFullMin,
      });
    }

    return t('training.executionModesHint');
  }, [executionModes, t]);

  const scheduleFormSchema = z.object({
    scheduleType: z.enum(['incremental_fine_tuning', 'complete_fine_tuning']),
    enabled: z.boolean(),
    cronPattern: z
      .string()
      .trim()
      .optional()
      .refine(
        (value) => {
          if (!value) return true;
          // 5-part cron: minuto hora diaDoMes mes diaDaSemana
          return value.split(/\s+/).length === 5;
        },
        { message: 'cronPattern inválido (esperado: 5 campos)' },
      ),
    minDataRequired: z.number().int().min(1).max(100000),
    namespaceId: z.string().uuid().optional().nullable(),
  });

  const [scheduleType, setScheduleType] = useState<'incremental_fine_tuning' | 'complete_fine_tuning'>(
    'incremental_fine_tuning',
  );
  const [scheduleNamespaceId, setScheduleNamespaceId] = useState<string>('__tenant__');
  const [scheduleEnabled, setScheduleEnabled] = useState<boolean>(true);
  const [scheduleCronPattern, setScheduleCronPattern] = useState<string>(trainingSystemConfig.autoLearningCronIncremental);
  const [scheduleMinDataRequired, setScheduleMinDataRequired] = useState<number>(trainingSystemConfig.minScheduledDatasetSizeIncremental);

  const configureSchedule = useMutation({
    mutationFn: async () => {
      if (!isTrainingOperatorRole) {
        throw new Error(t('training.runtime.controls.restrictedDescription'));
      }

      const parsed = scheduleFormSchema.parse({
        scheduleType,
        enabled: scheduleEnabled,
        cronPattern: scheduleCronPattern.trim().length > 0 ? scheduleCronPattern.trim() : undefined,
        minDataRequired: scheduleMinDataRequired,
        namespaceId: scheduleNamespaceId !== '__tenant__' ? scheduleNamespaceId : null,
      });
      const minAllowed =
        parsed.scheduleType === 'incremental_fine_tuning'
          ? trainingSystemConfig.minScheduledDatasetSizeIncremental
          : trainingSystemConfig.minScheduledDatasetSizeFull;
      if (parsed.minDataRequired < minAllowed) {
        throw new Error(`minDataRequired abaixo do limite configurado (${minAllowed})`);
      }

      if (!tenantId) {
        throw new Error('tenantId ausente (usuário não associado a um tenant)');
      }

      const res = await apiRequest('POST', '/api/training/schedule/configure', {
        tenantId,
        scheduleType: parsed.scheduleType,
        enabled: parsed.enabled,
        cronPattern: parsed.cronPattern,
        minDataRequired: parsed.minDataRequired,
        namespaceId: parsed.namespaceId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: autoLearningQueryKey });
      toast({ title: t('training.autoLearning.scheduleConfigured') });
    },
    onError: (error) => {
      frontendLogger.error('Erro ao configurar schedule de treinamento', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        tenantId,
        scheduleType,
        scheduleNamespaceId,
        scheduleEnabled,
        scheduleCronPattern,
        scheduleMinDataRequired,
      });
      toast({ title: t('training.autoLearning.scheduleError'), variant: 'destructive' });
    },
  });

  const prepareTrainingRuntimeMutation = useMutation({
    mutationFn: async () => {
      if (!isTrainingOperatorRole) {
        throw new Error(t('training.runtime.controls.restrictedDescription'));
      }
      return apiRequest('POST', '/api/training/gpu-orchestrator/prepare-training');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorStateQueryKey });
      queryClient.invalidateQueries({ queryKey: runStatusQueryKey });
      queryClient.invalidateQueries({ queryKey: ['/api/training/jobs'] });
      toast({ title: t('training.runtime.controls.prepareSuccess') });
    },
    onError: (error) => {
      const errorMessage = error instanceof ApiError ? error.message : t('training.runtime.controls.prepareError');
      toast({
        title: t('training.runtime.controls.prepareError'),
        description: errorMessage,
        variant: 'destructive',
      });
    },
  });

  const restoreServingRuntimeMutation = useMutation({
    mutationFn: async () => {
      if (!isTrainingOperatorRole) {
        throw new Error(t('training.runtime.controls.restrictedDescription'));
      }
      return apiRequest('POST', '/api/training/gpu-orchestrator/restore-serving');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorStateQueryKey });
      queryClient.invalidateQueries({ queryKey: runStatusQueryKey });
      queryClient.invalidateQueries({ queryKey: ['/api/training/jobs'] });
      toast({ title: t('training.runtime.controls.restoreSuccess') });
    },
    onError: (error) => {
      const errorMessage = error instanceof ApiError ? error.message : t('training.runtime.controls.restoreError');
      toast({
        title: t('training.runtime.controls.restoreError'),
        description: errorMessage,
        variant: 'destructive',
      });
    },
  });

  const onDemandSchema = z.object({
    trainingType: z.enum(['incremental', 'full']),
    includeImages: z.boolean(),
    priority: z.enum(['low', 'normal', 'high']),
    description: z.string().trim().max(500).optional(),
    namespaceId: z.string().uuid().optional(),
  });

  const [onDemandTrainingType, setOnDemandTrainingType] = useState<'incremental' | 'full'>('incremental');
  const [onDemandIncludeImages, setOnDemandIncludeImages] = useState<boolean>(trainingSystemConfig.autoLearningIncludeImages);
  const [onDemandPriority, setOnDemandPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [onDemandDescription, setOnDemandDescription] = useState<string>('');
  const [onDemandNamespaceId, setOnDemandNamespaceId] = useState<string>('__tenant__');
  const onDemandIdempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    setOnDemandIncludeImages(trainingSystemConfig.autoLearningIncludeImages);
  }, [trainingSystemConfig.autoLearningIncludeImages]);

  useEffect(() => {
    if (scheduleType === 'incremental_fine_tuning') {
      setScheduleCronPattern(trainingSystemConfig.autoLearningCronIncremental);
      setScheduleMinDataRequired(trainingSystemConfig.minScheduledDatasetSizeIncremental);
      return;
    }
    setScheduleCronPattern(trainingSystemConfig.autoLearningCronFull);
    setScheduleMinDataRequired(trainingSystemConfig.minScheduledDatasetSizeFull);
  }, [
    scheduleType,
    trainingSystemConfig.autoLearningCronFull,
    trainingSystemConfig.autoLearningCronIncremental,
    trainingSystemConfig.minScheduledDatasetSizeFull,
    trainingSystemConfig.minScheduledDatasetSizeIncremental,
  ]);

  const startOnDemand = useMutation({
    mutationFn: async () => {
      if (!isTrainingOperatorRole) {
        throw new Error(t('training.runtime.controls.restrictedDescription'));
      }

      const parsed = onDemandSchema.parse({
        trainingType: onDemandTrainingType,
        includeImages: onDemandIncludeImages,
        priority: onDemandPriority,
        description: onDemandDescription.trim().length > 0 ? onDemandDescription.trim() : undefined,
        namespaceId: (onDemandNamespaceId && onDemandNamespaceId !== '__tenant__') ? onDemandNamespaceId : undefined,
      });

      if (!tenantId) {
        throw new Error('tenantId ausente (usuário não associado a um tenant)');
      }

      const requestPayload = {
        tenantId,
        trainingType: parsed.trainingType,
        includeImages: parsed.includeImages,
        priority: parsed.priority,
        description: parsed.description,
        namespaceId: parsed.namespaceId,
      };
      const fingerprint = buildTrainingIdempotencyFingerprint(requestPayload);
      const idempotencyKey = onDemandIdempotencyRef.current?.fingerprint === fingerprint
        ? onDemandIdempotencyRef.current.key
        : generateTrainingIdempotencyKey('training-on-demand');
      onDemandIdempotencyRef.current = { fingerprint, key: idempotencyKey };

      const res = await apiRequest('POST', '/api/training/run/start', requestPayload, {
        headers: {
          'X-Idempotency-Key': idempotencyKey,
        },
      });
      return res.json();
    },
    onSuccess: () => {
      setShowOnDemandRun(false);
      queryClient.invalidateQueries({ queryKey: runStatusQueryKey });
      queryClient.invalidateQueries({ queryKey: ['/api/training/jobs'] });
      onDemandIdempotencyRef.current = null;
      toast({ title: t('training.autoLearning.onDemandStarted') });
    },
    onError: (error) => {
      const retryAfterHint = getRetryAfterHint(error, t);
      const errorMessage = error instanceof ApiError ? error.message : null;
      frontendLogger.error('Erro ao iniciar treinamento on-demand', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        tenantId,
        trainingType: onDemandTrainingType,
        includeImages: onDemandIncludeImages,
        priority: onDemandPriority,
        description: onDemandDescription,
      });
      toast({
        title: t('training.autoLearning.onDemandError'),
        description: retryAfterHint ?? errorMessage ?? undefined,
        variant: 'destructive',
      });
    },
  });

  const { data: namespaces } = useQuery<Namespace[]>({
    queryKey: ['/api/namespaces'],
    staleTime: 1000 * 60,
  });

  const { data: trainingData, isLoading: dataLoading } = useQuery<TrainingDataResponse>({
    queryKey: ['/api/training/data'],
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60,
  });

  const { data: jobs, isLoading: jobsLoading } = useQuery<JobsResponse>({
    queryKey: ['/api/training/jobs'],
    staleTime: 1000 * 15,
    refetchInterval: (query) => {
      const jobsList = (query.state.data as JobsResponse | undefined)?.jobs ?? [];
      const hasActive = jobsList.some((j) => ['pending', 'preparing', 'training', 'validating'].includes(j.status));
      return hasActive ? 5000 : 30000;
    },
  });

  const promoteJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await apiRequest('POST', `/api/training/jobs/${jobId}/promote`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/jobs'] });
      queryClient.invalidateQueries({ queryKey: autoLearningQueryKey });
      toast({ title: t('training.promotion.promoteSuccess') });
    },
    onError: (error) => {
      const errorMessage = error instanceof ApiError
        ? error.message
        : t('training.promotion.promoteError');
      toast({ title: t('training.promotion.promoteError'), description: errorMessage, variant: 'destructive' });
    },
  });

  const approvalPromotionMutation = useMutation({
    mutationFn: async ({ jobId, decision }: { jobId: string; decision: 'approved' | 'rejected' }) => {
      const response = await apiRequest('POST', `/api/training/jobs/${jobId}/promotion-approval`, { decision });
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/jobs'] });
      const title = variables.decision === 'approved'
        ? t('training.promotion.approvalSuccess')
        : t('training.promotion.rejectionSuccess');
      toast({ title });
    },
    onError: (error) => {
      const errorMessage = error instanceof ApiError
        ? error.message
        : t('training.promotion.approvalError');
      toast({ title: t('training.promotion.approvalError'), description: errorMessage, variant: 'destructive' });
    },
  });

  const rollbackJobMutation = useMutation({
    mutationFn: async ({ jobId, reason }: { jobId: string; reason: string }) => {
      const response = await apiRequest('POST', `/api/training/jobs/${jobId}/rollback`, { reason });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/jobs'] });
      queryClient.invalidateQueries({ queryKey: autoLearningQueryKey });
      toast({ title: t('training.promotion.rollbackSuccess') });
    },
    onError: (error) => {
      const errorMessage = error instanceof ApiError
        ? error.message
        : t('training.promotion.rollbackError');
      toast({ title: t('training.promotion.rollbackError'), description: errorMessage, variant: 'destructive' });
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({
      id,
      status,
      reviewNotes,
      overrideScope,
    }: {
      id: string;
      status: string;
      reviewNotes?: string;
      overrideScope?: {
        namespaceId?: string | null;
        agentId?: string | null;
        domain?: string | null;
        reason: string;
      };
    }) => {
      return apiRequest('PATCH', `/api/training/data/${id}/status`, { status, reviewNotes, overrideScope });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/datasets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/datasets/stats'] });
      toast({ title: t('training.success.statusUpdated') });
    },
    onError: () => {
      toast({ title: t('training.errors.updateStatus'), variant: 'destructive' });
    },
  });

  const updateStatusBatch = useMutation({
    mutationFn: async ({
      ids,
      action,
      reviewNotes,
    }: {
      ids: string[];
      action: 'approve' | 'reject';
      reviewNotes?: string;
    }) => {
      const response = await apiRequest('POST', '/api/training/data/approve-batch', {
        ids,
        action,
        reviewNotes,
      });
      return response.json() as Promise<{
        success: boolean;
        updated: number;
        skippedByQuarantine: number;
        skippedByMissingNamespace: number;
        skippedByTenantMismatch: number;
      }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/datasets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/trading/datasets/stats'] });
      setBatchReviewDialogOpen(false);
      setBatchReviewNotes('');
      setSelectedDataIds(new Set());
      toast({
        title: t('training.batchSelection.successTitle'),
        description: t('training.batchSelection.successDesc', {
          updated: result.updated,
          skippedByQuarantine: result.skippedByQuarantine,
          skippedByMissingNamespace: result.skippedByMissingNamespace,
          skippedByTenantMismatch: result.skippedByTenantMismatch,
        }),
      });
    },
    onError: () => {
      toast({ title: t('training.errors.updateStatus'), variant: 'destructive' });
    },
  });

  const createNamespaceMutation = useMutation({
    mutationFn: async (data: { nome: string; slug: string; descricao?: string }) => {
      const res = await apiRequest('POST', '/api/namespaces', data);
      return res.json() as Promise<{ id: string; nome: string; slug: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/namespaces'] });
    },
  });

  const resolveScopeMutation = useMutation({
    mutationFn: async ({
      id,
      namespaceId,
      agentId,
      domain,
      reason,
    }: {
      id: string;
      namespaceId: string;
      agentId?: string | null;
      domain?: string | null;
      reason: string;
    }) => {
      return apiRequest('PATCH', `/api/training/data/${id}/resolve-scope`, {
        namespaceId,
        agentId,
        domain,
        reason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      toast({ title: 'Escopo resolvido com sucesso' });
    },
    onError: () => {
      toast({ title: 'Falha ao resolver escopo', variant: 'destructive' });
    },
  });

  const allData = trainingData?.trainingData || [];
  const allJobs = jobs?.jobs || [];
  const [promoteDialogJob, setPromoteDialogJob] = useState<FineTuningJob | null>(null);
  const [rollbackDialogJob, setRollbackDialogJob] = useState<FineTuningJob | null>(null);
  const [rollbackReason, setRollbackReason] = useState('');

  const minCustomJobDatasetSize = trainingSystemConfig.minOndemandDatasetSize;

  const [, navigate] = useLocation();
  const [postTrainingDialog, setPostTrainingDialog] = useState<{ open: boolean; jobName: string }>({ open: false, jobName: '' });
  const prevJobStatusesRef = useRef<Map<string, string>>(new Map());
  const completedShownRef = useRef<Set<string>>(new Set());

  // Detectar job que acabou de completar → mostrar diálogo pós-treino
  useEffect(() => {
    if (!allJobs.length) return;
    const prev = prevJobStatusesRef.current;
    for (const job of allJobs) {
      const wasRunning = ['preparing', 'training', 'validating'].includes(prev.get(job.id) ?? '');
      if (wasRunning && job.status === 'completed' && !completedShownRef.current.has(job.id)) {
        completedShownRef.current.add(job.id);
        setPostTrainingDialog({ open: true, jobName: job.name || job.id });
        break;
      }
    }
    prev.clear();
    for (const j of allJobs) prev.set(j.id, j.status);
  }, [allJobs]);

  const returnOrchestrator = useMutation({
    mutationFn: async () => apiRequest('POST', '/api/training/gpu-orchestrator/restore-serving'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestratorStateQueryKey });
      setPostTrainingDialog((d) => ({ ...d, open: false }));
      navigate('/chat');
    },
    onError: () => {
      toast({ title: t('training.postTraining.returnError'), variant: 'destructive' });
    },
  });

  // Timer 10 min: retorno automático se usuário não responder
  useEffect(() => {
    if (!postTrainingDialog.open) return;
    const tid = window.setTimeout(() => {
      returnOrchestrator.mutate();
    }, 10 * 60 * 1000);
    return () => window.clearTimeout(tid);
  }, [postTrainingDialog.open, returnOrchestrator]);

  const namespacesById = new Map((namespaces || []).map((ns) => [ns.id, ns.nome]));
  const isTradingTrainingEntry = (entry: TrainingData): boolean => {
    if (
      entry.sourceType
      && TRADING_TRAINING_SOURCE_TYPES.includes(entry.sourceType as typeof TRADING_TRAINING_SOURCE_TYPES[number])
    ) {
      return true;
    }

    if (entry.sourceType !== TRADING_TRAINING_EXTERNAL_SOURCE_TYPE) {
      return false;
    }

    if ((entry.inferredDomain ?? '').toLowerCase() === TRADING_TRAINING_DOMAIN) {
      return true;
    }

    const namespaceLabels = [entry.namespaceId, entry.inferredNamespaceId]
      .map((id) => (id ? namespacesById.get(id) : null))
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().toLowerCase());

    return namespaceLabels.includes('trading');
  };
  const activeJobsByScope = useMemo(() => {
    const scoped = allJobs
      .filter((job) => job.promotionStatus === 'active')
      .sort((a, b) => {
        const aDate = new Date(a.completadoEm ?? a.criadoEm).getTime();
        const bDate = new Date(b.completadoEm ?? b.criadoEm).getTime();
        return bDate - aDate;
      });

    const dedup = new Map<string, FineTuningJob>();
    for (const job of scoped) {
      const scopeKey = `${job.scopeNamespaceId ?? 'tenant'}:${job.scopeAgentId ?? 'none'}`;
      if (!dedup.has(scopeKey)) {
        dedup.set(scopeKey, job);
      }
    }
    return Array.from(dedup.values());
  }, [allJobs]);

  const sourceOptions = Array.from(new Set(allData.map((d) => d.source))).sort();
  const rawSourceTypes = Array.from(new Set(allData.map((d) => d.sourceType).filter(Boolean) as string[])).sort();
  const hasTradingData = allData.some((entry) => isTradingTrainingEntry(entry));
  const sourceTypeOptions = hasTradingData ? ['trading', ...rawSourceTypes] : rawSourceTypes;

  const filteredData = allData.filter((entry) => {
    if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
    if (namespaceFilter !== 'all' && entry.namespaceId !== namespaceFilter) return false;
    if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false;
    if (sourceTypeFilter !== 'all') {
      if (sourceTypeFilter === 'trading') {
        if (!isTradingTrainingEntry(entry)) return false;
      } else if (entry.sourceType !== sourceTypeFilter) {
        return false;
      }
    }
    if (quarantineFilter === 'only' && !entry.needsHumanReview) return false;
    if (quarantineFilter === 'exclude' && entry.needsHumanReview) return false;
    if (duplicateFilter === 'only' && !entry.isDuplicate) return false;
    if (duplicateFilter === 'exclude' && entry.isDuplicate) return false;
    if (autoCollectFilter === 'only' && entry.source !== 'chat-auto') return false;
    if (autoCollectFilter === 'exclude' && entry.source === 'chat-auto') return false;
    return true;
  });

  /** Filtros ativos na aba Data: quando true, cards devem refletir contagens filtradas (consistência UX). */
  const allPendingIds = useMemo(
    () => new Set(allData.filter((entry) => entry.status === 'pending').map((entry) => entry.id)),
    [allData],
  );

  const filteredPendingIds = useMemo(
    () => filteredData.filter((entry) => entry.status === 'pending').map((entry) => entry.id),
    [filteredData],
  );

  const filteredSelectedPendingCount = filteredPendingIds.filter((id) => selectedDataIds.has(id)).length;
  const totalSelectedPendingCount = Array.from(selectedDataIds).filter((id) => allPendingIds.has(id)).length;
  const reviewMutationPending = updateStatus.isPending || updateStatusBatch.isPending;
  useEffect(() => {
    setSelectedDataIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (allPendingIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allPendingIds]);

  const toggleSelectData = useCallback((id: string, checked: boolean) => {
    setSelectedDataIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAllFilteredPending = useCallback((checked: boolean) => {
    setSelectedDataIds((prev) => {
      const next = new Set(prev);
      for (const id of filteredPendingIds) {
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }, [filteredPendingIds]);

  const selectAllFilteredPending = useCallback(() => {
    toggleSelectAllFilteredPending(true);
  }, [toggleSelectAllFilteredPending]);

  const clearAllPendingSelection = useCallback(() => {
    setSelectedDataIds(new Set());
  }, []);

  const openBatchReviewDialog = useCallback((action: 'approve' | 'reject') => {
    const selectedIds = Array.from(selectedDataIds).filter((id) => allPendingIds.has(id));
    if (selectedIds.length === 0) {
      toast({ title: t('training.batchSelection.emptySelection'), variant: 'destructive' });
      return;
    }
    setBatchReviewAction(action);
    setBatchReviewNotes('');
    setBatchReviewDialogOpen(true);
  }, [allPendingIds, selectedDataIds, t]);

  const confirmBatchReview = useCallback(() => {
    const selectedIds = Array.from(selectedDataIds).filter((id) => allPendingIds.has(id));
    if (selectedIds.length === 0) {
      toast({ title: t('training.batchSelection.emptySelection'), variant: 'destructive' });
      return;
    }
    updateStatusBatch.mutate({
      ids: selectedIds,
      action: batchReviewAction,
      reviewNotes: batchReviewNotes.trim().length > 0 ? batchReviewNotes.trim() : undefined,
    });
  }, [allPendingIds, batchReviewAction, batchReviewNotes, selectedDataIds, t, updateStatusBatch]);

  const filtersActive =
    statusFilter !== 'all' ||
    namespaceFilter !== 'all' ||
    sourceFilter !== 'all' ||
    sourceTypeFilter !== 'all' ||
    quarantineFilter !== 'all' ||
    duplicateFilter !== 'all' ||
    autoCollectFilter !== 'all';

  /** Training stats: filtrados quando filtros ativos, senão totais globais. */
  const stats = filtersActive
    ? {
        total: filteredData.length,
        pending: filteredData.filter((d) => d.status === 'pending').length,
        approved: filteredData.filter((d) => d.status === 'approved').length,
        rejected: filteredData.filter((d) => d.status === 'rejected').length,
        used: filteredData.filter((d) => d.status === 'used').length,
      }
    : {
        total: allData.length,
        pending: allData.filter((d) => d.status === 'pending').length,
        approved: allData.filter((d) => d.status === 'approved').length,
        rejected: allData.filter((d) => d.status === 'rejected').length,
        used: allData.filter((d) => d.status === 'used').length,
      };

  const jobStats = {
    total: allJobs.length,
    running: allJobs.filter(j => ['pending', 'preparing', 'training', 'validating'].includes(j.status)).length,
    completed: allJobs.filter(j => j.status === 'completed').length,
    failed: allJobs.filter(j => j.status === 'failed').length,
  };

  const resetReviewScopeOverride = useCallback(() => {
    setOverrideScopeEnabled(false);
    setOverrideNamespaceId('');
    setOverrideAgentId('');
    setOverrideDomain('');
    setOverrideReason('');
  }, []);

  const openReviewDialog = useCallback((entry: TrainingData, status: 'approved' | 'rejected') => {
    setReviewTarget({ id: entry.id, status, entry });
    setReviewNotes('');
    setOverrideScopeEnabled(false);
    setOverrideNamespaceId(entry.namespaceId ?? entry.inferredNamespaceId ?? '');
    setOverrideAgentId(entry.agentId ?? entry.inferredAgentId ?? '');
    setOverrideDomain(entry.inferredDomain ?? '');
    setOverrideReason('');
    setReviewDialogOpen(true);
  }, []);

  const confirmReview = useCallback(() => {
    if (!reviewTarget) return;
    if (reviewTarget.status === 'approved' && overrideScopeEnabled) {
      if (overrideNamespaceId.trim().length === 0) {
        toast({
          title: 'Namespace é obrigatório no override',
          description: 'Informe um namespace válido para concluir a aprovação com override.',
          variant: 'destructive',
        });
        return;
      }
      if (overrideReason.trim().length === 0) {
        toast({
          title: 'Motivo do override é obrigatório',
          description: 'Informe o motivo para manter trilha de auditoria.',
          variant: 'destructive',
        });
        return;
      }
    }
    updateStatus.mutate({
      id: reviewTarget.id,
      status: reviewTarget.status,
      reviewNotes: reviewNotes.trim().length > 0 ? reviewNotes.trim() : undefined,
      overrideScope:
        reviewTarget.status === 'approved' && overrideScopeEnabled
          ? {
              namespaceId: overrideNamespaceId.trim(),
              agentId: overrideAgentId.trim().length > 0 ? overrideAgentId.trim() : null,
              domain: overrideDomain.trim().length > 0 ? overrideDomain.trim() : null,
              reason: overrideReason.trim(),
            }
          : undefined,
    });
    setReviewDialogOpen(false);
    resetReviewScopeOverride();
  }, [
    overrideAgentId,
    overrideDomain,
    overrideNamespaceId,
    overrideReason,
    overrideScopeEnabled,
    resetReviewScopeOverride,
    reviewNotes,
    reviewTarget,
    updateStatus,
  ]);

  const handleResolveScope = useCallback((entry: TrainingData) => {
    setResolveScopeEntry(entry);
    setResolveScopeNamespaceId(entry.namespaceId ?? entry.inferredNamespaceId ?? '');
    setResolveScopeReason(
      entry.needsHumanReview
        ? t('training.resolveScope.reasonPlaceholder')
        : t('training.resolveScope.relinkReasonPlaceholder')
    );
    setResolveScopeDomain(entry.inferredDomain ?? '');
    setResolveScopeAgentId(entry.agentId ?? entry.inferredAgentId ?? '');
    setResolveScopeDialogOpen(true);
  }, [t]);

  const confirmResolveScope = useCallback(() => {
    if (!resolveScopeEntry) return;
    if (!resolveScopeNamespaceId.trim()) {
      toast({ title: 'Namespace é obrigatório', variant: 'destructive' });
      return;
    }
    if (!resolveScopeReason.trim()) {
      toast({ title: 'Motivo é obrigatório', variant: 'destructive' });
      return;
    }
    resolveScopeMutation.mutate({
      id: resolveScopeEntry.id,
      namespaceId: resolveScopeNamespaceId.trim(),
      domain: resolveScopeDomain.trim().length ? resolveScopeDomain.trim() : null,
      agentId: resolveScopeAgentId.trim().length ? resolveScopeAgentId.trim() : null,
      reason: resolveScopeReason.trim(),
    });
    setResolveScopeDialogOpen(false);
    setResolveScopeEntry(null);
  }, [resolveScopeEntry, resolveScopeNamespaceId, resolveScopeReason, resolveScopeDomain, resolveScopeAgentId, resolveScopeMutation]);

  const handleCreateAndResolveScope = useCallback(() => {
    if (!resolveScopeEntry) return;
    const suggested = resolveScopeEntry.inferenceTrace?.suggestedNewNamespace;
    if (!suggested) return;
    createNamespaceMutation.mutate(
      {
        nome: suggested.theme,
        slug: suggested.name.replace(/\s+/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'novo-namespace',
        descricao: suggested.theme,
      },
      {
        onSuccess: (created) => {
          resolveScopeMutation.mutate(
            {
              id: resolveScopeEntry.id,
              namespaceId: created.id,
              domain: resolveScopeEntry.inferredDomain?.trim().length ? resolveScopeEntry.inferredDomain : null,
              agentId: resolveScopeEntry.agentId ?? resolveScopeEntry.inferredAgentId ?? null,
              reason: resolveScopeReason.trim() || 'Namespace criado via sugestão de escopo',
            },
            {
              onSuccess: () => {
                setResolveScopeDialogOpen(false);
                setResolveScopeEntry(null);
                toast({ title: t('training.resolveScope.namespaceCreated') });
              },
            }
          );
        },
      }
    );
  }, [resolveScopeEntry, resolveScopeReason, createNamespaceMutation, resolveScopeMutation, t]);

  const resolveScopeNeedsHumanReview = Boolean(resolveScopeEntry?.needsHumanReview);
  const requireEvalPassedForPromotion = queueStatus?.governance?.requireEvalPassedForPromotion ?? true;
  const handleOpenOnDemandDialog = useCallback(() => {
    if (!isTrainingOperatorRole) {
      toast({ title: t('training.runtime.controls.restrictedDescription'), variant: 'destructive' });
      return;
    }
    setShowOnDemandRun(true);
  }, [isTrainingOperatorRole, t]);

  const handleOpenCreateJobDialog = useCallback(() => {
    if (!isTrainingOperatorRole) {
      toast({ title: t('training.runtime.controls.restrictedDescription'), variant: 'destructive' });
      return;
    }
    setShowCreateJob(true);
  }, [isTrainingOperatorRole, t]);

  const handleStartOnDemand = useCallback(() => {
    if (!isTrainingOperatorRole) {
      toast({ title: t('training.runtime.controls.restrictedDescription'), variant: 'destructive' });
      return;
    }
    startOnDemand.mutate();
  }, [isTrainingOperatorRole, startOnDemand, t]);

  const handlePrepareTrainingRuntime = useCallback(() => {
    if (!isTrainingOperatorRole) {
      toast({ title: t('training.runtime.controls.restrictedDescription'), variant: 'destructive' });
      return;
    }
    prepareTrainingRuntimeMutation.mutate();
  }, [isTrainingOperatorRole, prepareTrainingRuntimeMutation, t]);

  const handleRestoreServingRuntime = useCallback(() => {
    if (!isTrainingOperatorRole) {
      toast({ title: t('training.runtime.controls.restrictedDescription'), variant: 'destructive' });
      return;
    }
    restoreServingRuntimeMutation.mutate();
  }, [isTrainingOperatorRole, restoreServingRuntimeMutation, t]);

  return (
    <div className="flex flex-col h-full">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 border-b bg-background/95 backdrop-blur"
      >
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-training-title">
              {t('training.title')}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t('training.subtitle')}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={handleOpenOnDemandDialog}
              disabled={runStatusLoading || runStatus?.hasRunningTraining === true || !tenantId || !isTrainingOperatorRole}
              data-testid="button-on-demand-run"
            >
              <Play className="h-4 w-4 mr-2" />
              {t('training.autoLearning.onDemand')}
            </Button>
            <Button
              onClick={handleOpenCreateJobDialog}
              disabled={!tenantId || stats.approved < minCustomJobDatasetSize || !isTrainingOperatorRole}
              data-testid="button-new-job"
            >
              <Brain className="h-4 w-4 mr-2" />
              {t('training.newJob')}
            </Button>
            <Button
              variant="outline"
              onClick={() => setActiveTab('auto-learning')}
              disabled={!tenantId}
              data-testid="button-open-schedule"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('training.controlCards.openSchedule')}
            </Button>
          </div>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          {executionModesHint}
        </p>

        {!tenantId && (
          <Alert className="mb-4" variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('training.autoLearning.tenantMissingTitle')}</AlertTitle>
            <AlertDescription>{t('training.autoLearning.tenantMissingDesc')}</AlertDescription>
          </Alert>
        )}

        {!isTrainingOperatorRole && (
          <Alert className="mb-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('training.runtime.controls.restrictedTitle')}</AlertTitle>
            <AlertDescription>{t('training.runtime.controls.restrictedDescription')}</AlertDescription>
          </Alert>
        )}

        <TrainingRuntimeBanner
          hasRunningTraining={hasRunningTraining}
          inferenceAvailability={inferenceAvailability}
          isLoading={orchestratorStateLoading}
          reason={runtimeReason}
          runtimeState={runtimeFsmState}
          t={t}
        />

        <div className="grid gap-3 lg:grid-cols-2 mb-4">
          <TrainingRuntimeCard
            inferenceAvailability={inferenceAvailability}
            isLoading={orchestratorStateLoading}
            linkedRunId={linkedRuntimeRun.linkedRunId}
            linkedRunName={linkedRuntimeRun.linkedRunName}
            mode={runtimeMode}
            reason={runtimeReason}
            transitionState={runtimeTransitionState}
            t={t}
          />
          <TrainingOrchestratorControlsCard
            canControl={isTrainingOperatorRole}
            controlsDisabled={orchestratorStateLoading}
            currentState={runtimeFsmState}
            isPreparePending={prepareTrainingRuntimeMutation.isPending}
            isRestorePending={restoreServingRuntimeMutation.isPending}
            onPrepareTraining={handlePrepareTrainingRuntime}
            onRestoreServing={handleRestoreServingRuntime}
            t={t}
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t('training.stats.pending')}</p>
                  <p className="text-2xl font-bold" data-testid="stat-pending">{stats.pending}</p>
                </div>
                <Clock className="h-8 w-8 text-amber-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t('training.stats.approved')}</p>
                  <p className="text-2xl font-bold" data-testid="stat-approved">{stats.approved}</p>
                </div>
                <CheckCircle2 className="h-8 w-8 text-green-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t('training.stats.activeJobs')}</p>
                  <p className="text-2xl font-bold" data-testid="stat-running">{jobStats.running}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-purple-500/50" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{t('training.stats.completed')}</p>
                  <p className="text-2xl font-bold" data-testid="stat-completed">{jobStats.completed}</p>
                </div>
                <Zap className="h-8 w-8 text-blue-500/50" />
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      <Tabs value={activeTab} onValueChange={handleTrainingTabChange} className="flex-1 flex flex-col">
        <div className="px-4 pt-2 border-b">
          <WorkspaceFilterBar
            activeWorkspace={activeWorkspace}
            options={TRAINING_WORKSPACE_LABELS.map((workspace) => ({
              value: workspace.value,
              label: workspace.label,
            }))}
            onWorkspaceChange={handleTrainingWorkspaceChange}
            getTestId={(workspace) => `training-workspace-${workspace}`}
          />
          <div className="w-full min-w-0 overflow-x-auto pb-2 -mx-2 px-2 md:mx-0 md:px-0">
            <TabsList className="inline-flex min-w-max flex-nowrap items-center gap-1 whitespace-nowrap">
              {visibleTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    data-testid={tab.testId}
                    className="whitespace-nowrap shrink-0"
                  >
                    <Icon className="h-4 w-4 md:mr-2" />
                    <span className="hidden md:inline">
                      {tab.label({ t, statsTotal: stats.total, jobsTotal: allJobs.length })}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
        </div>

        <TrainingDataTabContent
          autoCollectFilter={autoCollectFilter}
          dataLoading={dataLoading}
          duplicateFilter={duplicateFilter}
          filteredData={filteredData}
          filteredPendingCount={filteredPendingIds.length}
          filteredSelectedPendingCount={filteredSelectedPendingCount}
          namespaceFilter={namespaceFilter}
          namespaces={namespaces || []}
          onApproveSelected={() => openBatchReviewDialog('approve')}
          onAutoCollectFilterChange={setAutoCollectFilter}
          onClearAllPendingSelection={clearAllPendingSelection}
          onDuplicateFilterChange={setDuplicateFilter}
          onNamespaceFilterChange={setNamespaceFilter}
          onQuarantineFilterChange={setQuarantineFilter}
          onRejectSelected={() => openBatchReviewDialog('reject')}
          onSelectAllFilteredPending={selectAllFilteredPending}
          onSourceFilterChange={setSourceFilter}
          onSourceTypeFilterChange={setSourceTypeFilter}
          onStatusFilterChange={setStatusFilter}
          onToggleSelectAllFilteredPending={toggleSelectAllFilteredPending}
          quarantineFilter={quarantineFilter}
          renderDataCard={(data) => (
            <TrainingDataCard
              key={data.id}
              data={data}
              namespaceName={data.namespaceId ? namespacesById.get(data.namespaceId) : null}
              isPending={reviewMutationPending}
              isSelected={selectedDataIds.has(data.id)}
              onSelectionChange={
                data.status === 'pending'
                  ? (checked) => toggleSelectData(data.id, checked)
                  : undefined
              }
              selectionDisabled={reviewMutationPending}
              onApprove={() => openReviewDialog(data, 'approved')}
              onReject={() => openReviewDialog(data, 'rejected')}
              onResolveScope={() => handleResolveScope(data)}
              t={t}
              locale={locale}
              timeZone={timeZone}
              variants={itemVariants}
            />
          )}
          reviewMutationPending={reviewMutationPending}
          sourceFilter={sourceFilter}
          sourceOptions={sourceOptions}
          sourceTypeFilter={sourceTypeFilter}
          sourceTypeOptions={sourceTypeOptions}
          statusFilter={statusFilter}
          t={t}
          totalSelectedPendingCount={totalSelectedPendingCount}
        />

        <TrainingAutoLearningTabContent
          autoLearning={autoLearning}
          autoLearningLoading={autoLearningLoading}
          canManageSchedule={isTrainingOperatorRole}
          configureSchedulePending={configureSchedule.isPending}
          formatScheduleDate={(value) => formatDateTime(value, { locale, timeZone })}
          minScheduledDatasetSizeFull={trainingSystemConfig.minScheduledDatasetSizeFull}
          minScheduledDatasetSizeIncremental={trainingSystemConfig.minScheduledDatasetSizeIncremental}
          namespaces={namespaces || []}
          onConfigureSchedule={() => configureSchedule.mutate()}
          queueStatus={queueStatus}
          queueStatusLoading={queueStatusLoading}
          resolveScheduleScopeLabel={(namespaceId) => getScheduleScopeLabel(namespaceId, namespacesById, t)}
          runStatus={runStatus}
          runStatusLoading={runStatusLoading}
          scheduleCronPattern={scheduleCronPattern}
          scheduleEnabled={scheduleEnabled}
          scheduleMinDataRequired={scheduleMinDataRequired}
          scheduleNamespaceId={scheduleNamespaceId}
          scheduleType={scheduleType}
          setScheduleCronPattern={setScheduleCronPattern}
          setScheduleEnabled={setScheduleEnabled}
          setScheduleMinDataRequired={setScheduleMinDataRequired}
          setScheduleNamespaceId={setScheduleNamespaceId}
          setScheduleType={setScheduleType}
          t={t}
          tenantId={tenantId}
        />

        <TrainingJobsTabContent
          activeJobsByScope={activeJobsByScope}
          allJobs={allJobs}
          createFirstJobDisabled={!tenantId || stats.approved < minCustomJobDatasetSize || !isTrainingOperatorRole}
          jobsLoading={jobsLoading}
          onCreateFirstJob={handleOpenCreateJobDialog}
          renderHistoryJobCard={(job) => (
            <TrainingJobCard
              job={job}
              scopeLabel={getScopeLabel(job, namespacesById, t)}
              t={t}
              locale={locale}
              timeZone={timeZone}
              variants={itemVariants}
              onClick={() => setSelectedJobId(job.id)}
              canPromote={
                job.status === 'completed'
                && job.promotionStatus === 'candidate'
                && (
                  requireEvalPassedForPromotion
                    ? job.evaluationStatus === 'passed'
                    : job.evaluationStatus !== 'failed'
                )
              }
              canApprovePromotion={job.status === 'completed' && job.promotionStatus === 'candidate'}
              canRejectPromotion={job.status === 'completed' && job.promotionStatus === 'candidate'}
              onApprovePromotion={() => approvalPromotionMutation.mutate({ jobId: job.id, decision: 'approved' })}
              onRejectPromotion={() => approvalPromotionMutation.mutate({ jobId: job.id, decision: 'rejected' })}
              canRollback={job.promotionStatus === 'active'}
              onPromote={() => setPromoteDialogJob(job)}
              onRollback={() => {
                setRollbackReason('');
                setRollbackDialogJob(job);
              }}
              actionPending={
                promoteJobMutation.isPending
                || approvalPromotionMutation.isPending
                || rollbackJobMutation.isPending
              }
            />
          )}
          renderRunningJobCard={(job) => (
            <TrainingJobCard
              job={job}
              scopeLabel={getScopeLabel(job, namespacesById, t)}
              t={t}
              locale={locale}
              timeZone={timeZone}
              variants={itemVariants}
              onClick={() => setSelectedJobId(job.id)}
              canPromote={false}
              canRollback={false}
              actionPending={
                promoteJobMutation.isPending
                || approvalPromotionMutation.isPending
                || rollbackJobMutation.isPending
              }
            />
          )}
          resolveScopeLabel={(job) => getScopeLabel(job, namespacesById, t)}
          t={t}
        />

        <TrainingBulkImportTabContent t={t} />

        <TabsContent value="multimodal" className="flex-1 m-0">
          <TrainingMultimodalTabContent t={t} />
        </TabsContent>
      </Tabs>

      <TrainingJobDetailModal
        jobId={selectedJobId}
        open={!!selectedJobId}
        onClose={() => setSelectedJobId(null)}
        t={t}
        locale={locale}
        timeZone={timeZone}
      />

      <TrainingCreateJobDialog
        open={showCreateJob}
        onClose={() => setShowCreateJob(false)}
        approvedCount={stats.approved}
        minRequiredApprovedData={minCustomJobDatasetSize}
        defaultHyperparams={trainingSystemConfig.defaultHyperparams}
        presetHyperparams={trainingSystemConfig.presets}
        namespaces={namespaces || []}
        namespaceId={createJobNamespaceId}
        onNamespaceIdChange={setCreateJobNamespaceId}
        tenantId={isTrainingOperatorRole ? tenantId : undefined}
        t={t}
      />

      <TrainingPromoteDialog
        isPending={promoteJobMutation.isPending}
        jobName={promoteDialogJob?.name ?? ''}
        onConfirm={() => {
          if (!promoteDialogJob) return;
          promoteJobMutation.mutate(promoteDialogJob.id, {
            onSuccess: () => setPromoteDialogJob(null),
          });
        }}
        onOpenChange={(open) => {
          if (!open) {
            setPromoteDialogJob(null);
          }
        }}
        open={Boolean(promoteDialogJob)}
        t={t}
      />

      <TrainingRollbackDialog
        isPending={rollbackJobMutation.isPending}
        jobName={rollbackDialogJob?.name ?? ''}
        onConfirm={() => {
          if (!rollbackDialogJob) return;
          rollbackJobMutation.mutate({ jobId: rollbackDialogJob.id, reason: rollbackReason.trim() }, {
            onSuccess: () => {
              setRollbackDialogJob(null);
              setRollbackReason('');
            },
          });
        }}
        onOpenChange={(open) => {
          if (!open) {
            setRollbackDialogJob(null);
            setRollbackReason('');
          }
        }}
        onReasonChange={setRollbackReason}
        open={Boolean(rollbackDialogJob)}
        reason={rollbackReason}
        t={t}
      />

      <TrainingPostTrainingDialog
        isReturnPending={returnOrchestrator.isPending}
        jobName={postTrainingDialog.jobName}
        onBackToChat={() => returnOrchestrator.mutate()}
        onContinueTraining={() => setPostTrainingDialog((dialogState) => ({ ...dialogState, open: false }))}
        onOpenChange={(open) => {
          if (!open) {
            setPostTrainingDialog((dialogState) => ({ ...dialogState, open: false }));
          }
        }}
        open={postTrainingDialog.open}
        t={t}
      />

      <TrainingOnDemandRunDialog
        description={onDemandDescription}
        includeImages={onDemandIncludeImages}
        isStartPending={startOnDemand.isPending}
        namespaces={namespaces || []}
        namespaceId={onDemandNamespaceId}
        onDescriptionChange={setOnDemandDescription}
        onIncludeImagesChange={setOnDemandIncludeImages}
        onNamespaceIdChange={setOnDemandNamespaceId}
        onOpenChange={setShowOnDemandRun}
        onPriorityChange={setOnDemandPriority}
        onStart={handleStartOnDemand}
        onTrainingTypeChange={setOnDemandTrainingType}
        open={showOnDemandRun}
        priority={onDemandPriority}
        t={t}
        tenantId={isTrainingOperatorRole ? tenantId : undefined}
        trainingType={onDemandTrainingType}
      />

      <TrainingBatchReviewDialog
        action={batchReviewAction}
        isPending={updateStatusBatch.isPending}
        notes={batchReviewNotes}
        onConfirm={confirmBatchReview}
        onNotesChange={setBatchReviewNotes}
        onOpenChange={(open) => {
          setBatchReviewDialogOpen(open);
          if (!open) {
            setBatchReviewNotes('');
          }
        }}
        open={batchReviewDialogOpen}
        selectedCount={totalSelectedPendingCount}
        t={t}
      />

      <TrainingReviewDialog
        hasReviewTarget={Boolean(reviewTarget)}
        isPending={updateStatus.isPending}
        namespaces={namespaces || []}
        notes={reviewNotes}
        onConfirm={confirmReview}
        onNotesChange={setReviewNotes}
        onOpenChange={(open) => {
          setReviewDialogOpen(open);
          if (!open) {
            resetReviewScopeOverride();
          }
        }}
        onOverrideAgentIdChange={setOverrideAgentId}
        onOverrideDomainChange={setOverrideDomain}
        onOverrideNamespaceIdChange={setOverrideNamespaceId}
        onOverrideReasonChange={setOverrideReason}
        onOverrideScopeEnabledChange={setOverrideScopeEnabled}
        open={reviewDialogOpen}
        overrideAgentId={overrideAgentId}
        overrideDomain={overrideDomain}
        overrideNamespaceId={overrideNamespaceId}
        overrideReason={overrideReason}
        overrideScopeEnabled={overrideScopeEnabled}
        reviewStatus={reviewTarget?.status ?? null}
        t={t}
      />

      <TrainingResolveScopeDialog
        agentId={resolveScopeAgentId}
        createNamespacePending={createNamespaceMutation.isPending}
        domain={resolveScopeDomain}
        entryHasSuggestedNamespace={Boolean(resolveScopeEntry?.inferenceTrace?.suggestedNewNamespace)}
        hasEntry={Boolean(resolveScopeEntry)}
        isResolvePending={resolveScopeMutation.isPending}
        namespaceId={resolveScopeNamespaceId}
        namespaces={namespaces || []}
        needsHumanReview={resolveScopeNeedsHumanReview}
        onAgentIdChange={setResolveScopeAgentId}
        onConfirm={confirmResolveScope}
        onCreateSuggestedNamespace={handleCreateAndResolveScope}
        onDomainChange={setResolveScopeDomain}
        onNamespaceIdChange={setResolveScopeNamespaceId}
        onOpenChange={(open) => {
          setResolveScopeDialogOpen(open);
          if (!open) {
            setResolveScopeEntry(null);
          }
        }}
        onReasonChange={setResolveScopeReason}
        open={resolveScopeDialogOpen}
        reason={resolveScopeReason}
        suggestedNamespace={resolveScopeEntry?.inferenceTrace?.suggestedNewNamespace ?? null}
        t={t}
      />
    </div>
  );
}
