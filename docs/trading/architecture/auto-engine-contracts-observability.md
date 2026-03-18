# Contracts e Observability do Auto Engine

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Documentar os contratos ativos do Auto Engine e os sinais de observability necessarios para leitura operacional do ciclo de vida de auto runs e signal generation.

## Contracts vigentes

### Backend

- `GET /api/trading/auto/runs`
- `GET /api/trading/auto/runs/:id`
- O filtro `status` aceita `queued`, `running`, `succeeded`, `no_trade`, `blocked`, `failed` e `cancelled`.

### Frontend

- `TradingAutoRun.status` deve aceitar os mesmos valores do backend.
- `TradingAutoRun.terminalReasonCode` expoe motivo terminal quando houver.
- O polling de detalhe encerra em qualquer estado terminal explicito.

### Signal generation

- `POST /api/integrations/trading/signals/generate` retorna `signalGeneration.stateCategory`.
- O bloco `signalGeneration` tambem pode trazer `reasonCode` e `reasonHuman`.
- A UX do cockpit deve diferenciar `signal_generated`, `no_trade`, `blocked` e `failed`.

## Observability minima

### Eventos e logs

- `trading.autorun.started`
- `trading.signal.generation.result`
- `trading.signal.pipeline.stage`
- `trading.signal.pipeline.completed`

### Campos que nao devem sumir

- `terminalState`
- `reasonCode`
- `runId`
- `correlationId`
- `candidateCount`
- `approvedCandidateCount`
- `runDurationMs`

### Metricas

- `trading_signal_auto_run_terminal_total`
- Labels principais: `terminalState` e `reasonCode`

## Regras de classificacao

- `TRADING_SCOPE_REQUIRED:*` deve aparecer como `blocked`.
- Ausencia de candidatos, edge insuficiente ou reprovacao por guardrail deve aparecer como `no_trade`.
- Falha tecnica real continua como `failed`.
- Persistencia concluida com sinal valido continua como `succeeded`.

## Referencias

- [auto-engine-state-model.md](auto-engine-state-model.md)
- [signal-engine-pipeline.md](signal-engine-pipeline.md)
- [../product/ai-signals-cockpit.md](../product/ai-signals-cockpit.md)
