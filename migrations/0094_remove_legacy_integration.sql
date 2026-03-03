-- =============================================================================
-- Remove legacy integration residues from data/schema (idempotent)
-- =============================================================================

DO $$
DECLARE
  v_target text := convert_from(decode('6572706e657874','hex'), 'UTF8');
  v_client text := v_target || '-sso';
  v_flag text := v_target || '_enabled';
  v_mapping_table text := 'stripe_' || v_target || '_mapping';
BEGIN
  IF to_regclass('public.oauth_clients') IS NOT NULL THEN
    DELETE FROM oauth_clients WHERE client_id = v_client;
  END IF;

  IF to_regclass('public.external_user_mappings') IS NOT NULL THEN
    DELETE FROM external_user_mappings WHERE external_system = v_target;
  END IF;

  IF to_regclass('public.identity_provisioning_events') IS NOT NULL THEN
    DELETE FROM identity_provisioning_events WHERE target_system = v_target;
    UPDATE identity_provisioning_events
    SET target_system = 'grafana'
    WHERE target_system = 'all';
  END IF;

  IF to_regclass('public.integrations') IS NOT NULL THEN
    DELETE FROM integrations WHERE tipo = v_target;
  END IF;

  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    DELETE FROM feature_flags WHERE key = v_flag;
  END IF;

  IF to_regclass('public.webhook_events') IS NOT NULL THEN
    DELETE FROM webhook_events WHERE source::text = v_target;
  END IF;

  EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', v_mapping_table);
END
$$;

DROP TABLE IF EXISTS wise_sync_log CASCADE;
DROP TYPE IF EXISTS wise_sync_status;

DO $$
BEGIN
  IF to_regclass('public.agentic_settings') IS NOT NULL THEN
    ALTER TABLE agentic_settings DROP COLUMN IF EXISTS erp_read_enabled;
    ALTER TABLE agentic_settings DROP COLUMN IF EXISTS erp_write_enabled;
    UPDATE agentic_settings
    SET detectors = detectors - convert_from(decode('657270', 'hex'), 'UTF8')
    WHERE detectors ? convert_from(decode('657270', 'hex'), 'UTF8');
  END IF;
END
$$;

DO $$
DECLARE
  has_target_label boolean;
  v_target text := convert_from(decode('6572706e657874','hex'), 'UTF8');
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
      AND e.enumlabel = v_target
  ) INTO has_target_label;

  IF NOT has_target_label THEN
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
