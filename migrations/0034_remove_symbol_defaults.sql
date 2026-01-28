-- Remover defaults hardcoded de símbolos e adicionar símbolo default configurável
-- Regra 6: sem hardcoded, persistência real em PostgreSQL

ALTER TABLE trading_signals
  ALTER COLUMN symbol DROP DEFAULT;

ALTER TABLE trading_orders
  ALTER COLUMN symbol DROP DEFAULT;

ALTER TABLE trading_positions
  ALTER COLUMN symbol DROP DEFAULT;

ALTER TABLE trading_technical_indicators
  ALTER COLUMN symbol DROP DEFAULT;

ALTER TABLE trading_market_data
  ALTER COLUMN symbol DROP DEFAULT;

ALTER TABLE trading_risk_config
  ADD COLUMN IF NOT EXISTS default_symbol VARCHAR(50);
