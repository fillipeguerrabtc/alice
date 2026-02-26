# Relatório de Implementação - Training Async, LoRA Routing e Streaming Chat

**Author:** Fillipe Guerra  
**Data:** 26 de Fevereiro de 2026

## Escopo aplicado

- P0: coleta de `training_data` assíncrona com fila Redis para `embedding + dedupe`.
- P0: dedupe com semhash exato (`tenant_id + semhash`) e KNN pgvector (`ORDER BY embedding <=> ... LIMIT 1`).
- P0/P2: migration real para `processed_at` + índices de semhash e HNSW.
- P0: remoção de fallback hardcoded de `TRAINING_SERVICE_URL` e invalidação de cache LoRA via `SCAN`.
- P0: ajuste de supressão de streaming SSE no perfil `trading` (não suprimir por ruído de dígitos).
- P1: `preferredName` sem uso de `displayName`.

## Arquitetura implementada

- Novo SSOT de fila em `packages/shared-utils/src/training-queues.ts`:
  - `TRAINING_EMBEDDING_DEDUPE_QUEUE`
  - payload Zod de enqueue
  - `buildTrainingIdempotencyKey` com SHA-256
- Endpoint `POST /api/training/data`:
  - persiste rápido (`pending` + `embedding NULL`) e enfileira job
  - rejeita síncrono apenas por qualidade mínima
  - mantém validações de auth/tenant/scope
  - proteção de idempotência por fingerprint (`tenant + sourceType + sourceId + semhash`)
- Worker dedicado:
  - `apps/training-service/src/workers/training-embedding-dedupe-worker.ts`
  - idempotência no consumer (lock Redis + short-circuit por `processedAt`)
  - dedupe semhash exato e KNN pgvector top-1 com threshold central
  - atualização de `processedAt`, `processadoEm`, `isDuplicate`, `duplicateOfId`, `similarityScore`, `embedding`
  - logs estruturados e métricas Prometheus

## Observabilidade aplicada

- `alice_training_embedding_dedupe_jobs_total{result}`
- `alice_training_embedding_dedupe_hits_total{method}`
- `alice_training_embedding_dedupe_duration_seconds`
- `chat_stream_suppression_total{profile,reason}`

## Migração aplicada

- `migrations/0087_training_data_async_embedding_dedupe_indexes.sql`
  - `processed_at` em `training_data`
  - `training_data_tenant_semhash_idx` (partial: `semhash IS NOT NULL`)
  - `training_data_embedding_hnsw_idx` (HNSW com `vector_cosine_ops`)
  - `training_data_processed_at_idx`

## Notas operacionais

- `TRAINING_SERVICE_URL` agora é obrigatório nos pontos de roteamento LoRA e worker dependente.
- Invalidação de cache LoRA deixou de usar `KEYS` e passou a usar `SCAN` em batches.
