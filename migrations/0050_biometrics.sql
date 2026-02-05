-- ============================================================================
-- MIGRAÇÃO: Biometria Facial (CPU-only, sem liveness)
-- Descrição: Tabelas para perfis biométricos, embeddings e verificações.
-- Regra 6: Persistência real em PostgreSQL (sem mocks)
--
-- Autor: Fillipe Guerra
-- Data: 03 de Fevereiro de 2026
-- Versão: 1.0
-- ============================================================================

-- ============================================================================
-- 1) ENUMS (idempotente)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'biometrics_profile_status') THEN
    CREATE TYPE biometrics_profile_status AS ENUM ('active', 'disabled');
    RAISE NOTICE 'Enum biometrics_profile_status criado';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'biometrics_verification_status') THEN
    CREATE TYPE biometrics_verification_status AS ENUM ('success', 'failed');
    RAISE NOTICE 'Enum biometrics_verification_status criado';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'biometrics_action_type') THEN
    CREATE TYPE biometrics_action_type AS ENUM ('login', 'approval', 'enroll');
    RAISE NOTICE 'Enum biometrics_action_type criado';
  END IF;
END$$;

-- ============================================================================
-- 2) TABELA biometric_profiles
-- ============================================================================
CREATE TABLE IF NOT EXISTS biometric_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  status biometrics_profile_status NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tenant_id, user_id)
);

-- ============================================================================
-- 3) TABELA biometric_embeddings
-- ============================================================================
CREATE TABLE IF NOT EXISTS biometric_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES biometric_profiles(id) ON DELETE CASCADE,
  embedding vector(128) NOT NULL,
  embedding_encrypted BYTEA NOT NULL,
  embedding_hash VARCHAR(64) NOT NULL,
  model VARCHAR(128) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 4) TABELA biometric_verifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS biometric_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES biometric_profiles(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  action_type biometrics_action_type NOT NULL,
  status biometrics_verification_status NOT NULL,
  score REAL NULL,
  threshold REAL NULL,
  ip TEXT NULL,
  user_agent TEXT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  failure_reason TEXT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- 5) INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_biometrics_profiles_tenant ON biometric_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_biometrics_profiles_user ON biometric_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_biometrics_embeddings_profile ON biometric_embeddings (profile_id, is_active);
CREATE INDEX IF NOT EXISTS idx_biometrics_verifications_tenant ON biometric_verifications (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_biometrics_verifications_user ON biometric_verifications (user_id, created_at);

-- ============================================================================
-- 6) RLS
-- ============================================================================
ALTER TABLE biometric_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS biometric_profiles_tenant_isolation ON biometric_profiles;
CREATE POLICY biometric_profiles_tenant_isolation ON biometric_profiles
  FOR ALL
  USING (is_super_admin() OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = current_tenant_id());

DROP POLICY IF EXISTS biometric_embeddings_tenant_isolation ON biometric_embeddings;
CREATE POLICY biometric_embeddings_tenant_isolation ON biometric_embeddings
  FOR ALL
  USING (
    is_super_admin()
    OR profile_id IN (SELECT id FROM biometric_profiles WHERE tenant_id = current_tenant_id())
  )
  WITH CHECK (
    is_super_admin()
    OR profile_id IN (SELECT id FROM biometric_profiles WHERE tenant_id = current_tenant_id())
  );

DROP POLICY IF EXISTS biometric_verifications_tenant_isolation ON biometric_verifications;
CREATE POLICY biometric_verifications_tenant_isolation ON biometric_verifications
  FOR ALL
  USING (is_super_admin() OR tenant_id = current_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = current_tenant_id());

-- ============================================================================
-- Documento em Português Brasileiro
-- Autor: Fillipe Guerra
-- Data: 03 de Fevereiro de 2026
-- Versão: 1.0
-- ============================================================================
