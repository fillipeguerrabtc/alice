export interface TradingAuthContext {
  tenantId: string;
  userId: string;
  sessionId?: string;
}

interface TradingRiskConfigLike {
  tradingEnabled: boolean | null;
  maxPositionSize: number | string | null;
  maxOrderValue: number | string | null;
}

type TradingRiskGateMetricObserver = (reasonCode: string, decision: 'allow' | 'block') => void;

interface CreateTradingRiskGateServiceParams {
  getRiskConfig: (authContext: TradingAuthContext) => Promise<TradingRiskConfigLike | null>;
}

export function createTradingRiskGateService(params: CreateTradingRiskGateServiceParams) {
  const { getRiskConfig } = params;
  let observeTradingRiskGateMetric: TradingRiskGateMetricObserver = () => {};

  const setTradingRiskGateMetricObserver = (observer: TradingRiskGateMetricObserver): void => {
    observeTradingRiskGateMetric = observer;
  };

  const validateTradingAllowed = async (
    authContext: TradingAuthContext,
    orderSize: number,
    orderValue: number,
  ): Promise<{ allowed: boolean; reason?: string; reasonCode: string; decision: 'allow' | 'block' }> => {
    const block = (reasonCode: string, reason: string) => {
      observeTradingRiskGateMetric(reasonCode, 'block');
      return { allowed: false as const, reason, reasonCode, decision: 'block' as const };
    };

    // CORREÇÃO 17/12/2025: Validação defensiva contra NaN/Infinity
    // Garante que valores inválidos não passem silenciosamente pela validação
    if (!Number.isFinite(orderSize) || orderSize <= 0) {
      return block('invalid_order_size', `Tamanho da ordem inválido: ${orderSize}. Deve ser um número positivo.`);
    }

    if (!Number.isFinite(orderValue) || orderValue <= 0) {
      return block('invalid_order_value', `Valor da ordem inválido: ${orderValue}. Deve ser um número positivo.`);
    }

    const config = await getRiskConfig(authContext);

    if (!config) {
      return block('risk_config_missing', 'Configuração de risco não encontrada. Configure antes de operar.');
    }

    if (!config.tradingEnabled) {
      return block('trading_disabled', 'Trading desabilitado para este tenant.');
    }

    // Validar maxPositionSize com proteção contra NaN
    const maxPositionSize = Number(config.maxPositionSize);
    if (!Number.isFinite(maxPositionSize)) {
      return block(
        'invalid_max_position_size_config',
        `Configuração maxPositionSize inválida: ${config.maxPositionSize}. Contate administrador.`,
      );
    }

    if (orderSize > maxPositionSize) {
      return block(
        'max_position_size_exceeded',
        `Tamanho da ordem (${orderSize}) excede limite máximo (${maxPositionSize}).`,
      );
    }

    // Validar maxOrderValue com proteção contra NaN
    const maxOrderValue = Number(config.maxOrderValue);
    if (!Number.isFinite(maxOrderValue)) {
      return block(
        'invalid_max_order_value_config',
        `Configuração maxOrderValue inválida: ${config.maxOrderValue}. Contate administrador.`,
      );
    }

    if (orderValue > maxOrderValue) {
      return block(
        'max_order_value_exceeded',
        `Valor da ordem (${orderValue.toFixed(2)} USD) excede limite máximo (${maxOrderValue.toFixed(2)} USD).`,
      );
    }

    observeTradingRiskGateMetric('allowed', 'allow');
    return { allowed: true, reasonCode: 'allowed', decision: 'allow' };
  };

  return {
    setTradingRiskGateMetricObserver,
    validateTradingAllowed,
  };
}
