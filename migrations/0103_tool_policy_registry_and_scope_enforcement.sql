-- 0103_tool_policy_registry_and_scope_enforcement.sql
-- Objetivo: adicionar registry de policy de tools com escopo tenant/namespace/agente.

DO $$
BEGIN
  CREATE TYPE tool_policy_status AS ENUM ('draft', 'active', 'deprecated', 'archived');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS tool_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  namespace_id uuid REFERENCES namespaces(id),
  agent_id uuid REFERENCES agents(id),
  policy_key varchar(120) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status tool_policy_status NOT NULL DEFAULT 'draft',
  allow_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  deny_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  approved_at timestamp,
  criado_em timestamp NOT NULL DEFAULT now(),
  atualizado_em timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tool_policies_tenant
  ON tool_policies (tenant_id);

CREATE INDEX IF NOT EXISTS idx_tool_policies_scope
  ON tool_policies (tenant_id, namespace_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_tool_policies_key
  ON tool_policies (policy_key);

CREATE INDEX IF NOT EXISTS idx_tool_policies_status
  ON tool_policies (status);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tool_policies_scope_key_version
  ON tool_policies (
    tenant_id,
    COALESCE(namespace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(agent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    policy_key,
    version
  );
