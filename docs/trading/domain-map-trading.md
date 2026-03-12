# Domain Map do Trading (Baseline Rodada 1)

Author: Fillipe Guerra  
Data: 2026-03-12

## Objetivo
Mapear o domínio Trading real do monorepo para orientar a refatoração com segurança, sem ruptura funcional e sem duplicação confusa entre stacks paralelas.

## 1. Entry points de Frontend
### Trading Real
- `apps/frontend-service/src/pages/Trading.tsx`
- `apps/frontend-service/src/pages/TradingContent.tsx`
- `apps/frontend-service/src/components/trading/*`
- `apps/frontend-service/src/services/api/trading.ts`

### Demo Trading
- `apps/frontend-service/src/pages/DemoTrading.tsx`
- `apps/frontend-service/src/services/api/tradingDemo.ts`

### Pontos de estado/navegação relevantes
- `useTradingWorkspaceNavigation.ts`
- `TradingNavigationConfig.ts`
- `useTradingSetupQueries.ts`
- `useTradingSignalMutations.ts`
- `useTradingPipelineActions.ts`

## 2. Rotas atuais de Backend (integrations-service)
### Estado, symbols, market e WS
- `GET /api/integrations/trading/status`
- `GET /api/integrations/trading/ws/status`
- `GET /api/integrations/trading/intervals`
- `POST /api/integrations/trading/ws/subscribe`
- `POST /api/integrations/trading/ws/unsubscribe`

Arquivo principal: `apps/integrations-service/src/routes/trading-websocket-routes.ts`

### Signal Generation
- `POST /api/integrations/trading/signals/generate`

Arquivo principal: `apps/integrations-service/src/routes/trading-signal-generation-routes.ts`

### Auto Engine orchestration (entrada HTTP)
- `GET /api/trading/auto/assets`
- `POST /api/trading/auto/portfolio/run`
- `POST /api/trading/auto/signal/run`
- `GET /api/trading/auto/runs`
- `GET /api/trading/auto/runs/:id`

Arquivo principal: `apps/integrations-service/src/routes/trading-automation-routes.ts`

### Demo Trading
- Rotas demo em `apps/integrations-service/src/routes/demo-trading-routes.ts`
- Engine demo em `apps/integrations-service/src/demo-trading-engine.ts`

## 3. Pipeline atual de Signal Generation
1. Frontend chama `POST /api/integrations/trading/signals/generate` via `useTradingSignalMutations.ts`.
2. `trading-signal-generation-routes.ts` valida payload (`zod`), auth e escopo de mercado.
3. Símbolo é resolvido por `resolveTradingSymbolOrRespond` com fallback controlado para símbolo padrão real.
4. Serviço `generateTradingSignalFromLlm(...)` é acionado com perfil técnico/configs.
5. Resultado persiste em `trading_signals` e retorna com metadata/validation.
6. Classificação operacional de saída (baseline rodada): `succeeded`, `no_trade`, `blocked`, `failed`.

## 4. Pipeline atual do Auto Engine
### Signal Auto
1. Frontend chama `POST /api/trading/auto/signal/run`.
2. `trading-automation-routes.ts` cria `trading_auto_runs` (`queued`) e steps iniciais.
3. Enfileira no `training-service` via endpoint interno `/internal/trading/auto/signal-run`.
4. `training-service` processa `processSignalAutoRun(...)`:
- `signal-decision`: filtra candidates e aplica guardrails
- `signal-llm`: executa arbitration/explanation quando aplicável
- `signal-persist`: persiste sinal ou no-trade explícito
5. Atualiza `trading_auto_runs` para estados terminais semânticos:
- `succeeded` (trade aprovado e persistido)
- `no_trade` (sem edge/candidate elegível)
- `blocked` (bloqueio de segurança/configuração)
- `failed` (falha técnica real)
6. `terminal_reason_code` fica persistido para consulta rápida em estado terminal.

### Portfolio Auto
1. Frontend chama `POST /api/trading/auto/portfolio/run`.
2. `trading-automation-routes.ts` cria run + steps (`universe-scan`, `backtest`, `calibration`, `model-risk`, `rebalance`).
3. Enfileira no `training-service` via `/internal/trading/auto/portfolio-run`.
4. `processPortfolioAutoRun(...)` encadeia filas de trading existentes e fecha run.

## 5. Pipeline atual de Demo Trading
1. `DemoTrading.tsx` consome dados de status/symbols/market da stack real.
2. Execução simulada usa rotas de demo (`demo-trading-routes.ts`) e `demo-trading-engine.ts`.
3. Pós-trade demo gera post-mortem e integra com Training via envio de dataset.
4. WebSocket de mercado é compartilhado com a infraestrutura de Trading Real (dados reais, execução simulada).

## 6. Handoffs atuais
### Training handoff
- Integrations -> Training (internal endpoints):
- `/internal/trading/auto/portfolio-run`
- `/internal/trading/auto/signal-run`
- Training executa workers e atualiza tabelas de auto-run.

### Demo execution handoff
- Demo UI -> Demo routes -> Demo engine -> postmortem/training dataset flow.

## 7. Seams de migração (pontos para evolução V2 sem ruptura)
- `trading_workspace_v2_enabled` no payload de status de Trading.
- Camada de composição de UI (`TradingContent.tsx` + hooks) já separada por responsabilidades.
- APIs de auto-run e detail (`/api/trading/auto/runs*`) já oferecem superfície para observability de ciclo de vida.
- Contrato de auto-run agora expõe `terminalReasonCode` e estados terminais explícitos (`no_trade`, `blocked`).
- Demo e Real já compartilham infra de market data, reduzindo custo de convergência de workspace.

## 8. Pontos de acoplamento críticos
- `TradingContent.tsx` centraliza múltiplos fluxos (UI + estado + orchestration).
- `DemoTrading.tsx` concentra fluxo extenso em um único arquivo.
- Contrato `tradingAutoRuns/tradingAutoRunSteps/tradingAutoDecisions` é sensível entre `integrations-service` e `training-service`.
- `metadata` em sinais/decisions é flexível (JSON), exigindo disciplina semântica para evitar ambiguidade.

## 9. Arquivos de maior risco
- `apps/frontend-service/src/pages/TradingContent.tsx`
- `apps/frontend-service/src/pages/DemoTrading.tsx`
- `apps/integrations-service/src/routes/trading-automation-routes.ts`
- `apps/training-service/src/index.ts` (trecho de `processSignalAutoRun` e `processPortfolioAutoRun`)
- `apps/integrations-service/src/routes/trading-signal-generation-routes.ts`

## 10. Observability baseline adicionada na Rodada 1
- Evento de uso de workspace/tab (`trading.workspace.usage`) em Trading e Demo.
- Evento de início de auto-run (`trading.autorun.started`) para signal/portfolio.
- Evento terminal/completed de auto-run com classificação final.
- Classificação de signal generation: `blocked`, `no_trade`, `succeeded`, `failed`.
- Flag de rollout explícita em status: `featureFlags.tradingWorkspaceV2Enabled`.

## 11. Diretriz de limpeza contínua
- Evitar convivência prolongada `legacy + v2` em paralelo.
- Avançar por substituição progressiva com cleanup por rodada.
- Documentação e mapa de domínio devem refletir apenas caminhos reais ativos e oficialmente suportados.
