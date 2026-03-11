# Relatório de Implementação - Streaming ChatGPT-like, Anticorrupção e UX de Documentos

**Autor:** Fillipe Guerra  
**Data:** 28 de Fevereiro de 2026

## Objetivo da rodada

Implementar correções críticas em três frentes:

1. Streaming do chat com comportamento ChatGPT-like:
- Texto incremental em tempo real.
- Indicador único de status dinâmico (sem lista técnica estática por padrão).

2. Correção de respostas corrompidas:
- Mitigar vazamento de padrão CSS/`;rred;`.
- Sanitizar snippets web antes de entrar no contexto do RAG.

3. Correção de layout em `/documents`:
- Remover efeito de lista espremida no rodapé com scroll inadequado.

## Implementações realizadas

## A) Chat streaming e status vivo

### Frontend (`apps/frontend-service`)

- `src/pages/Chat/index.tsx`
  - Adicionado estado `streamStatusLabel`.
  - Parser SSE agora processa `type: 'status'` sempre, independente de `showStreamDiagnostics`.
  - `agent_event` continua restrito a diagnósticos técnicos (`showStreamDiagnostics`).
  - `streamStatusLabel` é limpo ao iniciar novo envio e no encerramento do stream (sucesso/erro/finally).
  - Novo estágio `refining` mapeado em `resolveStreamStatus`.

- `src/pages/Chat/components/MessageBubble.tsx`
  - Nova prop `streamStatusLabel`.
  - Renderização de linha curta de status vivo no bubble do assistente durante streaming da última mensagem.
  - Painel técnico detalhado do stream permanece opcional, apenas com diagnósticos habilitados.

- `src/locales/pt-BR.json` e `src/locales/en.json`
  - Adicionada chave de tradução `chat.streaming.status.refining`.

### Backend (`apps/chat-service`)

- `src/index.ts`
  - `writeStatus(stage)` agora emite SSE sempre via `safeWriteSseEvent`, sem gate por `streamDiagnosticsEnabled`.
  - `emitAgentEvent` continua condicionado a diagnósticos.
  - Eventos `sources` em fluxos SSE migrados para `safeWriteSseEvent` (com flush garantido).
  - Fluxo de detecção de corrupção durante streaming alterado:
    - Não suprime chunks.
    - Ao detectar padrão suspeito, emite status `refining`.
    - Continua stream normal.
    - No final, `final_message` substitui o conteúdo caso guardrail altere a resposta.

## B) Anticorrupção de resposta e sanitização web

### RAG Service (`apps/rag-service`)

- Novo arquivo `src/web-sanitize.ts`
  - Implementada função `sanitizeWebSnippet(input: string): string`.
  - Regras aplicadas:
    - Remoção de HTML e decodificação de entidades com `cheerio`.
    - Normalização de whitespace.
    - Remoção de vazamento de estilo CSS (`color`, `background-color`, `font-size`, `font-weight`).
    - Remoção de padrões de semicolon soup.
    - Truncamento seguro do snippet (limite de 900 caracteres).

- `src/index.ts`
  - `buildAgenticContext` agora usa `sanitizeWebSnippet(result.description)` antes de inserir contexto web.

- `src/web-search.ts`
  - Sanitização aplicada em profundidade na montagem de `description` e `snippet` vindos do SearXNG.

### Heurística de corrupção (`apps/chat-service`)

- `src/stream-corruption-heuristics.ts`
  - Novo reason `css_style_leak` em `StreamCorruptionReason`.
  - Nova checagem explícita para semicolon soup / vazamento CSS.
  - Prioridade da checagem `css_style_leak` ajustada para ocorrer antes de `repeated_words`.

- `src/index.ts`
  - `enforceResponseGuardrails` reforçado para sempre finalizar retorno com sanitização + correção de nome preferido (`fixPreferredNameInDirectAddress`), inclusive em respostas especiais (pergunta de nome).

## C) Layout `/documents`

- `apps/frontend-service/src/App.tsx`
  - Atualizado `<main>` para `className="flex-1 min-h-0 overflow-auto"`.
  - Correção destrava cálculo de altura de children flex e normaliza scroll do painel em `/documents`.

## Testes adicionados/atualizados

- `tests/unit/rag-web-sanitize.test.ts`
  - Valida remoção de HTML.
  - Valida decodificação de entidades.
  - Valida remoção de vazamento CSS (`color:red`, `background-color`, `font-size`).

- `tests/unit/chat-stream-corruption-heuristics.test.ts`
  - Adicionado caso para `css_style_leak` com repetição `;rred;`.
  - Ajustados cenários de ruído linguístico para manter assertivas determinísticas.

## Validação executada (sequencial, sem paralelização)

1. `pnpm run typecheck`  
2. `pnpm run test`  
3. `pnpm run lint`  
4. `pnpm --filter @alice/frontend-service run build`  
5. `pnpm --filter @alice/chat-service run build`  
6. `pnpm --filter @alice/rag-service run build`  

Todos os comandos concluídos com sucesso após os ajustes desta rodada.
