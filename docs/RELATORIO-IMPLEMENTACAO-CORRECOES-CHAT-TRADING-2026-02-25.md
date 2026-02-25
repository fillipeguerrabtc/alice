# Relatório de Implementação — Correções Chat + Trading

**Autor:** Fillipe Guerra  
**Data:** 25 de Fevereiro de 2026

## Resumo
Este ciclo implementa correções reais de backend para os pontos críticos reportados: streaming SSE no gateway, consistência de identidade/nome no chat, guardrail de qualidade de resposta com regeneração controlada e persistência de histórico para `signal_auto`.

## Causa raiz consolidada
- O gateway LLM aplicava compressão global e timeouts curtos para streams longos.
- O chat dependia apenas de prompt para nomes/identidade, sem validação pós-geração.
- O fluxo `signal_auto` gravava decisão, mas não garantia persistência em `trading_signals` em todos os cenários.

## Soluções implementadas
1. **LLM Gateway (SSE realtime):**
   - Compression desabilitada na rota `/api/llm/stream`.
   - Headers SSE anti-buffer (`no-transform`, `X-Accel-Buffering: no`, `charset`).
   - Timeouts do servidor ajustados para streams longos.
   - Logs de início/TTFT/fim/desconexão com `correlationId`.

2. **Chat Service (qualidade + nomes):**
   - Guardrail pós-geração detectando conteúdo corrompido.
   - Regeneração única com temperatura reduzida quando necessário.
   - Regra determinística para resposta sobre nome do usuário (`preferredName`) e nome do agente.
   - Reforço de identidade do agente no system prompt.

3. **Training + Integrations (signal_auto):**
   - `signal_auto` agora cria/atualiza histórico em `trading_signals`.
   - Cenário aprovado: chama pipeline existente de geração de sinal via integrations e marca `generationSource=auto` com rastreabilidade (`autoRunId`, `autoDecisionId`, `correlationId`).
   - Cenário sem trade: persiste sinal `hold` com razão estruturada.
   - Idempotência por `autoRunId` no metadata para evitar duplicação em retry.

4. **Frontend build:**
   - Inclusão da dependência `@radix-ui/react-visually-hidden` no `package.json`.

## Impacto
- Streaming passa a chegar incremental no cliente com menor risco de buffering intermediário.
- Redução de respostas incorretas sobre nomes/identidade.
- Histórico de sinais passa a refletir todos os runs de `signal_auto`.

## Plano de rollback
1. Reverter o commit desta implementação.
2. Redeploy dos serviços alterados (`llm-gateway-service`, `chat-service`, `training-service`, `integrations-service`, frontend).
3. Validar health checks e rotas principais de chat/trading.

## Ajustes pós-review do Cursor (25/02/2026)
- Corrigido risco de `ReferenceError` (temporal dead zone) no fluxo de regeneração do streaming, removendo shadowing de `streamProfile` no bloco de persistência.
- Ajustado guardrail de identidade para evitar falso positivo por regex não ancorada; agora a detecção usa padrões ancorados por intenção e normalização de mensagem.
- Ajustado guardrail para responder em inglês quando a pergunta de nome for em inglês, mantendo aderência à política de idioma do prompt do sistema.
- Atualizado `TradingSignalMetadataSchema` com campos de rastreabilidade usados em `signal_auto` (`autoRunId`, `autoDecisionId`, `correlationId`, `noTradeReasonCode`).

## Ajustes adicionais pós-review (25/02/2026 - rodada 2)
- Corrigido no fluxo de streaming o uso do nome do agente para guardrail de identidade, priorizando `activeAgent` (agente roteado) e mantendo fallback para `conversation.agent` quando necessário.
- Corrigida a métrica de latência no fluxo sync: `llmLatencyMs` agora mede apenas a primeira chamada ao LLM; o tempo do guardrail/regeneração passou a ser exposto separadamente em `guardrailLatencyMs`.
- Corrigido metadado de sinal `hold` em `signal_auto`: `operationType` alterado de `scalping` para `neutral`, alinhando semântica de no-trade com o schema de operação.

## Ajustes adicionais pós-review (25/02/2026 - rodada 3)
- Corrigido `signal_auto` para respeitar o `timeframe` real aprovado no candidate/decision durante a geração de sinal via integrations, removendo hardcode de `interval: '5m'`.
- `generateAndTagAutoSignal` agora recebe `interval` por parâmetro e repassa o valor ao endpoint de geração, mantendo consistência entre análise aprovada e execução do sinal.

## Ajustes adicionais pós-review (25/02/2026 - rodada 4)
- Corrigida heurística de resposta corrompida para palavras repetidas com acentuação (PT-BR), removendo dependência de `\b` ASCII e adotando detecção Unicode-safe por sequência de palavras consecutivas.
- Corrigida atualização de metadata em `generateAndTagAutoSignal` para evitar perda silenciosa de metadata original do sinal: a marcação de rastreabilidade agora usa merge JSONB atômico no banco (`coalesce(metadata, '{}') || patch`) sem depender de leitura prévia imediata.

## Ajustes adicionais pós-review (25/02/2026 - rodada 5)
- Ajustado guardrail de ruído para evitar falso positivo em respostas com muito código (regex/JSON/template literal): a heurística de `excessiveNoiseRatio` agora é desativada quando o conteúdo é detectado como code-heavy.
- Removido `docs/PROMPT-COPILOT-CORRECOES-CHAT-TRADING-2026-02-25.md` por ser artefato operacional de geração de PR (prompt imperativo) e não documentação de produto/arquitetura, reduzindo risco de conteúdo obsoleto no diretório `docs/`.

## Ajustes adicionais pós-review (25/02/2026 - rodada 6)
- Ajustado `isCorruptedAssistantResponse` para também desativar a heurística de `maxRepeatedChars` quando o conteúdo é classificado como code-heavy, evitando falso positivo em separadores comuns de código (ex.: `====`, `----`).
- Adicionado tratamento resiliente de erro na regeneração do guardrail (`try/catch`): em falha de rede/timeout/rate-limit do LLM, o fluxo mantém e persiste a resposta sanitizada original ao invés de abortar a persistência.

## Ajustes adicionais pós-review (25/02/2026 - rodada 7)
- Ajustada a heurística `repeatedWord` em `isCorruptedAssistantResponse` para respeitar o mesmo gate `shouldApplyNoiseHeuristic` usado nas demais heurísticas de ruído, evitando falso positivo em respostas code-heavy com termos repetidos válidos (ex.: CSS/JSON).
