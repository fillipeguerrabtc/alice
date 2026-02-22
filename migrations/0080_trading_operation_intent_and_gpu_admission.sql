DO $$
BEGIN
  CREATE TYPE trading_operation_intent AS ENUM (
    'scalping',
    'intraday',
    'swing',
    'positional',
    'arbitrage_internal',
    'arbitrage_cross_exchange',
    'cash_and_carry',
    'market_neutral',
    'volatility_breakout'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS trading_exchanges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  venue varchar(32) NOT NULL,
  api_connected boolean NOT NULL DEFAULT false,
  supports_spot boolean NOT NULL DEFAULT false,
  supports_futures boolean NOT NULL DEFAULT false,
  supports_margin boolean NOT NULL DEFAULT false,
  fee_model_version integer NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT uniq_trading_exchanges_tenant_venue UNIQUE (tenant_id, venue)
);

CREATE INDEX IF NOT EXISTS idx_trading_exchanges_tenant ON trading_exchanges(tenant_id);

ALTER TABLE trading_strategy_registry
  ADD COLUMN IF NOT EXISTS operation_intent trading_operation_intent NOT NULL DEFAULT 'intraday';

ALTER TABLE trading_universe_candidates
  ADD COLUMN IF NOT EXISTS operation_intent trading_operation_intent NOT NULL DEFAULT 'intraday';

ALTER TABLE trading_backtest_runs
  ADD COLUMN IF NOT EXISTS operation_intent trading_operation_intent NOT NULL DEFAULT 'intraday';

ALTER TABLE trading_signal_calibration
  ADD COLUMN IF NOT EXISTS operation_intent trading_operation_intent NOT NULL DEFAULT 'intraday';

ALTER TABLE trading_portfolios
  ADD COLUMN IF NOT EXISTS allowed_operation_intents trading_operation_intent[] NOT NULL DEFAULT ARRAY['intraday']::trading_operation_intent[],
  ADD COLUMN IF NOT EXISTS policy jsonb NOT NULL DEFAULT '{}'::jsonb;
