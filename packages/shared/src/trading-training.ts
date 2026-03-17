/**
 * Constantes compartilhadas para classificação de dados de treinamento de Trading.
 *
 * Autor: Fillipe Guerra
 * Data: 16 de Março de 2026
 */

export const TRADING_TRAINING_SOURCE_TYPES = [
  'trading_signal',
  'trading_order',
  'trading_demo',
  'trading_postmortem',
] as const;

export const TRADING_TRAINING_EXTERNAL_SOURCE_TYPE = 'external' as const;
export const TRADING_TRAINING_DOMAIN = 'trading' as const;
