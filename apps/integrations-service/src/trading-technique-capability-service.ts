import type {
  TradingProfileDataSources,
  TradingTechnique,
  TradingTechniqueCapability,
  TradingTechniqueDataRequirement,
  TradingTechniqueFamily,
  TradingTechniqueScore,
  TradingTechniqueSupportLevel,
} from '@alice/shared';
import type { TradingMarketType } from './tradingTypes.js';

type TradingTechniqueCapabilityContext = {
  marketType: TradingMarketType;
  dataSources?: TradingProfileDataSources;
  hasArbitrageConfig: boolean;
};

type TradingTechniqueRequirementTemplate = Omit<TradingTechniqueDataRequirement, 'available'> & {
  availableWhen: (context: TradingTechniqueCapabilityContext) => boolean;
};

const TECHNIQUE_FAMILY_MAP: Record<TradingTechnique, TradingTechniqueFamily> = {
  scalping: 'directional_technical',
  day_trade: 'directional_technical',
  swing: 'directional_technical',
  position: 'directional_technical',
  trend: 'directional_technical',
  mean_reversion: 'directional_technical',
  breakout: 'directional_technical',
  range: 'directional_technical',
  momentum: 'directional_technical',
  arbitrage_triangular: 'cross_venue_arbitrage',
  cash_and_carry: 'basis_funding_carry',
  basis_trade: 'basis_funding_carry',
  funding_arbitrage: 'basis_funding_carry',
  grid_trading: 'intraday_microstructure',
  market_making: 'inventory_spread_capture',
};

const FAMILY_REQUIREMENTS: Record<TradingTechniqueFamily, TradingTechniqueRequirementTemplate[]> = {
  directional_technical: [
    {
      key: 'ohlcv_candles',
      label: 'Candles OHLCV',
      description: 'Série histórica de candles por timeframe para calcular indicadores técnicos.',
      required: true,
      availableWhen: () => true,
    },
    {
      key: 'technical_indicators',
      label: 'Indicadores Técnicos',
      description: 'Pipeline determinístico de RSI/MACD/ADX/Bollinger/ATR/Stochastic/Volume.',
      required: true,
      availableWhen: () => true,
    },
  ],
  intraday_microstructure: [
    {
      key: 'orderbook_depth_snapshots',
      label: 'Order Book Depth',
      description: 'Snapshots de profundidade com granularidade suficiente para microstructure.',
      required: true,
      availableWhen: (context) => Boolean(context.dataSources?.orderBook),
    },
    {
      key: 'trade_ticks_aggregation',
      label: 'Trade Ticks Aggregation',
      description: 'Agregação de fluxo agressor/passivo por janela para decisão intraday.',
      required: true,
      availableWhen: () => false,
    },
    {
      key: 'microstructure_features',
      label: 'Microstructure Features',
      description: 'Features de imbalance, depth decay e microprice prontas para score.',
      required: true,
      availableWhen: () => false,
    },
  ],
  basis_funding_carry: [
    {
      key: 'spot_futures_basis_curve',
      label: 'Spot/Futures Basis Curve',
      description: 'Curva temporal de basis entre mercados para identificar convergência real.',
      required: true,
      availableWhen: () => false,
    },
    {
      key: 'funding_rate_series',
      label: 'Funding Rate Series',
      description: 'Série de funding com janela histórica e regime para validação de edge.',
      required: true,
      availableWhen: () => false,
    },
    {
      key: 'carry_cost_model',
      label: 'Carry Cost Model',
      description: 'Modelo de custos de carry incluindo fees, borrow e transferência.',
      required: true,
      availableWhen: () => false,
    },
  ],
  inventory_spread_capture: [
    {
      key: 'orderbook_depth_snapshots',
      label: 'Order Book Depth',
      description: 'Visão de profundidade e dinâmica de spread para captura de inventário.',
      required: true,
      availableWhen: (context) => Boolean(context.dataSources?.orderBook),
    },
    {
      key: 'inventory_state_model',
      label: 'Inventory State Model',
      description: 'Estado de inventário e limites dinâmicos por símbolo/venue.',
      required: true,
      availableWhen: () => false,
    },
    {
      key: 'queue_position_estimator',
      label: 'Queue Position Estimator',
      description: 'Estimador de posição em fila para execução passiva com risco controlado.',
      required: true,
      availableWhen: () => false,
    },
  ],
  cross_venue_arbitrage: [
    {
      key: 'spot_or_margin_market',
      label: 'Market Compatibility',
      description: 'Arbitragem triangular requer mercado spot ou margin.',
      required: true,
      availableWhen: (context) => context.marketType === 'spot' || context.marketType === 'margin',
    },
    {
      key: 'arbitrage_config',
      label: 'Arbitrage Configuration',
      description: 'Exchanges e ativos intermediários definidos no profile.',
      required: true,
      availableWhen: (context) => context.hasArbitrageConfig,
    },
    {
      key: 'venue_quotes_and_fees',
      label: 'Venue Quotes and Fees',
      description: 'Quotes + fee model para calcular edge líquido e slippage.',
      required: true,
      availableWhen: (context) => context.marketType === 'spot' || context.marketType === 'margin',
    },
  ],
};

