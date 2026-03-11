import type { TFunction } from 'i18next';
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  TradingSignalsNewsAndActionsSection,
} from './TradingSignalsNewsAndActionsSection';
import {
  TradingSignalsProfileConfigurationSection,
} from './TradingSignalsProfileConfigurationSection';
import {
  TradingSignalsResultsSection,
} from './TradingSignalsResultsSection';
import {
  TradingSignalsSchedulerSection,
} from './TradingSignalsSchedulerSection';
import type { TradingNewsConfigForm, TradingNewsPresetOption } from './NewsConfigEditor';
import type { ReasoningMode } from '@/lib/reasoning-mode';

type TradingSignalsArbitrageConfig = {
  exchanges: string[];
  feePct: number;
  intermediateAssets: string[];
  maxIntervalMinutes: number;
  maxSlippagePct: number;
  minEdgePct: number;
};

type TradingSignalsProfileForm = {
  arbitrageConfig?: TradingSignalsArbitrageConfig | null;
  dataSources?: {
    news?: boolean;
    orderBook?: boolean;
    trainingData?: boolean;
  };
  ensembleConfig?: {
    topN?: number;
  };
  indicators: string[];
  newsConfig: TradingNewsConfigForm;
  techniques: string[];
  timeframes: string[];
};

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

type TradingSignalMetadata = {
  dataSources?: {
    news?: boolean;
  };
  entryPrice?: number;
  expectedDurationLabel?: string;
  expectedDurationMinutes?: number;
  generationSource?: 'on_demand' | 'scheduler' | 'chat';
  invalidationReasons?: string[];
  motivators?: string[];
  news?: {
    query: string;
    results: Array<{ title: string; url: string; score?: number }>;
  };
  operationType?: string;
  riskReward?: number;
  stopLoss?: number;
  takeProfit?: number;
  tradeSummary?: string;
  validationStatus?: 'pending' | 'validated' | 'failed';
};

type TradingSignalType = 'entry_long' | 'entry_short' | 'exit' | 'adjust_sl' | 'adjust_tp' | 'hold' | 'neutral';

type TradingSignalRow = {
  confidence: number;
  criadoEm: string;
  id: string;
  marketType: 'futures' | 'spot' | 'margin';
  metadata: TradingSignalMetadata;
  reasoning: string | null;
  signalType: TradingSignalType;
  sourceModel: string | null;
  symbol: string;
};

type TradingSignalsTabContentProps = {
  availableSignalArbitrageAssets: string[];
  availableSignalArbitrageExchanges: Array<{ id: string; label: string }>;
  canCreatePreset: boolean;
  canOverrideReasoningMode: boolean;
  canUpdatePreset: boolean;
  defaultArbitrageMaxIntervalMinutes: number;
  defaultEnsembleTopN: number;
  formatDurationMinutes: (minutes?: number) => string | null;
  hasSignalArbitrage: boolean;
  indicatorOptions: Array<{ label: string; value: string }>;
  intervalOptions: Array<{ label: string; value: string }>;
  isCreatePresetPending: boolean;
  isGeneratePending: boolean;
  isLoadingScheduler: boolean;
  isLoadingSignals: boolean;
  isManualSavePending: boolean;
  isSavingScheduler: boolean;
  isSignalArbitrageCatalogLoading: boolean;
  isUpdatePresetPending: boolean;
  locale: string;
  marketType: 'futures' | 'spot' | 'margin';
  maxArbitrageAssets: number;
  newsConfig: TradingNewsConfigForm;
  newsPresetDescription: string;
  newsPresetName: string;
  reasoningMode: ReasoningMode;
  reasoningModeOptions: Array<{ label: string; value: ReasoningMode }>;
  onApplyPreset: (preset: TradingNewsPresetOption) => void;
  onArbitrageAssetsChange: (values: string[]) => void;
  onArbitrageConfigChange: (patch: Partial<TradingSignalsArbitrageConfig>) => void;
  onArbitrageExchangesChange: (values: string[]) => void;
  onChangeNewsConfig: (next: TradingNewsConfigForm) => void;
  onCreatePreset: () => void;
  onDeactivateSignal: (signalId: string) => void;
  onDeletePreset: (presetId: string) => void;
  onEnabledChange: (enabled: boolean) => void;
  onEnsembleTopNChange: (topN: number) => void;
  onGenerateNow: () => void;
  onReasoningModeChange: (value: ReasoningMode) => void;
  onIndicatorsChange: (values: string[]) => void;
  onIntervalMinutesChange: (value: string) => void;
  onMaxSignalsPerRunChange: (value: string) => void;
  onNewsPresetDescriptionChange: (value: string) => void;
  onNewsPresetNameChange: (value: string) => void;
  onOpenNewSignalDialog: () => void;
  onSaveProfile: () => void;
  onSaveScheduler: () => void;
  onSelectPresetId: (presetId: string | null) => void;
  onSelectSignal: (signalId: string) => void;
  onSourcesChange: (values: string[]) => void;
  onSymbolsChange: (value: string) => void;
  onTechniquesChange: (values: string[]) => void;
  onTimeframesChange: (values: string[]) => void;
  onUpdatePreset: () => void;
  presets: TradingNewsPresetOption[];
  renderSignalTypeBadge: (signalType: TradingSignalType) => ReactNode;
  schedulerConfig: TradingSignalsSchedulerConfig;
  schedulerForm: TradingSignalsSchedulerForm;
  schedulerHasError: boolean;
  selectedPresetId: string | null;
  selectedSignal: TradingSignalRow | null;
  selectedSignalId: string | null;
  selectedSignalSources: string[];
  showArbitrageError: boolean;
  signalProfileForm: TradingSignalsProfileForm;
  signalProfileInvalid: boolean;
  signals: TradingSignalRow[];
  sourceOptions: Array<{ description: string; label: string; value: string }>;
  t: TFunction;
  techniqueOptions: Array<{ label: string; value: string }>;
  timeZone: string;
  validationErrorMessage: string;
};

