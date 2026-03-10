import { DEFAULT_TRADING_NEWS_CONFIG } from './NewsConfigEditor';
import { DEFAULT_ENSEMBLE_CONFIG, DEFAULT_SIGNAL_TECHNIQUES, SIGNAL_INDICATOR_OPTIONS } from './TradingSignalConfig';
import type { RiskConfig, TradingOrder, TradingProfileForm, TradingSignal } from './TradingDomainTypes';

export type TradingReviewOrderForm = {
  orderType: TradingOrder['orderType'];
  size: string;
  price: string;
  leverage: string;
  stopLoss: string;
  takeProfit: string;
};

export type TradingSchedulerForm = {
  enabled: boolean;
  intervalMinutes: string;
  symbols: string;
  maxSignalsPerRun: string;
};

export type TradingOrderForm = {
  side: 'buy' | 'sell';
  orderType: 'limit' | 'market';
  size: string;
  price: string;
  funds: string;
  usdtAmount: string;
  leverage: string;
  stopLoss: string;
  takeProfit: string;
};

export type TradingRiskForm = {
  maxPositionSize: string;
  maxDailyLoss: string;
  maxOrderValue: string;
  maxLeverage: number;
  maxOpenPositions: number;
  defaultLeverage: number;
  defaultSymbol: string;
  defaultMarketType: 'futures' | 'spot' | 'margin';
  marginMode: 'cross' | 'isolated';
  tradingEnabled: boolean;
};

export type TradingSignalForm = {
  signalType: TradingSignal['signalType'];
  confidence: string;
  reasoning: string;
};

type TradingSchedulerConfig = {
  enabled: boolean;
  intervalMinutes: number;
  symbols: string[];
  maxSignalsPerRun: number;
};

export function createDefaultReviewOrderForm(): TradingReviewOrderForm {
  return {
    orderType: 'market',
    size: '',
    price: '',
    leverage: '',
    stopLoss: '',
    takeProfit: '',
  };
}

export function createReviewOrderFormFromOrder(order: TradingOrder): TradingReviewOrderForm {
  const metadata = (order.metadata ?? {}) as { stopLoss?: number; takeProfit?: number };
  return {
    orderType: order.orderType,
    size: String(order.size ?? ''),
    price: order.price ? String(order.price) : '',
    leverage: String(order.leverage ?? ''),
    stopLoss: metadata.stopLoss ? String(metadata.stopLoss) : '',
    takeProfit: metadata.takeProfit ? String(metadata.takeProfit) : '',
  };
}

export function createDefaultSchedulerForm(): TradingSchedulerForm {
  return {
    enabled: false,
    intervalMinutes: '15',
    symbols: '',
    maxSignalsPerRun: '1',
  };
}

export function createSchedulerFormFromConfig(config: TradingSchedulerConfig): TradingSchedulerForm {
  return {
    enabled: config.enabled,
    intervalMinutes: String(config.intervalMinutes || 15),
    symbols: config.symbols.join(', '),
    maxSignalsPerRun: String(config.maxSignalsPerRun || 1),
  };
}

export function createDefaultOrderForm(): TradingOrderForm {
  return {
    side: 'buy',
    orderType: 'market',
    size: '',
    price: '',
    funds: '',
    usdtAmount: '',
    leverage: '10',
    stopLoss: '',
    takeProfit: '',
  };
}

export function createDefaultRiskForm(): TradingRiskForm {
  return {
    maxPositionSize: '10',
    maxDailyLoss: '5',
    maxOrderValue: '10000',
    maxLeverage: 20,
    maxOpenPositions: 3,
    defaultLeverage: 10,
    defaultSymbol: '',
    defaultMarketType: 'futures',
    marginMode: 'cross',
    tradingEnabled: false,
  };
}

export function createRiskFormFromConfig(config: RiskConfig): TradingRiskForm {
  return {
    maxPositionSize: config.maxPositionSize !== null && config.maxPositionSize !== undefined
      ? String(config.maxPositionSize)
      : '10',
    maxDailyLoss: config.maxDailyLoss !== null && config.maxDailyLoss !== undefined
      ? String(config.maxDailyLoss)
      : '5',
    maxOrderValue: config.maxOrderValue !== null && config.maxOrderValue !== undefined
      ? String(config.maxOrderValue)
      : '10000',
    maxLeverage: config.maxLeverage ?? 20,
    maxOpenPositions: config.maxOpenPositions ?? 3,
    defaultLeverage: config.defaultLeverage ?? 10,
    defaultSymbol: config.defaultSymbol ?? '',
    defaultMarketType: config.defaultMarketType ?? 'futures',
    marginMode: config.marginMode ?? 'cross',
    tradingEnabled: config.tradingEnabled ?? false,
  };
}

export function createDefaultSignalForm(): TradingSignalForm {
  return {
    signalType: 'entry_long',
    confidence: '0.85',
    reasoning: '',
  };
}

export function createDefaultSignalProfileForm(selectedInterval: string, defaultInterval: string): TradingProfileForm {
  return {
    kind: 'signal',
    timeframes: [selectedInterval || defaultInterval],
    indicators: SIGNAL_INDICATOR_OPTIONS.map((option) => option.key),
    techniques: DEFAULT_SIGNAL_TECHNIQUES,
    dataSources: {
      orderBook: false,
      news: false,
      trainingData: false,
    },
    newsConfig: DEFAULT_TRADING_NEWS_CONFIG,
    ensembleConfig: DEFAULT_ENSEMBLE_CONFIG,
    arbitrageConfig: null,
    modelConfig: {},
    consensus: { rule: 'majority' },
  };
}
