# Relatorio de Correcao - Chat (Fallback e Sumiço Temporario)

**Author:** Fillipe Guerra  
**Data:** 12 de Marco de 2026

## 1. Escopo da rodada
- Investigar e corrigir:
  - Sumiço temporario das mensagens durante geracao no chat.
  - Resposta de fallback "Desculpe, estou temporariamente indisponível..." em perguntas mais dificeis.
- Investigacao feita em:
  - Codigo local (`frontend-service` e `chat-service`).
  - Servidor de producao (`178.63.41.108`) com coleta de logs reais.

## 2. Evidencias de producao (causa raiz)

### 2.1 Fallback em perguntas dificeis
Evidencias no `alice-chat` (UTC):
- `2026-03-12T21:12:11.230Z`: `"reason":"empty"` em deteccao de resposta degenerada.
- `2026-03-12T21:13:06.474Z`: `"Erro no streaming do GPU Manager Service"` com `TimeoutError`.
- `2026-03-12T21:13:06.471Z`: `"Stream de texto finalizou sem conteúdo útil; persistindo fallback seguro"`.

Evidencias no `alice-llm-gateway` (mesma janela):
- Stream iniciou em `21:12:06.491Z` e finalizou com sucesso em `21:13:18.791Z` (`durationMs: 72300`).

Diagnostico:
- O `chat-service` abortava o stream no gateway em **60s**.
- Em respostas mais longas (especialmente com `thinking`), o gateway ainda estava gerando normalmente.
- Resultado: o `chat-service` cortava o stream antes do fim e persistia fallback.

### 2.2 Sumiço temporario de mensagens durante geracao
Diagnostico no frontend:
- Havia duas rotas separadas para Chat (`/chat` e `/chat/:conversationId`).
- Durante criacao de conversa (transicao de `/chat` para `/chat/:id`), ocorria remount do componente em cenarios de streaming.
- Isso causava perda temporaria de estado local de mensagens durante a geracao.

## 3. Correcoes implementadas

### 3.1 Frontend - estabilidade de estado do chat
Arquivo:
- `apps/frontend-service/src/App.tsx`

Mudanca:
- Unificacao da rota de chat para `"/chat/:conversationId?"` (rota unica), mantendo redirect canonico de `"/chat/"`.

Resultado esperado:
- Evita remount no salto `/chat` -> `/chat/:id`.
- Mantem estado local de mensagens durante streaming e elimina o "sumiço temporario" nesse fluxo.

### 3.2 Frontend - timeout de inatividade de chunk
Arquivo:
- `apps/frontend-service/src/pages/Chat/chat-stream-mutation.ts`

Mudanca:
- `STREAM_NO_CHUNK_TIMEOUT_MS`: `60000` -> `120000`.

Resultado esperado:
- Menos aborts prematuros no cliente para respostas longas.

### 3.3 Chat Service - timeout de stream via gateway
Arquivo:
- `apps/chat-service/src/index.ts`

Mudancas:
- Novo env/config: `LLM_STREAM_TIMEOUT_MS` (default `120000`).
- `callGatewayStream`: timeout fixo de `60000` substituido por `LLM_STREAM_TIMEOUT`.
- `requestGpuStream` (proxy stream): timeout fixo de `60000` substituido por `LLM_STREAM_TIMEOUT`.

Resultado esperado:
- Stream longo nao e cortado prematuramente no `chat-service` quando o gateway ainda esta saudavel e respondendo.

### 3.4 Chat Service - recuperacao antes de fallback em stream vazio
Arquivo:
- `apps/chat-service/src/index.ts`

Mudancas:
- `buildGuardrailRegenerationConfig(...)` passou a forcar `reasoningMode: 'non_thinking'` na regeneracao controlada.
- Nova rotina `recoverResponseFromEmptyStream(...)` para tentar recuperacao sincrona controlada antes de persistir fallback.
- Aplicacao dessa recuperacao nos fluxos de stream de texto e stream de midia quando a resposta sanitizada termina vazia.
- No fluxo de midia, guardrail passou a operar sobre resposta sanitizada.

Resultado esperado:
- Reduz incidencia de fallback por resposta vazia em cenarios de `thinking`/respostas longas.
- Mantem fail-safe (fallback) quando recuperacao realmente falha.

## 4. Validacao executada (sequencial)
Executado sem paralelizar:

1. `pnpm --filter @alice/chat-service typecheck` -> OK  
2. `pnpm --filter @alice/frontend-service typecheck` -> OK  
3. `pnpm test` -> OK (`129` arquivos, `1385` testes, `1385` passed)  
4. `pnpm --filter @alice/chat-service lint` -> OK  
5. `pnpm --filter @alice/frontend-service lint` -> OK  
6. `pnpm --filter @alice/chat-service build` -> OK  
7. `pnpm --filter @alice/frontend-service build` -> OK

## 5. Arquivos alterados
- `apps/frontend-service/src/App.tsx`
- `apps/frontend-service/src/pages/Chat/chat-stream-mutation.ts`
- `apps/chat-service/src/index.ts`

## 6. Observacoes operacionais
- Nenhum workflow trigger foi alterado.
- Mudancas cirurgicas e focadas em causa raiz de UX/stream timeout/fallback.
- Nao houve push automatico.