const FAMILY_REASON_TEXT: Record<string, string> = {
  ORDERBOOK_SOURCE_DISABLED: 'A fonte de dados orderBook está desabilitada para esta técnica.',
  ARBITRAGE_CONFIG_REQUIRED: 'Configuração de arbitragem é obrigatória para esta técnica.',
  ARBITRAGE_REQUIRES_SPOT_OR_MARGIN: 'Arbitragem triangular não é suportada em mercado futures.',
  BASIS_FUNDING_DATA_UNAVAILABLE: 'Dados mínimos de basis/funding/carry ainda não estão disponíveis.',
  MICROSTRUCTURE_PIPELINE_NOT_IMPLEMENTED: 'Pipeline de microstructure ainda não foi integrado ao score determinístico.',
  INVENTORY_SPREAD_MODELS_UNAVAILABLE: 'Modelos de inventário/spread capture ainda não estão disponíveis.',
  TECHNIQUE_SUPPORTED: 'Technique suportada no contexto atual.',
};

function mapRequirements(
  family: TradingTechniqueFamily,
  context: TradingTechniqueCapabilityContext,
): TradingTechniqueDataRequirement[] {
  return FAMILY_REQUIREMENTS[family].map((requirement) => ({
    key: requirement.key,
    label: requirement.label,
    description: requirement.description,
    required: requirement.required,
    available: requirement.availableWhen(context),
  }));
}

function resolveSupportForTechnique(params: {
  technique: TradingTechnique;
  family: TradingTechniqueFamily;
  context: TradingTechniqueCapabilityContext;
}): {
  supportLevel: TradingTechniqueSupportLevel;
  reasonCode: string | null;
} {
  const { technique, family, context } = params;

  if (family === 'directional_technical') {
    return { supportLevel: 'supported', reasonCode: null };
  }

  if (family === 'cross_venue_arbitrage') {
    if (context.marketType === 'futures') {
      return {
        supportLevel: 'not_supported_for_current_context',
        reasonCode: 'ARBITRAGE_REQUIRES_SPOT_OR_MARGIN',
      };
    }
    if (!context.hasArbitrageConfig) {
      return {
        supportLevel: 'blocked',
        reasonCode: 'ARBITRAGE_CONFIG_REQUIRED',
      };
    }
    return { supportLevel: 'supported', reasonCode: null };
  }

  if (family === 'intraday_microstructure') {
    if (!context.dataSources?.orderBook) {
      return { supportLevel: 'blocked', reasonCode: 'ORDERBOOK_SOURCE_DISABLED' };
    }
    return {
      supportLevel: 'not_supported_for_current_context',
      reasonCode: 'MICROSTRUCTURE_PIPELINE_NOT_IMPLEMENTED',
    };
  }

  if (family === 'basis_funding_carry') {
    return {
      supportLevel: 'not_supported_for_current_context',
      reasonCode: 'BASIS_FUNDING_DATA_UNAVAILABLE',
    };
  }

  if (family === 'inventory_spread_capture') {
    if (!context.dataSources?.orderBook) {
      return { supportLevel: 'blocked', reasonCode: 'ORDERBOOK_SOURCE_DISABLED' };
    }
    return {
      supportLevel: 'not_supported_for_current_context',
      reasonCode: 'INVENTORY_SPREAD_MODELS_UNAVAILABLE',
    };
  }

  return {
    supportLevel: 'blocked',
    reasonCode: `${technique.toUpperCase()}_UNSUPPORTED`,
  };
}

