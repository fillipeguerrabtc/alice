/**
 * NewsConfigEditor - Configuração de fontes/termos SearXNG
 *
 * Mantém configurações de coleta de notícias visíveis e editáveis.
 * Persistido via perfil de análise/sinais (trading_analysis_profiles.news_config).
 *
 * Autor: Fillipe Guerra
 * Data: 31 de Janeiro de 2026
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

export interface TradingNewsConfigForm {
  engines: string[];
  categories: string;
  language: string;
  safesearch: string;
  queryTemplates: string[];
  extraTerms: string[];
  maxResults: number;
}

interface NewsConfigEditorProps {
  value: TradingNewsConfigForm;
  onChange: (value: TradingNewsConfigForm) => void;
  title?: string;
  description?: string;
}

const DEFAULT_TEMPLATES = ['{symbol} {marketType} news {terms}'];

export const DEFAULT_TRADING_NEWS_CONFIG: TradingNewsConfigForm = {
  engines: [],
  categories: 'general',
  language: 'pt-BR',
  safesearch: '1',
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
}: NewsConfigEditorProps) {
  const { t } = useTranslation();
  const enginesLabel = value.engines.length > 0
    ? value.engines.join(', ')
    : t('trading.newsConfig.defaultEngines');

  const templatesText = useMemo(
    () => toLineList(value.queryTemplates.length > 0 ? value.queryTemplates : DEFAULT_TEMPLATES),
    [value.queryTemplates]
  );

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
        </div>
      </CardContent>
    </Card>
  );
}
