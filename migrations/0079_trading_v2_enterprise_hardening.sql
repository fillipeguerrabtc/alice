-- Trading V2 institutional hardening: instruments, cost models, dataset lineage/versioning

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trading_venue_type') THEN
    CREATE TYPE trading_venue_type AS ENUM ('cex', 'dex', 'broker', 'bank');
  END IF;
END $$;

ALTER TABLE trading_instruments
  ADD COLUMN IF NOT EXISTS venue_type trading_venue_type NOT NULL DEFAULT 'cex',
  ADD COLUMN IF NOT EXISTS trading_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS funding_rules jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS trading_cost_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  venue varchar(32) NOT NULL,
  asset_class varchar(24) NOT NULL,
  market_type trading_market_type NOT NULL,
  fee_bps numeric NOT NULL,
  slippage_model jsonb NOT NULL DEFAULT '{}'::jsonb,
  spread_model jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_cost_models_tenant ON trading_cost_models (tenant_id);
CREATE INDEX IF NOT EXISTS idx_trading_cost_models_lookup ON trading_cost_models (tenant_id, venue, asset_class, market_type, active);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_trading_cost_models_version ON trading_cost_models (tenant_id, venue, asset_class, market_type, version);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_trading_universe_candidates_scope
  ON trading_universe_candidates (tenant_id, instrument_id, market_type, timeframe, candle_timestamp, strategy_key, strategy_version);

CREATE TABLE IF NOT EXISTS training_dataset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  namespace_id uuid REFERENCES namespaces(id),
  agent_id uuid REFERENCES agents(id),
  source_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_window jsonb NOT NULL DEFAULT '{}'::jsonb,
  profile_id uuid REFERENCES training_dataset_profiles(id),
  profile_version integer NOT NULL DEFAULT 1,
  hash varchar(64) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_dataset_versions_tenant ON training_dataset_versions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_training_dataset_versions_namespace ON training_dataset_versions (namespace_id);

CREATE TABLE IF NOT EXISTS training_lineage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  namespace_id uuid REFERENCES namespaces(id),
  event_type varchar(64) NOT NULL,
  source_table varchar(64),
  source_id varchar(255),
  produced_table varchar(64),
  produced_id varchar(255),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_training_lineage_events_tenant ON training_lineage_events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_training_lineage_events_event_type ON training_lineage_events (event_type);

ALTER TABLE fine_tuning_jobs
  ADD COLUMN IF NOT EXISTS dataset_version_id uuid REFERENCES training_dataset_versions(id);

ALTER TABLE lora_jobs
  ADD COLUMN IF NOT EXISTS dataset_version_id uuid REFERENCES training_dataset_versions(id);
