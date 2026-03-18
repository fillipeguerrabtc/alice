# Demo Trading na Workspace Compartilhada

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Descrever como a Demo Trading opera hoje na mesma shell de workspace do produto principal, preservando isolamento de execucao e sem depender de uma UX paralela.

## Comportamento vigente

- A Demo usa a mesma shell V2 quando `tradingWorkspaceV2Enabled` esta ativo.
- Os modos `operate`, `ai-signals`, `portfolio-auto` e `post-trade` continuam disponiveis.
- O caminho legado permanece apenas como fallback funcional de compatibilidade.

## Handoff de sinais

- Leitura de sinais permanece no dominio Trading.
- Execucao paper usa `POST /api/integrations/demo-trading/orders/from-signal`.
- A Demo invalida caches de saldo, ordens e posicoes apos handoff bem-sucedido.

## Limites do ambiente demo

- Paper execution continua separado de live execution.
- Post-mortem e trilha demo continuam isolados.
- O compartilhamento de shell nao muda os boundaries operacionais do ambiente.

## Referencias

- [workspace-shell.md](workspace-shell.md)
- [../architecture/demo-isolation-guarantees.md](../architecture/demo-isolation-guarantees.md)
- [../runbooks/migration-rollback.md](../runbooks/migration-rollback.md)
