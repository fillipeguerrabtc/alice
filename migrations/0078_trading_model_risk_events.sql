CREATE TABLE IF NOT EXISTS trading_model_risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scope varchar(24) NOT NULL,
  scope_key varchar(128) NOT NULL,
  event_type varchar(32) NOT NULL,
  severity varchar(16) NOT NULL,
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
