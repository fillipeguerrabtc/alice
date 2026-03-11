# Relatório de Implementação - Correção de Falha no Deploy do Stack ALICE (RAG)

**Autor:** Fillipe Guerra  
**Data:** 28 de Fevereiro de 2026

## Objetivo
Corrigir a falha de deploy do stack ALICE na versão `v3.73.2`, onde o container `alice-rag` entrava em loop de restart e ficava `unhealthy`, bloqueando a subida completa do stack.

## Diagnóstico de causa raiz
A falha não estava relacionada a Qdrant, rede Docker ou dependências de infraestrutura.

O erro real estava explícito no log do `alice-rag`:
- `PathError [TypeError]: Unexpected ( at index 14, expected end: /api/media/:id([0-9a-fA-F-]{36})`
- stack em `path-to-regexp@8.3.0` + `express@5.2.1`

Na versão atual (Express 5 com `path-to-regexp` v8), regex inline em rota (`:id(...)`) não é suportada.  
Isso fazia o serviço falhar ainda no bootstrap da aplicação, antes de estabilizar health/readiness.

## Implementação aplicada
### Arquivo alterado
- `apps/rag-service/src/index.ts`

### Mudanças cirúrgicas
1. Ajuste de tipos:
   - adicionada importação de `NextFunction` de `express`.

2. Ajuste da rota:
   - de: `GET /api/media/:id([0-9a-fA-F-]{36})`
   - para: `GET /api/media/:id`

3. Proteção de roteamento sem regex inline:
   - na própria rota `:id`, quando o parâmetro não tem formato de UUID (36 chars hex/hífen), é feito `next()`.
   - isso impede interceptação indevida de rotas estáticas como:
     - `/api/media/uploads`
     - `/api/media/stats`
     - `/api/media/health`
   - validação UUID com Zod foi preservada para casos aplicáveis.

## Resultado esperado pós-correção
- `alice-rag` deixa de quebrar no startup por erro de parsing de rota.
- deploy do stack ALICE volta a prosseguir sem bloquear dependências.
- endpoints estáticos de mídia não são mais capturados por rota dinâmica de ID.

## Validações executadas (sequenciais)
1. `pnpm run typecheck` ✅
2. `pnpm run test` ✅
3. `pnpm run lint` ✅
4. `pnpm run build` ✅

## Observação técnica
O diagnóstico automático sugerido pelo Copilot apontou infraestrutura (Qdrant/rede/env), mas o erro determinístico de bootstrap em `path-to-regexp` é suficiente para explicar o incidente e foi a causa raiz tratada nesta correção.
