# Processamento Assincrono de Documentos RAG

Autor: Fillipe Guerra  
Data: 1 de Marco de 2026

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

## ETAPA 4 - Frontend com Status Real, Reprocessar e Enviar ao Treinamento

Implementacoes realizadas no `apps/frontend-service/src/pages/Documents.tsx`:

- Expansao do tipo `Document` para suportar:
  - `sentToTrainingAt`;
  - `metadata.processingStatus`, `metadata.processingError`, `metadata.processedAt`, `metadata.chunksCount`;
  - `metadata.sourceType`, `metadata.originalFilename`, `metadata.uploadedAt`, `metadata.uploadedByUserId`.
- Status real no card e viewer de documento:
  - `pending` -> "Aguardando";
  - `processing` -> "Processando...";
  - `failed` -> "Falhou" (com tooltip e erro visivel);
  - `completed` (ou `processado=true`) -> "Processado".
- Acao "Reprocessar" para documentos com falha:
  - chama `POST /api/rag/documents/:id/reprocess`;
  - exibe feedback e faz refetch via React Query.
- Acao "Enviar para treinamento" para documentos:
  - habilitada apenas quando `document.processado === true` e `sentToTrainingAt == null`;
  - chama `POST /api/rag/documents/:id/send-to-training`;
  - exibe toast de sucesso e refetch de documentos/training data.

Implementacoes de i18n:

- Novas chaves adicionadas em:
  - `apps/frontend-service/src/locales/pt-BR.json`
  - `apps/frontend-service/src/locales/en.json`
- Inclui labels para status detalhado, acao de reprocessamento e mensagens de sucesso/erro.

## ETAPA 5 - Correcao de Scroll no Viewer de Documento

Implementacoes realizadas no `apps/frontend-service/src/pages/Documents.tsx`:

- `DocumentViewer`:
  - `DialogContent` com altura fixa `h-[80vh]` para garantir area previsivel de leitura;
  - substituicao de `ScrollArea` por container com `overflow-auto` real no corpo do documento;
  - manutencao de `min-h-0` no layout flex para evitar bloqueio de rolagem.

Resultado esperado:

- Documentos longos podem ser rolados ate o final no modal sem truncamento visual.

## ETAPA 6 - Validacao E2E e Observabilidade

Hardening de logs no `apps/rag-service/src/index.ts`:

- Endpoints de documentos com logs estruturados incluindo `correlationId`:
  - listagem de documentos;
  - envio para treinamento;
  - status;
  - reprocessamento;
  - criacao via JSON;
  - upload de arquivo;
  - exclusao com limpeza no Qdrant.
- Worker de documentos mantido com logs estruturados por:
  - `jobId`, `tenantId`, `documentId`, `namespaceId`, `correlationId`, `attempt`.

Visibilidade de falhas de processamento:

- Em erro de embeddings/Qdrant no worker:
  - `documents.processado` permanece `false`;
  - `documents.metadata.processingStatus = 'failed'`;
  - `documents.metadata.processingError` recebe mensagem sanitizada.
- Recuperacao:
  - usar `POST /api/rag/documents/:id/reprocess` para reenfileirar.

## Status de Processamento

- `pending`: documento enfileirado e aguardando worker.
- `processing`: worker executando chunking/embeddings/persistencia.
- `failed`: processamento falhou; erro disponivel em `processingError`.
- `completed`: processamento concluido; documento apto para RAG e treinamento.

## Checklist Manual E2E

1. Upload de documento
   - confirmar retorno `202` com `documentId` e `jobId`.
   - confirmar transicao visual: `pending -> processing -> completed`.
2. Busca RAG
   - executar consulta em namespace do documento.
   - confirmar retorno de chunks do documento processado.
3. Envio para treinamento
   - no documento `completed`, acionar "Enviar para treinamento".
   - confirmar criacao de dados pendentes na pagina Training.
4. Falha e reprocessamento
   - em documento `failed`, acionar "Reprocessar".
   - confirmar novo fluxo: `pending -> processing -> completed`.
5. Exclusao de documento
   - deletar documento.
   - confirmar ausencia no PostgreSQL e ausencia de chunks no resultado RAG (sem ghost embeddings).

## ETAPA 7 - Confiabilidade e observabilidade enterprise (01/03/2026)

Implementacoes realizadas no `apps/rag-service/src/index.ts` e `apps/rag-service/src/document-processing-queue.ts`:

- Falha de enqueue agora nao deixa documento preso em `pending`:
  - `POST /api/rag/documents`
  - `POST /api/rag/documents/upload`
  - `PATCH /api/rag/documents/:id`
  - Em falha de fila, documento e atualizado para:
    - `processado = false`
    - `metadata.processingStatus = 'failed'`
    - `metadata.processingError = <erro sanitizado>`
    - `metadata.enqueueFailedAt = <ISO datetime>`
  - Resposta HTTP passa a ser `503` com `{ documentId, error, details }`.

- `PATCH /api/rag/documents/:id` virou assincro:
  - Removeu rebuild pesado de embeddings na request.
  - Atualiza documento para `pending` + `processingRequestedAt`.
  - Enfileira job com `force=true` e prioridade `5`.
  - Retorna `202` com `{ documentId, jobId }`.

- Health e diagnostico operacional:
  - `GET /api/rag/health` inclui:
    - `redis.available`
    - `documentProcessingWorker` (status consolidado do worker)
  - Novo endpoint:
    - `GET /api/rag/workers/document-processing`
    - protegido por `requireAuth + rag:documents:read + requireSameTenant`
    - retorna `{ redisAvailable, workerStatus }`.

- Reconciler automatico para pendentes stale:
  - Ciclo de 30s.
  - Seleciona ate 50 documentos `pending/processing` com `atualizadoEm` antigo (>2 min).
  - Faz join com namespace para obter `tenantId`.
  - Se nao houver job indexado no Redis, reenqueue com `force=true`.
  - Logs estruturados com `documentId`, `tenantId`, `namespaceId`, `correlationId`, `jobId`.

- `document-processing-queue.ts`:
  - Novo helper `getDocumentProcessingJobIdForDocument(documentId)`.

- Higiene de contexto web no agentic:
  - `buildAgenticContext` nao injeta mais `Fonte: <url>` no corpo enviado ao LLM.
  - URLs continuam no payload estruturado de `sources.web`.

## ETAPA 8 - UX de documentos e processamento assincro no frontend (01/03/2026)

Implementacoes realizadas no `apps/frontend-service/src/pages/Documents.tsx`:

- Acao de processamento para documentos pendentes:
  - Botao dinamico:
    - `pending` -> "Processar"
    - `failed` -> "Reprocessar"
  - Usa o mesmo endpoint de reprocessamento com enqueue forcado.

- Viewer com edicao completa:
  - Modo `Editar` com `Input` (titulo) e `Textarea` (conteudo).
  - Acao `Salvar` chama `PATCH /api/rag/documents/:id`.
  - Documento salvo volta para `pending` e e enfileirado.
  - Lista de documentos e invalidada apos sucesso.

- Auto-refresh de status:
  - React Query faz `refetchInterval=3000` enquanto existir documento nao `completed`.
  - Intervalo e desativado quando todos estiverem `completed`.

- i18n atualizado:
  - chaves adicionadas em `pt-BR` e `en` para:
    - `processNow`, `edit`, `save`
    - mensagens de sucesso/erro para salvar e enfileirar.
