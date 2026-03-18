# Relatorio de Implementacao - Segunda Passagem Enterprise (Bloco 2)

**Author:** Fillipe Guerra  
**Data:** 06 de Marco de 2026

## Objetivo
Executar a segunda passagem enterprise comparando a review externa com a remediacao em andamento, validar item a item no codigo real e fechar gaps restantes no fluxo ponta a ponta de geracao de datasets e treinamento.

## Matriz de cobertura (review externa x codigo real)

| ID | Item da review externa | Classificacao inicial | Status final desta rodada | Evidencias principais |
|---|---|---|---|---|
| P0-01 | Split aleatorio inadequado para trading temporal | COVERED_PARTIAL | Corrigido | `apps/training-service/src/datasets/dataset-selection.ts` |
| P0-02 | Dataset aprovado != dataset treinado (sem snapshot unico) | NOT_COVERED | Corrigido | `persistCanonicalDatasetSnapshot`, `datasetVersionId` em jobs |
| P0-03 | Scheduled/on-demand sem dataset version forte no nascimento | NOT_COVERED | Corrigido | `createScheduledRunLoraJob`, `POST /api/training/run/start` |
| P0-04 | Marcacao `used` cedo demais | NOT_COVERED | Corrigido | lifecycle `approved->reserved->used/released` |
| P0-05 | Active adapter path pode divergir | COVERED_PARTIAL | Corrigido | `lora_jobs.active_adapter_path`, `getActiveAdapter` |
| P0-06 | Promocao/ativacao com risco de divergencia DB x filesystem | COVERED_PARTIAL | Corrigido parcial | estados `activating/failed_activation/archived`; risco residual de journal/rollback transacional completo |
| P1-07 | Readiness/gate nao usa logica canonica do treino | NOT_COVERED | Corrigido | `auto-learning-scheduler` usando `planCanonicalDatasetSelection` |
| P1-08 | RAG/documentos/midia contaminando SFT | COVERED_PARTIAL | Corrigido | `purpose=knowledge_rag` por default em `training_data` |
| P1-09 | Holdout/eval estavel + baseline vs finetuned fraco | COVERED_PARTIAL | Corrigido parcial | holdout/manifest estavel obrigatorio para promocao; baseline melhorado |
| P1-10 | Gate de qualidade simplista | NOT_COVERED | Corrigido | `evaluateTrainingQuality` por sourceType + motivos de rejeicao |
| P1-11 | System config patch permissivo | NOT_COVERED | Corrigido | registry tipado + validacao semantica por chave |
| P1-12 | Bulk import sem hardening enterprise | NOT_COVERED | Corrigido | chunking + transacao por chunk + dedupe prefetch + logs |
| P1-13 | Dedupe sem decontaminacao forte train/val/holdout | COVERED_PARTIAL | Corrigido | manifest versionado + decontaminacao cruzada por semhash |
| P2-14 | Drift schema/migrations/invariantes operacionais | COVERED_PARTIAL | Corrigido parcial | migration 0101 + constraints/indexes; residual de governance avancada |

## Mudancas arquiteturais desta rodada

1. Pipeline canonico de dataset
- Criado `apps/training-service/src/datasets/dataset-selection.ts` para consolidar selecao, dedupe, split policy, holdout, decontaminacao cruzada e manifest imutavel.
- Todos os fluxos de job passam a usar `datasetVersionId` + manifest persistido em `training_dataset_versions`.

2. Lifecycle de dados de treino
- Introduzido estado `reserved` em `training_data.status`.
- Fluxo: reservar no nascimento do job, marcar `used` apenas apos sucesso real, liberar em cancel/failure.

3. Governanca de ativacao/promocao
- Persistencia de `active_adapter_path` canônico no `lora_jobs`.
- `promotion_status` expandido com `activating`, `failed_activation`, `archived`, `rollback_pending`.

