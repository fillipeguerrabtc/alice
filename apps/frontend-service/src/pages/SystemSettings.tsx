/**
 * System Settings Page - Alice Enterprise Platform
 *
 * Configurações editáveis do sistema: RAG, Chat, Treino, Embeddings.
 * Valores são persistidos no banco de dados (env vars como fallback).
 * Internacionalização completa (Regra 13 - i18n)
 *
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

type ConfigItem = {
  key: string;
  labelKey: string;
  descKey: string;
  default: number;
  min?: number;
  max?: number;
  unit?: string;
};

const RAG_ITEMS: ConfigItem[] = [
  {
    key: 'DOCUMENT_MAX_CHUNKS',
    labelKey: 'systemSettings.rag.documentMaxChunks',
    descKey: 'systemSettings.rag.documentMaxChunksDesc',
    default: 50,
    min: 10,
    max: 200,
  },
  {
    key: 'TRAINING_DOC_MAX_SAMPLES',
    labelKey: 'systemSettings.rag.trainingDocMaxSamples',
    descKey: 'systemSettings.rag.trainingDocMaxSamplesDesc',
    default: 50,
    min: 10,
    max: 100,
  },
];

const CHAT_ITEMS: ConfigItem[] = [
  {
    key: 'TRAINING_CONVERSATION_MAX_MESSAGES',
    labelKey: 'systemSettings.chat.trainingConvMaxMessages',
    descKey: 'systemSettings.chat.trainingConvMaxMessagesDesc',
    default: 50,
    min: 10,
    max: 200,
  },
  {
    key: 'CONVERSATION_SLICE_SIZE',
    labelKey: 'systemSettings.chat.conversationSliceSize',
    descKey: 'systemSettings.chat.conversationSliceSizeDesc',
    default: 10,
    min: 5,
    max: 50,
  },
];

const TRAINING_ITEMS: ConfigItem[] = [
  {
    key: 'MIN_ONDEMAND_DATASET_SIZE',
    labelKey: 'systemSettings.training.minOndemandDatasetSize',
    descKey: 'systemSettings.training.minOndemandDatasetSizeDesc',
    default: 10,
    min: 1,
    max: 100,
  },
  {
    key: 'maxSeqLen',
    labelKey: 'systemSettings.training.maxSeqLen',
    descKey: 'systemSettings.training.maxSeqLenDesc',
    default: 2048,
    min: 256,
    max: 32768,
  },
];

const ALL_ITEMS = [...RAG_ITEMS, ...CHAT_ITEMS, ...TRAINING_ITEMS];

function ConfigField({
  item,
  value,
  onChange,
  disabled,
}: {
  item: ConfigItem;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const parsed = parseInt(raw, 10);
    if (raw === '' || Number.isNaN(parsed)) return;
    onChange(parsed);
  };

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
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-xs">{t(item.descKey)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {item.min != null && item.max != null
                  ? `Range: ${item.min}–${item.max}. Default: ${item.default}`
                  : `Default: ${item.default}`}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <Input
        id={item.key}
        type="number"
        value={value}
        min={item.min}
        max={item.max}
        onChange={handleChange}
        disabled={disabled}
        className="max-w-[200px]"
      />
      {item.unit && (
        <span className="text-xs text-muted-foreground">{item.unit}</span>
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
      if (!res.ok) throw new Error('Erro ao carregar configurações');
      return res.json();
    },
  });

  const [localValues, setLocalValues] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!config) return;
    const next: Record<string, number> = {};
    for (const item of ALL_ITEMS) {
      const raw = config[item.key];
      const parsed = raw != null ? parseInt(String(raw), 10) : item.default;
      next[item.key] = Number.isNaN(parsed) ? item.default : parsed;
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

  const handleSave = () => {
    const payload: Record<string, string> = {};
    for (const [key, value] of Object.entries(localValues)) {
      const item = ALL_ITEMS.find((i) => i.key === key);
      if (!item) continue;
      const clamped = Math.min(Math.max(value, item.min ?? 0), item.max ?? Infinity);
      payload[key] = String(clamped);
    }
    saveMutation.mutate(payload);
  };

  const handleChange = (key: string, value: number) => {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
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

          {!isLoading && currentSection?.id === 'rag' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('systemSettings.sections.rag')}</CardTitle>
                <CardDescription>{t('systemSettings.ragDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {RAG_ITEMS.map((item) => (
                  <ConfigField
                    key={item.key}
                    item={item}
                    value={localValues[item.key] ?? item.default}
                    onChange={(v) => handleChange(item.key, v)}
                    disabled={saveMutation.isPending}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {!isLoading && currentSection?.id === 'chat' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('systemSettings.sections.chat')}</CardTitle>
                <CardDescription>{t('systemSettings.chatDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {CHAT_ITEMS.map((item) => (
                  <ConfigField
                    key={item.key}
                    item={item}
                    value={localValues[item.key] ?? item.default}
                    onChange={(v) => handleChange(item.key, v)}
                    disabled={saveMutation.isPending}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {!isLoading && currentSection?.id === 'training' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('systemSettings.sections.training')}</CardTitle>
                <CardDescription>{t('systemSettings.trainingDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {TRAINING_ITEMS.map((item) => (
                  <ConfigField
                    key={item.key}
                    item={item}
                    value={localValues[item.key] ?? item.default}
                    onChange={(v) => handleChange(item.key, v)}
                    disabled={saveMutation.isPending}
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
            <div className="flex justify-end">
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending}
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
