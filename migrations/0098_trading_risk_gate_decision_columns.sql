-- 0098_trading_risk_gate_decision_columns.sql
-- TRD-003: Persistir decisao do risk gate para ordens de trading real.

ALTER TABLE IF EXISTS trading_orders
  ADD COLUMN IF NOT EXISTS risk_gate_decision varchar(16) NOT NULL DEFAULT 'allow';

ALTER TABLE IF EXISTS trading_orders
  ADD COLUMN IF NOT EXISTS risk_gate_reason text;

CREATE INDEX IF NOT EXISTS idx_trading_orders_risk_gate_decision
  ON trading_orders (risk_gate_decision);

COMMENT ON COLUMN trading_orders.risk_gate_decision IS
  'Decisao do risk gate para a ordem (allow/block).';

COMMENT ON COLUMN trading_orders.risk_gate_reason IS
  'Motivo textual do bloqueio/aprovacao do risk gate.';
