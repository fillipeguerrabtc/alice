CREATE TABLE IF NOT EXISTS trading_backtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  instrument_id uuid REFERENCES trading_instruments(id),
  market_type trading_market_type NOT NULL,
  strategy_key varchar(64) NOT NULL,
  strategy_version integer NOT NULL,
  walk_forward_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_model jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  oos_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  dsr jsonb,
  pbo jsonb,
  status varchar(24) NOT NULL DEFAULT 'queued',
  error text,
  started_at timestamp,
  finished_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trading_backtest_runs_tenant_status ON trading_backtest_runs(tenant_id, status, created_at DESC);
