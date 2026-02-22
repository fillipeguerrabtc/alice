CREATE TABLE IF NOT EXISTS trading_orderbook_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  instrument_id uuid NOT NULL REFERENCES trading_instruments(id),
  market_type trading_market_type NOT NULL,
  timeframe trading_interval NOT NULL,
  snapshot_at timestamp NOT NULL,
  top_levels jsonb NOT NULL DEFAULT '{}'::jsonb,
  spread_bps numeric,
  order_book_imbalance numeric,
  depth_drop_ratio numeric,
  micro_price numeric,
  retention_until timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_orderbook_snapshots_lookup
  ON trading_orderbook_snapshots(tenant_id, instrument_id, snapshot_at);

CREATE TABLE IF NOT EXISTS trading_trade_ticks_agg (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  instrument_id uuid NOT NULL REFERENCES trading_instruments(id),
  market_type trading_market_type NOT NULL,
  timeframe trading_interval NOT NULL,
  window_start timestamp NOT NULL,
  window_end timestamp NOT NULL,
  buy_volume numeric NOT NULL,
  sell_volume numeric NOT NULL,
  delta_volume numeric NOT NULL,
  cvd numeric NOT NULL,
  trades_count integer NOT NULL DEFAULT 0,
  retention_until timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_trade_ticks_agg_lookup
  ON trading_trade_ticks_agg(tenant_id, instrument_id, window_start);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_trading_trade_ticks_agg_window
  ON trading_trade_ticks_agg(tenant_id, instrument_id, market_type, timeframe, window_start, window_end);
