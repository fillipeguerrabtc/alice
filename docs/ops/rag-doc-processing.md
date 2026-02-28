# Processamento Assincrono de Documentos RAG

Autor: Fillipe Guerra  
Data: 28 de Fevereiro de 2026

## ETAPA 1 - Fila Redis e Worker de Documentos

Implementacoes realizadas no `rag-service`:

- Fila dedicada de documentos em `apps/rag-service/src/document-processing-queue.ts`.
- Worker dedicado em `apps/rag-service/src/workers/document-processing-worker.ts`.
- Inicializacao do worker no boot do `rag-service` (condicionada a Redis disponivel).
- Novas variaveis de ambiente adicionadas na configuracao central do `rag-service`:
  - `DOC_PROCESS_MAX_ATTEMPTS`
  - `DOC_CHUNK_SIZE_CHARS`
  - `DOC_CHUNK_OVERLAP_CHARS`
  - `DOC_CHUNK_MAX_CHUNKS`

Capacidades implementadas:

- Idempotencia por `documentId` no enqueue.
- Dequeue com lease/lock para evitar execucao duplicada.
- Estados de job no Redis com TTL de 24 horas:
  - `queued`
  - `processing`
  - `completed`
  - `failed`
- Retry com backoff exponencial e reenfileiramento.
- Fluxo transacional no processamento:
  - leitura e validacao de tenant por namespace;
  - chunking configuravel com limite de chunks;
  - embeddings em batch via GPU Manager;
  - substituicao de chunks no PostgreSQL;
  - remocao + upsert de pontos no Qdrant;
  - atualizacao de status em `documents.metadata`.
- Invalidacao de cache RAG ao final de cada job (sucesso ou falha).

## ETAPA 2 - Endpoints de Documentos com Enqueue e Status Real

Implementacoes realizadas no `apps/rag-service/src/index.ts`:

- `POST /api/rag/documents/upload`
  - removeu processamento sincrono de chunks/embeddings no request;
  - persiste documento com `processado=false` e `metadata.processingStatus='pending'`;
  - inclui metadados de upload (`sourceType`, `originalFilename`, `mimeType`, `fileSize`, `uploadedAt`, `uploadedByUserId`, `correlationId`);
  - enfileira job de documento e retorna `202` com `{ documentId, jobId, status: "queued" }`.
- `POST /api/rag/documents`
  - persiste documento com `processado=false` e `metadata.sourceType='api_create'`;
  - enfileira job e retorna `202` com `{ documentId, jobId }`.
- `GET /api/rag/documents/:id/status`
  - retorna estado real: `processado`, `processingStatus`, `processingError`, `processedAt`, `chunksCount`, `sentToTrainingAt`;
  - validacao de tenant pelo namespace do documento.
- `POST /api/rag/documents/:id/reprocess`
  - reseta metadata para `pending`, limpa erro e grava `reprocessRequestedAt`;
  - reenfileira com `force=true` para sobrescrever dedupe quando solicitado;
  - retorna `{ jobId }`.

Regras aplicadas:

- Validacao com Zod nos endpoints novos.
- Autorizacao por permissoes existentes (`rag:documents:read`, `rag:documents:write`, `rag:documents:upload`).

## ETAPA 3 - Limpeza de Embeddings no Delete de Documento

Implementacoes realizadas no `apps/rag-service/src/index.ts`:

- `DELETE /api/rag/documents/:id`
  - antes de excluir no PostgreSQL, remove pontos no Qdrant via filtro:
    - `tenantId`
    - `documentId`
    - `type = document_chunk`
  - se a exclusao no Qdrant falhar:
    - registra log estruturado com `tenantId` e `documentId`;
    - retorna erro HTTP para evitar inconsistencia silenciosa.
  - mantida invalidacao de cache RAG ao final do fluxo de exclusao.
