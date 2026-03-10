export const SIGNAL_INDICATOR_OPTIONS = [
  { key: 'rsi', label: 'RSI', description: 'Mede sobrecompra/sobrevenda com base no momentum.' },
  { key: 'macd', label: 'MACD', description: 'Sinal de tendência via cruzamento de médias.' },
  { key: 'moving_averages', label: 'Médias Móveis', description: 'Tendência geral e níveis dinâmicos.' },
  { key: 'bollinger', label: 'Bollinger Bands', description: 'Volatilidade e afastamento do preço.' },
  { key: 'atr', label: 'ATR', description: 'Volatilidade média e risco de variação.' },
  { key: 'stochastic', label: 'Stochastic', description: 'Momentum e possíveis reversões.' },
  { key: 'adx', label: 'ADX', description: 'Força da tendência atual.' },
  { key: 'support_resistance', label: 'Suporte/Resistência', description: 'Níveis técnicos de reversão (pivot points).' },
  { key: 'volume', label: 'Volume', description: 'Força do movimento via fluxo negociado.' },
] as const;

export const TRADING_TECHNIQUE_OPTIONS = [
  { key: 'scalping', labelKey: 'trading.techniques.scalping.title', descKey: 'trading.techniques.scalping.desc' },
  { key: 'day_trade', labelKey: 'trading.techniques.day_trade.title', descKey: 'trading.techniques.day_trade.desc' },
  { key: 'swing', labelKey: 'trading.techniques.swing.title', descKey: 'trading.techniques.swing.desc' },
  { key: 'position', labelKey: 'trading.techniques.position.title', descKey: 'trading.techniques.position.desc' },
  { key: 'trend', labelKey: 'trading.techniques.trend.title', descKey: 'trading.techniques.trend.desc' },
  { key: 'mean_reversion', labelKey: 'trading.techniques.mean_reversion.title', descKey: 'trading.techniques.mean_reversion.desc' },
  { key: 'breakout', labelKey: 'trading.techniques.breakout.title', descKey: 'trading.techniques.breakout.desc' },
  { key: 'range', labelKey: 'trading.techniques.range.title', descKey: 'trading.techniques.range.desc' },
  { key: 'momentum', labelKey: 'trading.techniques.momentum.title', descKey: 'trading.techniques.momentum.desc' },
  { key: 'arbitrage_triangular', labelKey: 'trading.techniques.arbitrage_triangular.title', descKey: 'trading.techniques.arbitrage_triangular.desc' },
] as const;

export const AUTO_SIGNAL_MODE_OPTIONS = [
  { value: 'scalping', label: 'Scalping' },
  { value: 'day_trade', label: 'Day Trade' },
  { value: 'swing', label: 'Swing' },
  { value: 'position', label: 'Position' },
  { value: 'trend', label: 'Trend' },
  { value: 'mean_reversion', label: 'Mean Reversion' },
  { value: 'breakout', label: 'Breakout' },
  { value: 'range', label: 'Range' },
  { value: 'momentum', label: 'Momentum' },
  { value: 'arbitrage_triangular', label: 'Arbitrage Triangular' },
  { value: 'cash_and_carry', label: 'Cash and Carry' },
  { value: 'basis_trade', label: 'Basis Trade' },
  { value: 'funding_arbitrage', label: 'Funding Arbitrage' },
  { value: 'grid_trading', label: 'Grid Trading' },
  { value: 'market_making', label: 'Market Making' },
] as const;

export const AUTO_SIGNAL_ALL_MODES = AUTO_SIGNAL_MODE_OPTIONS.map((option) => option.value);

export const DEFAULT_SIGNAL_TECHNIQUES = TRADING_TECHNIQUE_OPTIONS
  .map((option) => option.key)
  .filter((key) => key !== 'arbitrage_triangular');

export const DEFAULT_ENSEMBLE_CONFIG = { mode: 'ensemble_top3' as const, topN: 3 };

export const DEFAULT_ARBITRAGE_CONFIG = {
  exchanges: ['kucoin'],
  intermediateAssets: ['ETH'],
  feePct: 0.1,
  maxSlippagePct: 0.05,
  minEdgePct: 0.3,
  maxIntervalMinutes: 5,
};

export const FALLBACK_INTERVAL_MINUTES: Record<string, number> = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '4h': 240,
  '8h': 480,
  '12h': 720,
  '1d': 1440,
  '1w': 10080,
};

export const MAX_ARBITRAGE_ASSETS = 30;

export const AUTO_SAVE_DEBOUNCE_MS = 600;
