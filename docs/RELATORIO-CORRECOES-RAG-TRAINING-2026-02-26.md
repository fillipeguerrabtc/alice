# Relatorio de Correcao Enterprise - RAG Upload e Training Bulk Import

**Author:** Fillipe Guerra  
**Data:** 26 de Fevereiro de 2026

## Escopo
- Corrigir erro no upload de documentos da pagina Documents (RAG).
- Corrigir erro no import em massa de JSON na pagina Training.
- Executar code review ponta a ponta em captacao de dados de treinamento, geracao de dataset e execucao de treinamento.
- Endurecer isolamento multi-tenant dos endpoints criticos.

## Causas Raizes

### 1) Upload RAG com 500
- `chunkText()` permitia estado sem progresso no final do texto.
- `/api/rag/documents/upload` decodificava arquivo binario como UTF-8 bruto, sem usar o fluxo de extracao enterprise para PDF/DOCX/XLSX.

### 2) Bulk import de Training com 403
- Endpoint exigia permissao RBAC inexistente: `training:training_data:create`.
- A plataforma usa `training:training_data:write`, por isso a autorizacao falhava mesmo com usuario valido.

### 3) Gaps de isolamento por tenant
- Parte dos endpoints aceitava `tenantId` de query/body sem consolidar com o tenant autenticado.
- Existia risco de leitura/acao cross-tenant por ID conhecido em jobs e operacoes em lote.

## Correcoes Implementadas

### RAG Service
Arquivo: `apps/rag-service/src/index.ts`
- Correcao de `chunkText()` para garantir progresso e parada segura.
- Inclusao de `isRawTextLikeDocumentMime()` e `extractTextFromUploadedDocument()`.
- Em `/api/rag/documents/upload`:
  - texto puro continua em UTF-8;
  - arquivos nao-texto passam por `document-processor`;
  - retorno `400` quando nao existe texto util extraido.

### Training Service
Arquivo: `apps/training-service/src/index.ts`
- Inclusao de `resolveAuthorizedTenantId(...)` para consolidar tenant autenticado.
- Permissoes corrigidas:
  - `/api/training/bulk-import`: `training:training_data:write`
  - `/api/training/data/approve-batch`: `training:training_data:manage`
- Isolamento de tenant aplicado em:
  - `/api/training/data`
  - `/api/training/data/:id/status`
  - `/api/training/data/:id/resolve-scope`
  - `/api/training/jobs`
  - `/api/training/jobs/:id`
  - `/api/training/lora/activate/:jobId`
  - `/api/training/lora/active` (GET/DELETE)
  - `/api/training/data/approve-batch` (com `skippedByTenantMismatch`)
  - `/api/training/auto-learning/status`
  - `/api/training/stats`
  - `/api/training/schedule/configure`
  - `/api/training/run/start`
  - `/api/training/run/status`
  - `/api/training/run/history`
  - `/api/training/run/cancel`
- Em `run/start`, validacao adicional para `namespaceId` pertencer ao tenant autenticado.

## Validacao Obrigatoria (sequencial)
1. Typecheck
   - `pnpm --filter @alice/rag-service run typecheck` (ok)
   - `pnpm --filter @alice/training-service run typecheck` (ok)
2. Testes
   - `pnpm test` (ok, 50 arquivos / 1111 testes)
3. ESLint
   - `pnpm --filter @alice/rag-service run lint` (ok)
   - `pnpm --filter @alice/training-service run lint` (ok)
4. Build
   - `pnpm --filter @alice/rag-service run build` (ok)
   - `pnpm --filter @alice/training-service run build` (ok)
