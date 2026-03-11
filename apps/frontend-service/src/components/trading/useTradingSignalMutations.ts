import type { Dispatch, SetStateAction } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { apiRequest } from '@/lib/queryClient';
import type { ReasoningMode } from '@/lib/reasoning-mode';
import { startSignalAutoRun, type TradingAutoSignalAsset } from '@/services/api/trading';
import { createDefaultSignalForm, type TradingSchedulerForm, type TradingSignalForm } from './TradingFormDefaults';
import type { NamespaceOption, TradingProfileForm } from './TradingDomainTypes';

type NotifyFn = (params: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

type RefetchFn = () => unknown;

type UseTradingSignalMutationsOptions = {
  allowedModes: string[];
  autoMix: boolean;
  autoSelectAllAssets: boolean;
  autoSelectedAssetKeys: string[];
  autoSignalAllModes: string[];
  autoSignalAssetMap: Map<string, TradingAutoSignalAsset>;
  autoUniverseScope: 'futures' | 'spot' | 'margin' | 'all';
  availableNamespaces: NamespaceOption[];
  defaultInterval: string;
  notify: NotifyFn;
  requestSymbol: string;
  refetchScheduler: RefetchFn;
  refetchSignalAutoRuns: RefetchFn;
  refetchSignals: RefetchFn;
  reasoningMode: ReasoningMode;
  schedulerForm: TradingSchedulerForm;
  selectedInterval: string;
  selectedMarginMode: 'cross' | 'isolated';
  selectedMarketType: 'futures' | 'spot' | 'margin';
  selectedSymbol: string;
  setActiveAutoRunId: Dispatch<SetStateAction<string | null>>;
  setShowNewSignalDialog: Dispatch<SetStateAction<boolean>>;
  setSignalForm: Dispatch<SetStateAction<TradingSignalForm>>;
  signalProfileForm: TradingProfileForm;
  t: TFunction;
};

export function useTradingSignalMutations(options: UseTradingSignalMutationsOptions) {
  const {
    allowedModes,
    autoMix,
    autoSelectAllAssets,
    autoSelectedAssetKeys,
    autoSignalAllModes,
    autoSignalAssetMap,
    autoUniverseScope,
    availableNamespaces,
    defaultInterval,
    notify,
    requestSymbol,
    refetchScheduler,
    refetchSignalAutoRuns,
    refetchSignals,
    reasoningMode,
    schedulerForm,
    selectedInterval,
    selectedMarginMode,
    selectedMarketType,
    selectedSymbol,
    setActiveAutoRunId,
    setShowNewSignalDialog,
    setSignalForm,
    signalProfileForm,
    t,
  } = options;

  const createSignalMutation = useMutation({
    mutationFn: async (data: TradingSignalForm) => {
      const response = await apiRequest('POST', '/api/integrations/trading/signals', {
        signalType: data.signalType,
        symbol: selectedSymbol || undefined,
        marketType: selectedMarketType,
        marginMode: selectedMarketType === 'margin' ? selectedMarginMode : undefined,
        confidence: Number.parseFloat(data.confidence),
        reasoning: data.reasoning || undefined,
        sourceModel: 'manual-admin',
      });
      return response.json();
    },
    onSuccess: () => {
      notify({
        title: t('trading.success.signalCreated'),
      });
      setShowNewSignalDialog(false);
      setSignalForm(createDefaultSignalForm());
      refetchSignals();
    },
    onError: (error: Error) => {
      notify({
        title: t('trading.errors.signalFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const generateSignalMutation = useMutation({
    mutationFn: async () => {
      if (!requestSymbol) {
        throw new Error(t('trading.signals.errors.symbolRequired'));
      }
      const response = await apiRequest('POST', '/api/integrations/trading/signals/generate', {
        symbol: requestSymbol,
        interval: selectedInterval || defaultInterval,
        timeframes: signalProfileForm.timeframes,
        indicators: signalProfileForm.indicators,
        dataSources: signalProfileForm.dataSources,
        techniques: signalProfileForm.techniques,
        ensembleConfig: signalProfileForm.ensembleConfig,
        arbitrageConfig: signalProfileForm.arbitrageConfig ?? undefined,
        modelConfig: signalProfileForm.modelConfig,
        consensus: signalProfileForm.consensus,
        marketType: selectedMarketType,
        marginMode: selectedMarketType === 'margin' ? selectedMarginMode : undefined,
        reasoningMode,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (!data?.success) {
        throw new Error(data?.error || t('trading.errors.signalGenerateFailed'));
      }
      notify({
        title: t('trading.success.signalGenerated'),
        description: t('trading.success.signalGeneratedDesc'),
      });
      refetchSignals();
      refetchScheduler();
    },
    onError: (error: Error) => {
      notify({
        title: t('trading.errors.signalGenerateFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const signalAutoRunMutation = useMutation({
    mutationFn: async () => {
      const tradingNamespace = availableNamespaces.find(
        (namespace) => namespace.slug === 'trading' || namespace.nome?.toLowerCase().includes('trading'),
      );
      const selectedAssetsPayload = autoSelectedAssetKeys
        .map((assetKey) => autoSignalAssetMap.get(assetKey))
        .filter((asset): asset is TradingAutoSignalAsset => Boolean(asset))
        .map((asset) => ({
          venue: asset.venue,
          symbol: asset.symbol,
          marketType: asset.marketType,
          marginMode: asset.marginMode,
        }));
      const effectiveSelectAllAssets = autoMix || autoSelectAllAssets;
      const effectiveUniverseScope = autoMix ? 'all' : autoUniverseScope;
      const effectiveAllowedModes = autoMix ? [...autoSignalAllModes] : allowedModes;
      const effectiveMarketType = effectiveUniverseScope === 'all' ? undefined : effectiveUniverseScope;
      const fallbackSymbol = !effectiveSelectAllAssets && selectedAssetsPayload.length === 0
        ? (requestSymbol || undefined)
        : undefined;

      if (!effectiveSelectAllAssets && selectedAssetsPayload.length === 0 && !fallbackSymbol) {
        throw new Error('Selecione ao menos um ativo ou habilite "Todos os ativos".');
      }

      return startSignalAutoRun({
        symbol: fallbackSymbol,
        marketType: effectiveMarketType,
        universeScope: effectiveUniverseScope,
        autoMix,
        allowedModes: effectiveAllowedModes.length > 0 ? effectiveAllowedModes : undefined,
        selectedAssets: !effectiveSelectAllAssets && selectedAssetsPayload.length > 0
          ? selectedAssetsPayload
          : undefined,
        selectAllAssets: effectiveSelectAllAssets,
        namespaceId: tradingNamespace?.id,
        reasoningMode,
      });
    },
    onSuccess: (data) => {
      setActiveAutoRunId(data.runId);
      refetchSignalAutoRuns();
      notify({
        title: 'Signal Auto Run iniciado',
        description: `Run ${data.runId.slice(0, 8)}… enfileirado. Acompanhe o status na aba.`,
      });
    },
    onError: (error: Error) => {
      notify({
        title: 'Falha ao iniciar Signal Auto Run',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateSignalSchedulerMutation = useMutation({
    mutationFn: async () => {
      const intervalMinutes = Number.parseInt(schedulerForm.intervalMinutes, 10);
      const maxSignalsPerRun = Number.parseInt(schedulerForm.maxSignalsPerRun, 10);
      if (Number.isNaN(intervalMinutes) || Number.isNaN(maxSignalsPerRun)) {
        throw new Error(t('trading.errors.schedulerUpdateFailed'));
      }
      const primaryInterval = signalProfileForm.timeframes?.[0] ?? selectedInterval ?? defaultInterval;
      const payload: {
        marketType: 'futures' | 'spot' | 'margin';
        marginMode?: 'cross' | 'isolated';
        intervalMinutes: number;
        interval: string;
        symbols: string[];
        enabled: boolean;
        maxSignalsPerRun: number;
        techniques: string[];
        ensembleConfig: TradingProfileForm['ensembleConfig'];
        arbitrageConfig: TradingProfileForm['arbitrageConfig'] | undefined;
      } = {
        marketType: selectedMarketType,
        marginMode: selectedMarketType === 'margin' ? selectedMarginMode : undefined,
        techniques: signalProfileForm.techniques,
        ensembleConfig: signalProfileForm.ensembleConfig,
        arbitrageConfig: signalProfileForm.arbitrageConfig ?? undefined,
        intervalMinutes,
        interval: primaryInterval,
        symbols: schedulerForm.symbols
          .split(',')
          .map((symbol) => symbol.trim())
          .filter(Boolean),
        enabled: schedulerForm.enabled,
        maxSignalsPerRun,
      };
      const response = await apiRequest('PUT', '/api/integrations/trading/signal-scheduler', payload);
      return response.json();
    },
    onSuccess: (data) => {
      if (!data?.success) {
        throw new Error(data?.error || t('trading.errors.schedulerUpdateFailed'));
      }
      notify({
        title: t('trading.success.schedulerUpdated'),
      });
      refetchScheduler();
    },
    onError: (error: Error) => {
      notify({
        title: t('trading.errors.schedulerUpdateFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const deactivateSignalMutation = useMutation({
    mutationFn: async (signalId: string) => {
      const response = await apiRequest('DELETE', `/api/integrations/trading/signals/${signalId}`);
      return response.json();
    },
    onSuccess: () => {
      notify({
        title: t('trading.success.signalDeactivated'),
      });
      refetchSignals();
    },
    onError: (error: Error) => {
      notify({
        title: t('trading.errors.signalDeactivateFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    createSignalMutation,
    deactivateSignalMutation,
    generateSignalMutation,
    signalAutoRunMutation,
    updateSignalSchedulerMutation,
  };
}
