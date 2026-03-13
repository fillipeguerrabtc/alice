# Contracts e Observability do Auto Engine (Rodada 2)

Author: Fillipe Guerra  
Data: 2026-03-13

## Objetivo
Documentar contratos e sinais de observability após correção semântica do state model do Auto Engine.

## Contracts atualizados
### Backend (`integrations-service`)
- Rota: `GET /api/trading/auto/runs`
- Query `status` agora aceita:
- `queued`
- `running`
- `succeeded`
- `no_trade`
- `blocked`
- `failed`
- `cancelled`

### Frontend (`frontend-service`)
- `TradingAutoRun.status` atualizado com `no_trade` e `blocked`.
- Novo campo `TradingAutoRun.terminalReasonCode` (nullable).
- Polling de detail (`useTradingSetupQueries`) encerra também em `no_trade` e `blocked`.

## Observability estruturada no `training-service`
### Structured logs (terminal)
Para `signal_auto`, logs terminais passam a incluir:
- `terminalState`
- `reasonCode`
- `candidateCount`
- `approvedCandidateCount`
- `runDurationMs`
- `runId`
- `correlationId`

### Métricas
- Nova métrica: `trading_signal_auto_run_terminal_total`
- Labels:
- `terminalState`
- `reasonCode`

### Regras de classificação
- `TRADING_SCOPE_REQUIRED:*` => `blocked`
- Sem candidatos/sem edge/guardrail sem aprovação => `no_trade`
- Falha técnica real => `failed`
- Persistência de sinal aprovada => `succeeded`

## Compatibilidade e transição
- Runs antigos com `status=succeeded` e `noTradeReasonCode` continuam classificados no frontend por fallback.
- Novos runs passam a receber estado terminal explícito e `terminal_reason_code` persistido.

## Atualização da Rodada 5 (Signal Generation contract)
- Rota `POST /api/integrations/trading/signals/generate` passa a responder também com:
- `signalGeneration.stateCategory`
- `signalGeneration.reasonCode`
- `signalGeneration.reasonHuman`
- Com isso, o frontend passa a classificar telemetria e UX do cockpit com semântica explícita entre `signal_generated` e `no_trade`, além de expor reason code em dois níveis (machine-readable e user-readable).
