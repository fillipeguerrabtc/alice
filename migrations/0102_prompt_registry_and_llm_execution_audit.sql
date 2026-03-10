-- 0102_prompt_registry_and_llm_execution_audit.sql
-- Objetivo: adicionar governança de prompts/versionamento e trilha auditável de execuções LLM

DO $$
BEGIN
  CREATE TYPE prompt_template_status AS ENUM ('draft', 'active', 'deprecated', 'archived');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  namespace_id uuid REFERENCES namespaces(id),
  agent_id uuid REFERENCES agents(id),
  prompt_key varchar(128) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status prompt_template_status NOT NULL DEFAULT 'draft',
  template text NOT NULL,
  input_schema jsonb DEFAULT '{}'::jsonb,
  output_schema jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamp,
  criado_em timestamp NOT NULL DEFAULT now(),
  atualizado_em timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_tenant
  ON prompt_templates (tenant_id);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_scope
  ON prompt_templates (tenant_id, namespace_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_key
  ON prompt_templates (prompt_key);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_status
  ON prompt_templates (status);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_prompt_templates_scope_key_version
  ON prompt_templates (
    tenant_id,
    COALESCE(namespace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    prompt_key,
    version
  );

CREATE TABLE IF NOT EXISTS llm_execution_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid REFERENCES users(id),
  namespace_id uuid REFERENCES namespaces(id),
  agent_id uuid REFERENCES agents(id),
  conversation_id uuid REFERENCES conversations(id),
  message_id uuid REFERENCES messages(id),
  service varchar(100) NOT NULL,
  operation varchar(120) NOT NULL,
  route varchar(255),
  model_name varchar(255),
  model_version_id uuid REFERENCES model_versions(id),
  prompt_template_id uuid REFERENCES prompt_templates(id),
  prompt_version integer,
  adapter_name varchar(255),
  structured_output boolean NOT NULL DEFAULT false,
  tool_policy_key varchar(120),
  request_fingerprint varchar(64),
  latency_ms integer,
  success boolean NOT NULL DEFAULT true,
  error_code varchar(120),
  metadata jsonb DEFAULT '{}'::jsonb,
  criado_em timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_execution_audit_tenant
  ON llm_execution_audit (tenant_id);

CREATE INDEX IF NOT EXISTS idx_llm_execution_audit_created
  ON llm_execution_audit (criado_em);

CREATE INDEX IF NOT EXISTS idx_llm_execution_audit_service
  ON llm_execution_audit (service);

CREATE INDEX IF NOT EXISTS idx_llm_execution_audit_prompt
  ON llm_execution_audit (prompt_template_id);

CREATE INDEX IF NOT EXISTS idx_llm_execution_audit_model
  ON llm_execution_audit (model_version_id);

CREATE INDEX IF NOT EXISTS idx_llm_execution_audit_outcome
  ON llm_execution_audit (success, error_code);
