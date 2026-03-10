import type { TFunction } from 'i18next';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatDateTime } from '@/lib/utils';

type TradingSignalsSchedulerForm = {
  enabled: boolean;
  intervalMinutes: string;
  maxSignalsPerRun: string;
  symbols: string;
};

type TradingSignalsSchedulerConfig = {
  lastDurationMs: number | null;
  lastError: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
} | null;

type TradingSignalsSchedulerSectionProps = {
  isLoadingScheduler: boolean;
  isSavingScheduler: boolean;
  locale: string;
  onEnabledChange: (enabled: boolean) => void;
  onIntervalMinutesChange: (value: string) => void;
  onMaxSignalsPerRunChange: (value: string) => void;
  onSaveScheduler: () => void;
  onSymbolsChange: (value: string) => void;
  schedulerConfig: TradingSignalsSchedulerConfig;
  schedulerForm: TradingSignalsSchedulerForm;
  schedulerHasError: boolean;
  signalTimeframes: string[];
  t: TFunction;
  timeZone: string;
};

export function TradingSignalsSchedulerSection({
  isLoadingScheduler,
  isSavingScheduler,
  locale,
  onEnabledChange,
  onIntervalMinutesChange,
  onMaxSignalsPerRunChange,
  onSaveScheduler,
  onSymbolsChange,
  schedulerConfig,
  schedulerForm,
  schedulerHasError,
  signalTimeframes,
  t,
  timeZone,
}: TradingSignalsSchedulerSectionProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t('trading.signals.scheduler.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('trading.signals.scheduler.subtitle')}</p>
      </div>

      <div className="space-y-2">
        <Label>{t('trading.signals.scheduler.timeframesLabel')}</Label>
        <div className="flex flex-wrap gap-2">
          {signalTimeframes.map((frame) => (
            <Badge key={frame} variant="outline">
              {frame}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('trading.signals.scheduler.timeframesHint')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('trading.signals.scheduler.intervalMinutes')}</Label>
          <Input
            type="number"
            min={1}
            max={1440}
            value={schedulerForm.intervalMinutes}
            onChange={(event) => onIntervalMinutesChange(event.target.value)}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>{t('trading.signals.scheduler.symbols')}</Label>
          <Input
            value={schedulerForm.symbols}
            onChange={(event) => onSymbolsChange(event.target.value)}
            placeholder={t('trading.signals.scheduler.symbolsPlaceholder')}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('trading.signals.scheduler.maxSignals')}</Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={schedulerForm.maxSignalsPerRun}
            onChange={(event) => onMaxSignalsPerRunChange(event.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={schedulerForm.enabled}
            onCheckedChange={onEnabledChange}
          />
          <span className="text-sm">{t('trading.signals.scheduler.enabled')}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={onSaveScheduler}
          disabled={isSavingScheduler}
        >
          {isSavingScheduler && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {t('trading.signals.scheduler.save')}
        </Button>
      </div>

      <div className="text-xs text-muted-foreground grid gap-1">
        <span>{t('trading.signals.scheduler.status.nextRun')}: {schedulerConfig?.nextRunAt ? formatDateTime(String(schedulerConfig.nextRunAt), { locale, timeZone }) : t('common.notAvailable')}</span>
        <span>{t('trading.signals.scheduler.status.lastRun')}: {schedulerConfig?.lastRunAt ? formatDateTime(String(schedulerConfig.lastRunAt), { locale, timeZone }) : t('common.notAvailable')}</span>
        <span>{t('trading.signals.scheduler.status.lastSuccess')}: {schedulerConfig?.lastSuccessAt ? formatDateTime(String(schedulerConfig.lastSuccessAt), { locale, timeZone }) : t('common.notAvailable')}</span>
        <span>{t('trading.signals.scheduler.status.lastDuration')}: {schedulerConfig?.lastDurationMs ? `${schedulerConfig.lastDurationMs}ms` : t('common.notAvailable')}</span>
        {schedulerConfig?.lastError && (
          <span className="text-destructive">{t('trading.signals.scheduler.status.lastError')}: {schedulerConfig.lastError}</span>
        )}
        {schedulerHasError && (
          <span className="text-destructive">{t('trading.signals.scheduler.status.loadError')}</span>
        )}
        {isLoadingScheduler && (
          <span>{t('trading.signals.scheduler.status.loading')}</span>
        )}
      </div>
    </div>
  );
}
