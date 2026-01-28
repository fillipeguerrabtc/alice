-- Remover defaults hardcoded de símbolos e adicionar símbolo default configurável
-- Regra 6: sem hardcoded, persistência real em PostgreSQL

ALTER TABLE IF EXISTS trading_signals
  ALTER COLUMN symbol DROP DEFAULT;

ALTER TABLE IF EXISTS trading_orders
  ALTER COLUMN symbol DROP DEFAULT;

ALTER TABLE IF EXISTS trading_positions
  ALTER COLUMN symbol DROP DEFAULT;

ALTER TABLE IF EXISTS trading_technical_indicators
  ALTER COLUMN symbol DROP DEFAULT;

ALTER TABLE IF EXISTS trading_market_data
  ALTER COLUMN symbol DROP DEFAULT;

ALTER TABLE IF EXISTS trading_risk_config
  ADD COLUMN IF NOT EXISTS default_symbol VARCHAR(50);
