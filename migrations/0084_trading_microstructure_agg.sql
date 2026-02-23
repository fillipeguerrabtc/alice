CREATE TABLE IF NOT EXISTS trading_microstructure_agg (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  instrument_id uuid NOT NULL REFERENCES trading_instruments(id),
  market_type trading_market_type NOT NULL,
  interval_seconds integer NOT NULL,
  asof_ts timestamp NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_microstructure_agg_lookup
  ON trading_microstructure_agg(tenant_id, instrument_id, market_type, asof_ts);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_trading_microstructure_agg_window
  ON trading_microstructure_agg(tenant_id, instrument_id, market_type, interval_seconds, asof_ts);
