DROP INDEX IF EXISTS uniq_trading_universe_candidates_scope;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_trading_universe_candidates_scope
  ON trading_universe_candidates (
    tenant_id,
    instrument_id,
    market_type,
    timeframe,
    candle_timestamp,
    strategy_key,
    strategy_version,
    operation_intent
  );

DROP INDEX IF EXISTS uniq_trading_signal_calibration;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_trading_signal_calibration
  ON trading_signal_calibration (
    tenant_id,
    instrument_id,
    market_type,
    operation_intent,
    strategy_key,
    strategy_version,
    method
  );
