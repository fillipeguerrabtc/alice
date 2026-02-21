CREATE TABLE IF NOT EXISTS trading_portfolio_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  portfolio_id uuid NOT NULL REFERENCES trading_portfolios(id),
  instrument_id uuid NOT NULL REFERENCES trading_instruments(id),
  target_weight numeric NOT NULL,
  max_weight numeric NOT NULL,
  min_weight numeric NOT NULL,
  leverage_cap numeric,
  market_type trading_market_type NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, instrument_id, market_type)
);
CREATE INDEX IF NOT EXISTS idx_trading_portfolio_allocations_portfolio ON trading_portfolio_allocations(portfolio_id, enabled);
