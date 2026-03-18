# Indice do Dominio Trading

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** indice

## Objetivo

Ser a porta de entrada do dominio Trading, separando claramente o que e SSOT canonico, o que e procedimento operacional e o que e historico arquivado.

## Precedencia do dominio

1. Instrucoes ativas de sistema, developer e usuario no bloco atual.
2. [AGENTS.md](../../AGENTS.md) e [CLAUDE.md](../../CLAUDE.md).
3. [docs/INDEX.md](../INDEX.md) como regra editorial global.
4. Este indice para navegacao e classificacao do dominio Trading.
5. SSOTs canonicos em `docs/trading/architecture/`, `docs/trading/product/` e `docs/trading/operations/`.
6. Runbooks ativos em `docs/trading/runbooks/`.
7. Historico temporal em `docs/archive/`, sem precedencia sobre o SSOT vigente.

## Como o dominio esta classificado

### Canonicos de dominio

- Arquitetura: [architecture/domain-map.md](architecture/domain-map.md), [architecture/auth-flow.md](architecture/auth-flow.md), [architecture/signal-engine-pipeline.md](architecture/signal-engine-pipeline.md), [architecture/auto-engine-state-model.md](architecture/auto-engine-state-model.md), [architecture/auto-engine-contracts-observability.md](architecture/auto-engine-contracts-observability.md), [architecture/demo-isolation-guarantees.md](architecture/demo-isolation-guarantees.md) e [architecture/compatibility-layer.md](architecture/compatibility-layer.md).
- Produto: [product/platform-institutional.md](product/platform-institutional.md), [product/workspace-shell.md](product/workspace-shell.md), [product/ai-signals-cockpit.md](product/ai-signals-cockpit.md), [product/demo-workspace-convergence.md](product/demo-workspace-convergence.md) e [product/strategy-specialists-data-requirements.md](product/strategy-specialists-data-requirements.md).
- Operacao de dominio: [operations/training-calibration-promotion-path.md](operations/training-calibration-promotion-path.md).

### Operacionais e runbooks

- Portal de runbooks: [runbooks/INDEX.md](runbooks/INDEX.md)
- Rollout e rollback funcional da Workspace: [runbooks/migration-rollback.md](runbooks/migration-rollback.md)
- Validacao operacional de Trading: [runbooks/operacao-testes.md](runbooks/operacao-testes.md)

### Historico e material temporal

- Plano arquivado da refatoracao: [../archive/plans/trading-refactor.md](../archive/plans/trading-refactor.md)
- Registro historico de correcao critica: [../archive/root/trading-critical-errors-2026-02-16.md](../archive/root/trading-critical-errors-2026-02-16.md)
- Relatorios historicos adicionais com foco em trading permanecem em `docs/archive/relatorios/` e `docs/archive/reports/`.

## Dependencias documentais fora do dominio

- Validacao de codigo e escopo incremental: [../engineering/validation-monorepo.md](../engineering/validation-monorepo.md)
- Pipeline, release e deploy: [../engineering/pipeline-overview.md](../engineering/pipeline-overview.md), [../operations/release.md](../operations/release.md) e [../operations/deploy.md](../operations/deploy.md)
- Observability de plataforma: [../operations/observability.md](../operations/observability.md)
- Onboarding operacional geral: [../operations/getting-started.md](../operations/getting-started.md)

## Regras editoriais do dominio

- Documento canonico de Trading deve descrever comportamento vigente, contratos ativos e guardrails atuais.
- Referencias a `release`, `deploy` e `validacao` devem apontar para os SSOTs gerais, sem duplicar a governanca da esteira.
- `research` aparece no produto apenas como area de workspace e governance; nao existe um `lab` separado como trilha documental ativa do dominio.
- Plano, rollout por rodada, fechamento de implementacao e incidente historico pertencem ao `archive`.
