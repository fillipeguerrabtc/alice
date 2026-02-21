DO $$
BEGIN
  CREATE TYPE trading_candidate_status AS ENUM ('candidate','approved','rejected','expired','executed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS trading_universe_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  instrument_id uuid NOT NULL REFERENCES trading_instruments(id),
  market_type trading_market_type NOT NULL,
  margin_mode trading_margin_mode,
  strategy_key varchar(64) NOT NULL,
  strategy_version integer NOT NULL,
  timeframe trading_interval NOT NULL,
  candle_timestamp timestamp NOT NULL,
  side varchar(16) NOT NULL,
  entry_model jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_edge numeric,
  confidence_raw numeric,
  confidence_calibrated numeric,
  dsr_score numeric,
  pbo_score numeric,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  status trading_candidate_status NOT NULL DEFAULT 'candidate',
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trading_universe_candidates_query ON trading_universe_candidates(tenant_id, market_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_universe_candidates_status ON trading_universe_candidates(tenant_id, status, created_at DESC);
