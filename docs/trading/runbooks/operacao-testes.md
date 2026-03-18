# Runbook de Validacao Operacional do Trading

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** runbook

## Objetivo

Concentrar os checks operacionais do dominio Trading que precisam ser reexecutados quando houver mudanca funcional em workspace, sinais, auto runs ou handoffs.

## Checks de bootstrap

- Usuario autenticado acessa Trading Real sem queries prematuras.
- Usuario autenticado acessa Demo Trading sem queries prematuras.
- `GET /api/integrations/trading/status` responde com `featureFlags.tradingWorkspaceV2Enabled`.
- WebSocket so conecta quando auth, configuracao e simbolo valido estiverem prontos.

## Checks de sinais

- `POST /api/integrations/trading/signals/generate` retorna `signalGeneration.stateCategory`.
- Estados `blocked` e `no_trade` aparecem de forma explicita na UX.
- `GET /api/integrations/trading/signals/:id/promotion-path` responde para sinal valido.
- `POST /api/integrations/trading/datasets/from-signal` respeita guardrails de lineage.

## Checks de demo

- `POST /api/integrations/demo-trading/orders/from-signal` executa apenas quando elegivel.
- Paper execution nao cria efeito colateral em fluxo live.
- Saldo, ordens e posicoes demo invalidam cache apos handoff.

## Checks de auto engine

- `POST /api/trading/auto/signal/run` e `POST /api/trading/auto/portfolio/run` criam runs validos.
- Estados terminais `succeeded`, `no_trade`, `blocked`, `failed` e `cancelled` ficam legiveis em API e UI.
- `terminalReasonCode` permanece consultavel quando houver encerramento terminal.

## Escopo de validacao de codigo

- Quando houver mudanca executavel, seguir o SSOT de escopo incremental em [../../engineering/validation-monorepo.md](../../engineering/validation-monorepo.md).
- Quando a mudanca for apenas documental, este runbook nao exige typecheck, lint, teste ou build.