4. Hardening de qualidade, config e ingestao
- Quality gate por tipo de fonte + motivos detalhados de rejeicao.
- `system-config` com chave conhecida obrigatoria e validacao semantica por chave.
- `bulk-import` com chunking/transacao por chunk, dedupe em lote e trilha estruturada.

5. Separacao SFT x RAG
- `training_data.purpose` com enum (`behavior_sft`, `knowledge_rag`, `eval_only`, `rejected`).
- `rag_document` e `rag_media` entram por default como `knowledge_rag`.

## Migrations e schema

- Nova migration: `migrations/0101_training_dataset_manifest_and_lifecycle_hardening.sql`
- Alteracoes principais:
  - `training_data_status`: adiciona `reserved`
  - `training_data_purpose` + coluna `training_data.purpose`
  - `training_dataset_versions`: `split_policy`, `manifest`
  - `lora_jobs`: `active_adapter_path`
  - `fine_tuning_promotion_status`: `activating`, `rollback_pending`, `failed_activation`, `archived`
  - Novos indices para lookup/consistencia operacional

## Plano de remediacao em 3 ondas (atualizado)

### Onda 1 (48h) - P0
- Bloco A: congelamento de dataset
  - patch: snapshot imutavel + datasetVersionId obrigatorio em create/process
- Bloco B: split enterprise
  - patch: `chat_deterministic_hash`, `trading_temporal`, `trading_purged`, `walk_forward`, `mixed_hybrid`
- Bloco C: lifecycle de dados
  - patch: `reserved/used/released` com idempotencia
- Bloco D: ativacao canônica
  - patch: `active_adapter_path` + retorno canônico em `getActiveAdapter`

### Onda 2 (2 semanas) - P1
- Bloco A: promotao/eval robusto
  - patch: holdout estavel obrigatorio, baseline vs finetuned no mesmo artefato, bloqueio de promocao sem eval valido
- Bloco B: readiness e scheduler
  - patch: gate e treino no mesmo pipeline canônico
- Bloco C: quality e ingestao
  - patch: quality scoring por sourceType + bulk import transacional em chunks
- Bloco D: config hardening
  - patch: registry tipado e validacao zod por chave no write path

### Onda 3 (30 dias) - P1/P2
- Bloco A: state machine completa de promocao com journal de transicao
- Bloco B: rollback transacional recuperavel (DB + filesystem) com replay/recovery tool
- Bloco C: harness de avaliacao offline versionado (benchmark estavel por dominio)
- Bloco D: observabilidade dedicada para leakage/dataset drift/promocao

## Riscos residuais honestos

1. Falta journal transacional completo de ativacao/promocao cobrindo todos os passos de filesystem e banco com replay nativo.
2. Comparacao baseline vs finetuned ainda depende de metricas de job; falta harness offline dedicado com bateria de testes por dominio.
3. `rollback_pending` foi introduzido no enum, mas fluxo automatizado de rollback ainda pode ser aprofundado.

## Validacao tecnica da rodada (sequencial, sem paralelismo)

1. `npx pnpm typecheck` -> **OK**
2. `npx pnpm test` -> **OK (117 arquivos, 1332 testes)**
3. `npx pnpm lint` -> **OK (zero erros, zero warnings de ESLint)**
4. `npx pnpm build` -> **OK**

## Arquivos impactados

- `apps/training-service/src/datasets/dataset-selection.ts`
- `apps/training-service/src/lora-job-manager.ts`
- `apps/training-service/src/training-runner.ts`
- `apps/training-service/src/auto-learning-scheduler.ts`
- `apps/training-service/src/index.ts`
- `apps/training-service/src/openapi-specs.ts`
- `apps/training-service/src/workers/training-embedding-dedupe-worker.ts`
- `packages/shared/src/schema.ts`
- `packages/database/src/system-config.ts`
- `apps/frontend-service/src/pages/Training.tsx`
- `migrations/0101_training_dataset_manifest_and_lifecycle_hardening.sql`
- `docs/operations/training/overview.md`
- `docs/INDEX.md`

