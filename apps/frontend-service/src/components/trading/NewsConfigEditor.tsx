/**
 * NewsConfigEditor - Configuração de fontes/termos SearXNG
 *
 * Mantém configurações de coleta de notícias visíveis e editáveis.
 * Persistido via perfil de análise/sinais (trading_analysis_profiles.news_config).
 *
 * Autor: Fillipe Guerra
 * Data: 31 de Janeiro de 2026
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface TradingNewsConfigForm {
  engines: string[];
  categories: string;
  language: string;
  safesearch: string;
  timeRange: 'last_hour' | 'last_24_hours' | 'custom' | 'day' | 'week' | 'month' | 'year';
  dateFrom?: string;
  dateTo?: string;
  queryTemplates: string[];
  extraTerms: string[];
  maxResults: number;
}

export interface TradingNewsPresetOption {
  id: string;
  name: string;
  description?: string | null;
  config: TradingNewsConfigForm;
  isDefault?: boolean;
}

interface NewsConfigEditorProps {
  value: TradingNewsConfigForm;
  onChange: (value: TradingNewsConfigForm) => void;
  title?: string;
  description?: string;
  presets?: TradingNewsPresetOption[];
  selectedPresetId?: string | null;
  onSelectPresetId?: (id: string) => void;
  onApplyPreset?: (preset: TradingNewsPresetOption) => void;
  onCreatePreset?: (payload: { name: string; description?: string | null; config: TradingNewsConfigForm }) => void;
  onUpdatePreset?: (payload: { id: string; name: string; description?: string | null; config: TradingNewsConfigForm }) => void;
  onDeletePreset?: (id: string) => void;
}

const DEFAULT_TEMPLATES = ['{symbol} {marketType} news {terms}'];

export const DEFAULT_TRADING_NEWS_CONFIG: TradingNewsConfigForm = {
  engines: [],
  categories: 'general',
  language: 'pt-BR',
  safesearch: '1',
  timeRange: 'last_24_hours',
  queryTemplates: DEFAULT_TEMPLATES,
  extraTerms: [],
  maxResults: 5,
};

export function normalizeTradingNewsConfigForm(input?: TradingNewsConfigForm): TradingNewsConfigForm {
  return {
    ...DEFAULT_TRADING_NEWS_CONFIG,
    ...input,
    engines: input?.engines ?? DEFAULT_TRADING_NEWS_CONFIG.engines,
    queryTemplates: input?.queryTemplates?.length
      ? input.queryTemplates
      : DEFAULT_TRADING_NEWS_CONFIG.queryTemplates,
    extraTerms: input?.extraTerms ?? DEFAULT_TRADING_NEWS_CONFIG.extraTerms,
    timeRange: input?.timeRange ?? DEFAULT_TRADING_NEWS_CONFIG.timeRange,
    dateFrom: input?.timeRange === 'custom' ? input?.dateFrom : undefined,
    dateTo: input?.timeRange === 'custom' ? input?.dateTo : undefined,
  };
}

function parseCommaList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLineList(raw: string): string[] {
  return raw
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toLineList(items: string[]): string {
  return items.join('\n');
}

function toCommaList(items: string[]): string {
  return items.join(', ');
}

export function NewsConfigEditor({
  value,
  onChange,
  title,
  description,
  presets,
  selectedPresetId,
  onSelectPresetId,
  onApplyPreset,
  onCreatePreset,
  onUpdatePreset,
  onDeletePreset,
}: NewsConfigEditorProps) {
  const { t } = useTranslation();
  const enginesLabel = value.engines.length > 0
    ? value.engines.join(', ')
    : t('trading.newsConfig.defaultEngines');
  const selectedPreset = presets?.find((preset) => preset.id === selectedPresetId);
  const [presetName, setPresetName] = useState('');
  const [presetDescription, setPresetDescription] = useState('');
  const canManagePresets = Boolean(onCreatePreset || onUpdatePreset || onDeletePreset);
  const normalizedPresetName = presetName.trim();
  const canCreatePreset = normalizedPresetName.length >= 2 && Boolean(onCreatePreset);
  const canUpdatePreset = Boolean(selectedPreset && normalizedPresetName.length >= 2 && onUpdatePreset);
  const canDeletePreset = Boolean(selectedPreset && onDeletePreset);

  const templatesText = useMemo(
    () => toLineList(value.queryTemplates.length > 0 ? value.queryTemplates : DEFAULT_TEMPLATES),
    [value.queryTemplates]
  );

  useEffect(() => {
    if (selectedPreset) {
      setPresetName(selectedPreset.name);
      setPresetDescription(selectedPreset.description ?? '');
      return;
    }
    setPresetName('');
    setPresetDescription('');
  }, [selectedPreset?.id]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title ?? t('trading.newsConfig.title')}</CardTitle>
        <CardDescription>{description ?? t('trading.newsConfig.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t('trading.newsConfig.sourceLabel')}</span>
          <Badge variant="secondary">SearXNG</Badge>
          <span>{t('trading.newsConfig.enginesLabelInline')}</span>
          <Badge variant="outline">{enginesLabel}</Badge>
        </div>

        {presets && presets.length > 0 && onApplyPreset && onSelectPresetId && (
          <div className="grid gap-3 md:grid-cols-[1fr_auto] items-end">
            <div className="space-y-2">
              <Label>{t('trading.newsConfig.presets')}</Label>
              <Select
                value={selectedPresetId ?? ''}
                onValueChange={(value) => onSelectPresetId(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('trading.newsConfig.presetsPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPreset?.description && (
                <p className="text-xs text-muted-foreground">{selectedPreset.description}</p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => selectedPreset && onApplyPreset(selectedPreset)}
              disabled={!selectedPreset}
            >
              {t('trading.newsConfig.applyPreset')}
            </Button>
          </div>
        )}

        {canManagePresets && (
          <div className="space-y-3 rounded-md border border-dashed p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('trading.newsConfig.manageTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('trading.newsConfig.manageHint')}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('trading.newsConfig.presetName')}</Label>
                <Input
                  value={presetName}
                  placeholder={t('trading.newsConfig.presetNamePlaceholder')}
                  onChange={(event) => setPresetName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('trading.newsConfig.presetDescription')}</Label>
                <Input
                  value={presetDescription}
                  placeholder={t('trading.newsConfig.presetDescriptionPlaceholder')}
                  onChange={(event) => setPresetDescription(event.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => onCreatePreset?.({
                  name: normalizedPresetName,
                  description: presetDescription.trim() || null,
                  config: value,
                })}
                disabled={!canCreatePreset}
              >
                {t('trading.newsConfig.createPreset')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => selectedPreset && onUpdatePreset?.({
                  id: selectedPreset.id,
                  name: normalizedPresetName,
                  description: presetDescription.trim() || null,
                  config: value,
                })}
                disabled={!canUpdatePreset}
              >
                {t('trading.newsConfig.updatePreset')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => selectedPreset && onDeletePreset?.(selectedPreset.id)}
                disabled={!canDeletePreset}
              >
                {t('trading.newsConfig.deletePreset')}
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('trading.newsConfig.engines')}</Label>
            <Input
              value={toCommaList(value.engines)}
              placeholder={t('trading.newsConfig.enginesPlaceholder')}
              onChange={(event) => onChange({
                ...value,
                engines: parseCommaList(event.target.value),
              })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('trading.newsConfig.categories')}</Label>
            <Input
              value={value.categories}
              placeholder={t('trading.newsConfig.categoriesPlaceholder')}
              onChange={(event) => onChange({ ...value, categories: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('trading.newsConfig.language')}</Label>
            <Input
              value={value.language}
              placeholder="pt-BR"
              onChange={(event) => onChange({ ...value, language: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('trading.newsConfig.safeSearch')}</Label>
            <Input
              value={value.safesearch}
              placeholder="1"
              onChange={(event) => onChange({ ...value, safesearch: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('trading.newsConfig.timeRange')}</Label>
            <Select
              value={value.timeRange}
              onValueChange={(range) => onChange({
                ...value,
                timeRange: range as TradingNewsConfigForm['timeRange'],
                dateFrom: range === 'custom' ? value.dateFrom : undefined,
                dateTo: range === 'custom' ? value.dateTo : undefined,
              })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last_hour">{t('trading.newsConfig.timeRangeLastHour')}</SelectItem>
                <SelectItem value="last_24_hours">{t('trading.newsConfig.timeRangeLast24Hours')}</SelectItem>
                <SelectItem value="custom">{t('trading.newsConfig.timeRangeCustom')}</SelectItem>
                <SelectItem value="day">{t('trading.newsConfig.timeRangeDay')}</SelectItem>
                <SelectItem value="week">{t('trading.newsConfig.timeRangeWeek')}</SelectItem>
                <SelectItem value="month">{t('trading.newsConfig.timeRangeMonth')}</SelectItem>
                <SelectItem value="year">{t('trading.newsConfig.timeRangeYear')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('trading.newsConfig.maxResults')}</Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={value.maxResults}
              onChange={(event) => onChange({
                ...value,
                maxResults: Number(event.target.value || 1),
              })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('trading.newsConfig.dateFrom')}</Label>
            <Input
              type="date"
              value={value.dateFrom ?? ''}
              onChange={(event) => onChange({
                ...value,
                dateFrom: event.target.value || undefined,
              })}
              disabled={value.timeRange !== 'custom'}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('trading.newsConfig.dateTo')}</Label>
            <Input
              type="date"
              value={value.dateTo ?? ''}
              onChange={(event) => onChange({
                ...value,
                dateTo: event.target.value || undefined,
              })}
              disabled={value.timeRange !== 'custom'}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('trading.newsConfig.extraTerms')}</Label>
            <Input
              value={toCommaList(value.extraTerms)}
              placeholder={t('trading.newsConfig.extraTermsPlaceholder')}
              onChange={(event) => onChange({
                ...value,
                extraTerms: parseCommaList(event.target.value),
              })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t('trading.newsConfig.queryTemplates')}</Label>
          <Textarea
            rows={3}
            value={templatesText}
            placeholder={DEFAULT_TEMPLATES.join('\n')}
            onChange={(event) => onChange({
              ...value,
              queryTemplates: parseLineList(event.target.value),
            })}
          />
          <p className="text-xs text-muted-foreground">
            {t('trading.newsConfig.queryTemplatesHint')}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('trading.newsConfig.dateHint')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
