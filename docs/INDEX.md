# Indice de Documentacao - Alice

**Author:** Fillipe Guerra
**Data:** 17 de Marco de 2026
**Atualizado:** 17 de Marco de 2026

## Objetivo

Ser o portal principal da documentacao do repositorio, definindo navegacao e precedencia sem duplicar conteudo tecnico.

## Regra de precedencia

1. Instrucoes ativas de sistema, developer e usuario no bloco atual.
2. [AGENTS.md](../AGENTS.md) e [CLAUDE.md](../CLAUDE.md) para governanca permanente de agentes, engenharia e operacao.
3. Documentos canonicos tematicos vigentes em `docs/`.
4. Documentos temporais ativos, como planos, rollouts, status, reviews e relatorios, apenas como contexto.
5. [docs/archive/INDEX.md](archive/INDEX.md) e todo o conteudo em [docs/archive/](archive/) apenas como historico.

[README.md](../README.md) e `docs/INDEX.md` sao portas de entrada. Eles nao substituem o SSOT tecnico dos documentos tematicos.

> Ate a reorganizacao fisica completa da taxonomia, a precedencia e definida por esta classificacao editorial, nao pela pasta onde o arquivo esta.

## Documentos canonicos da raiz

- [README.md](../README.md): visao geral e quick start.
- [AGENTS.md](../AGENTS.md): guia operacional permanente para agentes.
- [CLAUDE.md](../CLAUDE.md): SSOT de engenharia, operacao e entrega.

## Documentacao canonica tematica

### Arquitetura

- [docs/ARQUITETURA.md](ARQUITETURA.md)
- [docs/ARQUITETURA-GPU-MANAGER.md](ARQUITETURA-GPU-MANAGER.md)

### Operacao e deploy

- [docs/DEPLOYMENT.md](DEPLOYMENT.md)
- [docs/OBSERVABILITY.md](OBSERVABILITY.md)
- [docs/VALIDACAO-INCREMENTAL-MONOREPO.md](VALIDACAO-INCREMENTAL-MONOREPO.md)

### Configuracao e seguranca

- [docs/GUIA-CONFIGURACAO-INICIAL.md](GUIA-CONFIGURACAO-INICIAL.md)
- [docs/SECRETS.md](SECRETS.md)
- [docs/PERMISSIONS.md](PERMISSIONS.md)

## Documentacao temporal ativa

- [docs/documentation-refactor-rollout.md](documentation-refactor-rollout.md): plano e acompanhamento da refatoracao documental.
- [docs/STATUS-REAL-ATUAL.md](STATUS-REAL-ATUAL.md): snapshot operacional do momento.
- [docs/ROADMAP.md](ROADMAP.md): direcionamento futuro.
- [docs/PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md](PLANO-IMPLEMENTACAO-ENTERPRISE-BLOCOS.md), [docs/PLANO-DE-CORRECOES-ENTERPRISE.md](PLANO-DE-CORRECOES-ENTERPRISE.md) e [docs/PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md](PLANO-EXECUCAO-CODEX-ENTERPRISE-2026-03-10.md): planos e trackers ativos.
- `docs/RELATORIO-*.md`, `docs/REVISAO_*.md`, `docs/MODULARIZACAO-*.md` e `docs/STATUS_*.md`: evidencias temporais de execucao, review e validacao.

## Historico arquivado

- Indice historico: [docs/archive/INDEX.md](archive/INDEX.md)
- Conteudo arquivado: [docs/archive/relatorios/](archive/relatorios/)

Em caso de divergencia entre archive e documentacao vigente, sempre prevalece o documento canonico tematico aplicavel.
