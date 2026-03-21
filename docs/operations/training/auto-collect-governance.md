# Governanca de Auto-Collect por Namespace

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 21 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Padronizar a coleta automatica de dados de treinamento com isolamento por namespace, consentimento explicito, policy gate e comportamento fail-closed.

## Fonte de verdade

- Cada namespace possui um profile em `namespace_profiles`.
- A configuracao default vem de `system_config.NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON`.
- Reconciliacao automatica usa a fila `alice:training:namespace-profile-reconcile`.
- Policy gate assincro usa a fila `alice:training:data-policy-gate`.

## Defaults canonicos atuais

| Area | Default atual |
| --- | --- |
| Consentimento | `requiresUserConsent=true` |
| Sampling | `enabled=true`, `rate=0.5`, `deterministicKey=semhash` |
| Caps diarios | tenant `1000`, namespace `300`, usuario `100` |
| Conteudo minimo | usuario `8` chars, assistant `16` chars |
| Privacy | `enabled=true`, `logRedactionSummary=true` |
| Qualidade | `enabled=true`, `minScore=0.35`, `autoRejectBelowMin=true` |
| LLM judge | `enabled=false`, modelo `Qwen/Qwen3-8B-AWQ` |
| Dedupe | `scope=tenant`, `similarityThreshold=0.95` |

## Pipeline de governanca

### 1. Eligibility gate

- O profile do namespace precisa existir e estar valido.
- O namespace precisa permitir `autoCollect`.
- O conteudo minimo e as regras basicas do profile precisam ser atendidos.

### 2. Consentimento

- O sistema consulta `users.preferencias.training`.
- `requiresUserConsent=true` significa opt-in explicito para os dois campos.
- A coleta automatica so e permitida quando `allowTrainingUsage=true` e `allowAutoCollect=true`.
- Preferencia ausente, parcial ou com qualquer campo `false` deve bloquear a coleta automatica por politica.
- Nao existe fallback silencioso para tratar ausencia de preferencia como consentimento implicito.

### 3. Privacidade e PII

- Regras de privacidade vivem no profile do namespace.
- As acoes possiveis continuam `redact`, `quarantine` e `reject`.
- Conteudo sensivel nao deve ser logado fora do resumo controlado de redacao.

### 4. Qualidade e dedupe

- O score baseline e comparado com `quality.minScore`.
- Rejeicao automatica so ocorre quando `autoRejectBelowMin=true`.
- Dedupe combina `semhash` e similaridade vetorial no escopo configurado pelo profile.

### 5. Quarentena e revisao humana

- Itens com baixa confianca, profile ausente ou match de regra sensivel ficam em revisao.
- Quando necessario, o sistema agenda reconciliacao do profile antes de permitir liberacao segura.

## Observabilidade

- `alice_training_auto_collect_attempt_total{reason}` no `chat-service`.
- `alice_training_data_last_persisted_at_seconds{source_type="all",source="all"}` no `training-service` e a fonte canonica para saber quando houve persistencia real.
- `alice_training_data_persisted_total{source_type,source,status}` detalha volume real persistido por origem.
- Eventos de lineage: `training_data.collected`, `training_data.rejected_policy`, `training_data.quarantined_policy`, `training_data.judged`.
- As metricas e eventos devem refletir motivo de bloqueio, nao apenas sucesso bruto de ingestao.
- Counters de decisao no `chat-service` podem sofrer reset de processo e nao substituem o sinal duravel vindo do banco.

## Postura fail-closed

- `NAMESPACE_PROFILE_DEFAULT_CONFIG_JSON` invalido deve falhar rapido.
- Redis indisponivel no auto-collect bloqueia a decisao automatica.
- Ausencia de profile nao pode abrir excecao insegura para ingestao.
- Ausencia de consentimento explicito deve manter o gate fechado.

## Relacao com os demais docs

- Panorama geral do treinamento: [overview.md](overview.md)
- Modelo de aprendizado e dataset: [learning-system.md](learning-system.md)
- Limites e thresholds editaveis: [reference-limits.md](reference-limits.md)
