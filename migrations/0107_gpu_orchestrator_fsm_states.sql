-- 0107_gpu_orchestrator_fsm_states.sql
-- Objetivo: introduzir estados canônicos da FSM de orquestração GPU e manter compatibilidade legada.

DO $$
BEGIN
  ALTER TYPE gpu_orchestrator_state ADD VALUE IF NOT EXISTS 'serving_ready';
  ALTER TYPE gpu_orchestrator_state ADD VALUE IF NOT EXISTS 'serving_draining';
  ALTER TYPE gpu_orchestrator_state ADD VALUE IF NOT EXISTS 'training_starting';
  ALTER TYPE gpu_orchestrator_state ADD VALUE IF NOT EXISTS 'training_active';
  ALTER TYPE gpu_orchestrator_state ADD VALUE IF NOT EXISTS 'training_finishing';
  ALTER TYPE gpu_orchestrator_state ADD VALUE IF NOT EXISTS 'serving_restoring';
  ALTER TYPE gpu_orchestrator_state ADD VALUE IF NOT EXISTS 'error';
END $$;

ALTER TABLE gpu_runtime_state
  ALTER COLUMN orchestrator_state SET DEFAULT 'serving_ready';

UPDATE gpu_runtime_state
SET orchestrator_state = CASE orchestrator_state
  WHEN 'llm_embeddings' THEN 'serving_ready'::gpu_orchestrator_state
  WHEN 'training' THEN 'training_active'::gpu_orchestrator_state
  WHEN 'switching_to_training' THEN 'training_starting'::gpu_orchestrator_state
  WHEN 'switching_to_llm' THEN 'serving_restoring'::gpu_orchestrator_state
  ELSE orchestrator_state
END
WHERE orchestrator_state IN ('llm_embeddings', 'training', 'switching_to_training', 'switching_to_llm');

UPDATE gpu_runtime_events
SET from_orchestrator_state = CASE from_orchestrator_state
  WHEN 'llm_embeddings' THEN 'serving_ready'::gpu_orchestrator_state
  WHEN 'training' THEN 'training_active'::gpu_orchestrator_state
  WHEN 'switching_to_training' THEN 'training_starting'::gpu_orchestrator_state
  WHEN 'switching_to_llm' THEN 'serving_restoring'::gpu_orchestrator_state
  ELSE from_orchestrator_state
END
WHERE from_orchestrator_state IN ('llm_embeddings', 'training', 'switching_to_training', 'switching_to_llm');

UPDATE gpu_runtime_events
SET to_orchestrator_state = CASE to_orchestrator_state
  WHEN 'llm_embeddings' THEN 'serving_ready'::gpu_orchestrator_state
  WHEN 'training' THEN 'training_active'::gpu_orchestrator_state
  WHEN 'switching_to_training' THEN 'training_starting'::gpu_orchestrator_state
  WHEN 'switching_to_llm' THEN 'serving_restoring'::gpu_orchestrator_state
  ELSE to_orchestrator_state
END
WHERE to_orchestrator_state IN ('llm_embeddings', 'training', 'switching_to_training', 'switching_to_llm');
