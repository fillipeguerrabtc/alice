import type { TFunction } from 'i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MultiSelectDropdown } from './MultiSelectDropdown';

type TradingSignalsProfileArbitrageConfig = {
  exchanges: string[];
  feePct: number;
  intermediateAssets: string[];
  maxIntervalMinutes: number;
  maxSlippagePct: number;
  minEdgePct: number;
};

type TradingSignalsProfileForm = {
  arbitrageConfig?: TradingSignalsProfileArbitrageConfig | null;
  ensembleConfig?: {
    topN?: number;
  };
  indicators: string[];
  techniques: string[];
  timeframes: string[];
};

type TradingSignalsProfileOption = {
  label: string;
  value: string;
};

type TradingSignalsSourceOption = TradingSignalsProfileOption & {
  description: string;
};

type TradingSignalsProfileConfigurationSectionProps = {
  availableSignalArbitrageAssets: string[];
  availableSignalArbitrageExchanges: Array<{ id: string; label: string }>;
  defaultArbitrageMaxIntervalMinutes: number;
  defaultEnsembleTopN: number;
  hasSignalArbitrage: boolean;
  indicatorOptions: TradingSignalsProfileOption[];
  intervalOptions: TradingSignalsProfileOption[];
  isSignalArbitrageCatalogLoading: boolean;
  maxArbitrageAssets: number;
  onArbitrageAssetsChange: (values: string[]) => void;
  onArbitrageConfigChange: (patch: Partial<TradingSignalsProfileArbitrageConfig>) => void;
  onArbitrageExchangesChange: (values: string[]) => void;
  onEnsembleTopNChange: (topN: number) => void;
  onIndicatorsChange: (values: string[]) => void;
  onSourcesChange: (values: string[]) => void;
  onTechniquesChange: (values: string[]) => void;
  onTimeframesChange: (values: string[]) => void;
  selectedSignalSources: string[];
  signalProfileForm: TradingSignalsProfileForm;
  sourceOptions: TradingSignalsSourceOption[];
  t: TFunction;
  techniqueOptions: TradingSignalsProfileOption[];
};

