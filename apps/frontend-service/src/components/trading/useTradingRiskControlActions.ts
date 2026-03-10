import { useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { TradingControlMode } from './HandoverPanel';
import type {
  TradingRiskConfigMutationInput,
  TradingRiskControlMutationOptions,
} from './trading-control-order-types';

export function useTradingRiskControlActions(options: TradingRiskControlMutationOptions) {
  const {
    notify,
    refetchControlHistory,
    refetchRiskConfig,
    refetchStatus,
    setControlMode,
    setShowRiskConfigDialog,
    t,
  } = options;

  const updateRiskConfigMutation = useMutation({
    mutationFn: async (data: TradingRiskConfigMutationInput) => {
      const normalizeDecimal = (value: string | number): string | undefined => {
        const raw = String(value ?? '').trim();
        if (!raw) return undefined;
        const normalized = raw.replace(',', '.');
        if (!Number.isFinite(Number(normalized))) {
          throw new Error('Valor inválido. Use apenas números e separador decimal.');
        }
        return normalized;
      };

      const res = await apiRequest('PUT', '/api/integrations/trading/risk-config', {
        maxPositionSize: normalizeDecimal(data.maxPositionSize),
        maxDailyLoss: normalizeDecimal(data.maxDailyLoss),
        maxOrderValue: normalizeDecimal(data.maxOrderValue),
        maxLeverage: data.maxLeverage,
        maxOpenPositions: data.maxOpenPositions,
        defaultLeverage: data.defaultLeverage,
        defaultSymbol: data.defaultSymbol || undefined,
        defaultMarketType: data.defaultMarketType,
        marginMode: data.marginMode,
        tradingEnabled: data.tradingEnabled,
      });
      return res.json();
    },
    onSuccess: (data) => {
      notify({
        title: t('trading.success.riskConfigUpdated'),
      });
      setShowRiskConfigDialog(false);
      if (data?.success) {
        queryClient.setQueryData(['/api/integrations/trading/risk-config'], data);
      }
      refetchRiskConfig();
      refetchStatus();
    },
    onError: (error: Error) => {
      notify({
        title: t('trading.errors.riskConfigFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleModeChange = async (mode: TradingControlMode, reason: string) => {
    try {
      const res = await apiRequest('POST', '/api/integrations/trading/control', {
        mode,
        reason,
        source: 'dashboard',
      });
      const data = await res.json();
      if (data.success) {
        setControlMode(mode);
        refetchControlHistory();
        notify({
          title: t('trading.handover.modeChanged'),
        });
      }
    } catch (error) {
      notify({
        title: t('trading.handover.modeChangeError'),
        description: error instanceof Error ? error.message : 'Erro desconhecido',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const handleTradingToggle = async (enabled: boolean) => {
    try {
      const res = await apiRequest('PUT', '/api/integrations/trading/risk-config', {
        tradingEnabled: enabled,
      });
      const data = await res.json();
      if (data.success) {
        queryClient.setQueryData(['/api/integrations/trading/risk-config'], data);
        refetchRiskConfig();
        notify({
          title: enabled ? t('trading.handover.tradingEnabled') : t('trading.handover.tradingDisabled'),
        });
      }
    } catch (error) {
      notify({
        title: t('trading.handover.tradingToggleError'),
        description: error instanceof Error ? error.message : 'Erro desconhecido',
        variant: 'destructive',
      });
      throw error;
    }
  };

  return {
    handleModeChange,
    handleTradingToggle,
    updateRiskConfigMutation,
  };
}
