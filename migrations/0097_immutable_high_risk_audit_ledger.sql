-- 0097_immutable_high_risk_audit_ledger.sql
-- Objetivo: trilha de auditoria imutavel para eventos de alto risco (hash-chain por stream).

CREATE TABLE IF NOT EXISTS immutable_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  actor_user_id UUID REFERENCES users(id),
  source_service VARCHAR(64) NOT NULL,
  stream VARCHAR(120) NOT NULL,
  stream_key VARCHAR(255) NOT NULL,
  chain_position INTEGER NOT NULL CHECK (chain_position > 0),
  event_type VARCHAR(120) NOT NULL,
  resource_type VARCHAR(120) NOT NULL,
  resource_id VARCHAR(255),
  request_id VARCHAR(128),
  ip_address VARCHAR(45),
  user_agent TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_event_hash VARCHAR(64),
  event_hash VARCHAR(64) NOT NULL,
  hash_algorithm VARCHAR(16) NOT NULL DEFAULT 'sha256',
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_immutable_audit_event_hash_len CHECK (char_length(event_hash) = 64),
  CONSTRAINT chk_immutable_audit_prev_hash_len CHECK (prev_event_hash IS NULL OR char_length(prev_event_hash) = 64)
);

CREATE INDEX IF NOT EXISTS idx_immutable_audit_tenant
  ON immutable_audit_events (tenant_id);

CREATE INDEX IF NOT EXISTS idx_immutable_audit_stream
  ON immutable_audit_events (tenant_id, stream, stream_key, chain_position);

CREATE INDEX IF NOT EXISTS idx_immutable_audit_event_type
  ON immutable_audit_events (tenant_id, event_type);

CREATE INDEX IF NOT EXISTS idx_immutable_audit_created
  ON immutable_audit_events (created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_immutable_audit_stream_chain
  ON immutable_audit_events (tenant_id, stream, stream_key, chain_position);

CREATE UNIQUE INDEX IF NOT EXISTS uq_immutable_audit_event_hash
  ON immutable_audit_events (tenant_id, event_hash);

ALTER TABLE immutable_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS immutable_audit_events_tenant_isolation ON immutable_audit_events;
CREATE POLICY immutable_audit_events_tenant_isolation ON immutable_audit_events
  FOR ALL
  USING (is_super_admin() OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = current_tenant_id());

CREATE OR REPLACE FUNCTION prevent_immutable_audit_events_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'immutable_audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_audit_events_no_update ON immutable_audit_events;
CREATE TRIGGER trg_immutable_audit_events_no_update
  BEFORE UPDATE ON immutable_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_immutable_audit_events_mutation();

DROP TRIGGER IF EXISTS trg_immutable_audit_events_no_delete ON immutable_audit_events;
CREATE TRIGGER trg_immutable_audit_events_no_delete
  BEFORE DELETE ON immutable_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION prevent_immutable_audit_events_mutation();

