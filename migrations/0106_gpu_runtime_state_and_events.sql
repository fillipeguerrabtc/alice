-- 0106_gpu_runtime_state_and_events.sql
-- Objetivo: persistência durável do estado de runtime GPU + trilha auditável de eventos.

DO $$
BEGIN
  CREATE TYPE gpu_runtime_mode AS ENUM (
    'serving',
    'training',
    'switching_to_training',
    'switching_to_serving'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
  CREATE TYPE gpu_orchestrator_state AS ENUM (
    'llm_embeddings',
    'training',
    'switching_to_training',
    'switching_to_llm'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
  CREATE TYPE gpu_orchestration_mode AS ENUM ('simultaneous', 'preemptive');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
  CREATE TYPE gpu_runtime_event_type AS ENUM (
    'state_snapshot',
    'switch_requested',
    'switch_completed',
    'switch_failed',
    'manual_restore_requested',
    'manual_restore_completed',
    'manual_restore_failed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
  CREATE TYPE gpu_runtime_trigger_source AS ENUM ('startup', 'queue_request', 'manual_api', 'system');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
  CREATE TYPE gpu_runtime_event_outcome AS ENUM ('success', 'error');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS gpu_runtime_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_key varchar(64) NOT NULL DEFAULT 'global',
  runtime_mode gpu_runtime_mode NOT NULL DEFAULT 'serving',
  orchestrator_state gpu_orchestrator_state NOT NULL DEFAULT 'llm_embeddings',
  orchestration_mode gpu_orchestration_mode NOT NULL DEFAULT 'simultaneous',
  orchestrator_available boolean NOT NULL DEFAULT false,
  active_services jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_request_id varchar(128),
  last_reason varchar(255),
  correlation_id varchar(128),
  updated_by_service varchar(64) NOT NULL DEFAULT 'gpu-manager-service',
  updated_by_user_id uuid REFERENCES users(id),
  updated_by_tenant_id uuid REFERENCES tenants(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE gpu_runtime_state
  DROP CONSTRAINT IF EXISTS chk_gpu_runtime_state_runtime_key_not_blank;

ALTER TABLE gpu_runtime_state
  ADD CONSTRAINT chk_gpu_runtime_state_runtime_key_not_blank
  CHECK (btrim(runtime_key) <> '');

ALTER TABLE gpu_runtime_state
  DROP CONSTRAINT IF EXISTS chk_gpu_runtime_state_active_services_array;

ALTER TABLE gpu_runtime_state
  ADD CONSTRAINT chk_gpu_runtime_state_active_services_array
  CHECK (jsonb_typeof(active_services) = 'array');

ALTER TABLE gpu_runtime_state
  DROP CONSTRAINT IF EXISTS chk_gpu_runtime_state_metadata_object;

ALTER TABLE gpu_runtime_state
  ADD CONSTRAINT chk_gpu_runtime_state_metadata_object
  CHECK (jsonb_typeof(metadata) = 'object');

CREATE UNIQUE INDEX IF NOT EXISTS uq_gpu_runtime_state_runtime_key
  ON gpu_runtime_state (runtime_key);

CREATE INDEX IF NOT EXISTS idx_gpu_runtime_state_mode
  ON gpu_runtime_state (runtime_mode);

CREATE INDEX IF NOT EXISTS idx_gpu_runtime_state_orchestrator_state
  ON gpu_runtime_state (orchestrator_state);

CREATE INDEX IF NOT EXISTS idx_gpu_runtime_state_updated_at
  ON gpu_runtime_state (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_gpu_runtime_state_updated_by_tenant
  ON gpu_runtime_state (updated_by_tenant_id);

CREATE TABLE IF NOT EXISTS gpu_runtime_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_state_id uuid NOT NULL REFERENCES gpu_runtime_state(id) ON DELETE CASCADE,
  event_type gpu_runtime_event_type NOT NULL,
  trigger_source gpu_runtime_trigger_source NOT NULL DEFAULT 'system',
  outcome gpu_runtime_event_outcome NOT NULL DEFAULT 'success',
  from_mode gpu_runtime_mode,
  to_mode gpu_runtime_mode,
  from_orchestrator_state gpu_orchestrator_state,
  to_orchestrator_state gpu_orchestrator_state,
  request_id varchar(128),
  correlation_id varchar(128),
  reason varchar(255),
  source_service varchar(64) NOT NULL DEFAULT 'gpu-manager-service',
  actor_user_id uuid REFERENCES users(id),
  actor_tenant_id uuid REFERENCES tenants(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE gpu_runtime_events
  DROP CONSTRAINT IF EXISTS chk_gpu_runtime_events_source_service_not_blank;

ALTER TABLE gpu_runtime_events
  ADD CONSTRAINT chk_gpu_runtime_events_source_service_not_blank
  CHECK (btrim(source_service) <> '');

ALTER TABLE gpu_runtime_events
  DROP CONSTRAINT IF EXISTS chk_gpu_runtime_events_metadata_object;

ALTER TABLE gpu_runtime_events
  ADD CONSTRAINT chk_gpu_runtime_events_metadata_object
  CHECK (jsonb_typeof(metadata) = 'object');

CREATE INDEX IF NOT EXISTS idx_gpu_runtime_events_state_created
  ON gpu_runtime_events (runtime_state_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gpu_runtime_events_type_created
  ON gpu_runtime_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gpu_runtime_events_outcome_created
  ON gpu_runtime_events (outcome, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gpu_runtime_events_request_id
  ON gpu_runtime_events (request_id);

CREATE INDEX IF NOT EXISTS idx_gpu_runtime_events_correlation_id
  ON gpu_runtime_events (correlation_id);

CREATE INDEX IF NOT EXISTS idx_gpu_runtime_events_actor_tenant
  ON gpu_runtime_events (actor_tenant_id);

CREATE INDEX IF NOT EXISTS idx_gpu_runtime_events_failed_only
  ON gpu_runtime_events (created_at DESC)
  WHERE outcome = 'error';