export function TradingSignalsProfileConfigurationSection({
  availableSignalArbitrageAssets,
  availableSignalArbitrageExchanges,
  defaultArbitrageMaxIntervalMinutes,
  defaultEnsembleTopN,
  hasSignalArbitrage,
  indicatorOptions,
  intervalOptions,
  isSignalArbitrageCatalogLoading,
  maxArbitrageAssets,
  onArbitrageAssetsChange,
  onArbitrageConfigChange,
  onArbitrageExchangesChange,
  onEnsembleTopNChange,
  onIndicatorsChange,
  onSourcesChange,
  onTechniquesChange,
  onTimeframesChange,
  selectedSignalSources,
  signalProfileForm,
  sourceOptions,
  t,
  techniqueOptions,
}: TradingSignalsProfileConfigurationSectionProps) {
  return (
    <>
      <div className="space-y-3">
        <Label>{t('trading.signals.profile.timeframes')}</Label>
        <MultiSelectDropdown
          label={t('trading.signals.profile.timeframes')}
          options={intervalOptions}
          selectedValues={signalProfileForm.timeframes}
          onChange={onTimeframesChange}
          minSelected={1}
          placeholder={t('trading.common.selectPlaceholder')}
          selectedCountLabel={t('trading.common.selectedCount', { count: signalProfileForm.timeframes.length })}
          maxLabel={t('trading.common.maxSelected', { max: signalProfileForm.timeframes.length })}
          selectAllLabel={t('trading.common.selectAll')}
          clearLabel={t('trading.common.clearSelection')}
          emptyLabel={t('trading.common.noOptions')}
        />
      </div>

      <div className="space-y-3">
        <Label>{t('trading.signals.profile.indicators')}</Label>
        <MultiSelectDropdown
          label={t('trading.signals.profile.indicators')}
          options={indicatorOptions}
          selectedValues={signalProfileForm.indicators}
          onChange={onIndicatorsChange}
          minSelected={1}
          placeholder={t('trading.common.selectPlaceholder')}
          selectedCountLabel={t('trading.common.selectedCount', { count: signalProfileForm.indicators.length })}
          maxLabel={t('trading.common.maxSelected', { max: signalProfileForm.indicators.length })}
          selectAllLabel={t('trading.common.selectAll')}
          clearLabel={t('trading.common.clearSelection')}
          emptyLabel={t('trading.common.noOptions')}
        />
        <p className="text-xs text-muted-foreground">{t('trading.signals.profile.indicatorsSupportHint')}</p>
      </div>

      <div className="space-y-3">
        <Label>{t('trading.signals.profile.techniques')}</Label>
        <MultiSelectDropdown
          label={t('trading.signals.profile.techniques')}
          options={techniqueOptions}
          selectedValues={signalProfileForm.techniques}
          onChange={onTechniquesChange}
          minSelected={1}
          placeholder={t('trading.common.selectPlaceholder')}
          selectedCountLabel={t('trading.common.selectedCount', { count: signalProfileForm.techniques.length })}
          maxLabel={t('trading.common.maxSelected', { max: signalProfileForm.techniques.length })}
          selectAllLabel={t('trading.common.selectAll')}
          clearLabel={t('trading.common.clearSelection')}
          emptyLabel={t('trading.common.noOptions')}
        />
        <p className="text-xs text-muted-foreground">{t('trading.signals.profile.techniquesHint')}</p>
      </div>

      <div className="space-y-3">
        <Label>{t('trading.signals.profile.ensemble')}</Label>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">{t('trading.signals.profile.ensembleMode')}</Label>
            <Input value="ensemble_top3" disabled />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">{t('trading.signals.profile.ensembleTopN')}</Label>
            <Select
              value={String(signalProfileForm.ensembleConfig?.topN ?? defaultEnsembleTopN)}
              onValueChange={(value) => onEnsembleTopNChange(Number(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((value) => (
                  <SelectItem key={value} value={String(value)}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {hasSignalArbitrage && signalProfileForm.arbitrageConfig && (
        <div className="space-y-3">
          <Label>{t('trading.signals.profile.arbitrage')}</Label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <MultiSelectDropdown
                label={t('trading.signals.profile.arbitrageExchange')}
                options={availableSignalArbitrageExchanges.map((exchange) => ({
                  value: exchange.id,
                  label: exchange.label,
                }))}
                selectedValues={signalProfileForm.arbitrageConfig.exchanges}
                onChange={onArbitrageExchangesChange}
                placeholder={t('trading.common.selectPlaceholder')}
                selectedCountLabel={t('trading.common.selectedCount', { count: signalProfileForm.arbitrageConfig.exchanges.length })}
                maxLabel={t('trading.common.maxSelected', { max: signalProfileForm.arbitrageConfig.exchanges.length })}
                selectAllLabel={t('trading.common.selectAll')}
                clearLabel={t('trading.common.clearSelection')}
                emptyLabel={isSignalArbitrageCatalogLoading ? t('trading.common.loadingOptions') : t('trading.common.noOptions')}
              />
            </div>
            <div className="space-y-2">
              <MultiSelectDropdown
                label={t('trading.signals.profile.arbitrageIntermediate')}
                options={availableSignalArbitrageAssets.map((asset) => ({
                  value: asset.toUpperCase(),
                  label: asset.toUpperCase(),
                }))}
                selectedValues={signalProfileForm.arbitrageConfig.intermediateAssets}
                onChange={onArbitrageAssetsChange}
                maxSelected={maxArbitrageAssets}
                placeholder={t('trading.common.selectPlaceholder')}
                selectedCountLabel={t('trading.common.selectedCount', { count: signalProfileForm.arbitrageConfig.intermediateAssets.length })}
                maxLabel={t('trading.common.maxSelected', { max: maxArbitrageAssets })}
                selectAllLabel={t('trading.common.selectAll')}
                clearLabel={t('trading.common.clearSelection')}
                emptyLabel={isSignalArbitrageCatalogLoading ? t('trading.common.loadingOptions') : t('trading.common.noOptions')}
              />
              <p className="text-xs text-muted-foreground">
                Limite de {maxArbitrageAssets} ativos para evitar explosão combinatória.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('trading.signals.profile.arbitrageFee')}</Label>
              <Input
                value={String(signalProfileForm.arbitrageConfig.feePct)}
                readOnly
              />
              <p className="text-xs text-muted-foreground">
                Taxa automática (maior entre exchanges selecionadas).
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('trading.signals.profile.arbitrageSlippage')}</Label>
              <Input
                value={String(signalProfileForm.arbitrageConfig.maxSlippagePct)}
                onChange={(event) => onArbitrageConfigChange({ maxSlippagePct: Number(event.target.value) || 0 })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('trading.signals.profile.arbitrageMinEdge')}</Label>
              <Input
                value={String(signalProfileForm.arbitrageConfig.minEdgePct)}
                onChange={(event) => onArbitrageConfigChange({ minEdgePct: Number(event.target.value) || 0 })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{t('trading.signals.profile.arbitrageMaxInterval')}</Label>
              <Input
                value={String(signalProfileForm.arbitrageConfig.maxIntervalMinutes)}
                onChange={(event) => onArbitrageConfigChange({
                  maxIntervalMinutes: Number(event.target.value) || defaultArbitrageMaxIntervalMinutes,
                })}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Network fees são aplicadas automaticamente quando a rota cruza exchanges.
          </p>
          <p className="text-xs text-muted-foreground">{t('trading.signals.profile.arbitrageHint')}</p>
        </div>
      )}

      <div className="space-y-3">
        <Label>{t('trading.signals.profile.sources')}</Label>
        <MultiSelectDropdown
          label={t('trading.signals.profile.sources')}
          options={sourceOptions.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
          selectedValues={selectedSignalSources}
          onChange={onSourcesChange}
          placeholder={t('trading.common.selectPlaceholder')}
          selectedCountLabel={t('trading.common.selectedCount', { count: selectedSignalSources.length })}
          maxLabel={t('trading.common.maxSelected', { max: selectedSignalSources.length })}
          selectAllLabel={t('trading.common.selectAll')}
          clearLabel={t('trading.common.clearSelection')}
          emptyLabel={t('trading.common.noOptions')}
        />
        <div className="text-xs text-muted-foreground space-y-1">
          {sourceOptions.map((option) => (
            <p key={option.value}>
              <span className="font-medium">{option.label}:</span> {option.description}
            </p>
          ))}
        </div>
      </div>
    </>
  );
}
