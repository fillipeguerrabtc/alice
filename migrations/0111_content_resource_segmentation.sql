-- 0111_content_resource_segmentation.sql
-- Objetivo: estabelecer ownership/grants/visibilidade por recurso.
--
-- Author: Fillipe Guerra
-- Data: 20 de Marco de 2026

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_scope_type') THEN
    CREATE TYPE resource_scope_type AS ENUM ('user', 'group', 'tenant', 'system');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_visibility') THEN
    CREATE TYPE resource_visibility AS ENUM ('private', 'shared', 'tenant', 'public');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_sensitivity_label') THEN
    CREATE TYPE resource_sensitivity_label AS ENUM ('standard', 'confidential', 'restricted');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_access_subject_type') THEN
    CREATE TYPE resource_access_subject_type AS ENUM ('user', 'group', 'role', 'tenant');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_access_resource_type') THEN
    CREATE TYPE resource_access_resource_type AS ENUM (
      'conversation',
      'message',
      'document',
      'document_chunk',
      'namespace',
      'agent',
      'media_upload',
      'generated_image',
      'training_data',
      'tool_policy',
      'prompt_template',
      'llm_execution_audit'
    );
  END IF;
END
$$;

ALTER TABLE namespaces
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_group_id uuid REFERENCES user_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_type resource_scope_type NOT NULL DEFAULT 'tenant',
  ADD COLUMN IF NOT EXISTS visibility resource_visibility NOT NULL DEFAULT 'tenant',
  ADD COLUMN IF NOT EXISTS sensitivity_label resource_sensitivity_label NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_group_id uuid REFERENCES user_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_type resource_scope_type NOT NULL DEFAULT 'tenant',
  ADD COLUMN IF NOT EXISTS visibility resource_visibility NOT NULL DEFAULT 'tenant',
  ADD COLUMN IF NOT EXISTS sensitivity_label resource_sensitivity_label NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_group_id uuid REFERENCES user_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_type resource_scope_type NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS visibility resource_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS sensitivity_label resource_sensitivity_label NOT NULL DEFAULT 'confidential',
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_group_id uuid REFERENCES user_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_type resource_scope_type NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS visibility resource_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS sensitivity_label resource_sensitivity_label NOT NULL DEFAULT 'confidential',
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_group_id uuid REFERENCES user_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_type resource_scope_type NOT NULL DEFAULT 'tenant',
  ADD COLUMN IF NOT EXISTS visibility resource_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS sensitivity_label resource_sensitivity_label NOT NULL DEFAULT 'confidential',
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_group_id uuid REFERENCES user_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_type resource_scope_type NOT NULL DEFAULT 'tenant',
  ADD COLUMN IF NOT EXISTS visibility resource_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS sensitivity_label resource_sensitivity_label NOT NULL DEFAULT 'confidential';

ALTER TABLE training_data
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_group_id uuid REFERENCES user_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_type resource_scope_type NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS visibility resource_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS sensitivity_label resource_sensitivity_label NOT NULL DEFAULT 'confidential',
  ADD COLUMN IF NOT EXISTS access_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE tool_policies
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_group_id uuid REFERENCES user_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_type resource_scope_type NOT NULL DEFAULT 'tenant',
  ADD COLUMN IF NOT EXISTS visibility resource_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS sensitivity_label resource_sensitivity_label NOT NULL DEFAULT 'restricted';

ALTER TABLE prompt_templates
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_group_id uuid REFERENCES user_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_type resource_scope_type NOT NULL DEFAULT 'tenant',
  ADD COLUMN IF NOT EXISTS visibility resource_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS sensitivity_label resource_sensitivity_label NOT NULL DEFAULT 'restricted';

ALTER TABLE llm_execution_audit
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_group_id uuid REFERENCES user_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_type resource_scope_type NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS visibility resource_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS sensitivity_label resource_sensitivity_label NOT NULL DEFAULT 'restricted';

ALTER TABLE generated_images
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_group_id uuid REFERENCES user_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_type resource_scope_type NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS visibility resource_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS sensitivity_label resource_sensitivity_label NOT NULL DEFAULT 'confidential';

