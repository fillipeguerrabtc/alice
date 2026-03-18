# Shared Trading Workspace Shell

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Documentar a shell compartilhada de Trading usada por Real e Demo, com os modos primarios, as variacoes por ambiente e a regra de compatibilidade por feature flag.

## Estrutura do produto

- Base em `apps/frontend-service/src/components/trading-v2/`
- Composicao em `TradingContent.tsx` e `DemoTrading.tsx`
- Feature flag canonica: `tradingWorkspaceV2Enabled`
- Leitura de flags legadas existe apenas para compatibilidade

## Modos primarios

- `operate`
- `ai-signals`
- `portfolio-auto`
- `post-trade`

## Variacoes por ambiente

### Trading Real

- Mantem paines de ordens, posicoes, risco, conta e controle operacional.
- Usa dados, status e execucao real do dominio Trading.

### Demo Trading

- Reusa a mesma shell e os mesmos modos primarios.
- Explicita paper execution, saldo demo e pos-trade isolado.
- Consome handoff de sinal para demo sem bypass de guardrails.

## Progressive disclosure

- Areas avancadas saem da primeira dobra e entram em sidebar ou bottom tray.
- `research` e `governance` aparecem como areas de workspace, nao como produto paralelo nem como `lab` separado.
- O objetivo e reduzir ruido sem esconder estados criticos, guardrails ou trilha auditavel.

## Compatibilidade

- Quando a flag canonica estiver desabilitada, a UI preserva o caminho legado.
- Quando a flag estiver habilitada, Real e Demo convergem para a shell compartilhada.
- A documentacao deve citar o contrato canonico, e nao os aliases de compatibilidade.

## Referencias

- [platform-institutional.md](platform-institutional.md)
- [ai-signals-cockpit.md](ai-signals-cockpit.md)
- [demo-workspace-convergence.md](demo-workspace-convergence.md)
- [../architecture/compatibility-layer.md](../architecture/compatibility-layer.md)
