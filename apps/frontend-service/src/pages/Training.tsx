/**
 * Training - Gestão de Fine-tuning
 * 
 * Gate 2 (16/01/2026):
 * Página para gerenciar dados de treinamento e jobs de fine-tuning (QLoRA)
 * usando o MESMO modelo base do LLM (texto) em produção (Qwen2.5 7B),
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
  Pause,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  RefreshCw,
  MessageSquare,
  Database,
  Zap,
  ChevronRight,
  Filter,
  TrendingUp,
  Folder,
  Upload,
  FileJson,
  Info,
  FileCheck,
  AlertTriangle,
  Eye,
  Image,
  Mic,
  X,
  FileAudio,
  ImageIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ApiError, apiRequest } from '@/lib/queryClient';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { frontendLogger } from '@/lib/logger';
import {
  parseTrainingHyperparamsJson as parseSharedTrainingHyperparamsJson,
  trainingHyperparamsSchema as sharedTrainingHyperparamsSchema,
  type TrainingHyperparams,
} from '../../../../packages/shared-utils/src/training-config';

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
  status: 'pending' | 'approved' | 'rejected' | 'used';
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
  promotionStatus?: 'candidate' | 'staged' | 'active' | 'rejected' | 'rolled_back';
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
  };
};

type TrainingGovernanceAuditEvent = {
  id: string;
  action:
    | 'training_promotion_approval_recorded'
    | 'training_model_promoted'
    | 'training_model_rollback_executed'
    | 'training_run_start_requested'
    | string;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string | null;
  } | null;
};

interface BulkImportEntry {
  messages: Array<{ role: string; content: string }>;
  rating?: number;
}

interface BulkImportData {
  data?: BulkImportEntry[];
  // JSONL é parseado linha por linha para array
}

interface BulkImportResult {
  imported: number;
  duplicates?: number;
  duplicatesSkipped?: number;
  sourceType?: string;
  errors?: Array<{ index: number; error: string }>;
}

type TrainingHyperparamsPreset = 'safe' | 'standard' | 'large';

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

const TRAINING_HYPERPARAMS_SAFE_FALLBACK: TrainingHyperparamsForm = {
  epochs: 2,
  learningRate: 0.0001,
  batchSize: 2,
  maxSeqLen: 1536,
  gradientAccumulationSteps: 4,
  warmupSteps: 100,
  loraRank: 16,
  loraAlpha: 32,
  loraDropout: 0.05,
};

const TRAINING_HYPERPARAMS_STANDARD_FALLBACK: TrainingHyperparamsForm = {
  epochs: 3,
  learningRate: 0.0002,
  batchSize: 2,
  maxSeqLen: 1536,
  gradientAccumulationSteps: 4,
  warmupSteps: 100,
  loraRank: 16,
  loraAlpha: 32,
  loraDropout: 0.05,
};

const TRAINING_HYPERPARAMS_LARGE_FALLBACK: TrainingHyperparamsForm = {
  epochs: 1,
  learningRate: 0.0001,
  batchSize: 2,
  maxSeqLen: 1536,
  gradientAccumulationSteps: 8,
  warmupSteps: 100,
  loraRank: 16,
  loraAlpha: 32,
  loraDropout: 0.05,
};

const TRAINING_SYSTEM_CONFIG_DEFAULTS = {
  MIN_ONDEMAND_DATASET_SIZE: '20',
  MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL: '50',
  MIN_SCHEDULED_DATASET_SIZE_FULL: '200',
  TRAINING_QUALITY_MIN_RATIO: '0.60',
  TRAINING_DATASET_MAX_ROWS: '5000',
  TRAINING_TRAIN_EVAL_SPLIT_RATIO: '0.90',
  TRAINING_SLICE_STEPS: '10',
  TRAINING_GPU_TIMEOUT_MS: '120000',
  maxSeqLen: '1536',
  AUTO_LEARNING_CRON_INCREMENTAL: '0 3 * * 0',
  AUTO_LEARNING_CRON_FULL: '0 1 1,15 * *',
  AUTO_LEARNING_INCLUDE_IMAGES: 'true',
  TRAINING_DEFAULT_HYPERPARAMS_JSON: JSON.stringify(TRAINING_HYPERPARAMS_SAFE_FALLBACK),
  TRAINING_PRESET_SAFE_JSON: JSON.stringify(TRAINING_HYPERPARAMS_SAFE_FALLBACK),
  TRAINING_PRESET_STANDARD_JSON: JSON.stringify(TRAINING_HYPERPARAMS_STANDARD_FALLBACK),
  TRAINING_PRESET_LARGE_JSON: JSON.stringify(TRAINING_HYPERPARAMS_LARGE_FALLBACK),
} as const;

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

function parseTrainingHyperparamsConfig(raw: string, key: string): TrainingHyperparamsForm {
  try {
    return parseSharedTrainingHyperparamsJson(raw);
  } catch (error) {
    frontendLogger.warn('Configuracao de hyperparams invalida no system_config; aplicando fallback seguro', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    if (key === 'TRAINING_PRESET_STANDARD_JSON') {
      return { ...TRAINING_HYPERPARAMS_STANDARD_FALLBACK };
    }
    if (key === 'TRAINING_PRESET_LARGE_JSON') {
      return { ...TRAINING_HYPERPARAMS_LARGE_FALLBACK };
    }
    return { ...TRAINING_HYPERPARAMS_SAFE_FALLBACK };
  }
}

function generateTrainingIdempotencyKey(prefix: 'training-job' | 'training-on-demand'): string {
  const entropy = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${entropy}`.slice(0, 128);
}

function buildTrainingIdempotencyFingerprint(value: unknown): string {
  const stableSerialize = (input: unknown): string => {
    if (input === null) return 'null';
    if (typeof input !== 'object') return JSON.stringify(input);
    if (Array.isArray(input)) return `[${input.map((item) => stableSerialize(item)).join(',')}]`;
    const entries = Object.entries(input as Record<string, unknown>)
      .filter(([, entryValue]) => typeof entryValue !== 'undefined')
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
    return `{${entries.map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${stableSerialize(entryValue)}`).join(',')}}`;
  };
  return stableSerialize(value);
}

function getRetryAfterHint(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  if (!(error instanceof ApiError)) return null;
  if (!Number.isFinite(error.retryAfterSeconds) || !error.retryAfterSeconds || error.retryAfterSeconds <= 0) {
    return null;
  }
  return t('training.autoLearning.retryAfterHint', { seconds: error.retryAfterSeconds });
}

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

function getRunSourceLabel(job: FineTuningJob, t: (key: string, options?: Record<string, unknown>) => string): string {
  const runSource = job.runSource ?? 'custom_job';
  if (runSource === 'on_demand') return t('training.job.source.onDemand');
  if (runSource === 'scheduled') return t('training.job.source.scheduled');
  return t('training.job.source.advanced');
}

function getRunPriorityLabel(job: FineTuningJob, t: (key: string, options?: Record<string, unknown>) => string): string | null {
  const priority = job.configSnapshot?.priority;
  if (!priority) return null;
  if (priority === 'high') return t('training.job.priority.high');
  if (priority === 'normal') return t('training.job.priority.normal');
  return t('training.job.priority.low');
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { type: 'spring' as const, stiffness: 100, damping: 15 },
  },
} as const;

function getStatusBadge(status: TrainingData['status'], t: (key: string) => string) {
  switch (status) {
    case 'pending':
      return <Badge variant="outline" className="shrink-0 whitespace-nowrap bg-amber-500/10 text-amber-600"><Clock className="h-3 w-3 mr-1" />{t('training.status.pending')}</Badge>;
    case 'approved':
      return <Badge variant="outline" className="shrink-0 whitespace-nowrap bg-green-500/10 text-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />{t('training.status.approved')}</Badge>;
    case 'rejected':
      return <Badge variant="outline" className="shrink-0 whitespace-nowrap bg-red-500/10 text-red-600"><XCircle className="h-3 w-3 mr-1" />{t('training.status.rejected')}</Badge>;
    case 'used':
      return <Badge variant="outline" className="shrink-0 whitespace-nowrap bg-blue-500/10 text-blue-600"><Zap className="h-3 w-3 mr-1" />{t('training.status.used')}</Badge>;
    default:
      return null;
  }
}

function getJobStatusBadge(status: FineTuningJob['status'], t: (key: string) => string) {
  switch (status) {
    case 'pending':
      return <Badge variant="outline" className="bg-amber-500/10 text-amber-600"><Clock className="h-3 w-3 mr-1" />{t('training.status.queued')}</Badge>;
    case 'preparing':
      return <Badge variant="outline" className="bg-blue-500/10 text-blue-600"><RefreshCw className="h-3 w-3 mr-1 animate-spin" />{t('training.status.preparing')}</Badge>;
    case 'training':
    case 'validating':
      return <Badge variant="outline" className="bg-purple-500/10 text-purple-600"><Play className="h-3 w-3 mr-1" />{t('training.status.running')}</Badge>;
    case 'completed':
      return <Badge variant="outline" className="bg-green-500/10 text-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />{t('training.status.completed')}</Badge>;
    case 'failed':
      return <Badge variant="outline" className="bg-red-500/10 text-red-600"><AlertCircle className="h-3 w-3 mr-1" />{t('training.status.failed')}</Badge>;
    case 'cancelled':
      return <Badge variant="outline" className="bg-gray-500/10 text-gray-600"><Pause className="h-3 w-3 mr-1" />{t('training.status.cancelled')}</Badge>;
    default:
      return null;
  }
}

function getTrainingAuditActionLabel(
  action: TrainingGovernanceAuditEvent['action'],
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (action === 'training_promotion_approval_recorded') return t('training.audit.actions.approval');
  if (action === 'training_model_promoted') return t('training.audit.actions.promoted');
  if (action === 'training_model_rollback_executed') return t('training.audit.actions.rolledBack');
  if (action === 'training_run_start_requested') return t('training.audit.actions.runStarted');
  return action;
}

function TrainingDataCard({
  data,
  namespaceName,
  onApprove,
  onReject,
  onResolveScope,
  isPending,
  isSelected,
  onSelectionChange,
  selectionDisabled,
  t,
  locale,
  timeZone,
}: {
  data: TrainingData; 
  namespaceName?: string | null;
  onApprove: () => void;
  onReject: () => void;
  onResolveScope: () => void;
  isPending: boolean;
  isSelected?: boolean;
  onSelectionChange?: (checked: boolean) => void;
  selectionDisabled?: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  locale: string;
  timeZone: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const privacySummary = data.sourceMetadata?.['privacySummary'];

  return (
    <motion.div variants={itemVariants}>
      <Card className="h-full hover-elevate">
        <CardHeader className="pb-2">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {data.status === 'pending' && onSelectionChange && (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => onSelectionChange(Boolean(checked))}
                  disabled={selectionDisabled || isPending}
                  aria-label={`Selecionar dataset ${data.id}`}
                />
              )}
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="max-w-full truncate text-sm font-medium">{data.source}</span>
              {data.sourceType && (
                <Badge variant="outline" className="max-w-full text-xs">
                  {data.sourceType}
                </Badge>
              )}
              {namespaceName && (
                <Badge variant="secondary" className="max-w-full text-xs">
                  {namespaceName}
                </Badge>
              )}
              {data.needsHumanReview && (
                <Badge variant="destructive" className="max-w-full text-xs">
                  Quarentena de escopo
                </Badge>
              )}
            </div>
            <div className="w-full sm:w-auto">
              {getStatusBadge(data.status, t)}
            </div>
          </div>
          <CardDescription className="text-xs">
            {formatDateTime(data.criadoEm, { locale, timeZone })}
            {data.qualityScore !== null && data.qualityScore !== undefined && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {t('training.data.quality', { percent: Math.round(data.qualityScore * 100) })}
              </Badge>
            )}
            {data.isDuplicate && (
              <Badge variant="secondary" className="ml-2 text-xs">
                {t('training.data.duplicate', { percent: Math.round((data.similarityScore || 0) * 100) })}
              </Badge>
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="pb-2">
          <div className="space-y-2">
            {data.messages.slice(0, expanded ? undefined : 2).map((msg, idx) => (
              <div 
                key={idx} 
                className={cn(
                  'text-xs p-2 rounded',
                  msg.role === 'user' ? 'bg-muted' : 'bg-primary/5'
                )}
              >
                <span className="font-medium capitalize">{msg.role}:</span>{' '}
                <span className="text-muted-foreground">{msg.content.slice(0, 100)}{msg.content.length > 100 ? '...' : ''}</span>
              </div>
            ))}
            {data.messages.length > 2 && !expanded && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full text-xs"
                onClick={() => setExpanded(true)}
              >
                {t('training.data.viewMore', { count: data.messages.length - 2 })}
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            )}
            {(data.inferredDomain || data.inferenceConfidence !== null && data.inferenceConfidence !== undefined) && (
              <div className="text-xs text-muted-foreground">
                {data.inferredDomain && (
                  <span>Domínio inferido: {data.inferredDomain}</span>
                )}
                {data.inferenceConfidence !== null && data.inferenceConfidence !== undefined && (
                  <span className="ml-2">Confiança: {Math.round(data.inferenceConfidence * 100)}%</span>
                )}
              </div>
            )}
            {data.quarantineReason && (
              <div className="text-xs text-red-600">
                {data.quarantineReason}
              </div>
            )}
            {typeof data.profileVersion === 'number' && (
              <div className="text-xs text-muted-foreground">
                Profile version: {data.profileVersion}
              </div>
            )}
            {privacySummary !== undefined && (
              <div className="text-xs text-muted-foreground">
                Privacy summary: {JSON.stringify(privacySummary)}
              </div>
            )}
            {data.isDuplicate && data.duplicateOfId ? (
              <div className="text-xs text-muted-foreground">
                Duplicate of: {data.duplicateOfId}
              </div>
            ) : null}
            {data.reviewedAt && (
              <div className="text-xs text-muted-foreground">
                {t('training.data.reviewedAt', { date: formatDateTime(data.reviewedAt, { locale, timeZone }) })}
                {data.reviewedBy && (
                  <span className="ml-2">{t('training.data.reviewedBy', { userId: data.reviewedBy })}</span>
                )}
                {data.reviewNotes && (
                  <span className="ml-2">{t('training.data.reviewNotes', { notes: data.reviewNotes })}</span>
                )}
              </div>
            )}
          </div>
        </CardContent>

        {data.status === 'pending' && (
          <CardFooter className="pt-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onResolveScope}
              disabled={isPending}
            >
              <Folder className="h-3 w-3 mr-1" />
              {data.needsHumanReview
                ? t('training.resolveScope.resolveAction')
                : t('training.resolveScope.changeNamespaceAction')}
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1 text-green-600"
              onClick={onApprove}
              disabled={isPending || !!data.needsHumanReview}
              data-testid={`button-approve-${data.id}`}
            >
              <ThumbsUp className="h-3 w-3 mr-1" />
              {t('training.data.approve')}
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              className="flex-1 text-red-600"
              onClick={onReject}
              disabled={isPending}
              data-testid={`button-reject-${data.id}`}
            >
              <ThumbsDown className="h-3 w-3 mr-1" />
              {t('training.data.reject')}
            </Button>
          </CardFooter>
        )}
      </Card>
    </motion.div>
  );
}

function JobCard({
  job,
  scopeLabel,
  t,
  locale,
  timeZone,
  onClick,
  onPromote,
  onApprovePromotion,
  onRejectPromotion,
  onRollback,
  canPromote,
  canApprovePromotion,
  canRejectPromotion,
  canRollback,
  actionPending,
}: {
  job: FineTuningJob;
  scopeLabel: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  locale: string;
  timeZone: string;
  onClick?: () => void;
  onPromote?: () => void;
  onApprovePromotion?: () => void;
  onRejectPromotion?: () => void;
  onRollback?: () => void;
  canPromote?: boolean;
  canApprovePromotion?: boolean;
  canRejectPromotion?: boolean;
  canRollback?: boolean;
  actionPending?: boolean;
}) {
  const hyperparameters = job.hyperparameters;
  const evalLabel = t(`training.evaluation.${job.evaluationStatus ?? 'pending'}`);
  const promotionLabel = t(`training.promotion.${job.promotionStatus ?? 'candidate'}`);
  const runSourceLabel = getRunSourceLabel(job, t);
  const runPriorityLabel = getRunPriorityLabel(job, t);
  const timelineFinalKey = job.promotionStatus === 'active'
    ? 'training.timeline.active'
    : (job.promotionStatus === 'rejected' || job.evaluationStatus === 'failed'
      ? 'training.timeline.rejected'
      : 'training.timeline.active');

  const timelineChecks = {
    queued: true,
    preparing: job.status !== 'pending',
    training: ['training', 'validating', 'completed', 'failed', 'cancelled'].includes(job.status),
    evaluating: ['running', 'passed', 'failed', 'skipped'].includes(job.evaluationStatus ?? 'pending'),
    candidate: ['candidate', 'staged', 'active', 'rejected', 'rolled_back'].includes(job.promotionStatus ?? 'candidate'),
    final: ['active', 'rejected', 'rolled_back'].includes(job.promotionStatus ?? ''),
  };

  const timelineItems = [
    { key: 'queued', label: t('training.timeline.queued'), done: timelineChecks.queued },
    { key: 'preparing', label: t('training.timeline.preparing'), done: timelineChecks.preparing },
    { key: 'training', label: t('training.timeline.training'), done: timelineChecks.training },
    { key: 'evaluating', label: t('training.timeline.evaluating'), done: timelineChecks.evaluating },
    { key: 'candidate', label: t('training.timeline.candidate'), done: timelineChecks.candidate },
    { key: 'final', label: t(timelineFinalKey), done: timelineChecks.final },
  ];

  return (
    <motion.div variants={itemVariants}>
      <Card className="hover-elevate cursor-pointer" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">{job.name}</CardTitle>
            </div>
            {getJobStatusBadge(job.status, t)}
          </div>
          <CardDescription>
            {t('training.job.baseModel', { model: job.baseModel, count: job.trainingDataCount ?? 0 })}
          </CardDescription>
          <CardDescription>{scopeLabel}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          {['preparing', 'training', 'validating'].includes(job.status) && job.progress !== null && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t('training.job.progress')}</span>
                <span>{job.progress}%</span>
              </div>
              <Progress value={job.progress} className="h-2" />
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="p-2 rounded bg-muted/50 text-center">
              <div className="font-medium">{hyperparameters?.epochs ?? '-'}</div>
              <div className="text-muted-foreground">{t('training.job.epochs')}</div>
            </div>
            <div className="p-2 rounded bg-muted/50 text-center">
              <div className="font-medium">{hyperparameters?.batchSize ?? '-'}</div>
              <div className="text-muted-foreground">{t('training.job.batch')}</div>
            </div>
            <div className="p-2 rounded bg-muted/50 text-center">
              <div className="font-medium">{hyperparameters?.learningRate ?? '-'}</div>
              <div className="text-muted-foreground">{t('training.job.lr')}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{runSourceLabel}</Badge>
            {runPriorityLabel && <Badge variant="outline">{runPriorityLabel}</Badge>}
            <Badge variant="outline">{evalLabel}</Badge>
            <Badge variant="outline">{promotionLabel}</Badge>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">{t('training.timeline.label')}</div>
            <div className="flex flex-wrap gap-1">
              {timelineItems.map((item) => (
                <Badge
                  key={item.key}
                  variant={item.done ? 'secondary' : 'outline'}
                  className="text-[10px]"
                >
                  {item.label}
                </Badge>
              ))}
            </div>
          </div>

          {job.metrics && typeof job.metrics === 'object' && Object.keys(job.metrics).length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {Object.entries(job.metrics).map(([key, value]) => (
                <Badge key={key} variant="secondary" className="text-xs">
                  {key}: {typeof value === 'number' ? value.toFixed(4) : String(value)}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>

        <CardFooter className="pt-2 text-xs text-muted-foreground">
          <div className="w-full space-y-2">
            <div className="flex justify-between w-full">
              <span>{t('training.job.created', { date: formatDate(job.criadoEm, { locale, timeZone }) })}</span>
              {(job.completadoEm ?? (job as unknown as Record<string, unknown>).finalizadoEm as string | undefined) && (
                <span>{t('training.job.finished', { date: formatDate((job.completadoEm ?? (job as unknown as Record<string, unknown>).finalizadoEm) as string, { locale, timeZone }) })}</span>
              )}
            </div>
            {(canPromote || canApprovePromotion || canRejectPromotion || canRollback) && (
              <div className="flex flex-wrap gap-2">
                {canApprovePromotion && onApprovePromotion && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-green-700"
                    disabled={actionPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onApprovePromotion();
                    }}
                  >
                    {t('training.actions.approvePromotion')}
                  </Button>
                )}
                {canRejectPromotion && onRejectPromotion && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-red-700"
                    disabled={actionPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRejectPromotion();
                    }}
                  >
                    {t('training.actions.rejectPromotion')}
                  </Button>
                )}
                {canPromote && onPromote && (
                  <Button
                    size="sm"
                    className="h-7"
                    disabled={actionPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPromote();
                    }}
                  >
                    {t('training.actions.promote')}
                  </Button>
                )}
                {canRollback && onRollback && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={actionPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRollback();
                    }}
                  >
                    {t('training.actions.rollback')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  );
}

function JobDetailModal({
  jobId,
  open,
  onClose,
  t,
  locale,
  timeZone,
}: {
  jobId: string | null;
  open: boolean;
  onClose: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  locale: string;
  timeZone: string;
}) {
  const { data, isLoading } = useQuery<{ job: FineTuningJob }>({
    queryKey: ['/api/training/jobs', jobId],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/training/jobs/${jobId}`);
      return res.json();
    },
    enabled: open && !!jobId,
    refetchInterval: (query) => {
      const job = query.state.data?.job;
      if (!job) return false;
      const active = ['pending', 'preparing', 'training', 'validating'].includes(job.status);
      return active ? 2000 : false;
    },
  });
  const { data: auditData, isLoading: auditLoading } = useQuery<{ events: TrainingGovernanceAuditEvent[] }>({
    queryKey: ['/api/training/jobs', jobId, 'audit-trail'],
    queryFn: async () => {
      const res = await apiRequest('GET', `/api/training/jobs/${jobId}/audit-trail`);
      return res.json();
    },
    enabled: open && !!jobId,
    refetchInterval: false,
  });

  const job = data?.job;
  const auditEvents = auditData?.events ?? [];
  if (!open || !jobId) return null;

  const startTime = job?.iniciadoEm ? new Date(job.iniciadoEm).getTime() : null;
  const elapsedSec = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
  const progress = job?.progress ?? 0;
  const etaSec = progress > 0 && progress < 100 ? Math.round((elapsedSec / progress) * (100 - progress)) : null;
  const currentTask = job?.status === 'preparing' ? t('training.jobDetail.taskPreparing')
    : job?.status === 'training' ? t('training.jobDetail.taskTraining')
    : job?.status === 'validating' ? t('training.jobDetail.taskValidating')
    : job?.status === 'pending' ? t('training.jobDetail.taskQueued')
    : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            {job?.name ?? t('training.jobDetail.loading')}
          </DialogTitle>
          <DialogDescription>
            {job && `${t('training.job.baseModel', { model: job.baseModel, count: job.trainingDataCount ?? 0 })}`}
          </DialogDescription>
        </DialogHeader>
        {isLoading && !job ? (
          <div className="flex items-center gap-2 py-4"><Loader2 className="h-5 w-5 animate-spin" />{t('training.jobDetail.loading')}</div>
        ) : job ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              {getJobStatusBadge(job.status, t)}
              <span className="text-xs text-muted-foreground">{formatDateTime(job.criadoEm, { locale, timeZone })}</span>
            </div>
            {currentTask && (
              <p className="text-sm text-muted-foreground">{currentTask}</p>
            )}
            {['preparing', 'training', 'validating'].includes(job.status) && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span>{t('training.job.progress')}</span>
                  <span>{job.progress ?? 0}%</span>
                </div>
                <Progress value={job.progress ?? 0} className="h-2" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">{t('training.jobDetail.elapsed')}</p>
                <p className="font-medium">{t('training.jobDetail.elapsedValue', { seconds: elapsedSec })}</p>
              </div>
              {etaSec !== null && (
                <div className="rounded bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">{t('training.jobDetail.eta')}</p>
                  <p className="font-medium">~{Math.floor(etaSec / 60)}m {etaSec % 60}s</p>
                </div>
              )}
              {job.completadoEm && (
                <div className="rounded bg-muted/50 p-3 col-span-2">
                  <p className="text-xs text-muted-foreground">{t('training.job.finished', { date: formatDate(job.completadoEm, { locale, timeZone }) })}</p>
                </div>
              )}
            </div>
            {job.errorMessage && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t('training.status.failed')}</AlertTitle>
                <AlertDescription>{job.errorMessage}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('training.audit.title')}
              </p>
              {auditLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('training.audit.loading')}
                </div>
              ) : auditEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('training.audit.empty')}</p>
              ) : (
                <div className="max-h-40 space-y-2 overflow-y-auto rounded border p-2">
                  {auditEvents.map((event) => {
                    const details = event.details ?? {};
                    const reason = typeof details.reason === 'string' ? details.reason : null;
                    return (
                      <div key={event.id} className="rounded border bg-muted/20 p-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Badge variant="outline">{getTrainingAuditActionLabel(event.action, t)}</Badge>
                          <span className="text-muted-foreground">
                            {formatDateTime(event.createdAt, { locale, timeZone })}
                          </span>
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {event.user?.name ?? t('training.audit.systemUser')}
                        </p>
                        {reason && <p className="mt-1">{t('training.audit.reason', { reason })}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateJobDialog({
  open,
  onClose,
  approvedCount,
  minRequiredApprovedData,
  defaultHyperparams,
  presetHyperparams,
  namespaces,
  namespaceId,
  onNamespaceIdChange,
  tenantId,
  t,
}: {
  open: boolean;
  onClose: () => void;
  approvedCount: number;
  minRequiredApprovedData: number;
  defaultHyperparams: TrainingHyperparamsForm;
  presetHyperparams: Record<TrainingHyperparamsPreset, TrainingHyperparamsForm>;
  namespaces: Array<{ id: string; nome: string }>;
  namespaceId: string;
  onNamespaceIdChange: (value: string) => void;
  tenantId: string | undefined;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<TrainingHyperparamsPreset>('standard');
  const [advancedOverride, setAdvancedOverride] = useState(false);
  const [epochs, setEpochs] = useState(defaultHyperparams.epochs);
  const [batchSize, setBatchSize] = useState(defaultHyperparams.batchSize);
  const [learningRate, setLearningRate] = useState(defaultHyperparams.learningRate);
  const [gradientAccumulationSteps, setGradientAccumulationSteps] = useState(defaultHyperparams.gradientAccumulationSteps);
  const [warmupSteps, setWarmupSteps] = useState(defaultHyperparams.warmupSteps);
  const [maxSeqLen, setMaxSeqLen] = useState(defaultHyperparams.maxSeqLen);
  const [loraRank, setLoraRank] = useState(defaultHyperparams.loraRank);
  const [loraAlpha, setLoraAlpha] = useState(defaultHyperparams.loraAlpha);
  const [loraDropout, setLoraDropout] = useState(defaultHyperparams.loraDropout);
  const createJobIdempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const presetValues = presetHyperparams[preset] ?? defaultHyperparams;
    setEpochs(presetValues.epochs);
    setBatchSize(presetValues.batchSize);
    setLearningRate(presetValues.learningRate);
    setGradientAccumulationSteps(presetValues.gradientAccumulationSteps);
    setWarmupSteps(presetValues.warmupSteps);
    setMaxSeqLen(presetValues.maxSeqLen);
    setLoraRank(presetValues.loraRank);
    setLoraAlpha(presetValues.loraAlpha);
    setLoraDropout(presetValues.loraDropout);
  }, [defaultHyperparams, open, preset, presetHyperparams]);

  useEffect(() => {
    if (!open) {
      createJobIdempotencyRef.current = null;
    }
  }, [open]);

  const createJob = useMutation({
    mutationFn: async () => {
      if (!namespaceId || !tenantId) {
        throw new Error(t('training.createJob.namespaceRequired'));
      }

      const presetValues = presetHyperparams[preset] ?? defaultHyperparams;
      const parsed = sharedTrainingHyperparamsSchema.safeParse({
        ...presetValues,
        epochs,
        batchSize,
        learningRate,
        ...(advancedOverride
          ? {
            gradientAccumulationSteps,
            warmupSteps,
            maxSeqLen,
            loraRank,
            loraAlpha,
            loraDropout,
          }
          : {}),
      });
      if (!parsed.success) {
        throw new Error(t('training.createJob.invalidHyperparams'));
      }
      const validatedHyperparams = parsed.data;
      const requestPayload = {
        tenantId,
        namespaceId,
        name,
        hyperparametersPreset: preset,
        hyperparameters: validatedHyperparams,
      };
      const fingerprint = buildTrainingIdempotencyFingerprint(requestPayload);
      const idempotencyKey = createJobIdempotencyRef.current?.fingerprint === fingerprint
        ? createJobIdempotencyRef.current.key
        : generateTrainingIdempotencyKey('training-job');
      createJobIdempotencyRef.current = { fingerprint, key: idempotencyKey };

      return apiRequest('POST', '/api/training/jobs', requestPayload, {
        headers: {
          'X-Idempotency-Key': idempotencyKey,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      toast({ title: t('training.success.jobCreated') });
      onClose();
      setName('');
      setPreset('standard');
      setAdvancedOverride(false);
      createJobIdempotencyRef.current = null;
    },
    onError: (error) => {
      const retryAfterHint = getRetryAfterHint(error, t);
      toast({
        title: error instanceof Error ? error.message : t('training.errors.createJob'),
        description: retryAfterHint ?? undefined,
        variant: 'destructive',
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            {t('training.createJob.title')}
          </DialogTitle>
          <DialogDescription>
            {t('training.createJob.description')}
            {approvedCount < minRequiredApprovedData && (
              <span className="block mt-2 text-amber-600">
                {t('training.createJob.minDataWarning', {
                  count: approvedCount,
                  min: minRequiredApprovedData,
                })}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t('training.createJob.namespaceLabel')}</Label>
            <Select value={namespaceId} onValueChange={onNamespaceIdChange}>
              <SelectTrigger data-testid="select-job-namespace">
                <SelectValue placeholder={t('training.createJob.namespacePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {namespaces.map((ns) => (
                  <SelectItem key={ns.id} value={ns.id}>
                    {ns.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('training.createJob.namespaceHelp')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">{t('training.createJob.nameLabel')}</Label>
            <Input
              id="name"
              placeholder={t('training.createJob.namePlaceholder')}
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              data-testid="input-job-name"
            />
          </div>

          <div className="grid gap-2">
            <Label>{t('training.createJob.presetLabel')}</Label>
            <Select value={preset} onValueChange={(value) => setPreset(value as TrainingHyperparamsPreset)}>
              <SelectTrigger data-testid="select-hyperparams-preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="safe">{t('training.createJob.presetSafe')}</SelectItem>
                <SelectItem value="standard">{t('training.createJob.presetStandard')}</SelectItem>
                <SelectItem value="large">{t('training.createJob.presetLarge')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">{t('training.createJob.advancedOverride')}</p>
              <p className="text-xs text-muted-foreground">{t('training.createJob.advancedOverrideDesc')}</p>
            </div>
            <Switch checked={advancedOverride} onCheckedChange={setAdvancedOverride} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="epochs">{t('training.createJob.epochs')}</Label>
              <Input
                id="epochs"
                type="number"
                min={1}
                max={50}
                value={epochs}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEpochs(Number(e.target.value))}
                data-testid="input-epochs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="batchSize">{t('training.createJob.batchSize')}</Label>
              <Input
                id="batchSize"
                type="number"
                min={1}
                max={64}
                value={batchSize}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBatchSize(Number(e.target.value))}
                data-testid="input-batch-size"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lr">{t('training.createJob.learningRate')}</Label>
              <Input
                id="lr"
                type="number"
                step={0.00001}
                min={0.00001}
                max={0.99999}
                value={learningRate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLearningRate(Number(e.target.value))}
                data-testid="input-learning-rate"
              />
            </div>
          </div>

          {advancedOverride && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="gradientAccumulationSteps">{t('training.createJob.gradientAccumulationSteps')}</Label>
                  <Input
                    id="gradientAccumulationSteps"
                    type="number"
                    min={1}
                    max={128}
                    value={gradientAccumulationSteps}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGradientAccumulationSteps(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="warmupSteps">{t('training.createJob.warmupSteps')}</Label>
                  <Input
                    id="warmupSteps"
                    type="number"
                    min={0}
                    max={10000}
                    value={warmupSteps}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWarmupSteps(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxSeqLen">{t('training.createJob.maxSeqLen')}</Label>
                  <Input
                    id="maxSeqLen"
                    type="number"
                    min={256}
                    max={32768}
                    value={maxSeqLen}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxSeqLen(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="loraRank">{t('training.createJob.loraRank')}</Label>
                  <Input
                    id="loraRank"
                    type="number"
                    min={4}
                    max={128}
                    value={loraRank}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLoraRank(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="loraAlpha">{t('training.createJob.loraAlpha')}</Label>
                  <Input
                    id="loraAlpha"
                    type="number"
                    min={8}
                    max={256}
                    value={loraAlpha}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLoraAlpha(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="loraDropout">{t('training.createJob.loraDropout')}</Label>
                  <Input
                    id="loraDropout"
                    type="number"
                    min={0}
                    max={0.5}
                    step={0.01}
                    value={loraDropout}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLoraDropout(Number(e.target.value))}
                  />
                </div>
              </div>
            </>
          )}

          <div className="p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4 text-primary" />
              <span>{t('training.createJob.approvedData', { count: approvedCount })}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-job">
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => createJob.mutate()}
            disabled={!namespaceId || !tenantId || !name || approvedCount < minRequiredApprovedData || createJob.isPending}
            data-testid="button-create-job"
          >
            {createJob.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            {t('training.createJob.start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// COMPONENTE: MultimodalUploadTab - Upload de mídia multimodal para RAG
// ARQUITETURA 100% GPU (Gate 2):
// - Imagens: OpenAI Vision (descrição textual, sem embeddings de imagem)
// - Áudios: OpenAI ASR (gpt-4o-transcribe) + Qwen3-Embedding-0.6B embeddings (1024 dim)
// - Vídeo: NÃO suportado (desabilitado por custo/peso de GPU)
// REGRA 8: TypeScript strict, zero any
// REGRA 16: Validação client-side, error handling, UX feedback
// ============================================================================

// ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
interface MediaUpload {
  id: string;
  file: File;
  type: 'image' | 'audio';
  progress: number;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  error?: string;
  uploadId?: string;
}

interface MediaUploadResult {
  id: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  status: string;
  processedAt?: string;
}

interface RagDocumentItem {
  id: string;
  namespaceId?: string | null;
  titulo: string;
  tipo?: string | null;
  processado: boolean;
  sentToTrainingAt?: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

function MultimodalUploadTab({ t }: { t: (key: string, options?: Record<string, unknown>) => string }) {
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<MediaUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [description, setDescription] = useState('');
  const [namespaceId, setNamespaceId] = useState<string>('');
  const [promotingDocumentId, setPromotingDocumentId] = useState<string | null>(null);
  const [promotingMediaId, setPromotingMediaId] = useState<string | null>(null);
  const [documentTrainingDialogOpen, setDocumentTrainingDialogOpen] = useState(false);
  const [selectedDocumentForTraining, setSelectedDocumentForTraining] = useState<{ documentId: string; maxSamples?: number } | null>(null);
  const [documentTrainingNamespaceId, setDocumentTrainingNamespaceId] = useState<string>('');
  const [mediaTrainingDialogOpen, setMediaTrainingDialogOpen] = useState(false);
  const [selectedMediaForTraining, setSelectedMediaForTraining] = useState<string | null>(null);
  const [mediaTrainingNamespaceId, setMediaTrainingNamespaceId] = useState<string>('');

  const { data: namespacesData } = useQuery<Namespace[]>({
    queryKey: ['/api/namespaces'],
    staleTime: 1000 * 60,
  });
  const namespaces = namespacesData ?? [];

  const {
    data: ragDocumentsData,
    isLoading: isLoadingRagDocuments,
    refetch: refetchRagDocuments,
  } = useQuery<{ documents: RagDocumentItem[] }>({
    queryKey: ['/api/rag/documents'],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/rag/documents');
      return response.json();
    },
  });

  const ragDocuments = ragDocumentsData?.documents ?? [];

  const {
    data: mediaUploadsData,
    isLoading: isLoadingMediaUploads,
    refetch: refetchMediaUploads,
  } = useQuery<{ uploads: Array<{
    id: string;
    mediaType: string;
    originalFilename: string;
    processingStatus: string;
    namespaceId: string | null;
    approvedForTraining: boolean | null;
    llmDescription?: string | null;
    transcription?: string | null;
    criadoEm: string;
  }> }>({
    queryKey: ['/api/media/uploads', { limit: 100 }],
    queryFn: async () => {
      const response = await apiRequest('GET', '/api/media/uploads?limit=100');
      return response.json();
    },
  });

  const mediaUploads = (mediaUploadsData?.uploads ?? []).filter(
    (u) => (u.mediaType === 'image' || u.mediaType === 'audio') && u.processingStatus === 'completed'
  );

  const [bookModeByDocument, setBookModeByDocument] = useState<Record<string, boolean>>({});

  const promoteDocumentToTraining = useMutation({
    mutationFn: async (params: { documentId: string; maxSamples?: number; namespaceId: string }) => {
      const body = {
        ...(params.maxSamples ? { maxSamples: params.maxSamples } : {}),
        scope: { namespaceId: params.namespaceId },
      };
      const response = await apiRequest('POST', `/api/rag/documents/${params.documentId}/send-to-training`, body);
      return response.json() as Promise<{
        success: boolean;
        data?: { attempted: number; sent: number; failed: number };
        message?: string;
      }>;
    },
    onMutate: (params) => {
      setPromotingDocumentId(params.documentId);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      setDocumentTrainingDialogOpen(false);
      setSelectedDocumentForTraining(null);
      setDocumentTrainingNamespaceId('');
      toast({
        title: t('training.multimodal.promoteDocument.success'),
        description: result?.message ?? t('training.multimodal.promoteDocument.successDesc'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Falha ao promover documento',
        description: error.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setPromotingDocumentId(null);
      refetchRagDocuments();
    },
  });

  const promoteMediaToTraining = useMutation({
    mutationFn: async (params: { mediaUploadId: string; namespaceId: string }) => {
      const response = await apiRequest('POST', `/api/media/uploads/${params.mediaUploadId}/send-to-training`, {
        namespaceId: params.namespaceId,
      });
      return response.json() as Promise<{
        success: boolean;
        data?: { mediaUploadId: string; trainingDataId?: string };
        message?: string;
      }>;
    },
    onMutate: (params) => {
      setPromotingMediaId(params.mediaUploadId);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      queryClient.invalidateQueries({ queryKey: ['/api/media/uploads'] });
      setMediaTrainingDialogOpen(false);
      setSelectedMediaForTraining(null);
      setMediaTrainingNamespaceId('');
      toast({
        title: t('training.multimodal.promoteMedia.success'),
        description: result?.message ?? t('training.multimodal.promoteMedia.successDesc'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('training.multimodal.promoteMedia.error'),
        description: error.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setPromotingMediaId(null);
      refetchMediaUploads();
    },
  });

  // Tipos de arquivo aceitos para cada categoria
  // ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
  const acceptedTypes = {
    image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
    audio: ['audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4'],
  } as const;

  const allAccepted = [
    ...acceptedTypes.image,
    ...acceptedTypes.audio,
  ].join(',');

  // Determinar tipo de mídia baseado no MIME type
  // BUG FIX 23/12/2025: Normalização robusta de mimeType para suportar variações de case e espaços
  // MIME types são case-insensitive segundo RFC 2045, mas podem vir com variações (ex: "Image/JPEG", "Audio/MPEG")
  // .toLowerCase() e .trim() garantem matching correto mesmo com variações
  // Extrair apenas o tipo base (antes de ;) para suportar parâmetros adicionais (ex: "audio/mpeg; codecs=mp3")
  // Consistente com normalização em rag-service, chat-service e integrations-service para evitar rejeição de tipos legítimos
  // BUG FIX 23/12/2025: Type assertion segura seguindo padrão da plataforma (chat-service, rag-service)
  // includes() faz validação real em runtime, type assertion apenas informa TypeScript sobre tipos possíveis
  const getMediaType = (mimeType: string): 'image' | 'audio' | null => {
    const normalizedMimeType = mimeType.toLowerCase().trim().split(';')[0].trim();
    if (acceptedTypes.image.includes(normalizedMimeType as typeof acceptedTypes.image[number])) return 'image';
    if (acceptedTypes.audio.includes(normalizedMimeType as typeof acceptedTypes.audio[number])) return 'audio';
    return null;
  };

  // Handler para drag & drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    addFilesToQueue(files);
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    addFilesToQueue(files);
    e.target.value = ''; // Reset input para permitir re-seleção do mesmo arquivo
  };

  // Limites de arquivo por tipo de mídia (consistente com Chat e RAG service)
  // CORREÇÃO 23/12/2025: Removido limite fixo de 100MB (vídeo) - agora usa limites por tipo
  // BUG FIX 23/12/2025: Tipo explícito garante que todas as chaves de MediaType existam
  // Isso previne acesso a undefined e NaN em cálculos de limite
  // REMOVIDO 23/12/2025: video desabilitado (muito pesado para GPU)
  const FILE_LIMITS: Record<'image' | 'audio', number> = {
    image: 10 * 1024 * 1024,  // 10MB para imagens
    audio: 25 * 1024 * 1024,  // 25MB para áudio
  } as const;

  // Adicionar arquivos à fila de upload
  const addFilesToQueue = (files: File[]) => {
    const newUploads: MediaUpload[] = [];

    for (const file of files) {
      // Validar tipo primeiro (necessário para determinar limite)
      const mediaType = getMediaType(file.type);
      if (!mediaType) {
        toast({
          title: t('training.multimodal.errors.unsupportedType'),
          description: file.name,
          variant: 'destructive',
        });
        continue;
      }

      // BUG FIX 23/12/2025: Type narrowing explícito após validação para garantir type safety
      // TypeScript não faz narrowing automático após continue, então precisamos garantir que mediaType não é null
      // Após o early return acima, sabemos que mediaType é 'image' | 'audio', mas TypeScript não infere isso
      // Criar variável não-nullable para garantir type safety em todas as operações subsequentes
      const validatedMediaType: 'image' | 'audio' = mediaType;

      // Validar tamanho baseado no tipo de mídia
      // BUG FIX 23/12/2025: Usar validatedMediaType para garantir type safety
      const limit = FILE_LIMITS[validatedMediaType];
      if (!limit) {
        toast({
          title: t('training.multimodal.errors.unsupportedType'),
          description: `${file.name} - tipo de mídia não suportado: ${validatedMediaType}`,
          variant: 'destructive',
        });
        continue;
      }
      if (file.size > limit) {
        const limitMB = limit / (1024 * 1024);
        toast({
          title: t('training.multimodal.errors.fileTooLarge'),
          description: `${file.name} (máx ${limitMB}MB para ${validatedMediaType === 'image' ? 'imagens' : 'áudio'})`,
          variant: 'destructive',
        });
        continue;
      }

      newUploads.push({
        id: crypto.randomUUID(),
        file,
        type: validatedMediaType,
        progress: 0,
        status: 'pending',
      });
    }

    if (newUploads.length > 0) {
      setUploads(prev => [...prev, ...newUploads]);
    }
  };

  // Upload individual de arquivo
  const uploadFile = async (upload: MediaUpload) => {
    setUploads(prev => prev.map(u => 
      u.id === upload.id ? { ...u, status: 'uploading' as const, progress: 10 } : u
    ));

    try {
      const formData = new FormData();
      formData.append('file', upload.file);
      if (description) {
        formData.append('description', description);
      }
      if (namespaceId) {
        formData.append('namespaceId', namespaceId);
      }

      // Simular progresso durante upload (real progress seria via XHR)
      const progressInterval = setInterval(() => {
        setUploads(prev => prev.map(u => 
          u.id === upload.id && u.progress < 90 
            ? { ...u, progress: Math.min(90, u.progress + 10) } 
            : u
        ));
      }, 300);

      try {
        const response = await fetch('/api/media/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || `Erro ${response.status}`);
        }

        const result = await response.json() as MediaUploadResult;

        setUploads(prev => prev.map(u => 
          u.id === upload.id 
            ? { ...u, status: 'processing' as const, progress: 100, uploadId: result.id } 
            : u
        ));

        // Marcar como completado após pequeno delay (processamento assíncrono no backend)
        setTimeout(() => {
          setUploads(prev => prev.map(u => 
            u.id === upload.id ? { ...u, status: 'completed' as const } : u
          ));
          // Invalidar queries para atualizar lista de uploads
          queryClient.invalidateQueries({ queryKey: ['/api/media/uploads'] });
        }, 2000);

      } finally {
        // Sempre limpar interval (sucesso ou erro)
        clearInterval(progressInterval);
      }

    } catch (error) {
      frontendLogger.error('Erro ao fazer upload de mídia', {
        error: error instanceof Error ? error.message : String(error),
        fileName: upload.file.name,
        fileType: upload.file.type,
        fileSize: upload.file.size,
      });

      setUploads(prev => prev.map(u => 
        u.id === upload.id 
          ? { ...u, status: 'error' as const, error: error instanceof Error ? error.message : 'Erro desconhecido' } 
          : u
      ));
    }
  };

  // Upload de todos os arquivos pendentes
  const uploadAllPending = async () => {
    const pendingUploads = uploads.filter(u => u.status === 'pending');
    for (const upload of pendingUploads) {
      await uploadFile(upload);
    }
  };

  // Remover upload da fila
  const removeUpload = (id: string) => {
    setUploads(prev => prev.filter(u => u.id !== id));
  };

  // Limpar todos os completados
  const clearCompleted = () => {
    setUploads(prev => prev.filter(u => u.status !== 'completed'));
  };

  // Ícone baseado no tipo de mídia
  // ATUALIZADO 23/12/2025: Removido suporte a vídeo (muito pesado para GPU)
  // BUG FIX 23/12/2025: Tipo restrito garante que apenas tipos válidos sejam aceitos
  // TypeScript garante type safety - não há necessidade de default case se tipo está correto
  // Mas mantemos default como proteção defensiva para casos extremos (type narrowing failure)
  const getMediaIcon = (type: 'image' | 'audio'): typeof ImageIcon | typeof FileAudio => {
    switch (type) {
      case 'image': return ImageIcon;
      case 'audio': return FileAudio;
      default: {
        // BUG FIX 23/12/2025: Log de erro para identificar type narrowing failures
        // Este caso nunca deveria ocorrer se type está correto, mas serve como proteção defensiva
        // REGRA 8: Usar frontendLogger estruturado ao invés de console.error
        frontendLogger.error('getMediaIcon recebeu tipo inesperado', { type });
        return FileAudio; // Fallback seguro para tipos inesperados
      }
    }
  };

  const pendingCount = uploads.filter(u => u.status === 'pending').length;
  const completedCount = uploads.filter(u => u.status === 'completed').length;

  return (
    <div className="flex-1 p-4 space-y-6">
      {/* Header com descrição */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Image className="h-5 w-5 text-primary" />
            {t('training.multimodal.title')}
          </CardTitle>
          <CardDescription>
            {t('training.multimodal.subtitle')}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Descrição opcional para todos os uploads */}
          <div className="space-y-2">
            <Label htmlFor="media-description">{t('training.multimodal.descriptionLabel')}</Label>
            <Input
              id="media-description"
              placeholder={t('training.multimodal.descriptionPlaceholder')}
              value={description}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
              maxLength={200}
            />
          </div>

          {/* Namespace opcional (Plano RAG Multimodal Enterprise Fase 2 - 11/02/2026) */}
          <div className="space-y-2">
            <Label htmlFor="media-namespace">{t('training.multimodal.namespaceLabel')}</Label>
            <Select value={namespaceId || '__none__'} onValueChange={(v) => setNamespaceId(v === '__none__' ? '' : v)}>
              <SelectTrigger id="media-namespace" data-testid="multimodal-namespace-select">
                <SelectValue placeholder={t('training.multimodal.namespacePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t('training.multimodal.namespacePlaceholder')}</SelectItem>
                {namespaces.map((ns) => (
                  <SelectItem key={ns.id} value={ns.id}>
                    {ns.nome || ns.slug || ns.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('training.multimodal.namespaceHelp')}</p>
          </div>

          {/* Zona de Drop */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer",
              isDragging 
                ? "border-primary bg-primary/5 scale-[1.02]" 
                : "border-muted-foreground/25 hover:border-primary hover:bg-muted/50"
            )}
            onClick={() => document.getElementById('multimodal-upload-input')?.click()}
          >
            <input
              id="multimodal-upload-input"
              type="file"
              accept={allAccepted}
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />

            <div className="space-y-3">
              <div className="flex justify-center gap-4">
                <div className="p-3 rounded-full bg-blue-500/10">
                  <ImageIcon className="h-6 w-6 text-blue-500" />
                </div>
                <div className="p-3 rounded-full bg-green-500/10">
                  <Mic className="h-6 w-6 text-green-500" />
                </div>
                {/* REMOVIDO 23/12/2025: Vídeo desabilitado (muito pesado para GPU) */}
              </div>
              <div>
                <p className="font-medium">
                  {t('training.multimodal.dragDrop')}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('training.multimodal.supportedTypes')}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Uploads */}
      {uploads.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {t('training.multimodal.queueTitle')}
              </CardTitle>
              <div className="flex gap-2">
                {completedCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearCompleted}>
                    {t('training.multimodal.clearCompleted')}
                  </Button>
                )}
                {pendingCount > 0 && (
                  <Button size="sm" onClick={uploadAllPending}>
                    <Upload className="h-4 w-4 mr-2" />
                    {t('training.multimodal.uploadAll', { count: pendingCount })}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {uploads.map((upload) => {
                  const MediaIcon = getMediaIcon(upload.type);
                  return (
                    <div
                      key={upload.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted/30"
                    >
                      <div className={cn(
                        "p-2 rounded-lg",
                        upload.type === 'image' && "bg-blue-500/10",
                        upload.type === 'audio' && "bg-green-500/10"
                      )}>
                        <MediaIcon className={cn(
                          "h-4 w-4",
                          upload.type === 'image' && "text-blue-500",
                          upload.type === 'audio' && "text-green-500"
                        )} />
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{upload.file.name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{(upload.file.size / 1024 / 1024).toFixed(2)} MB</span>
                          <span>•</span>
                          <span className="capitalize">{upload.type}</span>
                        </div>
                        {(upload.status === 'uploading' || upload.status === 'processing') && (
                          <Progress value={upload.progress} className="h-1 mt-2" />
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {upload.status === 'pending' && (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-600">
                            <Clock className="h-3 w-3 mr-1" />
                            {t('training.multimodal.status.pending')}
                          </Badge>
                        )}
                        {upload.status === 'uploading' && (
                          <Badge variant="outline" className="bg-blue-500/10 text-blue-600">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            {t('training.multimodal.status.uploading')}
                          </Badge>
                        )}
                        {upload.status === 'processing' && (
                          <Badge variant="outline" className="bg-purple-500/10 text-purple-600">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            {t('training.multimodal.status.processing')}
                          </Badge>
                        )}
                        {upload.status === 'completed' && (
                          <Badge variant="outline" className="bg-green-500/10 text-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            {t('training.multimodal.status.completed')}
                          </Badge>
                        )}
                        {upload.status === 'error' && (
                          <Badge variant="outline" className="bg-red-500/10 text-red-600">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            {t('training.multimodal.status.error')}
                          </Badge>
                        )}
                        
                        {(upload.status === 'pending' || upload.status === 'error') && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8"
                            onClick={() => removeUpload(upload.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Lista de documentos RAG com promoção explícita para treinamento */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Folder className="h-4 w-4 text-primary" />
                Documentos da RAG
              </CardTitle>
              <CardDescription>
                RAG e Treinamento são separados. A promoção para dataset de treinamento é explícita e auditável por documento.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchRagDocuments()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('common.refresh')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingRagDocuments ? (
            <Skeleton className="h-24" />
          ) : ragDocuments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum documento RAG encontrado.</p>
          ) : (
            <div className="space-y-3">
              {ragDocuments.map((doc) => {
                const canPromote = doc.processado && Boolean(doc.namespaceId) && !doc.sentToTrainingAt;
                const isPromoting = promotingDocumentId === doc.id && promoteDocumentToTraining.isPending;

                return (
                  <div key={doc.id} className="rounded-lg border p-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.titulo}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{doc.tipo ?? 'documento'}</Badge>
                        <Badge variant={doc.processado ? 'default' : 'secondary'}>
                          {doc.processado ? 'processado' : 'processando'}
                        </Badge>
                        {!doc.namespaceId && (
                          <Badge variant="destructive">sem namespace</Badge>
                        )}
                        {doc.sentToTrainingAt && (
                          <Badge variant="default" className="bg-green-500/10 text-green-600">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            enviado para treinamento
                          </Badge>
                        )}
                        <span>Atualizado em {formatDate(doc.atualizadoEm)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Switch
                          id={`book-mode-${doc.id}`}
                          checked={bookModeByDocument[doc.id] ?? false}
                          onCheckedChange={(checked) =>
                            setBookModeByDocument((prev) => ({ ...prev, [doc.id]: checked }))
                          }
                        />
                        <Label htmlFor={`book-mode-${doc.id}`} className="text-xs cursor-pointer">
                          {t('training.promoteDocument.bookMode')}
                        </Label>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canPromote || isPromoting}
                        onClick={() => {
                          const maxSamples = (bookModeByDocument[doc.id] ?? false) ? 100 : undefined;
                          setSelectedDocumentForTraining({
                            documentId: doc.id,
                            maxSamples,
                          });
                          setDocumentTrainingNamespaceId(doc.namespaceId ?? '');
                          setDocumentTrainingDialogOpen(true);
                        }}
                      >
                      {isPromoting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Enviando...
                        </>
                      ) : (
                        <>
                          <FileCheck className="h-4 w-4 mr-2" />
                          Enviar para Treinamento
                        </>
                      )}
                    </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mídia Processada - Promoção para treinamento (Plano RAG Multimodal Fase 4) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-primary" />
                {t('training.multimodal.mediaProcessed.title')}
              </CardTitle>
              <CardDescription>
                {t('training.multimodal.mediaProcessed.subtitle')}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchMediaUploads()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('common.refresh')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingMediaUploads ? (
            <Skeleton className="h-24" />
          ) : mediaUploads.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('training.multimodal.mediaProcessed.empty')}</p>
          ) : (
            <div className="space-y-3">
              {mediaUploads.map((media) => {
                const canPromote = Boolean(media.namespaceId) && !media.approvedForTraining;
                const hasContent = (media.mediaType === 'image' && media.llmDescription) || (media.mediaType === 'audio' && media.transcription);
                const isPromoting = promotingMediaId === media.id && promoteMediaToTraining.isPending;

                return (
                  <div key={media.id} className="rounded-lg border p-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1 min-w-0 flex items-center gap-3">
                      <div className={cn(
                        'p-2 rounded-lg shrink-0',
                        media.mediaType === 'image' && 'bg-blue-500/10',
                        media.mediaType === 'audio' && 'bg-green-500/10'
                      )}>
                        {media.mediaType === 'image' ? (
                          <ImageIcon className="h-4 w-4 text-blue-500" />
                        ) : (
                          <FileAudio className="h-4 w-4 text-green-500" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium truncate">{media.originalFilename}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">{media.mediaType}</Badge>
                          {media.approvedForTraining && (
                            <Badge variant="default" className="bg-green-500/10 text-green-600">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              {t('training.multimodal.mediaProcessed.sent')}
                            </Badge>
                          )}
                          {!media.namespaceId && (
                            <Badge variant="destructive">{t('training.multimodal.mediaProcessed.noNamespace')}</Badge>
                          )}
                          <span>{formatDate(media.criadoEm)}</span>
                        </div>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canPromote || !hasContent || isPromoting}
                      onClick={() => {
                        setSelectedMediaForTraining(media.id);
                        setMediaTrainingNamespaceId(media.namespaceId ?? '');
                        setMediaTrainingDialogOpen(true);
                      }}
                    >
                      {isPromoting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {t('training.multimodal.mediaProcessed.sending')}
                        </>
                      ) : (
                        <>
                          <FileCheck className="h-4 w-4 mr-2" />
                          {t('training.multimodal.mediaProcessed.sendToTraining')}
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={documentTrainingDialogOpen}
        onOpenChange={(open) => {
          setDocumentTrainingDialogOpen(open);
          if (!open) {
            setSelectedDocumentForTraining(null);
            setDocumentTrainingNamespaceId('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar documento para treinamento</DialogTitle>
            <DialogDescription>
              Selecione o namespace de destino para gerar o dataset do documento.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Select value={documentTrainingNamespaceId} onValueChange={setDocumentTrainingNamespaceId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um namespace" />
              </SelectTrigger>
              <SelectContent>
                {namespaces.map((namespace) => (
                  <SelectItem key={namespace.id} value={namespace.id}>
                    {namespace.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocumentTrainingDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!selectedDocumentForTraining || !documentTrainingNamespaceId || promoteDocumentToTraining.isPending}
              onClick={() => {
                if (!selectedDocumentForTraining || !documentTrainingNamespaceId) {
                  toast({ title: 'Namespace obrigatório', variant: 'destructive' });
                  return;
                }
                promoteDocumentToTraining.mutate({
                  documentId: selectedDocumentForTraining.documentId,
                  maxSamples: selectedDocumentForTraining.maxSamples,
                  namespaceId: documentTrainingNamespaceId,
                });
              }}
            >
              {promoteDocumentToTraining.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                'Confirmar envio'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mediaTrainingDialogOpen}
        onOpenChange={(open) => {
          setMediaTrainingDialogOpen(open);
          if (!open) {
            setSelectedMediaForTraining(null);
            setMediaTrainingNamespaceId('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enviar mídia para treinamento</DialogTitle>
            <DialogDescription>
              Selecione o namespace de destino para gerar o dataset da mídia.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Select value={mediaTrainingNamespaceId} onValueChange={setMediaTrainingNamespaceId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um namespace" />
              </SelectTrigger>
              <SelectContent>
                {namespaces.map((namespace) => (
                  <SelectItem key={namespace.id} value={namespace.id}>
                    {namespace.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMediaTrainingDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              disabled={!selectedMediaForTraining || !mediaTrainingNamespaceId || promoteMediaToTraining.isPending}
              onClick={() => {
                if (!selectedMediaForTraining || !mediaTrainingNamespaceId) {
                  toast({ title: 'Namespace obrigatório', variant: 'destructive' });
                  return;
                }
                promoteMediaToTraining.mutate({
                  mediaUploadId: selectedMediaForTraining,
                  namespaceId: mediaTrainingNamespaceId,
                });
              }}
            >
              {promoteMediaToTraining.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Enviando...
                </>
              ) : (
                'Confirmar envio'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Informações sobre processamento */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4 text-primary" />
            {t('training.multimodal.info.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <div className="flex items-center gap-2 mb-2">
                <ImageIcon className="h-5 w-5 text-blue-500" />
                <p className="font-medium text-blue-600">{t('training.multimodal.info.images.title')}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('training.multimodal.info.images.desc')}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                JPEG, PNG, WebP, GIF (máx 10MB)
              </p>
            </div>
            
            <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Mic className="h-5 w-5 text-green-500" />
                <p className="font-medium text-green-600">{t('training.multimodal.info.audio.title')}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('training.multimodal.info.audio.desc')}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                MP3, WAV, WebM, OGG, M4A (máx 25MB)
              </p>
            </div>
            
            {/* REMOVIDO 23/12/2025: Seção de vídeo desabilitada (muito pesado para GPU) */}
          </div>

          <Alert>
            <Zap className="h-4 w-4" />
            <AlertTitle>{t('training.multimodal.info.gpu.title')}</AlertTitle>
            <AlertDescription>
              {t('training.multimodal.info.gpu.desc')}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// COMPONENTE: BulkImportTab - Upload em massa de dados de treinamento
// REGRA 8: TypeScript strict, zero any, validação Zod enterprise
// REGRA 16: Validação client-side, error handling, UX feedback
// ============================================================================
function BulkImportTab({ t }: { t: (key: string, options?: Record<string, unknown>) => string }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<BulkImportEntry[]>([]);
  const [source, setSource] = useState('bulk-import');
  const [namespaceId, setNamespaceId] = useState<string>('');
  const [sourceType, setSourceType] = useState<string>('external');
  const [autoApprove, setAutoApprove] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const BULK_IMPORT_SOURCE_TYPES = [
    'external',
    'chat',
    'trading_demo',
    'trading_postmortem',
    'trading_signal',
    'trading_order',
    'document',
    'rag_document',
    'rag_media',
    'upload',
    'manual',
    'system',
  ] as const;
  const { data: namespacesData } = useQuery<Namespace[]>({
    queryKey: ['/api/namespaces'],
    staleTime: 1000 * 60,
  });
  const namespaces = namespacesData ?? [];

  // Schema Zod para validação enterprise (Regra 8)
  const BulkImportEntrySchema = z.object({
    messages: z.array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string().min(1),
      })
    ).min(2),
    rating: z.number().int().min(1).max(5).optional(),
  });

  const BulkImportSchema = z.array(BulkImportEntrySchema).max(1000);

  const bulkImport = useMutation({
    mutationFn: async (): Promise<BulkImportResult> => {
      // REGRA 8: apiRequest retorna Response, precisa fazer .json() para parsear
      // Segue padrão usado em Namespaces.tsx, Agents.tsx, BackupAdmin.tsx
      const res = await apiRequest('POST', '/api/training/bulk-import', {
        data: parsedData,
        source: source || 'bulk-import',
        ...(namespaceId ? { namespaceId } : {}),
        sourceType,
        autoApprove,
      });
      return res.json();
    },
    onSuccess: (result) => {
      const duplicatesCount = result.duplicates ?? result.duplicatesSkipped ?? 0;
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      toast({ 
        title: t('training.bulkImport.success.fullSuccess', { 
          imported: result.imported,
          duplicates: duplicatesCount,
        }),
      });
      // Limpar formulário após sucesso
      setFile(null);
      setParsedData([]);
      setSource('bulk-import');
      setNamespaceId('');
      setSourceType('external');
      setAutoApprove(false);
    },
    onError: (error) => {
      // REGRA 8: Logger estruturado enviado para observability stack
      frontendLogger.error('Erro ao importar dados de treinamento em massa', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        source,
        namespaceId: namespaceId || null,
        sourceType,
        autoApprove,
        entriesCount: parsedData.length,
      });
      toast({ 
        title: t('training.bulkImport.errors.importFailed'),
        description: error instanceof Error ? error.message : 'Erro desconhecido',
        variant: 'destructive',
      });
    },
  });

  // Handler para drag & drop (UX enterprise - Regra 16)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFileSelect(selectedFile);
    }
  };

  // Validação e parse do arquivo (Enterprise error handling - Regra 8)
  const handleFileSelect = async (selectedFile: File) => {
    setValidationError(null);
    setParsedData([]);

    // BUG FIX 23/12/2025: Validação de tamanho RESTAURADA - necessário para segurança e DoS prevention
    // Backend limita payload JSON a 10MB (express.json({ limit: '10mb' }))
    // Validação frontend previne upload de arquivos grandes e dá feedback imediato ao usuário
    // Consistente com limite do backend para evitar tentativas de upload que falhariam
    // Previne memory exhaustion quando arquivo é parseado com selectedFile.text()
    const BULK_IMPORT_MAX_SIZE = 10 * 1024 * 1024; // 10MB - mesmo limite do backend
    if (selectedFile.size > BULK_IMPORT_MAX_SIZE) {
      setValidationError(t('training.bulkImport.validation.fileTooLargeDesc'));
      return;
    }

    // Validação 2: Extensão do arquivo
    const validExtensions = ['.json', '.jsonl'];
    const fileExtension = selectedFile.name.toLowerCase().slice(selectedFile.name.lastIndexOf('.'));
    if (!validExtensions.includes(fileExtension)) {
      setValidationError(t('training.bulkImport.validation.invalidFormatDesc'));
      return;
    }

    try {
      const text = await selectedFile.text();
      let entries: BulkImportEntry[] = [];

      // Parse JSON ou JSONL
      // REGRA 8: Error handling enterprise com logging estruturado e feedback detalhado
      if (fileExtension === '.json') {
        const parsed = JSON.parse(text) as BulkImportData;
        entries = parsed.data || (Array.isArray(parsed) ? parsed : []);
      } else if (fileExtension === '.jsonl') {
        const lines = text.split('\n');
        const parsedEntries: BulkImportEntry[] = [];
        const errors: Array<{ lineNumber: number; error: string }> = [];
        
        lines.forEach((line, index) => {
          const trimmedLine = line.trim();
          if (!trimmedLine) return; // Ignorar linhas vazias
          
          const lineNumber = index + 1; // Linhas começam em 1 para usuário
          try {
            const parsed = JSON.parse(trimmedLine) as BulkImportEntry;
            parsedEntries.push(parsed);
          } catch (parseError) {
            const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
            errors.push({ lineNumber, error: errorMessage });
            
            // REGRA 8: Logger estruturado para observability stack
            frontendLogger.error('Erro ao fazer parse de linha JSONL', {
              lineNumber,
              lineContent: trimmedLine.substring(0, 100), // Primeiros 100 chars para não logar dados sensíveis
              error: errorMessage,
              fileName: selectedFile.name,
            });
          }
        });
        
        // Se houver erros, mostrar feedback detalhado ao usuário
        if (errors.length > 0) {
          const firstError = errors[0];
          setValidationError(
            t('training.bulkImport.errors.jsonlParseErrorDesc', {
              lineNumber: firstError.lineNumber,
              error: firstError.error,
            })
          );
          
          // Log completo para observability
          frontendLogger.error('Falha ao processar arquivo JSONL - múltiplas linhas com erro', {
            totalErrors: errors.length,
            errors: errors.map(e => ({ line: e.lineNumber, error: e.error })),
            fileName: selectedFile.name,
            totalLines: lines.length,
            successfulParses: parsedEntries.length,
          });
          
          return;
        }
        
        entries = parsedEntries;
      }

      // Validação 3: Máximo 1000 entradas
      if (entries.length > 1000) {
        setValidationError(t('training.bulkImport.validation.tooManyEntriesDesc'));
        return;
      }

      // Validação 4: Schema Zod
      const validationResult = BulkImportSchema.safeParse(entries);
      if (!validationResult.success) {
        const firstError = validationResult.error.errors[0];
        setValidationError(firstError?.message || t('training.bulkImport.validation.missingMessagesDesc'));
        return;
      }

      // Sucesso - salvar dados parseados
      setFile(selectedFile);
      setParsedData(entries);
    } catch (error) {
      // REGRA 8: Logger estruturado enviado para observability stack
      frontendLogger.error('Erro ao fazer parse do arquivo de bulk import', {
        error: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileType: selectedFile.type,
      });
      setValidationError(t('training.bulkImport.errors.parseError'));
    }
  };

  const handleClearFile = () => {
    setFile(null);
    setParsedData([]);
    setValidationError(null);
  };

  return (
    <div className="flex-1 p-4 space-y-6">
      {/* Zona de Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            {t('training.bulkImport.title')}
          </CardTitle>
          <CardDescription>
            {t('training.bulkImport.subtitle')}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Drag & Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-all cursor-pointer",
              isDragging 
                ? "border-primary bg-primary/5 scale-[1.02]" 
                : file 
                  ? "border-green-500 bg-green-500/5"
                  : "border-muted-foreground/25 hover:border-primary hover:bg-muted/50"
            )}
            onClick={() => document.getElementById('bulk-import-file')?.click()}
          >
            <input
              id="bulk-import-file"
              type="file"
              accept=".json,.jsonl"
              className="hidden"
              onChange={handleFileInputChange}
            />

            {file ? (
              <div className="space-y-2">
                <FileCheck className="h-12 w-12 text-green-500 mx-auto" />
                <div>
                  <p className="font-medium text-green-600">
                    {t('training.bulkImport.fileSelected')}
                  </p>
                  <p className="text-sm text-muted-foreground">{file.name}</p>
                  <Badge variant="outline" className="mt-2 bg-green-500/10 text-green-600">
                    {t('training.bulkImport.entries', { count: parsedData.length })}
                  </Badge>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClearFile();
                  }}
                  className="mt-2"
                >
                  {t('common.cancel')}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <FileJson className={cn(
                  "h-12 w-12 mx-auto transition-colors",
                  isDragging ? "text-primary" : "text-muted-foreground/50"
                )} />
                <div>
                  <p className="font-medium">
                    {t('training.bulkImport.dragDrop')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('training.bulkImport.or')} {t('training.bulkImport.browse')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {t('training.bulkImport.supportedFormats')}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Erro de Validação */}
          {validationError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t('training.bulkImport.validation.invalidFormat')}</AlertTitle>
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}

          {/* Configurações de Import */}
          {parsedData.length > 0 && (
            <div className="space-y-4 pt-4 border-t">
              <div className="space-y-2">
                <Label htmlFor="import-source">{t('training.bulkImport.source')}</Label>
                <Input
                  id="import-source"
                  placeholder={t('training.bulkImport.sourcePlaceholder')}
                  value={source}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSource(e.target.value)}
                  maxLength={50}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="import-namespace">Namespace</Label>
                <Select value={namespaceId || '__none__'} onValueChange={(value) => setNamespaceId(value === '__none__' ? '' : value)}>
                  <SelectTrigger id="import-namespace">
                    <SelectValue placeholder="Selecionar namespace" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem namespace explícito</SelectItem>
                    {namespaces.map((namespace) => (
                      <SelectItem key={namespace.id} value={namespace.id}>
                        {namespace.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="import-source-type">Source Type</Label>
                <Select value={sourceType} onValueChange={setSourceType}>
                  <SelectTrigger id="import-source-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BULK_IMPORT_SOURCE_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="space-y-0.5">
                  <Label htmlFor="auto-approve" className="font-medium">
                    {t('training.bulkImport.autoApprove')}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t('training.bulkImport.autoApproveDesc')}
                  </p>
                </div>
                <Switch
                  id="auto-approve"
                  checked={autoApprove}
                  onCheckedChange={setAutoApprove}
                />
              </div>
            </div>
          )}
        </CardContent>

        {parsedData.length > 0 && (
          <CardFooter className="flex justify-end gap-2">
            <Button 
              variant="outline" 
              onClick={handleClearFile}
              disabled={bulkImport.isPending}
            >
              {t('training.bulkImport.cancel')}
            </Button>
            <Button 
              onClick={() => bulkImport.mutate()}
              disabled={bulkImport.isPending || parsedData.length === 0}
            >
              {bulkImport.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {t('training.bulkImport.importing')}
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  {t('training.bulkImport.import', { count: parsedData.length })}
                </>
              )}
            </Button>
          </CardFooter>
        )}
      </Card>

      {/* Preview dos Dados */}
      {parsedData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              {t('training.bulkImport.preview')}
            </CardTitle>
            <CardDescription>
              {t('training.bulkImport.showingFirst', { 
                count: Math.min(5, parsedData.length),
                total: parsedData.length 
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {parsedData.slice(0, 5).map((entry, idx) => (
                  <Card key={idx} className="bg-muted/30">
                    <CardContent className="p-3 space-y-2">
                      {entry.messages.map((msg, msgIdx) => (
                        <div 
                          key={msgIdx}
                          className={cn(
                            'text-xs p-2 rounded',
                            msg.role === 'user' ? 'bg-background' : 'bg-primary/5'
                          )}
                        >
                          <span className="font-medium capitalize">{msg.role}:</span>{' '}
                          <span className="text-muted-foreground">
                            {msg.content.slice(0, 200)}
                            {msg.content.length > 200 ? '...' : ''}
                          </span>
                        </div>
                      ))}
                      {entry.rating && (
                        <Badge variant="secondary" className="text-xs">
                          Rating: {entry.rating}/5
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                ))}
                {parsedData.length > 5 && (
                  <p className="text-center text-sm text-muted-foreground">
                    +{parsedData.length - 5} {t('training.bulkImport.entries', { count: parsedData.length - 5 })}
                  </p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Ajuda - Formato do Arquivo */}
      {parsedData.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="h-4 w-4 text-primary" />
              {t('training.bulkImport.help.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">
                {t('training.bulkImport.help.jsonExample')}
              </p>
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{`{
  "data": [
    {
      "messages": [
        {"role": "user", "content": "Como funciona X?"},
        {"role": "assistant", "content": "X funciona..."}
      ],
      "rating": 5
    }
  ]
}`}
              </pre>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">
                {t('training.bulkImport.help.jsonlExample')}
              </p>
              <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
{`{"messages": [{"role": "user", "content": "Pergunta 1"}, {"role": "assistant", "content": "Resposta 1"}], "rating": 5}
{"messages": [{"role": "user", "content": "Pergunta 2"}, {"role": "assistant", "content": "Resposta 2"}], "rating": 4}`}
              </pre>
            </div>

            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-medium mb-1">
                  {t('training.bulkImport.help.requiredFields')}
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li>{t('training.bulkImport.help.messagesField')}</li>
                </ul>
              </div>
              <div>
                <p className="font-medium mb-1">
                  {t('training.bulkImport.help.optionalFields')}
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li>{t('training.bulkImport.help.ratingField')}</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function Training() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const locale = user?.idioma ?? 'pt-BR';
  const timeZone = user?.timezone ?? TIMEZONE;
  const queryClient = useQueryClient();
  const tenantId = user?.tenantId;
  
  const [activeTab, setActiveTab] = useState<string>('data');
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
    mutationFn: async () => apiRequest('POST', '/api/training/gpu-orchestrator/return'),
    onSuccess: () => {
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

  const TRADING_SOURCE_TYPES = ['trading_signal', 'trading_order', 'trading_postmortem', 'trading_demo'] as const;
  const namespacesById = new Map((namespaces || []).map((ns) => [ns.id, ns.nome]));
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
  const hasTradingData = rawSourceTypes.some((st) => TRADING_SOURCE_TYPES.includes(st as typeof TRADING_SOURCE_TYPES[number]));
  const sourceTypeOptions = hasTradingData ? ['trading', ...rawSourceTypes] : rawSourceTypes;

  const filteredData = allData.filter((entry) => {
    if (statusFilter !== 'all' && entry.status !== statusFilter) return false;
    if (namespaceFilter !== 'all' && entry.namespaceId !== namespaceFilter) return false;
    if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false;
    if (sourceTypeFilter !== 'all') {
      if (sourceTypeFilter === 'trading') {
        if (!entry.sourceType || !TRADING_SOURCE_TYPES.includes(entry.sourceType as typeof TRADING_SOURCE_TYPES[number])) return false;
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
  const allFilteredPendingSelected =
    filteredPendingIds.length > 0 && filteredSelectedPendingCount === filteredPendingIds.length;

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
              onClick={() => setShowOnDemandRun(true)}
              disabled={runStatusLoading || runStatus?.hasRunningTraining === true || !tenantId}
              data-testid="button-on-demand-run"
            >
              <Play className="h-4 w-4 mr-2" />
              {t('training.autoLearning.onDemand')}
            </Button>
            <Button
              onClick={() => setShowCreateJob(true)}
              disabled={!tenantId || stats.approved < minCustomJobDatasetSize}
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <div className="px-4 pt-2 border-b">
          <TabsList>
            <TabsTrigger value="data" data-testid="tab-training-data">
              <Database className="h-4 w-4 mr-2" />
              {t('training.tabs.data', { count: stats.total })}
            </TabsTrigger>
            <TabsTrigger value="auto-learning" data-testid="tab-auto-learning">
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('training.tabs.autoLearning')}
            </TabsTrigger>
            <TabsTrigger value="jobs" data-testid="tab-jobs">
              <Brain className="h-4 w-4 mr-2" />
              {t('training.tabs.jobs', { count: allJobs.length })}
            </TabsTrigger>
            <TabsTrigger value="bulk-import" data-testid="tab-bulk-import">
              <Upload className="h-4 w-4 mr-2" />
              {t('training.bulkImport.title')}
            </TabsTrigger>
            <TabsTrigger value="multimodal" data-testid="tab-multimodal">
              <Image className="h-4 w-4 mr-2" />
              {t('training.multimodal.tabTitle')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="data" className="flex-1 m-0">
          <div className="p-4 border-b flex items-center gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder={t('training.filter.placeholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('training.filter.all')}</SelectItem>
                <SelectItem value="pending">{t('training.filter.pending')}</SelectItem>
                <SelectItem value="approved">{t('training.filter.approved')}</SelectItem>
                <SelectItem value="rejected">{t('training.filter.rejected')}</SelectItem>
                <SelectItem value="used">{t('training.filter.used')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={namespaceFilter} onValueChange={setNamespaceFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-namespace-filter">
                <Folder className="h-4 w-4 mr-2" />
                <SelectValue placeholder={t('training.filter.namespace')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('training.filter.allNamespaces')}</SelectItem>
                {(namespaces || []).map((namespace) => (
                  <SelectItem key={namespace.id} value={namespace.id}>
                    {namespace.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-source-filter">
                <Database className="h-4 w-4 mr-2" />
                <SelectValue placeholder={t('training.filter.source')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('training.filter.allSources')}</SelectItem>
                {sourceOptions.map((source) => (
                  <SelectItem key={source} value={source}>
                    {source}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sourceTypeFilter} onValueChange={setSourceTypeFilter}>
              <SelectTrigger className="w-[200px]" data-testid="select-source-type-filter">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder={t('training.filter.sourceType')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('training.filter.allSources')}</SelectItem>
                {sourceTypeOptions.map((sourceType) => (
                  <SelectItem key={sourceType} value={sourceType}>
                    {sourceType}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={quarantineFilter} onValueChange={setQuarantineFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-quarantine-filter">
                <SelectValue placeholder="Quarentena" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Quarentena: todos</SelectItem>
                <SelectItem value="only">Somente quarentena</SelectItem>
                <SelectItem value="exclude">Excluir quarentena</SelectItem>
              </SelectContent>
            </Select>
            <Select value={duplicateFilter} onValueChange={setDuplicateFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-duplicate-filter">
                <SelectValue placeholder="Duplicados" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Duplicados: todos</SelectItem>
                <SelectItem value="only">Somente duplicados</SelectItem>
                <SelectItem value="exclude">Excluir duplicados</SelectItem>
              </SelectContent>
            </Select>
            <Select value={autoCollectFilter} onValueChange={setAutoCollectFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-auto-collect-filter">
                <SelectValue placeholder="Auto-collect" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Auto-collect: todos</SelectItem>
                <SelectItem value="only">Somente auto-collect</SelectItem>
                <SelectItem value="exclude">Excluir auto-collect</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              {t('training.filter.results', { count: filteredData.length })}
            </span>
          </div>

          {(filteredPendingIds.length > 0 || totalSelectedPendingCount > 0) && (
            <div className="px-4 pt-4">
              <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={
                      filteredPendingIds.length === 0
                        ? false
                        : filteredSelectedPendingCount === 0
                          ? false
                          : filteredSelectedPendingCount === filteredPendingIds.length
                            ? true
                            : 'indeterminate'
                    }
                    onCheckedChange={(checked) => toggleSelectAllFilteredPending(Boolean(checked))}
                    disabled={filteredPendingIds.length === 0 || reviewMutationPending}
                    aria-label={t('training.batchSelection.selectAllFiltered')}
                  />
                  <span className="text-sm font-medium">
                    {t('training.batchSelection.selected', { count: totalSelectedPendingCount })}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {t('training.batchSelection.filteredPending', { count: filteredPendingIds.length })}
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={selectAllFilteredPending}
                    disabled={filteredPendingIds.length === 0 || allFilteredPendingSelected || reviewMutationPending}
                    data-testid="button-select-all-filtered"
                  >
                    {t('training.batchSelection.selectAll')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllPendingSelection}
                    disabled={totalSelectedPendingCount === 0 || reviewMutationPending}
                    data-testid="button-deselect-all"
                  >
                    {t('training.batchSelection.deselectAll')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-green-600"
                    onClick={() => openBatchReviewDialog('approve')}
                    disabled={totalSelectedPendingCount === 0 || reviewMutationPending}
                  >
                    <ThumbsUp className="mr-1 h-3 w-3" />
                    {t('training.batchSelection.approveSelected')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-600"
                    onClick={() => openBatchReviewDialog('reject')}
                    disabled={totalSelectedPendingCount === 0 || reviewMutationPending}
                  >
                    <ThumbsDown className="mr-1 h-3 w-3" />
                    {t('training.batchSelection.rejectSelected')}
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="px-4 pt-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>{t('training.approval.title')}</AlertTitle>
              <AlertDescription>{t('training.approval.desc')}</AlertDescription>
            </Alert>
          </div>

          <ScrollArea className="flex-1 p-4">
            {dataLoading ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-48" />
                ))}
              </div>
            ) : filteredData.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-64 text-center"
              >
                <Database className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-medium mb-1">{t('training.empty.noData')}</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  {t('training.empty.noDataDesc')}
                </p>
              </motion.div>
            ) : (
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
              >
                {filteredData.map((data) => (
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
                  />
                ))}
              </motion.div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="auto-learning" className="flex-1 m-0">
          <ScrollArea className="flex-1 p-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>{t('training.autoLearning.statusTitle')}</CardTitle>
                  <CardDescription>{t('training.autoLearning.statusDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  {autoLearningLoading ? (
                    <Skeleton className="h-32" />
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t('training.autoLearning.activeModel')}</span>
                        <Badge variant="secondary">
                          {autoLearning?.activeModel?.name} v{autoLearning?.activeModel?.version}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">{t('training.autoLearning.pendingEntries')}</div>
                          <div className="text-xl font-semibold">{autoLearning?.pendingData?.trainingEntries ?? 0}</div>
                        </div>
                        <div className="rounded-md border p-3">
                          <div className="text-xs text-muted-foreground">{t('training.autoLearning.pendingImages')}</div>
                          <div className="text-xl font-semibold">{autoLearning?.pendingData?.images ?? 0}</div>
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{t('training.autoLearning.runStatus')}</div>
                        {runStatusLoading ? (
                          <Skeleton className="h-6 mt-2" />
                        ) : runStatus?.hasRunningTraining ? (
                          <div className="mt-2 text-sm">
                            <div className="font-medium">{runStatus.currentJob.name}</div>
                            <div className="text-muted-foreground">
                              {t('training.autoLearning.elapsed', { seconds: runStatus.currentJob.elapsedSeconds })}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-2 text-sm text-muted-foreground">
                            {runStatus?.message || t('training.autoLearning.idle')}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('training.autoLearning.scheduleTitle')}</CardTitle>
                  <CardDescription>{t('training.autoLearning.scheduleDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3">
                    <div className="grid gap-2">
                      <Label>{t('training.autoLearning.scheduleType')}</Label>
                      <Select value={scheduleType} onValueChange={(v) => setScheduleType(v as typeof scheduleType)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="incremental_fine_tuning">{t('training.autoLearning.incremental')}</SelectItem>
                          <SelectItem value="complete_fine_tuning">{t('training.autoLearning.complete')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-2">
                      <Label>{t('training.autoLearning.scheduleScope')}</Label>
                      <Select value={scheduleNamespaceId} onValueChange={setScheduleNamespaceId}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__tenant__">{t('training.autoLearning.scheduleScopeTenant')}</SelectItem>
                          {(namespaces || []).map((ns) => (
                            <SelectItem key={ns.id} value={ns.id}>{ns.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">{t('training.autoLearning.scheduleScopeDesc')}</p>
                    </div>

                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <div className="text-sm font-medium">{t('training.autoLearning.enabled')}</div>
                        <div className="text-xs text-muted-foreground">{t('training.autoLearning.enabledDesc')}</div>
                      </div>
                      <Switch checked={scheduleEnabled} onCheckedChange={setScheduleEnabled} />
                    </div>

                    <div className="grid gap-2">
                      <Label>{t('training.autoLearning.cronPattern')}</Label>
                      <Input
                        value={scheduleCronPattern}
                        onChange={(e) => setScheduleCronPattern(e.target.value)}
                        placeholder="0 3 * * 0"
                      />
                      <p className="text-xs text-muted-foreground">{t('training.autoLearning.cronHelp')}</p>
                    </div>

                    <div className="grid gap-2">
                      <Label>{t('training.autoLearning.minDataRequired')}</Label>
                      <Input
                        type="number"
                        value={scheduleMinDataRequired}
                        onChange={(e) => setScheduleMinDataRequired(Number(e.target.value))}
                        min={
                          scheduleType === 'incremental_fine_tuning'
                            ? trainingSystemConfig.minScheduledDatasetSizeIncremental
                            : trainingSystemConfig.minScheduledDatasetSizeFull
                        }
                      />
                    </div>

                    <Button onClick={() => configureSchedule.mutate()} disabled={!tenantId || configureSchedule.isPending}>
                      {configureSchedule.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {t('training.autoLearning.saving')}
                        </>
                      ) : (
                        <>
                          <FileCheck className="h-4 w-4 mr-2" />
                          {t('training.autoLearning.saveSchedule')}
                        </>
                      )}
                    </Button>
                  </div>

                  <div className="rounded-md border p-3">
                    <div className="text-sm font-medium mb-2">{t('training.autoLearning.upcoming')}</div>
                    {autoLearningLoading ? (
                      <Skeleton className="h-20" />
                    ) : (autoLearning?.upcomingSchedules?.length || 0) === 0 ? (
                      <div className="text-sm text-muted-foreground">{t('training.autoLearning.noUpcoming')}</div>
                    ) : (
                      <div className="space-y-2">
                        {autoLearning?.upcomingSchedules?.slice(0, 5).map((s) => (
                          <div key={s.id} className="flex items-center justify-between text-sm">
                            <div className="flex flex-col">
                              <span className="text-muted-foreground">
                                {s.type === 'incremental_fine_tuning'
                                  ? t('training.autoLearning.incremental')
                                  : t('training.autoLearning.complete')}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {getScheduleScopeLabel(s.namespaceId, namespacesById, t)}
                              </span>
                            </div>
                            <span>{formatDateTime(s.scheduledFor, { locale, timeZone })}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('training.autoLearning.queueTitle')}</CardTitle>
                  <CardDescription>{t('training.autoLearning.queueDesc')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {queueStatusLoading ? (
                    <Skeleton className="h-24" />
                  ) : (
                    <>
                      <div className="rounded-md border p-3 space-y-2">
                        <div className="text-xs text-muted-foreground">{t('training.autoLearning.policyTitle')}</div>
                        <div className="text-sm">
                          {t('training.autoLearning.policyInflight', {
                            current: queueStatus?.tenant?.inflightCount ?? 0,
                            max: queueStatus?.governance?.maxInflightRunsPerTenant ?? 0,
                          })}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {queueStatus?.governance?.requireEvalPassedForPromotion
                            ? t('training.autoLearning.policyRequireEvalPassed')
                            : t('training.autoLearning.policyAllowWithoutEval')}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {queueStatus?.governance?.requireDualApprovalForPromotion
                            ? t('training.autoLearning.policyDualApprovalEnabled', {
                              count: queueStatus?.governance?.promotionMinApprovals ?? 2,
                            })
                            : t('training.autoLearning.policyDualApprovalDisabled')}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {(queueStatus?.queues ?? []).map((queue) => {
                          const priorityLabel = queue.queue.endsWith(':high')
                            ? t('training.autoLearning.priorityHigh')
                            : queue.queue.endsWith(':low')
                              ? t('training.autoLearning.priorityLow')
                              : t('training.autoLearning.priorityNormal');
                          return (
                            <div key={queue.queue} className="rounded-md border p-3">
                              <div className="text-sm font-medium">{priorityLabel}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {t('training.autoLearning.queueStats', {
                                  pending: queue.pending,
                                  lag: queue.lag,
                                  dlq: queue.dlq,
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="jobs" className="flex-1 m-0">
          <ScrollArea className="flex-1 p-4">
            {jobsLoading ? (
              <div className="grid gap-4 md:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-48" />
                ))}
              </div>
            ) : allJobs.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-64 text-center"
              >
                <Brain className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <h3 className="font-medium mb-1">{t('training.empty.noJobs')}</h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  {t('training.empty.noJobsDesc')}
                </p>
                <Button 
                  className="mt-4" 
                  onClick={() => setShowCreateJob(true)}
                  disabled={!tenantId || stats.approved < minCustomJobDatasetSize}
                  data-testid="button-create-first-job"
                >
                  <Brain className="h-4 w-4 mr-2" />
                  {t('training.empty.createFirstJob')}
                </Button>
              </motion.div>
            ) : (
              <div className="space-y-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{t('training.activeByScope.title')}</CardTitle>
                    <CardDescription>{t('training.activeByScope.desc')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {activeJobsByScope.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t('training.activeByScope.none')}</p>
                    ) : (
                      activeJobsByScope.map((job) => (
                        <div key={job.id} className="flex items-center justify-between rounded-md border p-2">
                          <div>
                            <p className="text-sm font-medium">{job.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {getScopeLabel(job, namespacesById, t)}
                            </p>
                          </div>
                          <Badge>{t('training.promotion.active')}</Badge>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                {jobStats.running > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 text-primary" />
                      {t('training.jobsInProgress')}
                    </h3>
                    <motion.div
                      variants={containerVariants}
                      initial="hidden"
                      animate="visible"
                      className="grid gap-4 md:grid-cols-2"
                    >
                      {allJobs.filter((j) => ['pending', 'preparing', 'training', 'validating'].includes(j.status)).map((job) => (
                        <JobCard
                          key={job.id}
                          job={job}
                          scopeLabel={getScopeLabel(job, namespacesById, t)}
                          t={t}
                          locale={locale}
                          timeZone={timeZone}
                          onClick={() => setSelectedJobId(job.id)}
                          canPromote={false}
                          canRollback={false}
                          actionPending={
                            promoteJobMutation.isPending
                            || approvalPromotionMutation.isPending
                            || rollbackJobMutation.isPending
                          }
                        />
                      ))}
                    </motion.div>
                  </div>
                )}
                {allJobs.filter((j) => ['completed', 'failed', 'cancelled'].includes(j.status)).length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      {t('training.jobHistory')}
                    </h3>
                    <motion.div
                      variants={containerVariants}
                      initial="hidden"
                      animate="visible"
                      className="grid gap-4 md:grid-cols-2"
                    >
                      {allJobs.filter((j) => ['completed', 'failed', 'cancelled'].includes(j.status)).map((job) => (
                        <JobCard
                          key={job.id}
                          job={job}
                          scopeLabel={getScopeLabel(job, namespacesById, t)}
                          t={t}
                          locale={locale}
                          timeZone={timeZone}
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
                      ))}
                    </motion.div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="bulk-import" className="flex-1 m-0">
          <BulkImportTab t={t} />
        </TabsContent>

        <TabsContent value="multimodal" className="flex-1 m-0">
          <MultimodalUploadTab t={t} />
        </TabsContent>
      </Tabs>

      <JobDetailModal
        jobId={selectedJobId}
        open={!!selectedJobId}
        onClose={() => setSelectedJobId(null)}
        t={t}
        locale={locale}
        timeZone={timeZone}
      />

      <CreateJobDialog
        open={showCreateJob}
        onClose={() => setShowCreateJob(false)}
        approvedCount={stats.approved}
        minRequiredApprovedData={minCustomJobDatasetSize}
        defaultHyperparams={trainingSystemConfig.defaultHyperparams}
        presetHyperparams={trainingSystemConfig.presets}
        namespaces={namespaces || []}
        namespaceId={createJobNamespaceId}
        onNamespaceIdChange={setCreateJobNamespaceId}
        tenantId={tenantId}
        t={t}
      />

      <Dialog open={!!promoteDialogJob} onOpenChange={(open) => !open && setPromoteDialogJob(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('training.promotion.promoteTitle')}</DialogTitle>
            <DialogDescription>
              {t('training.promotion.promoteDesc', {
                jobName: promoteDialogJob?.name ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPromoteDialogJob(null)}>
              {t('training.createJob.cancel')}
            </Button>
            <Button
              onClick={() => {
                if (!promoteDialogJob) return;
                promoteJobMutation.mutate(promoteDialogJob.id, {
                  onSuccess: () => setPromoteDialogJob(null),
                });
              }}
              disabled={!promoteDialogJob || promoteJobMutation.isPending}
            >
              {promoteJobMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              {t('training.actions.promote')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!rollbackDialogJob}
        onOpenChange={(open) => {
          if (!open) {
            setRollbackDialogJob(null);
            setRollbackReason('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('training.promotion.rollbackTitle')}</DialogTitle>
            <DialogDescription>
              {t('training.promotion.rollbackDesc', {
                jobName: rollbackDialogJob?.name ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rollback-reason">{t('training.promotion.rollbackReasonLabel')}</Label>
            <Input
              id="rollback-reason"
              value={rollbackReason}
              onChange={(event) => setRollbackReason(event.target.value)}
              placeholder={t('training.promotion.rollbackReasonPlaceholder')}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              {t('training.promotion.rollbackReasonHint')}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setRollbackDialogJob(null); setRollbackReason(''); }}>
              {t('training.createJob.cancel')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (!rollbackDialogJob) return;
                rollbackJobMutation.mutate({ jobId: rollbackDialogJob.id, reason: rollbackReason.trim() }, {
                  onSuccess: () => {
                    setRollbackDialogJob(null);
                    setRollbackReason('');
                  },
                });
              }}
              disabled={!rollbackDialogJob || rollbackJobMutation.isPending || rollbackReason.trim().length < 10}
            >
              {rollbackJobMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {t('training.actions.rollback')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={postTrainingDialog.open} onOpenChange={(open) => !open && setPostTrainingDialog((d) => ({ ...d, open: false }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('training.postTraining.title')}</DialogTitle>
            <DialogDescription>
              {t('training.postTraining.desc', { jobName: postTrainingDialog.jobName })}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('training.postTraining.autoReturn')}</p>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setPostTrainingDialog((d) => ({ ...d, open: false }))}
            >
              {t('training.postTraining.continueTraining')}
            </Button>
            <Button
              onClick={() => returnOrchestrator.mutate()}
              disabled={returnOrchestrator.isPending}
            >
              {returnOrchestrator.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <MessageSquare className="h-4 w-4 mr-2" />
              )}
              {t('training.postTraining.backToChat')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showOnDemandRun} onOpenChange={setShowOnDemandRun}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('training.autoLearning.onDemandTitle')}</DialogTitle>
            <DialogDescription>{t('training.autoLearning.onDemandDesc')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>{t('training.autoLearning.onDemandType')}</Label>
              <Select value={onDemandTrainingType} onValueChange={(v) => setOnDemandTrainingType(v as typeof onDemandTrainingType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="incremental">{t('training.autoLearning.incremental')}</SelectItem>
                  <SelectItem value="full">{t('training.autoLearning.complete')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>{t('training.autoLearning.namespace')}</Label>
              <Select value={onDemandNamespaceId} onValueChange={setOnDemandNamespaceId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('training.autoLearning.namespacePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__tenant__">{t('training.autoLearning.namespaceTenantWide')}</SelectItem>
                  {(namespaces || []).map((namespace) => (
                    <SelectItem key={namespace.id} value={namespace.id}>
                      {namespace.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">{t('training.autoLearning.includeImages')}</div>
                <div className="text-xs text-muted-foreground">{t('training.autoLearning.includeImagesDesc')}</div>
              </div>
              <Switch checked={onDemandIncludeImages} onCheckedChange={setOnDemandIncludeImages} />
            </div>

            <div className="grid gap-2">
              <Label>{t('training.autoLearning.priority')}</Label>
              <Select value={onDemandPriority} onValueChange={(v) => setOnDemandPriority(v as typeof onDemandPriority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('training.autoLearning.priorityLow')}</SelectItem>
                  <SelectItem value="normal">{t('training.autoLearning.priorityNormal')}</SelectItem>
                  <SelectItem value="high">{t('training.autoLearning.priorityHigh')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>{t('training.autoLearning.description')}</Label>
              <Input value={onDemandDescription} onChange={(e) => setOnDemandDescription(e.target.value)} />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowOnDemandRun(false)}>
              {t('training.createJob.cancel')}
            </Button>
            <Button onClick={() => startOnDemand.mutate()} disabled={!tenantId || startOnDemand.isPending}>
              {startOnDemand.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('training.autoLearning.starting')}
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  {t('training.autoLearning.startOnDemand')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={batchReviewDialogOpen}
        onOpenChange={(open) => {
          setBatchReviewDialogOpen(open);
          if (!open) {
            setBatchReviewNotes('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {batchReviewAction === 'approve'
                ? t('training.batchSelection.approveTitle')
                : t('training.batchSelection.rejectTitle')}
            </DialogTitle>
            <DialogDescription>
              {batchReviewAction === 'approve'
                ? t('training.batchSelection.dialogDescApprove')
                : t('training.batchSelection.dialogDescReject')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="batch-review-notes">{t('training.batchSelection.notes')}</Label>
            <Input
              id="batch-review-notes"
              value={batchReviewNotes}
              onChange={(event) => setBatchReviewNotes(event.target.value)}
              placeholder={t('training.batchSelection.notesPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">
              {t('training.batchSelection.selected', { count: totalSelectedPendingCount })}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBatchReviewDialogOpen(false)}>
              {t('training.createJob.cancel')}
            </Button>
            <Button onClick={confirmBatchReview} disabled={totalSelectedPendingCount === 0 || updateStatusBatch.isPending}>
              {updateStatusBatch.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('training.batchSelection.saving')}
                </>
              ) : (
                <>{t('training.batchSelection.confirm')}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={reviewDialogOpen}
        onOpenChange={(open) => {
          setReviewDialogOpen(open);
          if (!open) {
            resetReviewScopeOverride();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('training.reviewDialog.title')}</DialogTitle>
            <DialogDescription>{t('training.reviewDialog.desc')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="review-notes">{t('training.reviewDialog.notes')}</Label>
            <Input
              id="review-notes"
              value={reviewNotes}
              onChange={(event) => setReviewNotes(event.target.value)}
              placeholder={t('training.reviewDialog.notesPlaceholder')}
            />
          </div>
          {reviewTarget?.status === 'approved' && (
            <div className="grid gap-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Override de escopo</p>
                  <p className="text-xs text-muted-foreground">
                    Ajuste manual de namespace/agente/domínio antes de aprovar (auditável).
                  </p>
                </div>
                <Switch checked={overrideScopeEnabled} onCheckedChange={setOverrideScopeEnabled} />
              </div>
              {overrideScopeEnabled && (
                <div className="grid gap-2">
                  <Label htmlFor="override-namespace">Namespace ID (obrigatório)</Label>
                  <Input
                    id="override-namespace"
                    value={overrideNamespaceId}
                    onChange={(event) => setOverrideNamespaceId(event.target.value)}
                    placeholder="UUID do namespace"
                  />
                  <Label htmlFor="override-agent">Agent ID (opcional)</Label>
                  <Input
                    id="override-agent"
                    value={overrideAgentId}
                    onChange={(event) => setOverrideAgentId(event.target.value)}
                    placeholder="UUID do agente"
                  />
                  <Label htmlFor="override-domain">Domínio (opcional)</Label>
                  <Input
                    id="override-domain"
                    value={overrideDomain}
                    onChange={(event) => setOverrideDomain(event.target.value)}
                    placeholder="trading, fiscal, suporte..."
                  />
                  <Label htmlFor="override-reason">Motivo do override (obrigatório)</Label>
                  <Input
                    id="override-reason"
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    placeholder="Explique por que o escopo foi ajustado"
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setReviewDialogOpen(false);
                resetReviewScopeOverride();
              }}
            >
              {t('training.createJob.cancel')}
            </Button>
            <Button onClick={confirmReview} disabled={!reviewTarget || updateStatus.isPending}>
              {updateStatus.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('training.reviewDialog.saving')}
                </>
              ) : (
                <>{t('training.reviewDialog.confirm')}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resolveScopeDialogOpen}
        onOpenChange={(open) => {
          setResolveScopeDialogOpen(open);
          if (!open) setResolveScopeEntry(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {resolveScopeNeedsHumanReview
                ? t('training.resolveScope.title')
                : t('training.resolveScope.relinkTitle')}
            </DialogTitle>
            <DialogDescription>
              {resolveScopeNeedsHumanReview
                ? t('training.resolveScope.desc')
                : t('training.resolveScope.relinkDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {resolveScopeNeedsHumanReview && resolveScopeEntry?.inferenceTrace?.suggestedNewNamespace && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                <p className="text-sm font-medium mb-2">{t('training.resolveScope.suggestedTitle')}</p>
                <p className="text-xs text-muted-foreground mb-2">
                  {resolveScopeEntry.inferenceTrace.suggestedNewNamespace!.name} ({resolveScopeEntry.inferenceTrace.suggestedNewNamespace!.theme})
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCreateAndResolveScope}
                  disabled={createNamespaceMutation.isPending || resolveScopeMutation.isPending}
                >
                  {createNamespaceMutation.isPending || resolveScopeMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Folder className="h-4 w-4 mr-2" />
                  )}
                  {t('training.resolveScope.createSuggested')}
                </Button>
              </div>
            )}
            <div className="grid gap-2">
              <Label>{t('training.resolveScope.namespaceSelect')}</Label>
              <Select value={resolveScopeNamespaceId || '_none'} onValueChange={(v) => setResolveScopeNamespaceId(v === '_none' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t('training.createJob.namespacePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">{t('training.filter.all')}</SelectItem>
                  {(namespaces || []).map((ns) => (
                    <SelectItem key={ns.id} value={ns.id}>
                      {ns.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t('training.resolveScope.reason')}</Label>
              <Input
                value={resolveScopeReason}
                onChange={(e) => setResolveScopeReason(e.target.value)}
                placeholder={
                  resolveScopeNeedsHumanReview
                    ? t('training.resolveScope.reasonPlaceholder')
                    : t('training.resolveScope.relinkReasonPlaceholder')
                }
              />
            </div>
            <div className="grid gap-2">
              <Label>{t('training.resolveScope.domain')}</Label>
              <Input value={resolveScopeDomain} onChange={(e) => setResolveScopeDomain(e.target.value)} placeholder="trading, geral..." />
            </div>
            <div className="grid gap-2">
              <Label>{t('training.resolveScope.agentId')}</Label>
              <Input value={resolveScopeAgentId} onChange={(e) => setResolveScopeAgentId(e.target.value)} placeholder="UUID do agente" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setResolveScopeDialogOpen(false)}>
              {t('training.createJob.cancel')}
            </Button>
            <Button onClick={confirmResolveScope} disabled={!resolveScopeEntry || resolveScopeMutation.isPending}>
              {resolveScopeMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('training.reviewDialog.saving')}
                </>
              ) : (
                resolveScopeNeedsHumanReview
                  ? t('training.resolveScope.confirm')
                  : t('training.resolveScope.relinkConfirm')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
