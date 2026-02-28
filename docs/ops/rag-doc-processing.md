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
