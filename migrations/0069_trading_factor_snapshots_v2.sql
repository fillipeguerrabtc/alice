-- Trading V2 - Feature Store snapshots
CREATE TABLE IF NOT EXISTS trading_factor_snapshots_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  instrument_id uuid NOT NULL REFERENCES trading_instruments(id),
  market_type trading_market_type NOT NULL,
  interval trading_interval NOT NULL,
  candle_timestamp timestamp NOT NULL,
  asof_timestamp timestamp NOT NULL,
  feature_version integer NOT NULL,
  regimes jsonb NOT NULL DEFAULT '{}'::jsonb,
  factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  costs_estimate jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_return numeric,
  expected_volatility numeric,
  sharpe_proxy numeric,
  risk_score numeric,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, instrument_id, market_type, interval, candle_timestamp, feature_version)
);
CREATE INDEX IF NOT EXISTS idx_trading_factor_snapshots_v2_tenant_market ON trading_factor_snapshots_v2(tenant_id, market_type, created_at DESC);
