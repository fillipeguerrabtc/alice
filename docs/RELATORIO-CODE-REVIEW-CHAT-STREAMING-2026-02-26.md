# Relatório de Code Review e Correções - Chat Streaming e Qualidade de Resposta

**Author:** Fillipe Guerra  
**Data:** 26 de Fevereiro de 2026

## Objetivo da rodada
Corrigir comportamento de streaming para padrão ChatGPT (sem steps estáticos por padrão) e eliminar respostas degeneradas/confusas observadas em produção durante geração SSE.

## Escopo revisado
- `apps/chat-service/src/index.ts`
- `apps/frontend-service/src/pages/Chat/index.tsx`
- `apps/frontend-service/src/pages/Chat/components/MessageBubble.tsx`
- Fluxo completo: emissão SSE no backend, parser/render no frontend e guardrails de qualidade de resposta.

## Findings (code review)
1. **UX fora do padrão ChatGPT (Alta):** eventos de diagnóstico (`status` e `agent_event`) eram exibidos por padrão dentro da bolha de mensagem durante streaming.
2. **Guardrail incompleto para degeneração (Alta):** validação anti-corrupção focava em ruído textual e repetição de palavras, mas não cobria loops numéricos curtos dominantes (ex.: repetição de `5`).
3. **Reuso de conteúdo ruim (Alta):** `greeting gate` e `reuse gate` podiam persistir novamente respostas já degradadas.
4. **Renderização artificial concorrendo com stream real (Média):** `MessageBubble` animava caractere a caractere mesmo com tokens chegando por SSE, piorando percepção de fluidez.
5. **Backend sem controle explícito de diagnóstico de stream (Média):** não havia chave de contrato para ligar/desligar telemetria de etapas por requisição.

## Correções implementadas

### 1) Streaming sem steps estáticos por padrão
- **Frontend (`Chat/index.tsx`):**
  - Adicionado estado `showStreamDiagnostics` (default `false`).
  - `streamEvents` só são exibidos na UI quando diagnóstico está ativado.
  - Adicionado toggle no menu de ações do chat (desktop e mobile):
    - `Mostrar diagnóstico de stream`
    - `Ocultar diagnóstico de stream`
  - Payload de stream agora envia `streamDiagnostics` para o backend.

- **Backend (`chat-service/index.ts`):**
  - `streamMessageSchema` agora aceita `streamDiagnostics`.
  - `writeStatus` e `emitAgentEvent` foram condicionados a `streamDiagnosticsEnabled`.
  - Logs estruturados adicionados para configuração de diagnóstico por conversa.

### 2) Guardrail robusto contra respostas degeneradas
- **Backend (`chat-service/index.ts`):**
  - Novas heurísticas:
    - `hasRepeatedTokenSequence` (tokens alfanuméricos repetidos consecutivamente)
    - `hasDominantShortTokenLoop` (token curto/número dominando a resposta)
    - `hasHighDigitNoise` (densidade numérica alta com baixa diversidade)
  - `isCorruptedAssistantResponse` agora combina essas heurísticas com as anteriores.
  - Em corrupção sem recuperação confiável, resposta final retorna fallback seguro (em vez de persistir texto corrompido).

### 3) Proteção durante o streaming (tempo real)
- **Backend (`chat-service/index.ts`):**
  - Nos fluxos de stream de texto e mídia:
    - detecção incremental de degeneração parcial;
    - supressão de chunks subsequentes quando o conteúdo entra em padrão degenerado;
    - finalização com guardrail para garantir resposta persistida consistente.

### 4) Bloqueio de reuso/cache com conteúdo ruim
- **Backend (`chat-service/index.ts`):**
  - `greeting gate`: sanitiza + valida; se corrompido, descarta resposta de cache e continua fluxo normal.
  - `reuse gate`: sanitiza + valida; se corrompido, descarta reuso e continua fluxo normal.

### 5) Renderização alinhada ao stream real
- **Frontend (`MessageBubble.tsx`):**
  - Ajuste para não animar caractere a caractere enquanto `isStreaming=true`.
  - Exibição passa a refletir tokens/chunks reais do SSE, reduzindo artefatos visuais.

## Validação executada (sequencial, sem paralelismo)

### @alice/chat-service
1. `typecheck` -> OK
2. `testes` -> OK (`No test files found`, exit 0)
3. `eslint` -> OK
4. `build` -> OK

### @alice/frontend-service
1. `typecheck` -> OK
2. `testes` -> OK (`No test files found`, exit 0)
3. `eslint` -> OK
4. `build` -> OK

## Resultado da rodada
- Streaming de resposta volta ao padrão limpo por default (estilo ChatGPT).
- Diagnóstico detalhado de etapas permanece disponível sob demanda.
- Respostas degeneradas deixam de ser persistidas/reutilizadas.
- Fluxo de stream fica resiliente contra saída corrompida sem quebrar SSE.
