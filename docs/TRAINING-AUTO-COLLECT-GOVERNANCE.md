# Governança de Auto-Collect por Namespace

## Objetivo

Padronizar a coleta automática de dados de treinamento com governança por namespace (`namespace_profiles`), consentimento explícito do usuário e pipeline de qualidade/privacidade enterprise.

## Arquitetura de governança

- Cada namespace possui 1 profile em `namespace_profiles` (relação 1:1).
- O profile é criado automaticamente na criação do namespace.
- Existe reconciliação assíncrona contínua para namespace sem profile (`TRAINING_NAMESPACE_PROFILE_RECONCILE_QUEUE`).
- Configuração padrão é SSOT em `system_config` na chave `NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON`.

## Pipeline de candidato de treinamento

- Eligibility Gate
  - Verifica profile ativo, `autoCollectEnabled`, política de consentimento e limites mínimos de conteúdo.
- Privacy/PII
  - Regras de privacidade por namespace (`profile.config.privacy.rules`) com ações `redact`, `quarantine`, `reject`.
  - Mensagens persistidas já redigidas quando privacy está habilitado.
- Quality Scoring
  - Score baseline (`computeQualityScore`) comparado com `profile.config.quality.minScore`.
  - Rejeição automática por qualidade apenas quando `autoRejectBelowMin=true`.
- Dedupe
  - `semhash` + dedupe por embedding.
  - Escopo configurável por profile: `tenant` ou `namespace`.
  - Threshold de similaridade configurável por profile.
- Policy Gate assíncrono
  - Worker dedicado (`TRAINING_DATA_POLICY_GATE_QUEUE`).
  - LLM Judge opcional (`profile.config.quality.llmJudge.enabled`) com prompt no `system_config`.
- Quarentena/Human review
  - Itens com baixa confiança, profile ausente, ou match de regra de privacidade ficam em revisão humana.

## Consentimento e opt-out

- Preferências do usuário em `users.preferencias.training`:
  - `allowTrainingUsage`
  - `allowAutoCollect`
- Para `source=chat-auto` e `sourceType=chat`, quando o profile exige consentimento:
  - Se qualquer flag for `false`, o item é rejeitado por política (`user_opt_out`).

## Sampling, caps e anti-poluição

- Sampling determinístico (sem variação aleatória entre retries):
  - `profile.config.autoCollect.sampling.enabled`
  - `profile.config.autoCollect.sampling.rate`
  - `deterministicKey` (`semhash`, `conversationId`, `messagePairHash`)
- Caps diários:
  - `dailyTenantCap`
  - `dailyNamespaceCap`
  - `dailyUserCap`
- Controle via Redis com chaves diárias por escopo.

## Observabilidade

- `alice_training_auto_collect_attempt_total{reason}` no `chat-service`.
- Métricas de `training-service` para:
  - redações de privacidade
  - quarentena por privacidade
  - rejeição por consentimento
- Lineage events:
  - `training_data.collected`
  - `training_data.rejected_policy`
  - `training_data.quarantined_policy`
  - `training_data.judged`

## Operação e troubleshooting

- Se profile estiver ausente:
  - item entra em modo restritivo (quarentena/revisão),
  - worker de reconcile é enfileirado automaticamente.
- Se `NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON` estiver inválido:
  - comportamento fail-fast para evitar ingestão fora de política.
- Se Redis indisponível em auto-collect:
  - decisão de coleta é negada (sem fallback inseguro).

## Checklist de segurança

- Sem hardcode de thresholds/rules em runtime.
- Sem log de conteúdo sensível nas etapas de policy.
- Isolamento por tenant em todas as consultas críticas.
- Processamento pesado sempre assíncrono com filas e idempotência.

## Atualização 02/03/2026

- Remoção final da lógica legada no `chat-service` para SLA/history/routing por perfil hardcoded.
- Fluxos `sync`, `stream`, `websocket`, `websocket-media` e `external-channel` passaram a usar knobs de `namespace_profiles.config` em runtime.
- Threshold de roteamento, orçamento de prompt, prioridade GPU, limites de memória e histórico agora são governados por namespace profile.
- Fallback seguro mantido somente quando o namespace não está disponível, sem bypass de política.

---

**Autor:** Fillipe Guerra  
**Data:** 02 de Março de 2026
