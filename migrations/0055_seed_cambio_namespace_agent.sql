-- ============================================================================
-- 0055_seed_cambio_namespace_agent.sql
-- Cria Namespace e Agente Câmbio padrão por tenant (Wise)
-- Autor: Fillipe Guerra
-- Data: 05 de Fevereiro de 2026
-- ============================================================================

BEGIN;

INSERT INTO namespaces (
  id,
  tenant_id,
  nome,
  slug,
  descricao,
  icone,
  cor,
  contexto_sistema,
  configuracoes,
  ordem,
  ativo,
  criado_em,
  atualizado_em
)
SELECT
  gen_random_uuid(),
  t.id,
  'Câmbio',
  'cambio',
  'Operações de câmbio e conversão de moedas via Wise',
  'ArrowLeftRight',
  '#2563eb',
  'Você é o namespace responsável por operações de câmbio. Responda com precisão, valide moedas e valores, e priorize segurança e conformidade.',
  '{}'::jsonb,
  50,
  true,
  now(),
  now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM namespaces n
  WHERE n.tenant_id = t.id
    AND n.slug = 'cambio'
);

INSERT INTO agents (
  id,
  tenant_id,
  namespace_id,
  nome,
  slug,
  descricao,
  personalidade,
  instrucoes,
  capacidades,
  modelo_base,
  temperatura_modelo,
  max_tokens,
  status,
  versao,
  criado_em,
  atualizado_em
)
SELECT
  gen_random_uuid(),
  t.id,
  n.id,
  'Agente Câmbio',
  'agente-cambio',
  'Especialista em câmbio Wise, cotações e conversões de moedas.',
  'Preciso, objetivo e orientado a conformidade.',
  'Confirme moeda de origem/destino, valide valores e explique taxas e prazos. Para execução, use fluxos Wise com aprovação financeira quando exigido.',
  ARRAY['wise_exchange', 'wise_quotes', 'wise_balances', 'wise_transfers']::text[],
  'Qwen2.5-7B-Instruct-AWQ',
  0.2,
  1200,
  'active',
  1,
  now(),
  now()
FROM tenants t
JOIN namespaces n
  ON n.tenant_id = t.id
  AND n.slug = 'cambio'
WHERE NOT EXISTS (
  SELECT 1
  FROM agents a
  WHERE a.tenant_id = t.id
    AND a.slug = 'agente-cambio'
);

COMMIT;
