import { createLogger } from '@alice/logger';
import type { TradingOperationIntent } from './trading/core/types.js';

const logger = createLogger('integrations-runtime-config');

function parseEnvFloat(envValue: string | undefined, defaultValue: number, varName: string): number {
  const raw = (envValue ?? String(defaultValue)).trim().replace(',', '.');
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser número entre 0 e 1.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw, parsed }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, parsed, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }
  return parsed;
}

function parsePositiveEnvInt(envValue: string | undefined, defaultValue: number, varName: string): number {
  const raw = (envValue ?? String(defaultValue)).trim();
  if (!/^\d+$/.test(raw)) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser inteiro positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }

  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const errorMsg = `${varName} inválido: "${raw}". Deve ser inteiro positivo.`;
    if (process.env.NODE_ENV === 'production') {
      logger.error({ varName, rawValue: raw, parsed }, errorMsg);
      throw new Error(errorMsg);
    }
    logger.warn({ varName, rawValue: raw, parsed, defaultValue }, `${errorMsg} Usando valor padrão.`);
    return defaultValue;
  }

  return parsed;
}

export const TRADING_DATASET_MIN_QUALITY = parseEnvFloat(
  process.env.TRADING_DATASET_MIN_QUALITY,
  0.35,
  'TRADING_DATASET_MIN_QUALITY'
);

export const TRADING_MODE = (process.env.TRADING_MODE ?? 'portfolio_auto') as
  | 'portfolio_auto'
  | 'signal_auto'
  | 'lab';

export const TRADING_OPERATION_INTENTS: TradingOperationIntent[] = [
  'scalping',
  'intraday',
  'swing',
  'positional',
  'arbitrage_internal',
  'arbitrage_cross_exchange',
  'cash_and_carry',
  'market_neutral',
  'volatility_breakout',
];

export const TRADING_LLM_PROMPT_MODE = (process.env.TRADING_LLM_PROMPT_MODE ?? 'compact') as
  | 'compact'
  | 'verbose';

export const TRADING_METRICS_INTERVAL_MS = parsePositiveEnvInt(
  process.env.TRADING_METRICS_INTERVAL_MS,
  60_000,
  'TRADING_METRICS_INTERVAL_MS'
);

export const TRADING_PNL_WINDOW_HOURS = parsePositiveEnvInt(
  process.env.TRADING_PNL_WINDOW_HOURS,
  24,
  'TRADING_PNL_WINDOW_HOURS'
);

export const INTEGRATIONS_IMMUTABLE_AUDIT_CHECK_INTERVAL_MS = parsePositiveEnvInt(
  process.env.INTEGRATIONS_IMMUTABLE_AUDIT_CHECK_INTERVAL_MS,
  300_000,
  'INTEGRATIONS_IMMUTABLE_AUDIT_CHECK_INTERVAL_MS'
);

export const INTEGRATIONS_IMMUTABLE_AUDIT_STREAMS_PER_CHECK = parsePositiveEnvInt(
  process.env.INTEGRATIONS_IMMUTABLE_AUDIT_STREAMS_PER_CHECK,
  30,
  'INTEGRATIONS_IMMUTABLE_AUDIT_STREAMS_PER_CHECK'
);

export const INTEGRATIONS_IMMUTABLE_AUDIT_EVENTS_PER_STREAM_LIMIT = parsePositiveEnvInt(
  process.env.INTEGRATIONS_IMMUTABLE_AUDIT_EVENTS_PER_STREAM_LIMIT,
  5_000,
  'INTEGRATIONS_IMMUTABLE_AUDIT_EVENTS_PER_STREAM_LIMIT'
);
