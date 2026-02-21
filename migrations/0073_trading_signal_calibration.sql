CREATE TABLE IF NOT EXISTS trading_signal_calibration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  instrument_id uuid NOT NULL REFERENCES trading_instruments(id),
  market_type trading_market_type NOT NULL,
  strategy_key varchar(64) NOT NULL,
  strategy_version integer NOT NULL,
  method varchar(16) NOT NULL,
  payload jsonb NOT NULL,
  eval_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, instrument_id, market_type, strategy_key, strategy_version, method)
);