ALTER TABLE media_uploads
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_group_id uuid REFERENCES user_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_type resource_scope_type NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS visibility resource_visibility NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS sensitivity_label resource_sensitivity_label NOT NULL DEFAULT 'confidential';

UPDATE namespaces
SET created_by_user_id = COALESCE(created_by_user_id, owner_user_id),
    updated_by_user_id = COALESCE(updated_by_user_id, owner_user_id)
WHERE created_by_user_id IS NULL OR updated_by_user_id IS NULL;

UPDATE agents
SET created_by_user_id = COALESCE(created_by_user_id, owner_user_id),
    updated_by_user_id = COALESCE(updated_by_user_id, owner_user_id)
WHERE created_by_user_id IS NULL OR updated_by_user_id IS NULL;

UPDATE conversations
SET owner_user_id = COALESCE(owner_user_id, user_id),
    created_by_user_id = COALESCE(created_by_user_id, user_id),
    updated_by_user_id = COALESCE(updated_by_user_id, user_id)
WHERE owner_user_id IS NULL
   OR created_by_user_id IS NULL
   OR updated_by_user_id IS NULL;

UPDATE messages m
SET tenant_id = COALESCE(m.tenant_id, c.tenant_id),
    owner_user_id = COALESCE(m.owner_user_id, m.user_id, c.owner_user_id, c.user_id),
    owner_group_id = COALESCE(m.owner_group_id, c.owner_group_id),
    visibility = COALESCE(m.visibility, c.visibility),
    sensitivity_label = COALESCE(m.sensitivity_label, c.sensitivity_label),
    created_by_user_id = COALESCE(m.created_by_user_id, m.user_id, c.created_by_user_id, c.user_id)
FROM conversations c
WHERE c.id = m.conversation_id
  AND (
    m.tenant_id IS NULL
    OR m.owner_user_id IS NULL
    OR m.owner_group_id IS NULL
    OR m.created_by_user_id IS NULL
  );

UPDATE documents d
SET tenant_id = COALESCE(d.tenant_id, n.tenant_id),
    owner_user_id = COALESCE(
      d.owner_user_id,
      d.created_by_user_id,
      NULLIF(d.metadata->>'uploadedByUserId', '')::uuid
    ),
    updated_by_user_id = COALESCE(d.updated_by_user_id, d.created_by_user_id),
    visibility = CASE
      WHEN d.owner_user_id IS NOT NULL OR d.created_by_user_id IS NOT NULL OR d.metadata ? 'uploadedByUserId' THEN 'private'::resource_visibility
      ELSE 'tenant'::resource_visibility
    END
FROM namespaces n
WHERE n.id = d.namespace_id
  AND (
    d.tenant_id IS NULL
    OR d.owner_user_id IS NULL
    OR d.updated_by_user_id IS NULL
  );

UPDATE document_chunks dc
SET tenant_id = COALESCE(dc.tenant_id, d.tenant_id),
    owner_user_id = COALESCE(dc.owner_user_id, d.owner_user_id),
    owner_group_id = COALESCE(dc.owner_group_id, d.owner_group_id),
    visibility = COALESCE(dc.visibility, d.visibility),
    sensitivity_label = COALESCE(dc.sensitivity_label, d.sensitivity_label)
FROM documents d
WHERE d.id = dc.document_id
  AND (
    dc.tenant_id IS NULL
    OR dc.owner_user_id IS NULL
    OR dc.owner_group_id IS NULL
  );

UPDATE training_data
SET owner_user_id = COALESCE(owner_user_id, created_by),
    visibility = CASE
      WHEN owner_user_id IS NOT NULL OR created_by IS NOT NULL THEN 'private'::resource_visibility
      ELSE visibility
    END,
    access_snapshot = jsonb_strip_nulls(
      access_snapshot
      || jsonb_build_object(
        'ownerUserId', COALESCE(owner_user_id, created_by),
        'ownerGroupId', owner_group_id,
        'visibility', visibility,
        'scopeType', scope_type
      )
    )
