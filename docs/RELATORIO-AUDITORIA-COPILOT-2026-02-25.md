# Relatório Técnico de Auditoria - Chat, Streaming e Trading

**Autor:** Fillipe Guerra  
**Data:** 25 de Fevereiro de 2026

## Escopo da auditoria

Este relatório cobre os problemas relatados em produção e uma revisão ampla do repositório com foco em:

1. Streaming de tokens em tempo real no chat.
2. Personalização de nome do usuário (Preferred Name) e identidade do agente.
3. Qualidade/resiliência das respostas do chat.
4. Geração de sinais IA (on-demand e auto) e persistência/histórico.
5. Integridade técnica geral (typecheck, testes, lint e build).

---

## Diagnóstico dos problemas relatados

## 1) Streaming de tokens em tempo real aparece como steps estáticos

### Evidências encontradas
- O frontend processa SSE incremental por `parsed.content` e atualiza o conteúdo da mensagem em tempo real, então a camada de UI já suporta token streaming. (`apps/frontend-service/src/pages/Chat/index.tsx`)
- O `chat-service` escreve SSE com `data: { content }` em cada chunk e faz `flush()` por chunk, então também está preparado para streaming token a token. (`apps/chat-service/src/index.ts`)
- O `llm-gateway-service` aplica `compression()` globalmente em todas as rotas, incluindo `/api/llm/stream`. Em cenários de SSE, compressão pode agregar/bufferizar chunks e degradar “token realtime”, deixando o usuário vendo majoritariamente eventos de status/steps. (`apps/llm-gateway-service/src/index.ts`)
- O `llm-gateway-service` usa `server.timeout = 30000` (30s) enquanto o stream do GPU usa timeout de 60s e há cenários de resposta longa. Isso pode cortar streaming no meio ou induzir comportamento inconsistente de entrega. (`apps/llm-gateway-service/src/index.ts`)

### Causa raiz provável
- Gargalo principal no gateway (compressão + timeout de servidor baixo para stream).

### Severidade
- **Crítica** (impacta UX principal do produto e percepção de qualidade do chat).

---

## 2) Nome do usuário (Preferred Name) e nome do agente ainda saem errados

### Evidências encontradas
- O `chat-service` implementa contexto de nome com prioridade para `preferredName`, depois sugestão por perfil/login, e inclui política explícita no prompt para uso de nome. (`apps/chat-service/src/index.ts`)
- O mesmo serviço injeta identidade do agente no prompt via bloco `IDENTIDADE DO AGENTE: Você é ...`. (`apps/chat-service/src/index.ts`)
- O endpoint `/api/auth/user` retorna `safeUser` completo (inclui `preferredName`), então o frontend recebe o campo corretamente. (`apps/auth-service/src/index.ts`)

### Hipótese técnica
- O problema não parece ser ausência estrutural de `preferredName`, e sim **qualidade da resposta LLM** (falta de guardrail pós-processamento e validação semântica mínima de cumprimento das instruções de identidade/nome).
- O comportamento com texto corrompido (“eNEse...”) sugere também problemas de geração/modelo e/ou parsing em cadeia, não apenas regras de nome.

### Severidade
- **Alta** (quebra personalização e confiança do usuário).

---

## 3) Respostas do chat saindo erradas/corrompidas

### Evidências encontradas
- Há sanitização de resposta no chat (`sanitizeAssistantResponse`), mas ela atua em repetição/quebras, não corrige conteúdo semanticamente ruim. (`apps/chat-service/src/index.ts`)
- Existe política de hora/data no prompt (`SERVER_TIME`), porém sem validação final de coerência factual antes de persistir e enviar.

### Causa raiz provável
- Ausência de uma camada de validação leve pós-geração para erros gritantes (ex.: data nonsense, linguagem truncada) e fallback controlado.

### Severidade
- **Alta**.

---

## 4) Geração de sinais IA para trading não está usando LLM (sinais falsos/repetidos)

### Evidências encontradas
- A geração **on-demand** (`/api/integrations/trading/signals/generate`) chama `generateTradingSignalFromLlm(...)` e persiste via `kucoinService.createSignal(...)`. (`apps/integrations-service/src/index.ts`)
- Já a geração **auto** (`processSignalAutoRun`) **não chama LLM**; ela decide por guardrails em `tradingUniverseCandidates`, grava decisão em `trading_auto_decisions`, mas não cria `trading_signals`. (`apps/training-service/src/index.ts`)

### Causa raiz
- Fluxo `signal_auto` atual é engine de decisão/guardrail, não pipeline completo de sinal LLM persistido.

### Severidade
- **Crítica** (problema funcional direto no core de trading).

---

## 5) Geração de sinais auto não salva sinal e não tem histórico

### Evidências encontradas
- Existe histórico de sinais em `/api/integrations/trading/signals/history`, mas ele depende da tabela `trading_signals`. (`apps/integrations-service/src/index.ts`)
- Como `signal_auto` salva somente `trading_auto_runs/steps/decisions` e não cria `trading_signals`, o histórico principal de sinais não recebe as execuções auto.

### Causa raiz
- Falta de persistência final do sinal no fluxo `signal_auto`.

### Severidade
- **Crítica**.

---

## Achados adicionais de code review (repositório)

1. **Build quebrando no frontend por dependência ausente**: `@radix-ui/react-visually-hidden` não resolvida em `sidebar.tsx`.  
2. **Inconsistência de timeout para stream no gateway** (30s server vs 60s request GPU).  
3. **Arquitetura com arquivo muito grande** (`apps/chat-service/src/index.ts` e `apps/integrations-service/src/index.ts`) elevando risco de regressão e dificultando isolamento de bugs.  
4. **Observabilidade parcial do streaming**: já há métricas/eventos, mas faltam métricas fim-a-fim de chunk latency percebida pelo cliente (frontend + gateway + chat-service).

---

## Priorização de correções (ordem recomendada)

1. **P0** - Corrigir streaming realtime no `llm-gateway-service` (compressão SSE + timeout de servidor).
2. **P0** - Corrigir `signal_auto` para gerar sinal real com LLM e persistir em `trading_signals`.
3. **P1** - Garantir rastreabilidade no histórico (link run → decision → signalId).
4. **P1** - Adicionar validação pós-geração para nome/identidade e respostas com texto corrompido no chat.
5. **P1** - Resolver build frontend (`@radix-ui/react-visually-hidden`).

---

## Critérios de aceite (DoD)

1. Chat streaming exibindo tokens progressivos em tempo real durante toda a resposta.
2. Preferred name aplicado de forma consistente sem troca indevida.
3. Identidade do agente respeitada em auto-apresentação.
4. Fluxo `signal_auto` gera sinal via LLM e persiste em `trading_signals`.
5. Histórico de sinais inclui origem `signal_auto`.
6. Typecheck, testes, ESLint e build sem erros.

