# Relatório Core Review - Chat, Streaming, Web Search e Rota de Contexto

**Autor:** Fillipe Guerra  
**Data:** 27 de Fevereiro de 2026

## Objetivo
Aplicar correções estruturais no fluxo de chat para:
- remover steps técnicos no modo normal;
- manter streaming token a token estável;
- corrigir classificação web/internal para consultas de cotação/preço cripto;
- exibir fontes/links visitados no frontend;
- preservar contexto real de rota ao abrir o chat a partir de outras páginas.

## Diagnóstico de causa raiz
1. `chat-service` emitia `status` e `agent_event` sempre, forçando painel de etapas no frontend.
2. Parser SSE do proxy de stream no `chat-service` fazia split por linha e não tratava CRLF/`\r` de forma robusta por evento.
3. `rag-service` classificava usando texto sem normalização de diacríticos e sem termos sem acento (ex.: `cotacao`, `preco`, `btc`).
4. Frontend ignorava evento SSE `sources` e não renderizava card de fontes.
5. Contexto de rota no chat dependia de pathname de tela atual (`/chat`) sem preservar rota de origem.

## Implementação aplicada
### Backend
- `apps/chat-service/src/index.ts`
  - `writeStatus` e `emitAgentEvent` agora só emitem SSE quando `streamDiagnosticsEnabled === true`.
  - Parser SSE do `proxyStreamFromGpuManager` refeito para:
    - normalizar `\r\n` e `\r`;
    - separar eventos por `\n\n`;
    - suportar `event:` + múltiplas linhas `data:`;
    - tratar `[DONE]` sem perda de chunks finais;
    - manter métricas TTFT, token usage e duração.

- `apps/rag-service/src/index.ts`
  - `classifyQuery` atualizado com normalização (`NFD` + remoção de diacríticos).
  - Keywords expandidas para variações sem acento e termos de mercado/cripto (`cotacao`, `preco`, `btc`, `bitcoin`, `bitcoi`, `eth`, `crypto`, `price`, `quote`, `market cap`).
  - Regra adicional para consultas de preço/mercado classificar como `web` ou `hybrid` mesmo sem `hoje/agora`.

### Frontend
- `apps/frontend-service/src/pages/Chat/index.tsx`
  - Eventos de stream (`setStreamEvents`, `status`, `agent_event`) condicionados a `showStreamDiagnostics`.
  - Parser SSE com normalização adicional de `\r`.
  - Evento `sources` agora é validado em runtime e anexado no `metadata` da última mensagem `assistant`.
  - Contexto de rota para payload do stream agora usa `window.location.pathname` e suporta `?from=/rota-origem`.
  - Query `from` não é mais tratada como filtro de data quando representa rota.
  - Navegação para conversa criada preserva `from` quando presente.

- `apps/frontend-service/src/pages/Chat/components/types.ts`
  - Tipos explícitos para fontes (`MessageSources`, `WebSourceLink`, `InternalSourceReference`) adicionados ao `metadata` da mensagem.

- `apps/frontend-service/src/pages/Chat/components/SourcesCard.tsx`
  - Novo componente para renderizar fontes web (links clicáveis) e fontes internas (documento + similaridade).

- `apps/frontend-service/src/pages/Chat/components/MessageBubble.tsx`
  - Painel de steps renderizado apenas com `showStreamDiagnostics === true`.
  - Card de fontes renderizado quando `message.metadata.sources` existir.

- `apps/frontend-service/src/components/app-sidebar.tsx`
  - Link de Chat agora preserva rota de origem via `?from=<pathname-atual>` ao abrir chat fora de `/chat`.

## Validações executadas
1. `pnpm typecheck` ✅
2. `pnpm test` ✅
3. `pnpm lint` ✅
4. `pnpm build` ✅

## Resultado esperado pós-correção
- Modo normal: apenas `Thinking...` + tokens em tempo real, sem painel de steps.
- Modo diagnóstico: steps técnicos continuam visíveis.
- Consultas como `cotacao do bitcoi`, `preco btc`, `cotação bitcoin` disparam classificação web/hybrid.
- Fontes web/internal passam a aparecer no card da resposta quando evento `sources` for emitido.
- Chat aberto de páginas como Trading/DemoTrading leva contexto de rota correto ao backend.
