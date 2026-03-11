# STATUS QWEN3-8B MIGRATION

**Author:** Fillipe Guerra  
**Data:** 11 de Marco de 2026

## Rodada Atual
- Rodada: 1
- Status: Concluída

## Objetivo
Implantar a fundação SSOT de modelos Qwen3-8B e contrato compartilhado de `reasoningMode`, com compatibilidade de leitura para registros históricos legados Qwen2.5.

## Premissas
- Serving alvo: `Qwen/Qwen3-8B-AWQ`.
- Training base alvo: `Qwen/Qwen3-8B`.
- Embeddings alvo: `Qwen/Qwen3-Embedding-0.6B`.
- `reasoningMode` canônico: `auto | thinking | non_thinking` (default `auto`).
- Compatibilidade histórica com valores legados Qwen2.5 deve ser preservada.

## Escopo da Rodada
- Refatorar `packages/shared-utils/src/llm-models.ts` para catálogo estruturado com:
  - `publicModelName`
  - `servingModelId`
  - `trainingBaseModelId`
  - `reasoningDefault`
- Introduzir Qwen3-8B como família principal.
- Manter compatibilidade de leitura de valores legados Qwen2.5.
- Alinhar defaults/resolução de modelo nos serviços/configs do escopo.
- Introduzir contrato compartilhado de `reasoningMode`.
- Atualizar inventário de acoplamentos Qwen2.5.

## Alterações
- `packages/shared-utils/src/llm-models.ts`:
  - Novo catálogo SSOT (`LLM_MODEL_CATALOG`) com família principal `qwen3_8b`.
  - Campos canônicos por família: `publicModelName`, `servingModelId`, `trainingBaseModelId`, `reasoningDefault`.
  - Defaults exportados: `DEFAULT_PUBLIC_LLM_MODEL_NAME`, `DEFAULT_LLM_SERVING_MODEL_ID`, `DEFAULT_LLM_TRAINING_BASE_MODEL_ID`, `DEFAULT_EMBEDDINGS_MODEL_ID`, `DEFAULT_REASONING_MODE`.
  - Compatibilidade legada Qwen2.5 via aliases de resolução (`Qwen2.5-7B-Instruct-AWQ` -> `Qwen/Qwen3-8B-AWQ`).
  - Contrato compartilhado de reasoning: `resolveReasoningMode` e `resolveReasoningModeWithHeuristic`.
- `packages/config/src/index.ts`:
  - Defaults atualizados para Qwen3 (`LLM_MODEL` -> `Qwen3-8B`).
  - Contrato `REASONING_MODE_VALUES` exportado e novo `LLM_REASONING_MODE` no schema.
- `packages/shared-utils/src/config.ts`:
  - `GPU_MANAGER_CONFIG.models.llm` agora usa resolvedor SSOT (`resolveServingModelIdFromConfig`).
  - `embeddings` alinhado para `DEFAULT_EMBEDDINGS_MODEL_ID`.
- `apps/llm-gateway-service/src/index.ts`:
  - `DEFAULT_MODEL` agora resolvido por SSOT (`resolveServingModelIdFromConfig`).
- `apps/chat-service/src/index.ts`:
  - `DEFAULT_LLM_CONFIG.model` migrado para `DEFAULT_LLM_SERVING_MODEL_ID` (Qwen3).
  - `agentModelNameSchema` passa a usar `ALLOWED_AGENT_LLM_MODEL_NAMES` do SSOT.
  - Default de `modeloBase` migrado para `DEFAULT_PUBLIC_LLM_MODEL_NAME`.
  - Contrato `reasoningMode` propagado nos caminhos gateway `complete`/`stream` via `extraBody.alice_reasoning_mode`.
  - Mensagens de validação ajustadas para alvo Qwen3.
- `apps/training-service/src/index.ts`:
  - Fallback de `TRADING_LLM_MODEL` migrado para resolvedor SSOT.
  - Contrato `reasoningMode` aplicado via `TRADING_REASONING_MODE` com envio para gateway (`extraBody.alice_reasoning_mode`).
- `tests/unit/config-validation.test.ts`:
  - Expectativas atualizadas para default LLM Qwen3 no `GPU_MANAGER_CONFIG`.

## Inventário de Acoplamentos Qwen2.5 (Atualizado)
- Resolvido no escopo da rodada:
  - `packages/config/src/index.ts`
  - `packages/shared-utils/src/config.ts`
  - `packages/shared-utils/src/llm-models.ts`
  - `apps/llm-gateway-service/src/index.ts`
  - `apps/chat-service/src/index.ts` (defaults e validação de modelo)
  - `apps/training-service/src/index.ts`
- Mantido por compatibilidade histórica:
  - Alias legados Qwen2.5 aceitos no resolvedor de modelo para leitura de registros antigos.
- Fora do escopo desta rodada (pendente para rodadas futuras):
  - referências textuais/comentários e defaults legados remanescentes em outros módulos e schemas de histórico.

## Validações
Executadas em sequência, sem paralelização:
1. `typecheck` (`cmd.exe /c pnpm typecheck`) -> OK
2. `testes` (`cmd.exe /c pnpm test`) -> falha inicial em 1 teste de default antigo Qwen2.5, corrigido; reexecução -> OK
3. `eslint` (`cmd.exe /c pnpm lint`) -> OK
4. `build` (`cmd.exe /c pnpm build`) -> OK

## Riscos
- Ainda existem referências legadas Qwen2.5 fora do escopo da rodada (principalmente em comentários/schemas históricos), sem impacto funcional imediato.
- O campo `LLM_MODEL` em `@alice/config` foi atualizado para default Qwen3 (nome público), e integrações externas que assumiam o nome antigo podem exigir revisão de configuração em ambiente.

## Próximo Passo
Iniciar Rodada 2 somente após prompt explícito, focando orquestração de runtime GPU (preempção automática serving/training) e controles operacionais com RBAC conforme Prompt Mestre Fixo.
