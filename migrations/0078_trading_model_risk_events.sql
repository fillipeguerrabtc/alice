DO $$
BEGIN
  CREATE TYPE trading_model_risk_scope AS ENUM ('strategy', 'portfolio', 'instrument');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
  CREATE TYPE trading_model_risk_event_type AS ENUM ('drift', 'performance_decay', 'data_quality', 'execution_anomaly', 'kill_switch');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
  CREATE TYPE trading_model_risk_severity AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS trading_model_risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scope trading_model_risk_scope NOT NULL,
  scope_key varchar(128) NOT NULL,
  event_type trading_model_risk_event_type NOT NULL,
  severity trading_model_risk_severity NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trading_model_risk_events_tenant ON trading_model_risk_events(tenant_id, created_at DESC);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'trading_instruments',
    'trading_factor_snapshots_v2',
    'trading_universe_candidates',
    'trading_backtest_runs',
    'trading_signal_calibration',
    'trading_portfolios',
    'trading_portfolio_allocations',
    'trading_portfolio_rebalances',
    'trading_execution_reports',
    'trading_model_risk_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_isolation ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_tenant_isolation ON %I FOR ALL USING (is_super_admin() OR tenant_id = current_tenant_id()) WITH CHECK (is_super_admin() OR tenant_id = current_tenant_id())',
      tbl,
      tbl
    );
  END LOOP;
END $$;
