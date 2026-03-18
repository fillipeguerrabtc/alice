# Camada de Compatibilidade da Trading Workspace

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Objetivo

Registrar a superficie de compatibilidade ainda ativa no dominio Trading e deixar claro qual e o contrato canonico a partir do qual a evolucao deve continuar.

## Contratos canonicos

- Feature flag: `tradingWorkspaceV2Enabled`
- Promotion path: `GET /api/integrations/trading/signals/:id/promotion-path`
- Promocao para real eligibility: `POST /api/integrations/trading/signals/:id/promote-real-eligibility`

## Compatibilidade ainda suportada

### Feature flags legadas

- `trading_workspace_v2_enabled`
- `tradingV2Enabled`

Leitura legada existe apenas no `workspace-rollout-adapter.ts`. A documentacao e os novos consumers devem usar a chave canonica.

### Aliases de rotas legadas

- `GET /api/integrations/trading/signals/:id/promotion`
- `POST /api/integrations/trading/signals/:id/promote-live-eligibility`

Esses aliases continuam ativos para consumers antigos, mas nao sao o SSOT para novos integradores.

### Adapters de frontend

- `workspace-rollout-adapter.ts`
- `ai-signals-cockpit-state-adapter.ts`
- `ai-signals-demo-handoff-adapter.ts`

Esses adapters existem para normalizar flag, estado e handoff sem espalhar logica de compatibilidade pela UI.

## Regra editorial

- Sempre documentar primeiro o contrato canonico.
- Compatibilidade deve aparecer como nota de transicao, nao como caminho principal.
- Qualquer revisao de rollout ou rollback deve verificar se a camada legada ainda esta em uso real.

## Referencias

- [domain-map.md](domain-map.md)
- [../product/workspace-shell.md](../product/workspace-shell.md)
- [../runbooks/migration-rollback.md](../runbooks/migration-rollback.md)
