CREATE TABLE IF NOT EXISTS trading_execution_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  portfolio_id uuid REFERENCES trading_portfolios(id),
  instrument_id uuid NOT NULL REFERENCES trading_instruments(id),
  market_type trading_market_type NOT NULL,
  order_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  execution_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  estimated_costs jsonb NOT NULL DEFAULT '{}'::jsonb,
  realized_costs jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trading_execution_reports_tenant_created ON trading_execution_reports(tenant_id, created_at DESC);
