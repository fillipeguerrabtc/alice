# Prompt para Copilot - Implementação completa das correções de Chat + Trading

**Autor:** Fillipe Guerra  
**Data:** 25 de Fevereiro de 2026

Você é responsável por abrir **1 PR único, enterprise-grade**, sem workarounds, sem mocks, sem hardcode, sem stubs, com mudanças cirúrgicas e rastreáveis.

## Objetivo
Corrigir definitivamente os problemas abaixo:

1. Streaming de tokens realtime no chat (hoje aparecem apenas steps estáticos).
2. Respostas do chat com erros de qualidade e nome do usuário incorreto.
3. Nome do agente não sendo respeitado com consistência.
4. Geração de sinais IA Auto sem LLM real e sem persistência no histórico de sinais.
5. Build quebrando por dependência faltante no frontend.

---

## Regras obrigatórias

1. Não alterar gatilhos/triggers de workflows GitHub Actions.
2. Não usar mocks, placeholders, fallback fake ou armazenamento in-memory.
3. Fazer mudanças mínimas e cirúrgicas nos pontos abaixo.
4. Preservar multi-tenant, RBAC, segurança e logs estruturados.
5. Seguir padrões existentes já implementados no repo.

---

## Escopo técnico e arquivos-alvo

## A) Streaming realtime do chat

### Problema
SSE está funcional no chat-service e frontend, mas o gateway pode estar bufferizando stream (compressão global) e possui timeout de servidor incompatível com streams longos.

### Arquivo principal
- `apps/llm-gateway-service/src/index.ts`

### Implementar
1. **Desabilitar compressão para rota SSE** `/api/llm/stream`.
   - Opção preferida: usar `compression({ filter })` e retornar `false` para `text/event-stream` e/ou path de stream.
2. Ajustar headers SSE no gateway para evitar buffering intermediário:
   - `Content-Type: text/event-stream; charset=utf-8`
   - `Cache-Control: no-cache, no-transform`
   - `Connection: keep-alive`
   - `X-Accel-Buffering: no`
3. Ajustar timeouts do servidor HTTP do gateway para suportar streaming real:
   - `server.timeout` >= 120000 (ou alinhado ao chat-service).
   - revisar `keepAliveTimeout` e `headersTimeout` coerentes com stream.
4. Garantir flush por chunk (`res.flush?.()`), mantendo compatibilidade com Express.
5. Adicionar logs de diagnóstico em nível `debug/info` com correlationId para:
   - início stream
   - primeiro chunk (TTFT)
   - fim stream
   - encerramento por timeout/desconexão

### Critério de aceite
- Frontend recebe `parsed.content` incremental (não apenas status/steps).

---

## B) Qualidade de resposta + nome do usuário + identidade do agente

### Arquivo principal
- `apps/chat-service/src/index.ts`

### Implementar
1. **Guardrail pós-geração de resposta** antes de persistir/enviar final:
   - detectar texto corrompido evidente (caracteres repetidos/entropia anômala/trechos nonsense).
   - quando detectar, regenerar 1 vez com temperatura menor (sem fallback fake) e registrar evento.
2. **Nome do usuário**:
   - manter `preferredName` como prioridade máxima em TODA resposta de saudação/pergunta sobre nome.
   - criar validação final para impedir troca para nome não confirmado.
3. **Nome do agente**:
   - reforçar política de identidade no prompt: proibir auto-renomeação.
   - quando usuário perguntar “qual seu nome?”, responder estritamente com identidade do agente ativo.
4. Adicionar testes unitários cobrindo:
   - saudação com preferredName.
   - pergunta sobre nome do usuário.
   - pergunta sobre nome do agente.
   - bloqueio de resposta corrompida com regeneração controlada.

### Critério de aceite
- Nenhuma troca indevida de nome em cenários de teste.

---

## C) Geração de sinais Auto usando LLM real + persistência em histórico

### Arquivos principais
- `apps/training-service/src/index.ts`
- `apps/integrations-service/src/index.ts`
- (se necessário) `packages/shared/src/schema.ts` e migration nova em `migrations/`

### Problema
`processSignalAutoRun` atualmente decide por guardrails e grava `trading_auto_decisions`, mas não cria `trading_signals`.

### Implementar
1. No fluxo `signal_auto`, após seleção do candidato aprovado:
   - chamar pipeline real de geração de sinal com LLM (reutilizar função/endpoint já existente, sem duplicar lógica).
   - persistir em `trading_signals` com `source = auto` e metadata rica (`runId`, `decisionId`, `correlationId`, candidato, técnica etc).
2. Em cenário `no-trade`:
   - persistir sinal explícito de não-operação (ex.: `hold/neutral`) em `trading_signals`, com razão estruturada.
3. Garantir idempotência:
   - evitar sinal duplicado para mesmo `runId` quando houver retry.
4. Atualizar endpoint/listagem de histórico para exibir claramente origem `signal_auto`.
5. Se necessário, criar migration para colunas de rastreabilidade (ex.: `auto_run_id`, `auto_decision_id`) mantendo backward compatibility.
6. Criar testes integrados/unitários para:
   - run auto com candidato aprovado gera `trading_signals`.
   - run auto sem candidato também gera registro `hold/neutral` no histórico.
   - retries não duplicam sinal.

### Critério de aceite
- Todo `signal_auto` concluído aparece no histórico de sinais.

---

## D) Correção de build frontend

### Arquivo principal
- `package.json` (dependências)
- `apps/frontend-service/src/components/ui/sidebar.tsx`

### Implementar
1. Resolver dependência faltante `@radix-ui/react-visually-hidden`.
2. Garantir build completo sem erro de resolução de módulo.

---

## Checklist de validação (executar UM POR VEZ)

1. `npm run typecheck`
2. `npm run test`
3. `npm run lint`
4. `npm run build`

Se qualquer comando falhar: corrigir causa raiz e repetir até ficar sem erros.

---

## Entregáveis do PR

1. Código corrigido e testado.
2. Novos testes cobrindo os cenários críticos.
3. Migrações (se necessárias) + atualização de schema.
4. Documentação em PT-BR com:
   - resumo do problema
   - causa raiz
   - solução implementada
   - impacto
   - plano de rollback

