/**
 * System Settings Page - Alice Enterprise Platform
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  MessageSquare,
  Brain,
  Sparkles,
  Info,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { parseTrainingHyperparamsJson } from '@alice/shared-utils/training-config';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

type ConfigValueType = 'int' | 'float' | 'json' | 'cron' | 'boolean';

type ConfigItem = {
  key: string;
  labelKey: string;
  descKey: string;
  defaultValue: string;
  valueType: ConfigValueType;
  min?: number;
  max?: number;
  step?: string;
  unit?: string;
};

const TRAINING_HYPERPARAMS_JSON_KEYS = new Set([
  'TRAINING_DEFAULT_HYPERPARAMS_JSON',
  'TRAINING_PRESET_SAFE_JSON',
  'TRAINING_PRESET_STANDARD_JSON',
  'TRAINING_PRESET_LARGE_JSON',
]);

const TRAINING_RECOMMENDED_DEFAULTS: Record<string, string> = {
  MIN_ONDEMAND_DATASET_SIZE: '20',
  maxSeqLen: '1536',
  MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL: '50',
  MIN_SCHEDULED_DATASET_SIZE_FULL: '200',
  TRAINING_QUALITY_MIN_RATIO: '0.60',
  TRAINING_DATASET_MAX_ROWS: '5000',
  TRAINING_TRAIN_EVAL_SPLIT_RATIO: '0.90',
  TRAINING_SLICE_STEPS: '10',
  TRAINING_GPU_TIMEOUT_MS: '120000',
  TRAINING_DEFAULT_HYPERPARAMS_JSON:
    '{"epochs":2,"learningRate":0.0001,"batchSize":2,"maxSeqLen":1536,"gradientAccumulationSteps":4,"warmupSteps":100,"loraRank":16,"loraAlpha":32,"loraDropout":0.05,"lrSchedulerType":"linear","maxGradNorm":1,"targetModules":["q_proj","v_proj"]}',
  TRAINING_PRESET_SAFE_JSON:
    '{"epochs":2,"learningRate":0.0001,"batchSize":2,"maxSeqLen":1536,"gradientAccumulationSteps":4,"warmupSteps":100,"loraRank":16,"loraAlpha":32,"loraDropout":0.05,"lrSchedulerType":"linear","maxGradNorm":1,"targetModules":["q_proj","v_proj"]}',
  TRAINING_PRESET_STANDARD_JSON:
    '{"epochs":3,"learningRate":0.0002,"batchSize":2,"maxSeqLen":1536,"gradientAccumulationSteps":4,"warmupSteps":100,"loraRank":16,"loraAlpha":32,"loraDropout":0.05,"lrSchedulerType":"linear","maxGradNorm":1,"targetModules":["q_proj","v_proj"]}',
  TRAINING_PRESET_LARGE_JSON:
    '{"epochs":1,"learningRate":0.0001,"batchSize":2,"maxSeqLen":1536,"gradientAccumulationSteps":8,"warmupSteps":100,"loraRank":16,"loraAlpha":32,"loraDropout":0.05,"lrSchedulerType":"linear","maxGradNorm":1,"targetModules":["q_proj","v_proj"]}',
};

const RAG_ITEMS: ConfigItem[] = [
  {
    key: 'DOCUMENT_MAX_CHUNKS',
    labelKey: 'systemSettings.rag.documentMaxChunks',
    descKey: 'systemSettings.rag.documentMaxChunksDesc',
    defaultValue: '50',
    valueType: 'int',
    min: 10,
    max: 200,
  },
  {
    key: 'TRAINING_DOC_MAX_SAMPLES',
    labelKey: 'systemSettings.rag.trainingDocMaxSamples',
    descKey: 'systemSettings.rag.trainingDocMaxSamplesDesc',
    defaultValue: '50',
    valueType: 'int',
    min: 10,
    max: 100,
  },
];

const CHAT_ITEMS: ConfigItem[] = [
  {
    key: 'TRAINING_CONVERSATION_MAX_MESSAGES',
    labelKey: 'systemSettings.chat.trainingConvMaxMessages',
    descKey: 'systemSettings.chat.trainingConvMaxMessagesDesc',
    defaultValue: '50',
    valueType: 'int',
    min: 10,
    max: 200,
  },
  {
    key: 'CONVERSATION_SLICE_SIZE',
    labelKey: 'systemSettings.chat.conversationSliceSize',
    descKey: 'systemSettings.chat.conversationSliceSizeDesc',
    defaultValue: '10',
    valueType: 'int',
    min: 5,
    max: 50,
  },
];

const TRAINING_ITEMS: ConfigItem[] = [
  {
    key: 'MIN_ONDEMAND_DATASET_SIZE',
    labelKey: 'systemSettings.training.minOndemandDatasetSize',
    descKey: 'systemSettings.training.minOndemandDatasetSizeDesc',
    defaultValue: '20',
    valueType: 'int',
    min: 1,
    max: 100000,
  },
  {
    key: 'MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL',
    labelKey: 'systemSettings.training.minScheduledDatasetSizeIncremental',
    descKey: 'systemSettings.training.minScheduledDatasetSizeIncrementalDesc',
    defaultValue: '50',
    valueType: 'int',
    min: 50,
    max: 10000,
  },
  {
    key: 'MIN_SCHEDULED_DATASET_SIZE_FULL',
    labelKey: 'systemSettings.training.minScheduledDatasetSizeFull',
    descKey: 'systemSettings.training.minScheduledDatasetSizeFullDesc',
    defaultValue: '200',
    valueType: 'int',
    min: 50,
    max: 50000,
  },
  {
    key: 'TRAINING_QUALITY_MIN_RATIO',
    labelKey: 'systemSettings.training.trainingQualityMinRatio',
    descKey: 'systemSettings.training.trainingQualityMinRatioDesc',
    defaultValue: '0.60',
    valueType: 'float',
    min: 0,
    max: 1,
    step: '0.01',
  },
  {
    key: 'TRAINING_DATASET_MAX_ROWS',
    labelKey: 'systemSettings.training.trainingDatasetMaxRows',
    descKey: 'systemSettings.training.trainingDatasetMaxRowsDesc',
    defaultValue: '5000',
    valueType: 'int',
    min: 100,
    max: 500000,
  },
  {
    key: 'TRAINING_TRAIN_EVAL_SPLIT_RATIO',
    labelKey: 'systemSettings.training.trainingTrainEvalSplitRatio',
    descKey: 'systemSettings.training.trainingTrainEvalSplitRatioDesc',
    defaultValue: '0.90',
    valueType: 'float',
    min: 0.5,
    max: 0.99,
    step: '0.01',
  },
  {
    key: 'TRAINING_SLICE_STEPS',
    labelKey: 'systemSettings.training.trainingSliceSteps',
    descKey: 'systemSettings.training.trainingSliceStepsDesc',
    defaultValue: '10',
    valueType: 'int',
    min: 1,
    max: 500,
  },
  {
    key: 'TRAINING_GPU_TIMEOUT_MS',
    labelKey: 'systemSettings.training.trainingGpuTimeoutMs',
    descKey: 'systemSettings.training.trainingGpuTimeoutMsDesc',
    defaultValue: '120000',
    valueType: 'int',
    min: 10000,
    max: 600000,
    unit: 'ms',
  },
  {
    key: 'TRAINING_EVAL_MAX_LOSS',
    labelKey: 'systemSettings.training.trainingEvalMaxLoss',
    descKey: 'systemSettings.training.trainingEvalMaxLossDesc',
    defaultValue: '2.0',
    valueType: 'float',
    min: 0.0001,
    max: 20,
    step: '0.01',
  },
  {
    key: 'TRAINING_AUTO_PROMOTE_SCHEDULED',
    labelKey: 'systemSettings.training.trainingAutoPromoteScheduled',
    descKey: 'systemSettings.training.trainingAutoPromoteScheduledDesc',
    defaultValue: 'false',
    valueType: 'boolean',
  },
  {
    key: 'AUTO_LEARNING_CRON_INCREMENTAL',
    labelKey: 'systemSettings.training.autoLearningCronIncremental',
    descKey: 'systemSettings.training.autoLearningCronIncrementalDesc',
    defaultValue: '0 3 * * 0',
    valueType: 'cron',
  },
  {
    key: 'AUTO_LEARNING_CRON_FULL',
    labelKey: 'systemSettings.training.autoLearningCronFull',
    descKey: 'systemSettings.training.autoLearningCronFullDesc',
    defaultValue: '0 1 1,15 * *',
    valueType: 'cron',
  },
  {
    key: 'AUTO_LEARNING_INCLUDE_IMAGES',
    labelKey: 'systemSettings.training.autoLearningIncludeImages',
    descKey: 'systemSettings.training.autoLearningIncludeImagesDesc',
    defaultValue: 'true',
    valueType: 'boolean',
  },
  {
    key: 'TRAINING_DEFAULT_HYPERPARAMS_JSON',
    labelKey: 'systemSettings.training.trainingDefaultHyperparamsJson',
    descKey: 'systemSettings.training.trainingDefaultHyperparamsJsonDesc',
    defaultValue: '{}',
    valueType: 'json',
  },
  {
    key: 'TRAINING_PRESET_SAFE_JSON',
    labelKey: 'systemSettings.training.trainingPresetSafeJson',
    descKey: 'systemSettings.training.trainingPresetSafeJsonDesc',
    defaultValue: '{}',
    valueType: 'json',
  },
  {
    key: 'TRAINING_PRESET_STANDARD_JSON',
    labelKey: 'systemSettings.training.trainingPresetStandardJson',
    descKey: 'systemSettings.training.trainingPresetStandardJsonDesc',
    defaultValue: '{}',
    valueType: 'json',
  },
  {
    key: 'TRAINING_PRESET_LARGE_JSON',
    labelKey: 'systemSettings.training.trainingPresetLargeJson',
    descKey: 'systemSettings.training.trainingPresetLargeJsonDesc',
    defaultValue: '{}',
    valueType: 'json',
  },
  {
    key: 'maxSeqLen',
    labelKey: 'systemSettings.training.maxSeqLen',
    descKey: 'systemSettings.training.maxSeqLenDesc',
    defaultValue: '1536',
    valueType: 'int',
    min: 256,
    max: 32768,
  },
];

const ALL_ITEMS = [...RAG_ITEMS, ...CHAT_ITEMS, ...TRAINING_ITEMS];

function validateCron(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  return parts.length === 5;
}

function validateItem(item: ConfigItem, rawValue: string): string | null {
  if (item.valueType === 'boolean') {
    if (rawValue !== 'true' && rawValue !== 'false') {
      return 'Expected true or false';
    }
    return null;
  }

  if (item.valueType === 'json') {
    try {
      const parsed = JSON.parse(rawValue);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return 'Expected JSON object';
      }
      if (TRAINING_HYPERPARAMS_JSON_KEYS.has(item.key)) {
        parseTrainingHyperparamsJson(rawValue);
      }
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON';
      return message;
    }
  }

  if (item.valueType === 'cron') {
    if (!validateCron(rawValue)) {
      return 'Invalid cron (expected 5 fields)';
    }
    return null;
  }

  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) {
    return 'Invalid number';
  }

  if (item.valueType === 'int' && !Number.isInteger(numeric)) {
    return 'Must be integer';
  }

  if (item.min != null && numeric < item.min) {
    return `Minimum: ${item.min}`;
  }

  if (item.max != null && numeric > item.max) {
    return `Maximum: ${item.max}`;
  }

  return null;
}

function ConfigField({
  item,
  value,
  error,
  onChange,
  disabled,
}: {
  item: ConfigItem;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor={item.key} className="text-sm font-medium">
          {t(item.labelKey)}
        </Label>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm">
              <p className="text-xs">{t(item.descKey)}</p>
              {(item.min != null || item.max != null) && (
                <p className="text-xs text-muted-foreground mt-1">
                  Range: {item.min ?? '-'} to {item.max ?? '-'}
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {item.valueType === 'json' ? (
        <Textarea
          id={item.key}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          rows={7}
          className="font-mono text-xs"
        />
      ) : item.valueType === 'boolean' ? (
        <div className="flex items-center gap-3 rounded-md border px-3 py-2 max-w-[220px]">
          <Switch
            checked={value === 'true'}
            onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
            disabled={disabled}
          />
          <span className="text-sm text-muted-foreground">{value === 'true' ? 'true' : 'false'}</span>
        </div>
      ) : (
        <Input
          id={item.key}
          type={item.valueType === 'cron' ? 'text' : 'number'}
          value={value}
          min={item.min}
          max={item.max}
          step={item.step}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="max-w-[320px]"
        />
      )}

      {item.unit && (
        <span className="text-xs text-muted-foreground">{item.unit}</span>
      )}
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}

export default function SystemSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState('rag');

  const { data: config, isLoading } = useQuery<Record<string, string>>({
    queryKey: ['/api/training/system-config'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/training/system-config');
      if (!res.ok) throw new Error('Erro ao carregar configuracoes');
      return res.json();
    },
  });

  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!config) return;
    const next: Record<string, string> = {};
    for (const item of ALL_ITEMS) {
      const raw = config[item.key];
      next[item.key] = raw != null ? String(raw) : item.defaultValue;
    }
    setLocalValues(next);
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, string>) => {
      const res = await apiRequest('PATCH', '/api/training/system-config', {
        configs: payload,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Erro ao salvar');
      }
      return res.json() as Promise<Record<string, string>>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/system-config'] });
      toast({ title: t('systemSettings.saved') });
    },
    onError: (e: Error) => {
      toast({ title: e.message, variant: 'destructive' });
    },
  });

  const applyRecommendedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('PATCH', '/api/training/system-config', {
        configs: TRAINING_RECOMMENDED_DEFAULTS,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Erro ao aplicar defaults recomendados');
      }
      return res.json() as Promise<Record<string, string>>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/system-config'] });
      toast({ title: t('systemSettings.training.recommendedApplied') });
    },
    onError: (error: Error) => {
      toast({ title: error.message, variant: 'destructive' });
    },
  });

  const handleSave = () => {
    const payload: Record<string, string> = {};
    const nextErrors: Record<string, string> = {};

    for (const item of ALL_ITEMS) {
      const value = localValues[item.key] ?? item.defaultValue;
      const error = validateItem(item, value);
      if (error) {
        nextErrors[item.key] = error;
      } else {
        payload[item.key] = value.trim();
      }
    }

    setFieldErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      toast({
        title: 'Validation error',
        description: 'Corrija os campos com erro antes de salvar.',
        variant: 'destructive',
      });
      return;
    }

    saveMutation.mutate(payload);
  };

  const handleChange = (key: string, value: string) => {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
    const item = ALL_ITEMS.find((entry) => entry.key === key);
    if (!item) return;
    const error = validateItem(item, value);
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (error) {
        next[key] = error;
      } else {
        delete next[key];
      }
      return next;
    });
  };

  const sections = [
    { id: 'rag', labelKey: 'systemSettings.sections.rag', icon: FileText, items: RAG_ITEMS },
    { id: 'chat', labelKey: 'systemSettings.sections.chat', icon: MessageSquare, items: CHAT_ITEMS },
    { id: 'training', labelKey: 'systemSettings.sections.training', icon: Brain, items: TRAINING_ITEMS },
    { id: 'embeddings', labelKey: 'systemSettings.sections.embeddings', icon: Sparkles, items: [] as ConfigItem[] },
  ];

  const currentSection = sections.find((s) => s.id === activeSection);
  const currentHasItems = (currentSection?.items?.length ?? 0) > 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
          {t('systemSettings.title')}
        </h1>
        <p className="text-muted-foreground">{t('systemSettings.description')}</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <nav className="w-full md:w-64 space-y-1">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                activeSection === section.id ? 'bg-primary text-primary-foreground' : 'hover-elevate'
              }`}
              data-testid={`section-${section.id}`}
            >
              <section.icon className="h-4 w-4" />
              {t(section.labelKey)}
            </button>
          ))}
        </nav>

        <div className="flex-1 space-y-6">
          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t('common.loading')}</span>
            </div>
          )}

          {!isLoading && currentSection && currentSection.id !== 'embeddings' && (
            <Card>
              <CardHeader>
                <CardTitle>{t(currentSection.labelKey)}</CardTitle>
                <CardDescription>
                  {currentSection.id === 'rag'
                    ? t('systemSettings.ragDesc')
                    : currentSection.id === 'chat'
                      ? t('systemSettings.chatDesc')
                      : t('systemSettings.trainingDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {currentSection.items.map((item) => (
                  <ConfigField
                    key={item.key}
                    item={item}
                    value={localValues[item.key] ?? item.defaultValue}
                    error={fieldErrors[item.key]}
                    onChange={(v) => handleChange(item.key, v)}
                    disabled={saveMutation.isPending || applyRecommendedMutation.isPending}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {!isLoading && currentSection?.id === 'embeddings' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('systemSettings.sections.embeddings')}</CardTitle>
                <CardDescription>{t('systemSettings.embeddingsDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {t('systemSettings.embeddingsPlaceholder')}
                </p>
              </CardContent>
            </Card>
          )}

          {!isLoading && currentHasItems && (
            <div className="flex justify-end gap-2">
              {activeSection === 'training' && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => applyRecommendedMutation.mutate()}
                  disabled={saveMutation.isPending || applyRecommendedMutation.isPending}
                >
                  {applyRecommendedMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('common.saving')}
                    </>
                  ) : (
                    t('systemSettings.training.applyRecommended')
                  )}
                </Button>
              )}
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending || applyRecommendedMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('common.saving')}
                  </>
                ) : (
                  t('common.save')
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