WHERE owner_user_id IS NULL OR access_snapshot = '{}'::jsonb;

UPDATE tool_policies
SET owner_user_id = COALESCE(owner_user_id, created_by, approved_by),
    visibility = CASE WHEN COALESCE(owner_user_id, created_by, approved_by) IS NULL THEN 'tenant'::resource_visibility ELSE visibility END
WHERE owner_user_id IS NULL;

UPDATE prompt_templates
SET owner_user_id = COALESCE(owner_user_id, created_by, approved_by, evaluated_by),
    visibility = CASE WHEN COALESCE(owner_user_id, created_by, approved_by, evaluated_by) IS NULL THEN 'tenant'::resource_visibility ELSE visibility END
WHERE owner_user_id IS NULL;

UPDATE llm_execution_audit
SET owner_user_id = COALESCE(owner_user_id, user_id)
WHERE owner_user_id IS NULL;

UPDATE generated_images
SET owner_user_id = COALESCE(owner_user_id, created_by),
    visibility = CASE WHEN COALESCE(owner_user_id, created_by) IS NULL THEN 'tenant'::resource_visibility ELSE visibility END
WHERE owner_user_id IS NULL;

UPDATE media_uploads
SET owner_user_id = COALESCE(owner_user_id, user_id),
    visibility = CASE WHEN COALESCE(owner_user_id, user_id) IS NULL THEN 'tenant'::resource_visibility ELSE visibility END
WHERE owner_user_id IS NULL;

CREATE TABLE IF NOT EXISTS resource_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource_type resource_access_resource_type NOT NULL,
  resource_id uuid NOT NULL,
  subject_type resource_access_subject_type NOT NULL,
  subject_id varchar(255) NOT NULL,
  permissions text[] NOT NULL DEFAULT ARRAY['read']::text[],
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp NULL,
  revoked_at timestamp NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_resource_access_grants_tenant
  ON resource_access_grants (tenant_id);
