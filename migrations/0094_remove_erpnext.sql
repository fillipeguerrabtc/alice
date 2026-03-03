-- =============================================================================
-- Remove ERPNext residues from data/schema (idempotent)
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.oauth_clients') IS NOT NULL THEN
    DELETE FROM oauth_clients WHERE client_id = 'erpnext-sso';
  END IF;

  IF to_regclass('public.external_user_mappings') IS NOT NULL THEN
    DELETE FROM external_user_mappings WHERE external_system = 'erpnext';
  END IF;

  IF to_regclass('public.identity_provisioning_events') IS NOT NULL THEN
    DELETE FROM identity_provisioning_events WHERE target_system = 'erpnext';
    UPDATE identity_provisioning_events
    SET target_system = 'grafana'
    WHERE target_system = 'all';
  END IF;

  IF to_regclass('public.integrations') IS NOT NULL THEN
    DELETE FROM integrations WHERE tipo = 'erpnext';
  END IF;

  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    DELETE FROM feature_flags WHERE key = 'erpnext_enabled';
  END IF;

  IF to_regclass('public.webhook_events') IS NOT NULL THEN
    DELETE FROM webhook_events WHERE source::text = 'erpnext';
  END IF;
END
$$;

DROP TABLE IF EXISTS wise_sync_log CASCADE;
DROP TYPE IF EXISTS wise_sync_status;
DROP TABLE IF EXISTS stripe_erpnext_mapping CASCADE;

DO $$
BEGIN
  IF to_regclass('public.agentic_settings') IS NOT NULL THEN
    ALTER TABLE agentic_settings DROP COLUMN IF EXISTS erp_read_enabled;
    ALTER TABLE agentic_settings DROP COLUMN IF EXISTS erp_write_enabled;
    UPDATE agentic_settings
    SET detectors = detectors - 'erp'
    WHERE detectors ? 'erp';
  END IF;
END
$$;

DO $$
DECLARE
  has_erpnext_label boolean;
BEGIN
  IF to_regtype('public.webhook_source') IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'webhook_source'
      AND e.enumlabel = 'erpnext'
  ) INTO has_erpnext_label;

  IF NOT has_erpnext_label THEN
    RETURN;
  END IF;

  CREATE TYPE webhook_source_new AS ENUM ('stripe', 'wise', 'twilio');

  IF to_regclass('public.webhook_events') IS NOT NULL THEN
    ALTER TABLE webhook_events
      ALTER COLUMN source TYPE webhook_source_new
      USING (source::text::webhook_source_new);
  END IF;

  DROP TYPE webhook_source;
  ALTER TYPE webhook_source_new RENAME TO webhook_source;
END
$$;
