# Relatorio de Correcao do Release e Governanca Frontend

**Author:** Fillipe Guerra  
**Data:** 15 de Marco de 2026

## Contexto

O workflow de release falhou no passo `Validate Release` por violacao dos guardrails de governanca executados por `pnpm run validate:enterprise`, especificamente em `pnpm run verify:enterprise-focus`.

Falhas observadas:

- `apps/frontend-service/src/pages/TradingContent.tsx`: `1810` linhas para limite `1350`
- `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts`: `609` linhas para limite `600`

## Causa raiz

O problema nao estava em cache, versionamento, retag ou triggers do pipeline.

As causas reais foram:

- `TradingContent.tsx` acumulava responsabilidades de composicao, telemetria e workspace V2 no mesmo arquivo.
- `useChatPageLayoutController.ts` manteve densidade marginalmente acima do threshold apos a rodada anterior.
- O workflow de release reexecuta a suite full por desenho, porque `release.yml` chama `pnpm run validate:enterprise`, que encadeia `typecheck:full`, `test:full`, `lint:full`, `build:full` e `verify:enterprise-focus`.

## Correcao aplicada

### Trading

- Extracao do workspace V2 para `apps/frontend-service/src/pages/TradingV2WorkspaceView.tsx`
- Extracao da telemetria terminal de auto-run para `apps/frontend-service/src/pages/useTradingTerminalAutoRunTelemetry.ts`
- Simplificacao de `TradingContent.tsx` para composicao e orquestracao
- Atualizacao do teste de governanca para refletir o novo contrato arquitetural

### Chat

- Reducao cirurgica da densidade de `apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts`
- Preservacao do comportamento e dos guardrails de streaming/cancelamento

## Resultado

Guardrails verificados localmente:

- `TradingContent.tsx`: `1330` linhas
- `useChatPageLayoutController.ts`: `594` linhas

Saida final de `pnpm run verify:enterprise-focus`:

- `OK - Densidade TradingContent: 1330 <= 1350`
- `OK - Densidade Chat layout controller: 594 <= 600`
- `Resultado: OK (guardrails atendidos).`

## Validacoes executadas

Executadas de forma sequencial para o frontend alterado:

- `pnpm exec vitest run tests/unit/frontend/trading-frontend-governance.test.ts tests/e2e/chat-streaming-backpressure.test.ts`
- `pnpm exec eslint apps/frontend-service/src/pages/TradingContent.tsx apps/frontend-service/src/pages/TradingV2WorkspaceView.tsx apps/frontend-service/src/pages/useTradingTerminalAutoRunTelemetry.ts apps/frontend-service/src/pages/Chat/useChatPageLayoutController.ts tests/unit/frontend/trading-frontend-governance.test.ts tests/e2e/chat-streaming-backpressure.test.ts --max-warnings=0`
- `pnpm --filter @alice/frontend-service build`
- `pnpm run verify:enterprise-focus`

Observacao:

- O build do frontend concluiu com sucesso e inclui `pnpm run typecheck` antes do `vite build`.
- A execucao isolada de `pnpm --filter @alice/frontend-service typecheck` ficou muito lenta no ambiente WSL em `/mnt/c`, mas o mesmo typecheck foi exercitado integralmente dentro do build aprovado.

## Nota sobre redundancia entre CI e Release

Hoje existe sobreposicao entre:

- `.github/workflows/ci.yml` em `main`, que roda `typecheck:full`, `test:full`, `lint:full` e `build:full`
- `.github/workflows/release.yml`, que roda novamente `validate:enterprise`

Isso e redundante do ponto de vista de custo, mas e intencional do ponto de vista de seguranca operacional, porque o release e um workflow independente e pode acontecer em momento posterior, com versionamento, tag e retag. Qualquer otimizacao futura precisa preservar esse fail-closed.
