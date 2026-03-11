# Relatório de Implementação - Correções Documentos (RAG) e Chat (Rodada 4)

**Autor:** Fillipe Guerra  
**Data:** 27 de Fevereiro de 2026

## Objetivo
Corrigir falhas funcionais reportadas em produção:
- página de Documentos (RAG) sem renderizar a lista apesar de exibir contagem;
- aba Mídia com erro HTTP 400 ao carregar uploads;
- chat sem respeitar nome preferido e nome informado pelo usuário;
- respostas do chat com degradação de qualidade textual (grafia fragmentada);
- fallback "temporariamente indisponível" sem persistência consistente no histórico.

## Diagnóstico de causa raiz
1. No `rag-service`, a rota dinâmica `GET /api/media/:id` capturava indevidamente o caminho estático `/api/media/uploads`, resultando em `400 Bad Request`.
2. Na tela de Documentos, o container com `ScrollArea` podia impedir a visualização da lista em determinados cenários de layout/altura, mesmo com itens carregados.
3. No `chat-service`, a resolução de usuário/locale com filtro estrito de tenant podia falhar em contexto multi-tenant/super-admin, degradando o contexto de nome preferido.
4. O fluxo de stream possuía limiares tardios para supressão de conteúdo corrompido, permitindo trechos com tokens fragmentados.
5. Em erros de stream, o fallback podia ser exibido no SSE sem garantia de persistência da mensagem do assistant, causando sensação de "mensagem sumiu" após recarregar.

## Implementação aplicada
### RAG Service
- **Arquivo:** `apps/rag-service/src/index.ts`
- Alteração cirúrgica da rota:
  - de `GET /api/media/:id`
  - para `GET /api/media/:id([0-9a-fA-F-]{36})`
- Resultado: `GET /api/media/uploads` volta a resolver no endpoint correto de listagem.

### Frontend Service
- **Arquivo:** `apps/frontend-service/src/pages/Documents.tsx`
- Substituição do container de rolagem:
  - de `ScrollArea` para `div` com `overflow-y-auto`.
- Resultado: lista de documentos volta a ficar visível de forma consistente no layout da página.

### Chat Service
- **Arquivo:** `apps/chat-service/src/index.ts`
- Resolução de identidade/locale:
  - `getUserById` com fallback por `userId` sem filtro de tenant quando busca primária falha.
  - `getUserLocaleContext` com a mesma estratégia de fallback.
  - logs de warning adicionados para rastreabilidade de contexto multi-tenant/super-admin.
- Qualidade textual:
  - reforço no `DEFAULT_SYSTEM_PROMPT` para revisão de ortografia e gramática antes da resposta final.
- Robustez de stream:
  - limiares de detecção antecipados para supressão de chunks corrompidos.
- Persistência de fallback:
  - em erro de stream (texto e mídia), quando a resposta do assistant ainda não foi persistida:
    - persiste fallback no banco (`messages`);
    - atualiza metadados da conversa;
    - emite SSE `final_message` e `message_saved`;
    - finaliza stream com `[DONE]`.

- **Arquivo:** `apps/chat-service/src/stream-corruption-heuristics.ts`
- Nova heurística `fragmented_tokens` para detectar padrão de fragmentação textual.
- Aplicação condicionada para não impactar perfil `trading`.

## Validações executadas
Executado de forma sequencial e individual:
1. `pnpm run typecheck` ✅
2. `pnpm run test` ✅
3. `pnpm run lint` ✅
4. `pnpm run build` ✅

## Resultado esperado pós-correção
- A aba Mídia carrega uploads sem erro 400 indevido.
- A lista de documentos volta a aparecer na página de Documentos quando houver itens.
- O chat volta a usar corretamente o nome preferido/contextual do usuário em cenários multi-tenant.
- Respostas com ruído textual fragmentado são suprimidas mais cedo.
- Em falha de stream, o fallback do assistant permanece persistido no histórico da conversa.
