# Garantias de Isolamento Demo Trading

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Registrar as garantias tecnicas que mantem a Demo Trading estritamente isolada da execucao Live.

## Garantias de isolamento

- Rotas demo vivem em `/api/integrations/demo-trading/*`.
- Handoff de sinal para demo vive em `/api/integrations/demo-trading/orders/from-signal`.
- Persistencia demo e separada em artefatos `demo*`, sempre com scoping por `tenantId`.
- Post-mortem demo e marcado com `isDemo=true`.
- Nao existe chamada de execucao live dentro do fluxo de ordem demo.

## Evidencias no codigo

- `apps/integrations-service/src/demo-trading-engine.ts`
- `apps/integrations-service/src/routes/demo-trading-routes.ts`
- `apps/integrations-service/src/routes/postmortem-routes.ts`
- `apps/integrations-service/src/postmortem-worker.ts`

## Observacoes operacionais

- Mercado e precificacao podem ser compartilhados com o dominio real.
- A execucao continua paper-only mesmo quando a Demo usa a mesma shell V2 do produto principal.
- Qualquer rollout de UI deve preservar esse boundary antes de qualquer ganho de UX.
