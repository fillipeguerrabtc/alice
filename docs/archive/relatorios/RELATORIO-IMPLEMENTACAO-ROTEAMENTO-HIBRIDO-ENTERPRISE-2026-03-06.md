# Relatório de Implementação - Roteamento Híbrido Enterprise (Semântico + Thresholds + Revisão Humana)

**Autor:** Fillipe Guerra  
**Data:** 06 de Março de 2026

## Objetivo
Implementar o modelo híbrido enterprise de roteamento para Namespaces, combinando roteamento semântico, thresholds configuráveis e revisão humana governada, com conhecimento transversal no namespace `default` e exceções explícitas por domínio.

## Escopo Implementado

### 1) Contrato compartilhado e governança de configuração
- Novo schema compartilhado para política híbrida:
  - `HybridRoutingPolicySchema`
  - `HybridRoutingExceptionSchema`
  - tipo `HybridRoutingPolicy`
- `TenantConfiguracoesSchema` agora aceita `hybridRouting` para override por tenant.
- Novo `system_config`:
  - chave `HYBRID_ROUTING_DEFAULT_POLICY_JSON`
  - fallback de ambiente controlado no backend.
- Nova migration:
  - `0099_hybrid_routing_policy.sql` com seed inicial da política padrão.

### 2) Chat Service - motor híbrido de decisão
- Leitura e merge de política:
  - default global (`system_config`) + override do tenant.
- Novos endpoints de governança:
  - `GET /api/llm/hybrid-routing-policy`
  - `PATCH /api/llm/hybrid-routing-policy`
  - `GET /api/llm/hybrid-review-queue`
- Expansão de motivos de fallback para revisão:
  - `low_confidence_semantic_routing`
  - `high_risk_route`
  - `exception_require_human_review`
- Regras híbridas aplicadas no roteamento:
  - decisão por confiança (auto-accept x revisão humana),
  - exceções por rota/contexto/padrão,
  - `force_namespace`,
  - `require_human_review`,
  - `bypass_transversal_default`.
- Conhecimento transversal:
  - gate de greetings/reuse direcionado para `default` por política,
  - bypass explícito quando exceção de domínio exigir.
- Auditoria operacional:
  - eventos de revisão humana persistidos em `llm_fallback_logs`.

### 3) Frontend Namespaces - operação e governança
- UI para visualizar e editar política híbrida (JSON) com persistência via API.
- Enriquecimento dos clusters de fallback com:
  - `confidence`,
  - recomendação (`auto_tag_candidate` vs `human_review`),
  - thresholds efetivos.
- Mapeamento de novos motivos de fallback na interface.

### 4) Internacionalização
- Novas chaves i18n adicionadas em:
  - `pt-BR.json`
  - `en.json`
- Cobertura de labels/mensagens de política híbrida e recomendações de revisão.

## Arquivos Alterados
- `packages/shared/src/schema.ts`
- `packages/database/src/system-config.ts`
- `migrations/0099_hybrid_routing_policy.sql`
- `apps/chat-service/src/index.ts`
- `apps/chat-service/src/response-cache.ts`
- `apps/frontend-service/src/pages/Namespaces.tsx`
- `apps/frontend-service/src/locales/pt-BR.json`
- `apps/frontend-service/src/locales/en.json`

## Validações Executadas (sequenciais, sem paralelismo)
1. `pnpm --filter @alice/shared typecheck` ✅
2. `pnpm --filter @alice/database typecheck` ✅
3. `pnpm --filter @alice/chat-service typecheck` ✅
4. `pnpm --filter @alice/frontend-service typecheck` ✅
5. `pnpm test` ✅ (116 arquivos, 1328 testes)
6. `pnpm --filter @alice/shared lint` ✅
7. `pnpm --filter @alice/database lint` ✅
8. `pnpm --filter @alice/chat-service lint` ✅
9. `pnpm --filter @alice/frontend-service lint` ✅
10. `pnpm --filter @alice/shared build` ✅
11. `pnpm --filter @alice/database build` ✅
12. `pnpm --filter @alice/chat-service build` ✅
13. `pnpm --filter @alice/frontend-service build` ✅

## Resultado
O roteamento passou a operar em modelo híbrido enterprise com governança explícita por política, thresholds auditáveis e trilha de revisão humana. O namespace `default` foi formalizado como conhecimento transversal com exceções configuráveis por domínio, mantendo segregação por namespace quando necessário.
