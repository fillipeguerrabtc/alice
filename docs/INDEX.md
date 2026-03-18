# Indice de Documentacao - Alice

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Objetivo

Ser o portal principal da documentacao do repositorio, definindo a taxonomia vigente, a navegacao e a precedencia sem duplicar conteudo tecnico.

## Regra de precedencia

1. Instrucoes ativas de sistema, developer e usuario no bloco atual.
2. [AGENTS.md](../AGENTS.md) e [CLAUDE.md](../CLAUDE.md) para governanca permanente de agentes, engenharia e operacao.
3. `docs/INDEX.md` como mapa editorial da taxonomia vigente.
4. SSOTs tematicos duraveis em `docs/architecture/`, `docs/operations/`, `docs/product/` e `docs/engineering/`.
5. Contexto temporal ativo em `docs/status/` e no rollout de refatoracao documental.
6. [docs/archive/INDEX.md](archive/INDEX.md) e o restante de `docs/archive/` apenas como historico.

[README.md](../README.md) e `docs/INDEX.md` sao portas de entrada. Eles nao substituem o SSOT tecnico dos documentos tematicos.

## Taxonomia vigente

- Raiz obrigatoria: [README.md](../README.md), [AGENTS.md](../AGENTS.md) e [CLAUDE.md](../CLAUDE.md).
- Portal documental: [docs/INDEX.md](INDEX.md).
- Arquitetura: [docs/architecture/platform.md](architecture/platform.md) e [docs/architecture/gpu-manager.md](architecture/gpu-manager.md).
- Operacoes: [docs/operations/deployment.md](operations/deployment.md), [docs/operations/release.md](operations/release.md), [docs/operations/deploy.md](operations/deploy.md), [docs/operations/observability.md](operations/observability.md), [docs/operations/secrets.md](operations/secrets.md), [docs/operations/permissions.md](operations/permissions.md), onboarding em [docs/operations/getting-started.md](operations/getting-started.md), treinamento em [docs/operations/training/](operations/training/) e runbooks em [docs/operations/runbooks/INDEX.md](operations/runbooks/INDEX.md).
- Produto: [docs/product/design-guidelines.md](product/design-guidelines.md) e [docs/product/training-business-guide.md](product/training-business-guide.md).
- Trading: [docs/trading/INDEX.md](trading/INDEX.md), com separacao explicita entre arquitetura, produto, operacao e runbooks do dominio.
- Engenharia: [docs/engineering/pipeline-overview.md](engineering/pipeline-overview.md), [docs/engineering/validation-monorepo.md](engineering/validation-monorepo.md) e [docs/engineering/pull-inteligente-flow.md](engineering/pull-inteligente-flow.md).
- Status ativo: [docs/status/current-platform-status.md](status/current-platform-status.md), [docs/status/roadmap.md](status/roadmap.md) e [docs/documentation-refactor-rollout.md](documentation-refactor-rollout.md).
- Historico arquivado: [docs/archive/INDEX.md](archive/INDEX.md), com planos em `docs/archive/plans/`, relatorios em `docs/archive/reports/`, notas historicas da raiz em `docs/archive/root/`, notas operacionais em `docs/archive/ops/` e lote legado em `docs/archive/relatorios/`.

## SSOTs principais por trilha

### Arquitetura

- [docs/architecture/platform.md](architecture/platform.md)
- [docs/architecture/gpu-manager.md](architecture/gpu-manager.md)

### Operacoes

- [docs/operations/deployment.md](operations/deployment.md)
- [docs/operations/release.md](operations/release.md)
- [docs/operations/deploy.md](operations/deploy.md)
- [docs/operations/observability.md](operations/observability.md)
- [docs/operations/secrets.md](operations/secrets.md)
- [docs/operations/permissions.md](operations/permissions.md)
- [docs/operations/runbooks/INDEX.md](operations/runbooks/INDEX.md)

### Produto

- [docs/product/design-guidelines.md](product/design-guidelines.md)
- [docs/product/training-business-guide.md](product/training-business-guide.md)

### Trading

- [docs/trading/INDEX.md](trading/INDEX.md)
- [docs/trading/architecture/domain-map.md](trading/architecture/domain-map.md)
- [docs/trading/product/platform-institutional.md](trading/product/platform-institutional.md)
- [docs/trading/operations/training-calibration-promotion-path.md](trading/operations/training-calibration-promotion-path.md)

### Engenharia

- [docs/engineering/pipeline-overview.md](engineering/pipeline-overview.md)
- [docs/engineering/validation-monorepo.md](engineering/validation-monorepo.md)
- [docs/engineering/pull-inteligente-flow.md](engineering/pull-inteligente-flow.md)

## Regras editoriais

- Documento canonico deve viver fora de `docs/archive/` e nao depender de historico para ser compreendido.
- Documento datado, por rodada, review, validacao, plano ou snapshot nao ocupa espaco canonico tematico.
- `docs/status/` concentra contexto temporal ativo; material fechado, supersedido ou apenas rastreavel pertence ao archive.
- Em caso de divergencia entre archive e documentacao vigente, sempre prevalece o documento canonico tematico aplicavel.