export function TradingSignalsTabContent({
  availableSignalArbitrageAssets,
  availableSignalArbitrageExchanges,
  canCreatePreset,
  canOverrideReasoningMode,
  canUpdatePreset,
  defaultArbitrageMaxIntervalMinutes,
  defaultEnsembleTopN,
  formatDurationMinutes,
  hasSignalArbitrage,
  indicatorOptions,
  intervalOptions,
  isCreatePresetPending,
  isGeneratePending,
  isLoadingScheduler,
  isLoadingSignals,
  isManualSavePending,
  isSavingScheduler,
  isSignalArbitrageCatalogLoading,
  isUpdatePresetPending,
  locale,
  marketType,
  maxArbitrageAssets,
  newsConfig,
  newsPresetDescription,
  newsPresetName,
  reasoningMode,
  reasoningModeOptions,
  onApplyPreset,
  onArbitrageAssetsChange,
  onArbitrageConfigChange,
  onArbitrageExchangesChange,
  onChangeNewsConfig,
  onCreatePreset,
  onDeactivateSignal,
  onDeletePreset,
  onEnabledChange,
  onEnsembleTopNChange,
  onGenerateNow,
  onReasoningModeChange,
  onIndicatorsChange,
  onIntervalMinutesChange,
  onMaxSignalsPerRunChange,
  onNewsPresetDescriptionChange,
  onNewsPresetNameChange,
  onOpenNewSignalDialog,
  onSaveProfile,
  onSaveScheduler,
  onSelectPresetId,
  onSelectSignal,
  onSourcesChange,
  onSymbolsChange,
  onTechniquesChange,
  onTimeframesChange,
  onUpdatePreset,
  presets,
  renderSignalTypeBadge,
  schedulerConfig,
  schedulerForm,
  schedulerHasError,
  selectedPresetId,
  selectedSignal,
  selectedSignalId,
  selectedSignalSources,
  showArbitrageError,
  signalProfileForm,
  signalProfileInvalid,
  signals,
  sourceOptions,
  t,
  techniqueOptions,
  timeZone,
  validationErrorMessage,
}: TradingSignalsTabContentProps) {
  return (
    <>
      <div className="flex justify-between items-center">
        <CardDescription>{t('trading.signals.subtitle')}</CardDescription>
        <Button onClick={onOpenNewSignalDialog}>
          <Plus className="h-4 w-4 mr-2" />
          {t('trading.signals.new')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('trading.signals.profile.title')}</CardTitle>
          <CardDescription>{t('trading.signals.profile.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <TradingSignalsProfileConfigurationSection
            availableSignalArbitrageAssets={availableSignalArbitrageAssets}
            availableSignalArbitrageExchanges={availableSignalArbitrageExchanges}
            defaultArbitrageMaxIntervalMinutes={defaultArbitrageMaxIntervalMinutes}
            defaultEnsembleTopN={defaultEnsembleTopN}
            hasSignalArbitrage={hasSignalArbitrage}
            indicatorOptions={indicatorOptions}
            intervalOptions={intervalOptions}
            isSignalArbitrageCatalogLoading={isSignalArbitrageCatalogLoading}
            maxArbitrageAssets={maxArbitrageAssets}
            onArbitrageAssetsChange={onArbitrageAssetsChange}
            onArbitrageConfigChange={onArbitrageConfigChange}
            onArbitrageExchangesChange={onArbitrageExchangesChange}
            onEnsembleTopNChange={onEnsembleTopNChange}
            onIndicatorsChange={onIndicatorsChange}
            onSourcesChange={onSourcesChange}
            onTechniquesChange={onTechniquesChange}
            onTimeframesChange={onTimeframesChange}
            selectedSignalSources={selectedSignalSources}
            signalProfileForm={signalProfileForm}
            sourceOptions={sourceOptions}
            t={t}
            techniqueOptions={techniqueOptions}
          />

          <TradingSignalsNewsAndActionsSection
            canCreatePreset={canCreatePreset}
            canUpdatePreset={canUpdatePreset}
            isCreatePresetPending={isCreatePresetPending}
            isGeneratePending={isGeneratePending}
            isManualSavePending={isManualSavePending}
            isUpdatePresetPending={isUpdatePresetPending}
            newsConfig={newsConfig}
            newsPresetDescription={newsPresetDescription}
            newsPresetName={newsPresetName}
            reasoningMode={reasoningMode}
            reasoningModeOptions={reasoningModeOptions}
            canOverrideReasoningMode={canOverrideReasoningMode}
            onApplyPreset={onApplyPreset}
            onChangeNewsConfig={onChangeNewsConfig}
            onCreatePreset={onCreatePreset}
            onDeletePreset={onDeletePreset}
            onGenerateNow={onGenerateNow}
            onReasoningModeChange={onReasoningModeChange}
            onNewsPresetDescriptionChange={onNewsPresetDescriptionChange}
            onNewsPresetNameChange={onNewsPresetNameChange}
            onSaveProfile={onSaveProfile}
            onSelectPresetId={onSelectPresetId}
            onUpdatePreset={onUpdatePreset}
            presets={presets}
            selectedPresetId={selectedPresetId}
            showArbitrageError={showArbitrageError}
            signalProfileInvalid={signalProfileInvalid}
            t={t}
            validationErrorMessage={validationErrorMessage}
          />

          <TradingSignalsSchedulerSection
            isLoadingScheduler={isLoadingScheduler}
            isSavingScheduler={isSavingScheduler}
            locale={locale}
            onEnabledChange={onEnabledChange}
            onIntervalMinutesChange={onIntervalMinutesChange}
            onMaxSignalsPerRunChange={onMaxSignalsPerRunChange}
            onSaveScheduler={onSaveScheduler}
            onSymbolsChange={onSymbolsChange}
            schedulerConfig={schedulerConfig}
            schedulerForm={schedulerForm}
            schedulerHasError={schedulerHasError}
            signalTimeframes={signalProfileForm.timeframes}
            t={t}
            timeZone={timeZone}
          />
        </CardContent>
      </Card>

      <TradingSignalsResultsSection
        formatDurationMinutes={formatDurationMinutes}
        isLoadingSignals={isLoadingSignals}
        locale={locale}
        marketType={marketType}
        onDeactivateSignal={onDeactivateSignal}
        onSelectSignal={onSelectSignal}
        renderSignalTypeBadge={renderSignalTypeBadge}
        selectedSignal={selectedSignal}
        selectedSignalId={selectedSignalId}
        signals={signals}
        t={t}
        timeZone={timeZone}
      />
    </>
  );
}
