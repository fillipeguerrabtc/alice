DO $$
BEGIN
  CREATE TYPE trading_rebalance_status AS ENUM ('queued','running','succeeded','failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS trading_portfolio_rebalances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  portfolio_id uuid NOT NULL REFERENCES trading_portfolios(id),
  asof_timestamp timestamp NOT NULL,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  decisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  status trading_rebalance_status NOT NULL DEFAULT 'queued',
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trading_portfolio_rebalances_query ON trading_portfolio_rebalances(tenant_id, portfolio_id, asof_timestamp DESC);
