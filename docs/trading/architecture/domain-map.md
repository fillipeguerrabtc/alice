# Domain Map do Trading

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Mapear o dominio Trading vigente no monorepo, destacando entry points, contratos ativos, handoffs entre servicos e pontos de acoplamento que merecem cuidado.

## Frontend vigente

### Trading Real

- `apps/frontend-service/src/pages/Trading.tsx`
- `apps/frontend-service/src/pages/TradingContent.tsx`
- `apps/frontend-service/src/components/trading/*`
- `apps/frontend-service/src/components/trading-v2/*`
- `apps/frontend-service/src/services/api/trading.ts`

### Demo Trading

- `apps/frontend-service/src/pages/DemoTrading.tsx`
- `apps/frontend-service/src/components/trading-v2/*`
- `apps/frontend-service/src/services/api/tradingDemo.ts`

### Hooks e composicao relevantes

- `useTradingWorkspaceNavigation.ts`
- `TradingNavigationConfig.ts`
- `useTradingSetupQueries.ts`
- `useTradingSignalMutations.ts`
- `useTradingPipelineActions.ts`

## Superficie de backend vigente

### Bootstrap, status e WebSocket

- `GET /api/integrations/trading/status`
- `GET /api/integrations/trading/ws/status`
- `GET /api/integrations/trading/intervals`
- `POST /api/integrations/trading/ws/subscribe`
- `POST /api/integrations/trading/ws/unsubscribe`

Arquivo principal: `apps/integrations-service/src/routes/trading-websocket-routes.ts`

### Signal generation e governanca de sinais

- `POST /api/integrations/trading/signals/generate`
- `GET /api/integrations/trading/signals/:id/promotion-path`
- `POST /api/integrations/trading/signals/:id/promote-real-eligibility`
- `POST /api/integrations/trading/datasets/from-signal`

Arquivos principais:

- `apps/integrations-service/src/routes/trading-signal-generation-routes.ts`
- `apps/integrations-service/src/routes/trading-signal-promotion-routes.ts`

### Auto engine

- `GET /api/trading/auto/assets`
- `POST /api/trading/auto/portfolio/run`
- `POST /api/trading/auto/signal/run`
- `GET /api/trading/auto/runs`
- `GET /api/trading/auto/runs/:id`

Arquivo principal: `apps/integrations-service/src/routes/trading-automation-routes.ts`

### Demo execution

- `POST /api/integrations/demo-trading/orders/from-signal`
- demais rotas demo em `apps/integrations-service/src/routes/demo-trading-routes.ts`

## Jornadas principais

### Bootstrap de workspace

1. `useAuth` resolve usuario e `csrfReady`.
2. `GET /api/integrations/trading/status` retorna saude do dominio, configuracao e `featureFlags.tradingWorkspaceV2Enabled`.
3. Queries de dados e WebSocket so entram quando auth, tenant, configuracao e simbolo valido estiverem prontos.

### Geracao de sinais

1. O frontend chama `POST /api/integrations/trading/signals/generate`.
2. O backend valida auth, payload, mercado, simbolo e contexto operacional.
3. `generateTradingSignalFromLlm(...)` delega a execucao ao pipeline interno do signal engine.
4. O resultado persiste em `trading_signals` e retorna `validationStatus` e `signalGeneration.stateCategory`.

### Auto runs

1. O frontend aciona `signal` ou `portfolio` via `/api/trading/auto/*`.
2. `integrations-service` cria `trading_auto_runs` e steps iniciais.
3. O processamento assincrono e feito pelo `training-service` via endpoints internos.
4. O estado terminal fica em `queued`, `running`, `succeeded`, `no_trade`, `blocked`, `failed` ou `cancelled`.

### Handoff para Demo e Training

- Demo execution: `POST /api/integrations/demo-trading/orders/from-signal`
- Dataset curation: `POST /api/integrations/trading/datasets/from-signal`
- Promotion path: leitura e promocao de elegibilidade real via rotas de signal promotion

## Contratos e guardrails que ancoram o dominio

- `tradingWorkspaceV2Enabled` e a chave canonica da feature flag; aliases legados existem apenas para compatibilidade de leitura.
- `blocked` e `no_trade` sao estados legitimos e auditaveis, nao mascarados como erro tecnico.
- Demo e Live compartilham dados de mercado quando necessario, mas a execucao permanece segregada.
- `techniqueCapabilities` governa suporte real por tecnica e evita inferencia falsa em familias ainda nao suportadas.

## Observability essencial

- `trading.workspace.usage`
- `trading.autorun.started`
- `trading.signal.pipeline.stage`
- `trading.signal.pipeline.completed`
- `trading.signal.generation.result`

## Pontos de acoplamento criticos

- `TradingContent.tsx` e `DemoTrading.tsx` continuam sendo superficies de alta composicao.
- `trading_auto_runs`, `trading_auto_run_steps` e `trading_auto_decisions` ligam `integrations-service` e `training-service`.
- `metadata` em sinais e promotions continua flexivel e exige semantica consistente.

## Referencias

- [auth-flow.md](auth-flow.md)
- [signal-engine-pipeline.md](signal-engine-pipeline.md)
- [auto-engine-state-model.md](auto-engine-state-model.md)
- [../product/workspace-shell.md](../product/workspace-shell.md)
- [../operations/training-calibration-promotion-path.md](../operations/training-calibration-promotion-path.md)
