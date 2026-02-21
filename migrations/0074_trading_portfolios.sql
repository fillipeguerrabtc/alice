CREATE TABLE IF NOT EXISTS trading_portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name varchar(120) NOT NULL,
  base_currency varchar(16) NOT NULL,
  risk_profile varchar(24) NOT NULL,
  max_gross_exposure numeric NOT NULL,
  max_net_exposure numeric NOT NULL,
  max_drawdown_limit numeric NOT NULL,
  rebalance_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trading_portfolios_tenant ON trading_portfolios(tenant_id);
