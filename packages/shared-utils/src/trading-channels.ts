/**
 * Trading Channels - Alice Enterprise Platform
 *
 * Canalização Redis para dados de trading em tempo real.
 * Mantém SSOT de nomes para evitar divergências entre serviços.
 *
 * Regra 6: sem hardcoded fora deste SSOT
 * Regra 10: documentação PT-BR
 */

export const TRADING_CHANNEL_PREFIX = 'alice:trading';

export const TRADING_CHANNELS = {
  TICKER: `${TRADING_CHANNEL_PREFIX}:ticker`,
  ORDERBOOK: `${TRADING_CHANNEL_PREFIX}:orderbook`,
  KLINES: `${TRADING_CHANNEL_PREFIX}:klines`,
  TRADES: `${TRADING_CHANNEL_PREFIX}:trades`,
  ORDERS: `${TRADING_CHANNEL_PREFIX}:orders`,
  POSITIONS: `${TRADING_CHANNEL_PREFIX}:positions`,
  BALANCE: `${TRADING_CHANNEL_PREFIX}:balance`,
  CONTROL: `${TRADING_CHANNEL_PREFIX}:control`,
} as const;
