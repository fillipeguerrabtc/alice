import type { TFunction } from 'i18next';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type TradingCriticalApiError = {
  message: string;
  retryAfterSeconds?: number;
  status?: number;
};

type TradingOperationalAlertsProps = {
  criticalApiError: TradingCriticalApiError | null;
  isTradingEnabled: boolean;
  onOpenRiskConfigDialog: () => void;
  t: TFunction;
};

export function TradingOperationalAlerts({
  criticalApiError,
  isTradingEnabled,
  onOpenRiskConfigDialog,
  t,
}: TradingOperationalAlertsProps) {
  if (!criticalApiError && isTradingEnabled) {
    return null;
  }

  return (
    <div className="space-y-2">
      {criticalApiError ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Falha ao carregar dados de Trading</AlertTitle>
          <AlertDescription className="space-y-1">
            <p>{criticalApiError.message}</p>
            {criticalApiError.status === 429 ? (
              <p className="text-sm">
                Rate limit excedido
                {criticalApiError.retryAfterSeconds
                  ? ` — tente novamente em ~${criticalApiError.retryAfterSeconds}s.`
                  : '.'}
              </p>
            ) : null}
            {criticalApiError.status === 503 ? (
              <p className="text-sm">
                Serviço upstream indisponível (circuit breaker/credenciais). Verifique status, secrets e o painel de
                Observability.
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {!isTradingEnabled ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t('trading.alerts.tradingDisabled')}</AlertTitle>
          <AlertDescription>
            {t('trading.alerts.tradingDisabledDesc')}
            <Button
              variant="link"
              className="p-0 h-auto ml-1"
              onClick={onOpenRiskConfigDialog}
            >
              {t('trading.alerts.enableNow')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