export function getTradingTechniqueFamily(technique: TradingTechnique): TradingTechniqueFamily {
  return TECHNIQUE_FAMILY_MAP[technique];
}

export function resolveTradingTechniqueCapabilities(params: {
  techniques: TradingTechnique[];
  marketType?: TradingMarketType;
  dataSources?: TradingProfileDataSources;
  hasArbitrageConfig?: boolean;
}): TradingTechniqueCapability[] {
  const context: TradingTechniqueCapabilityContext = {
    marketType: params.marketType ?? 'futures',
    dataSources: params.dataSources,
    hasArbitrageConfig: Boolean(params.hasArbitrageConfig),
  };

  return params.techniques.map((technique) => {
    const family = getTradingTechniqueFamily(technique);
    const requirements = mapRequirements(family, context);
    const support = resolveSupportForTechnique({ technique, family, context });
    const reasonCode = support.reasonCode;

    return {
      technique,
      family,
      supportLevel: support.supportLevel,
      reasonCode,
      reasonHuman: reasonCode ? (FAMILY_REASON_TEXT[reasonCode] ?? 'Technique indisponível no contexto atual.') : FAMILY_REASON_TEXT.TECHNIQUE_SUPPORTED,
      minimumDataRequirements: requirements,
    };
  });
}

export function filterSupportedTradingTechniques(capabilities: TradingTechniqueCapability[]): TradingTechnique[] {
  return capabilities
    .filter((capability) => capability.supportLevel === 'supported')
    .map((capability) => capability.technique);
}

export function mapTechniqueCapabilitiesByTechnique(
  capabilities: TradingTechniqueCapability[],
): Map<TradingTechnique, TradingTechniqueCapability> {
  return new Map(capabilities.map((capability) => [capability.technique, capability]));
}

export function buildUnsupportedTechniqueScores(capabilities: TradingTechniqueCapability[]): TradingTechniqueScore[] {
  return capabilities
    .filter((capability) => capability.supportLevel !== 'supported')
    .map((capability) => ({
      technique: capability.technique,
      family: capability.family,
      supportLevel: capability.supportLevel,
      reasonCode: capability.reasonCode ?? null,
      reasonHuman: capability.reasonHuman ?? null,
      minimumDataRequirements: capability.minimumDataRequirements,
      signal: 'neutral',
      confidence: 0,
      rationale: capability.reasonHuman ?? 'Technique indisponível no contexto atual.',
    }));
}

export function applyCapabilityToTechniqueScore(
  score: TradingTechniqueScore,
  capability?: TradingTechniqueCapability,
): TradingTechniqueScore {
  if (!capability) {
    return score;
  }
  return {
    ...score,
    family: capability.family,
    supportLevel: capability.supportLevel,
    reasonCode: capability.reasonCode ?? null,
    reasonHuman: capability.reasonHuman ?? null,
    minimumDataRequirements: capability.minimumDataRequirements,
  };
}

