import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/queryClient';
import {
  TradingContentLoadingState,
  TradingNotConfiguredState,
  TradingStatusErrorState,
  TradingStatusUnavailableState,
  TradingTenantRequiredState,
} from './TradingServiceStates';

type TradingStatusGateData = {
  isConfigured?: boolean;
  missingKeys?: string[];
  requiresTenant?: boolean;
};

type TradingStatusGatePayload = {
  data?: TradingStatusGateData | null;
};

type ResolveTradingStatusGateOptions = {
  isLoadingStatus: boolean;
  refetchStatus: () => Promise<unknown> | unknown;
  statusData?: TradingStatusGatePayload | null;
  statusError: unknown;
  t: TFunction;
};

export function resolveTradingStatusGate({
  isLoadingStatus,
  refetchStatus,
  statusData,
  statusError,
  t,
}: ResolveTradingStatusGateOptions): ReactNode | null {
  if (isLoadingStatus) {
    return <TradingContentLoadingState />;
  }

  if (statusError) {
    const errorMessage = statusError instanceof ApiError
      ? statusError.message
      : statusError instanceof Error
        ? statusError.message
        : 'Erro desconhecido';
    return <TradingStatusErrorState errorMessage={errorMessage} onReload={refetchStatus} />;
  }

  if (!statusData?.data) {
    return <TradingStatusUnavailableState onReload={refetchStatus} />;
  }

  if (!statusData.data.isConfigured) {
    const missingKeys = statusData.data.missingKeys?.length
      ? statusData.data.missingKeys
      : ['KUCOIN_PRO_API_KEY', 'KUCOIN_PRO_API_SECRET', 'KUCOIN_PRO_API_PASSPHRASE'];
    return (
      <TradingNotConfiguredState
        description={t('trading.notConfiguredDesc')}
        missingKeys={missingKeys}
        title={t('trading.notConfigured')}
      />
    );
  }

  if (statusData.data.requiresTenant) {
    return (
      <TradingTenantRequiredState
        description="Seu usuário está autenticado, mas não possui um tenant associado. Para operar trading, é obrigatório ter um tenant válido (multi-tenancy + RLS)."
        title="Tenant obrigatório"
      />
    );
  }

  return null;
}
