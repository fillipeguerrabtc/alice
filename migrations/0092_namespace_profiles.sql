-- Migration: 0092_namespace_profiles
-- Descrição: Governança de auto-collect por namespace (1:1 namespace_profiles)
-- Autor: Fillipe Guerra
-- Data: 02 de Março de 2026

CREATE TABLE IF NOT EXISTS namespace_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  namespace_id UUID NOT NULL REFERENCES namespaces(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  auto_collect_enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_namespace_profiles_tenant_namespace
  ON namespace_profiles (tenant_id, namespace_id);
CREATE INDEX IF NOT EXISTS idx_namespace_profiles_tenant ON namespace_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_namespace_profiles_namespace ON namespace_profiles (namespace_id);
CREATE INDEX IF NOT EXISTS idx_namespace_profiles_auto_collect ON namespace_profiles (auto_collect_enabled);
CREATE INDEX IF NOT EXISTS idx_namespace_profiles_active ON namespace_profiles (is_active);

ALTER TABLE namespace_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS namespace_profiles_tenant_isolation ON namespace_profiles;
CREATE POLICY namespace_profiles_tenant_isolation
  ON namespace_profiles
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

INSERT INTO namespace_profiles (
  tenant_id,
  namespace_id,
  version,
  is_active,
  auto_collect_enabled,
  config
)
SELECT
  n.tenant_id,
  n.id,
  1,
  true,
  true,
  '{}'::jsonb
FROM namespaces n
WHERE n.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, namespace_id) DO NOTHING;

INSERT INTO system_config (key, value, updated_at)
VALUES (
  'NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON',
  $$
  {
    "autoCollect": {
      "enabled": true,
      "requiresUserConsent": true,
      "sampling": {
        "enabled": true,
        "rate": 0.5,
        "deterministicKey": "semhash"
      },
      "caps": {
        "dailyTenantCap": 1000,
        "dailyNamespaceCap": 300,
        "dailyUserCap": 100
      },
      "minChars": {
        "user": 8,
        "assistant": 16
      },
      "alwaysNeedsHumanReview": false,
      "rejectIfDuplicate": false
    },
    "privacy": {
      "enabled": true,
      "rules": [],
      "logRedactionSummary": true
    },
    "quality": {
      "enabled": true,
      "minScore": 0.35,
      "autoRejectBelowMin": true,
      "ruleBased": {
        "enabled": true,
        "weights": {
          "coherence": 0.25,
          "informativeness": 0.35,
          "safety": 0.40
        },
        "requiredPatterns": [],
        "bannedPatterns": []
      },
      "llmJudge": {
        "enabled": false,
        "model": "Qwen/Qwen2.5-7B-Instruct-AWQ",
        "temperature": 0.1,
        "maxTokens": 512,
        "promptSystemConfigKey": "TRAINING_LLM_JUDGE_PROMPT",
        "schemaVersion": "v1"
      }
    },
    "dedupe": {
      "scope": "tenant",
      "similarityThreshold": 0.95
    },
    "history": {
      "relevanceThreshold": 0.12,
      "alwaysIncludeCount": 4,
      "minMessages": 0,
      "fallbackEnabled": false,
      "searchLimit": 200,
      "searchTokenBudget": 1200,
      "searchConversationsLimit": 20
    },
    "sla": {
      "syncSeconds": 18,
      "streamSeconds": 12,
      "websocketSeconds": 12,
      "websocketMediaSeconds": 18,
      "externalSeconds": 20,
      "titleSeconds": 6
    },
    "routing": {
      "threshold": 0.08,
      "gpuPriority": "medium",
      "promptTokenBudget": 2800
    }
  }
  $$,
  NOW()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = NOW();

INSERT INTO system_config (key, value, updated_at)
VALUES (
  'TRAINING_LLM_JUDGE_PROMPT',
  $$
Você é um juiz de qualidade para candidatos de treinamento. Responda SOMENTE JSON válido.
Avalie: relevance, correctnessRisk, piiRisk, realtimeClaimsRisk, formatCompliance, overallScore, recommendedAction, notes.
Campos esperados:
- relevance: número 0..1
- correctnessRisk: número 0..1
- piiRisk: número 0..1
- realtimeClaimsRisk: número 0..1
- formatCompliance: número 0..1
- overallScore: número 0..1
- recommendedAction: "approve" | "pending" | "quarantine" | "reject"
- notes: string curta com justificativa
  $$,
  NOW()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = NOW();
