# Garantias de Isolamento Demo Trading

Author: Fillipe Guerra  
Data: 2026-03-12

## Objetivo
Registrar as garantias técnicas que mantêm execução Demo estritamente isolada da execução Live.

## Garantias de isolamento
- Rotas de execução demo segregadas em `/api/integrations/demo-trading/*`.
- Handoff de sinal para demo segregado em `/api/integrations/demo-trading/orders/from-signal`.
- Persistência separada por domínio demo (`demoBalances`, `demoOrders`, `demoPositions`, `demoFundHistory`) com escopo por `tenantId`.
- Post-mortem com marcação explícita `isDemo=true` e processamento assíncrono dedicado.
- Enforcement de tenant em rotas e queries (`req.tenantId`, `withTenantContext`, filtros SQL por tenant).
- Ausência de chamadas de execução de ordem live dentro do fluxo de ordem demo.

## Evidências de código
- Engine demo: `apps/integrations-service/src/demo-trading-engine.ts`
- Rotas demo: `apps/integrations-service/src/routes/demo-trading-routes.ts`
- Rotas post-mortem: `apps/integrations-service/src/routes/postmortem-routes.ts`
- Worker post-mortem: `apps/integrations-service/src/postmortem-worker.ts`

## Observações operacionais
- Dados de mercado podem ser compartilhados (fonte de preço), mas a execução permanece paper-only.
- O caminho V2 da Demo torna explícito o isolamento no modo `ai-signals` por cards dedicados de guardrails.