CREATE INDEX IF NOT EXISTS idx_resource_access_grants_resource
  ON resource_access_grants (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_resource_access_grants_subject
  ON resource_access_grants (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_resource_access_grants_active
  ON resource_access_grants (tenant_id, revoked_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_namespaces_owner_user ON namespaces (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_agents_owner_user ON agents (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_owner_user ON conversations (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_visibility ON messages (tenant_id, visibility);
CREATE INDEX IF NOT EXISTS idx_messages_owner_user ON messages (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_documents_tenant_visibility ON documents (tenant_id, visibility);
CREATE INDEX IF NOT EXISTS idx_documents_owner_user ON documents (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_tenant ON document_chunks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_training_data_owner_user ON training_data (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_media_uploads_owner_user ON media_uploads (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_generated_images_owner_user ON generated_images (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_owner_user ON prompt_templates (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_tool_policies_owner_user ON tool_policies (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_llm_execution_audit_owner_user ON llm_execution_audit (owner_user_id);

CREATE OR REPLACE FUNCTION current_user_id()
RETURNS uuid AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_user_id', true), '')::uuid;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_role_code()
RETURNS text AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_role', true), '');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_custom_role_id()
RETURNS uuid AS $$
BEGIN
  RETURN NULLIF(current_setting('app.current_custom_role_id', true), '')::uuid;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION break_glass_active()
RETURNS boolean AS $$
BEGIN
  RETURN COALESCE(NULLIF(current_setting('app.break_glass_active', true), '')::boolean, false);
EXCEPTION
  WHEN others THEN
    RETURN false;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_role_codes()
RETURNS text[] AS $$
DECLARE
  raw_value text;
  result text[];
BEGIN
  raw_value := COALESCE(NULLIF(current_setting('app.current_role_codes', true), ''), '[]');
  SELECT COALESCE(array_agg(value), ARRAY[]::text[])
    INTO result
  FROM jsonb_array_elements_text(raw_value::jsonb) AS value;
  RETURN COALESCE(result, ARRAY[]::text[]);
EXCEPTION
  WHEN others THEN
    RETURN ARRAY[]::text[];
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_group_ids()
RETURNS uuid[] AS $$
DECLARE
  raw_value text;
  result uuid[];
BEGIN
  raw_value := COALESCE(NULLIF(current_setting('app.current_group_ids', true), ''), '[]');
  SELECT COALESCE(array_agg(value::uuid), ARRAY[]::uuid[])
    INTO result
  FROM jsonb_array_elements_text(raw_value::jsonb) AS value;
  RETURN COALESCE(result, ARRAY[]::uuid[]);
EXCEPTION
  WHEN others THEN
    RETURN ARRAY[]::uuid[];
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION alice_is_resource_owner(
  p_resource_type text,
  p_resource_id uuid,
  p_tenant_id uuid DEFAULT current_tenant_id(),
  p_user_id uuid DEFAULT current_user_id()
)
RETURNS boolean AS $$
BEGIN
  IF p_resource_id IS NULL OR p_user_id IS NULL THEN
    RETURN false;
  END IF;

  CASE p_resource_type
    WHEN 'conversation' THEN
      RETURN EXISTS (
        SELECT 1
        FROM conversations
        WHERE id = p_resource_id
          AND tenant_id = p_tenant_id
          AND COALESCE(owner_user_id, user_id) = p_user_id
      );
    WHEN 'message' THEN
      RETURN EXISTS (
        SELECT 1
        FROM messages
        WHERE id = p_resource_id
          AND tenant_id = p_tenant_id
          AND COALESCE(owner_user_id, user_id) = p_user_id
      );
    WHEN 'document' THEN
      RETURN EXISTS (
        SELECT 1
        FROM documents
        WHERE id = p_resource_id
          AND tenant_id = p_tenant_id
          AND owner_user_id = p_user_id
      );
    WHEN 'document_chunk' THEN
      RETURN EXISTS (
        SELECT 1
        FROM document_chunks
        WHERE id = p_resource_id
          AND tenant_id = p_tenant_id
          AND owner_user_id = p_user_id
      );
    WHEN 'namespace' THEN
      RETURN EXISTS (
        SELECT 1
        FROM namespaces
        WHERE id = p_resource_id
          AND tenant_id = p_tenant_id
          AND owner_user_id = p_user_id
      );
    WHEN 'agent' THEN
      RETURN EXISTS (
        SELECT 1
        FROM agents
        WHERE id = p_resource_id
          AND tenant_id = p_tenant_id
          AND owner_user_id = p_user_id
      );
    WHEN 'media_upload' THEN
      RETURN EXISTS (
        SELECT 1
        FROM media_uploads
        WHERE id = p_resource_id
          AND tenant_id = p_tenant_id
          AND COALESCE(owner_user_id, user_id) = p_user_id
      );
    WHEN 'generated_image' THEN
      RETURN EXISTS (
        SELECT 1
        FROM generated_images
        WHERE id = p_resource_id
          AND tenant_id = p_tenant_id
          AND COALESCE(owner_user_id, created_by) = p_user_id
      );
    WHEN 'training_data' THEN
      RETURN EXISTS (
        SELECT 1
        FROM training_data
        WHERE id = p_resource_id
          AND tenant_id = p_tenant_id
          AND COALESCE(owner_user_id, created_by) = p_user_id
      );
    WHEN 'tool_policy' THEN
      RETURN EXISTS (
        SELECT 1
        FROM tool_policies
        WHERE id = p_resource_id
          AND tenant_id = p_tenant_id
          AND COALESCE(owner_user_id, created_by, approved_by) = p_user_id
      );
    WHEN 'prompt_template' THEN
      RETURN EXISTS (
        SELECT 1
        FROM prompt_templates
        WHERE id = p_resource_id
          AND tenant_id = p_tenant_id
          AND COALESCE(owner_user_id, created_by, approved_by, evaluated_by) = p_user_id
      );
    WHEN 'llm_execution_audit' THEN
      RETURN EXISTS (
        SELECT 1
        FROM llm_execution_audit
        WHERE id = p_resource_id
          AND tenant_id = p_tenant_id
          AND COALESCE(owner_user_id, user_id) = p_user_id
      );
    ELSE
      RETURN false;
  END CASE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION alice_has_resource_grant(
  p_resource_type text,
  p_resource_id uuid,
  p_permission text,
  p_tenant_id uuid DEFAULT current_tenant_id(),
  p_user_id uuid DEFAULT current_user_id()
)
RETURNS boolean AS $$
BEGIN
  IF p_resource_id IS NULL OR p_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM resource_access_grants rag
    WHERE rag.tenant_id = p_tenant_id
      AND rag.resource_type::text = p_resource_type
      AND rag.resource_id = p_resource_id
      AND rag.revoked_at IS NULL
      AND (rag.expires_at IS NULL OR rag.expires_at > now())
      AND (
        '*' = ANY(rag.permissions)
        OR 'manage' = ANY(rag.permissions)
        OR p_permission = ANY(rag.permissions)
        OR (p_permission = 'read' AND ('write' = ANY(rag.permissions) OR 'delete' = ANY(rag.permissions)))
      )
      AND (
        (rag.subject_type = 'user' AND rag.subject_id = COALESCE(p_user_id::text, ''))
        OR (rag.subject_type = 'tenant' AND rag.subject_id = p_tenant_id::text)
        OR (rag.subject_type = 'role' AND rag.subject_id = ANY(current_role_codes()))
        OR (rag.subject_type = 'group' AND rag.subject_id = ANY(ARRAY(SELECT gid::text FROM unnest(current_group_ids()) AS gid)))
      )
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION alice_can_access_resource(
  p_resource_type text,
  p_resource_id uuid,
  p_permission text DEFAULT 'read',
  p_tenant_id uuid DEFAULT current_tenant_id()
)
RETURNS boolean AS $$
DECLARE
  v_visibility text;
  v_tenant_id uuid;
BEGIN
  IF p_resource_id IS NULL THEN
    RETURN false;
  END IF;

  IF is_super_admin() AND break_glass_active() THEN
    RETURN true;
  END IF;

  CASE p_resource_type
    WHEN 'conversation' THEN
      SELECT tenant_id, visibility::text INTO v_tenant_id, v_visibility FROM conversations WHERE id = p_resource_id;
    WHEN 'message' THEN
      SELECT tenant_id, visibility::text INTO v_tenant_id, v_visibility FROM messages WHERE id = p_resource_id;
    WHEN 'document' THEN
      SELECT tenant_id, visibility::text INTO v_tenant_id, v_visibility FROM documents WHERE id = p_resource_id;
    WHEN 'document_chunk' THEN
      SELECT tenant_id, visibility::text INTO v_tenant_id, v_visibility FROM document_chunks WHERE id = p_resource_id;
    WHEN 'namespace' THEN
      SELECT tenant_id, visibility::text INTO v_tenant_id, v_visibility FROM namespaces WHERE id = p_resource_id;
    WHEN 'agent' THEN
      SELECT tenant_id, visibility::text INTO v_tenant_id, v_visibility FROM agents WHERE id = p_resource_id;
    WHEN 'media_upload' THEN
      SELECT tenant_id, visibility::text INTO v_tenant_id, v_visibility FROM media_uploads WHERE id = p_resource_id;
    WHEN 'generated_image' THEN
      SELECT tenant_id, visibility::text INTO v_tenant_id, v_visibility FROM generated_images WHERE id = p_resource_id;
    WHEN 'training_data' THEN
      SELECT tenant_id, visibility::text INTO v_tenant_id, v_visibility FROM training_data WHERE id = p_resource_id;
    WHEN 'tool_policy' THEN
      SELECT tenant_id, visibility::text INTO v_tenant_id, v_visibility FROM tool_policies WHERE id = p_resource_id;
    WHEN 'prompt_template' THEN
      SELECT tenant_id, visibility::text INTO v_tenant_id, v_visibility FROM prompt_templates WHERE id = p_resource_id;
    WHEN 'llm_execution_audit' THEN
      SELECT tenant_id, visibility::text INTO v_tenant_id, v_visibility FROM llm_execution_audit WHERE id = p_resource_id;
    ELSE
      RETURN false;
  END CASE;

  IF v_tenant_id IS NULL OR p_tenant_id IS NULL OR v_tenant_id <> p_tenant_id THEN
    RETURN false;
  END IF;

  IF alice_is_resource_owner(p_resource_type, p_resource_id, p_tenant_id, current_user_id()) THEN
    RETURN true;
  END IF;

  IF p_permission = 'read' AND v_visibility IN ('public', 'tenant') THEN
    RETURN true;
  END IF;

  IF alice_has_resource_grant(p_resource_type, p_resource_id, p_permission, p_tenant_id, current_user_id()) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION alice_can_access_scope(
  p_tenant_id uuid,
  p_namespace_id uuid DEFAULT NULL,
  p_agent_id uuid DEFAULT NULL,
  p_permission text DEFAULT 'read'
)
RETURNS boolean AS $$
BEGIN
  IF p_tenant_id IS NULL OR current_tenant_id() IS NULL OR p_tenant_id <> current_tenant_id() THEN
    RETURN false;
  END IF;

  IF p_namespace_id IS NOT NULL AND NOT alice_can_access_resource('namespace', p_namespace_id, p_permission, p_tenant_id) THEN
    RETURN false;
  END IF;

  IF p_agent_id IS NOT NULL AND NOT alice_can_access_resource('agent', p_agent_id, p_permission, p_tenant_id) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

DO $$
DECLARE
  target_table text;
  resource_name text;
BEGIN
  FOR target_table, resource_name IN
    SELECT * FROM (VALUES
      ('conversations', 'conversation'),
      ('messages', 'message'),
      ('documents', 'document'),
      ('document_chunks', 'document_chunk'),
      ('namespaces', 'namespace'),
      ('agents', 'agent'),
      ('media_uploads', 'media_upload'),
      ('generated_images', 'generated_image'),
      ('training_data', 'training_data'),
      ('tool_policies', 'tool_policy'),
      ('prompt_templates', 'prompt_template'),
      ('llm_execution_audit', 'llm_execution_audit')
    ) AS t(target_table, resource_name)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I_select_policy ON %I', target_table || '_resource', target_table);
    EXECUTE format(
      'CREATE POLICY %I_select_policy ON %I FOR SELECT USING (current_tenant_id() IS NULL OR alice_can_access_resource(%L, id, %L, tenant_id))',
      target_table || '_resource',
      target_table,
      resource_name,
      'read'
    );
  END LOOP;
END
$$;

COMMENT ON FUNCTION current_user_id() IS 'Retorna app.current_user_id do contexto transacional da requisição.';
COMMENT ON FUNCTION current_role_code() IS 'Retorna app.current_role do contexto transacional da requisição.';
COMMENT ON FUNCTION current_role_codes() IS 'Retorna role codes efetivos serializados em app.current_role_codes.';
COMMENT ON FUNCTION current_group_ids() IS 'Retorna group IDs efetivos serializados em app.current_group_ids.';
COMMENT ON FUNCTION break_glass_active() IS 'Indica se o modo break-glass foi ativado e propagado para a transação.';
COMMENT ON FUNCTION alice_is_resource_owner(text, uuid, uuid, uuid) IS 'Verifica ownership explícito por recurso e usuário.';
COMMENT ON FUNCTION alice_has_resource_grant(text, uuid, text, uuid, uuid) IS 'Verifica grants explícitos por recurso, sujeito e permissão.';
COMMENT ON FUNCTION alice_can_access_resource(text, uuid, text, uuid) IS 'Combina tenant, ownership, visibilidade e grants para decidir acesso.';
COMMENT ON FUNCTION alice_can_access_scope(uuid, uuid, uuid, text) IS 'Valida acesso de escopo para namespace/agente sob o tenant corrente.';
