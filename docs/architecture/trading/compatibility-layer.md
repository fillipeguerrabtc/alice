# Arquitetura Final e Compatibility Layer da Trading Workspace V2

Author: Fillipe Guerra  
Data: 2026-03-13

## Objetivo
Consolidar a arquitetura final da Trading Workspace V2 e registrar a camada de compatibilidade usada para migração segura sem perda funcional do legado.

## Arquitetura consolidada
- Workspace V2 compartilhada entre ambientes `real` e `demo`.
- Modos primários unificados: `operate`, `ai-signals`, `portfolio-auto`, `post-trade`.
- Progressive disclosure para áreas avançadas, reduzindo ruído na primeira dobra.
- Reuso dos data sources e contracts reais já existentes no monorepo.

## Compatibility layer implementada
- Adapter de rollout por feature flag:
- `workspace-rollout-adapter.ts` com fallback seguro para chaves legadas (`trading_workspace_v2_enabled`, `tradingV2Enabled`).
- Adapter de estado do cockpit:
- `ai-signals-cockpit-state-adapter.ts` para mapear estados terminais de forma explícita (`blocked`, `no_trade`, `signal_generated`, `executed`, `failed`, `running`).
- Adapter de handoff demo:
- `ai-signals-demo-handoff-adapter.ts` para validação de payload, elegibilidade e bloqueios sem lógica duplicada no componente.

## Contracts e rotas compatíveis
- Frontend API:
- Alias para `getTradingSignalPromotionPath`, `sendTradingSignalToTrainingDataset` e `sendTradingSignalToDemoExecution`.
- Backend API:
- Alias de leitura: `GET /api/integrations/trading/signals/:id/promotion`.
- Alias de promoção: `POST /api/integrations/trading/signals/:id/promote-live-eligibility`.
- Contracts canônicos continuam ativos e são a referência oficial para evolução futura.

## Critério de remoção futura de compatibilidade
- Remover aliases apenas após janela estável de rollout sem erro de consumer legado.
- Validar observability de uso dos paths legados antes de qualquer remoção.
- Executar remoção faseada com checklist de rollback.
