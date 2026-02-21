-- Trading V2 - Strategy registry
CREATE TABLE IF NOT EXISTS trading_strategy_registry (
  strategy_key varchar(64) NOT NULL,
  version integer NOT NULL,
  applicable_asset_classes text[] NOT NULL,
  applicable_markets trading_market_type[] NOT NULL,
  default_timeframes trading_interval[] NOT NULL,
  params jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (strategy_key, version)
);

INSERT INTO trading_strategy_registry(strategy_key, version, applicable_asset_classes, applicable_markets, default_timeframes, params, enabled)
VALUES
  ('tf_breakout_v1', 1, ARRAY['crypto']::text[], ARRAY['spot','futures','margin']::trading_market_type[], ARRAY['5m','15m','1h']::trading_interval[], '{"lookback":[20,50],"atrMultiplier":[1,3]}'::jsonb, true),
  ('mr_zscore_v1', 1, ARRAY['crypto']::text[], ARRAY['spot','futures']::trading_market_type[], ARRAY['5m','15m']::trading_interval[], '{"zEntry":[1.5,3.0],"zExit":[0.2,1.0]}'::jsonb, true)
ON CONFLICT (strategy_key, version) DO NOTHING;
