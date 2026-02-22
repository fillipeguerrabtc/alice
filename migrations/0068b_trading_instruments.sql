-- Trading V2 - Instrument Registry
CREATE TABLE IF NOT EXISTS trading_instruments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  venue varchar(32) NOT NULL,
  asset_class varchar(24) NOT NULL,
  symbol varchar(64) NOT NULL,
  base_asset varchar(32),
  quote_asset varchar(32),
  tick_size numeric,
  lot_size numeric,
  min_notional numeric,
  price_decimals integer,
  size_decimals integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, venue, symbol)
);
CREATE INDEX IF NOT EXISTS idx_trading_instruments_tenant ON trading_instruments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trading_instruments_asset_class ON trading_instruments(asset_class);
CREATE INDEX IF NOT EXISTS idx_trading_instruments_symbol ON trading_instruments(symbol);
