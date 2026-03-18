# Status Atual da Plataforma Alice

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Objetivo

Registrar um snapshot curto do estado atual da plataforma, sem acumular historico de rodadas, changelog extensivo ou relato de execucao pontual.

## Snapshot confirmado

- Arquitetura modular multi-stack em `INFRA`, `ALICE`, `OBSERVABILITY` e `BACKUP`.
- Operacao oficial com integracoes reais, sem mocks, stubs ou persistencia in-memory.
- Serving de texto em `Qwen/Qwen3-8B-AWQ`, treino em `Qwen/Qwen3-8B` e embeddings em `Qwen/Qwen3-Embedding-0.6B`.
- `alice-gpu-manager` continua como boundary unico para orquestracao de GPU e alternancia entre inferencia e treino.
- `qwen-trainer` continua on-demand; ausencia dele em steady state do deploy e esperada.
- `training-service` concentra coleta, governanca, versionamento de dataset, jobs e ativacao de adapters por escopo.
- Pipeline vigente separa `CI`, `Release` e `Deploy`; `docs-only` e `pipeline-only` nao seguem automaticamente para publicacao.

## Estado por trilha

### Plataforma e operacao

- Topologia, stacks e servicos: [../architecture/platform.md](../architecture/platform.md)
- Orquestracao de GPU: [../architecture/gpu-manager.md](../architecture/gpu-manager.md)
- Deploy, release e smart pull: [../operations/deployment.md](../operations/deployment.md), [../operations/release.md](../operations/release.md) e [../operations/deploy.md](../operations/deploy.md)

### Treinamento e aprendizado

- Visao geral do treinamento: [../operations/training/overview.md](../operations/training/overview.md)
- Modelo de aprendizado: [../operations/training/learning-system.md](../operations/training/learning-system.md)
- Limites e governanca: [../operations/training/reference-limits.md](../operations/training/reference-limits.md) e [../operations/training/auto-collect-governance.md](../operations/training/auto-collect-governance.md)
- Guia de uso por negocio: [../product/training-business-guide.md](../product/training-business-guide.md)

### Planejamento e historico

- Roadmap ativo: [roadmap.md](roadmap.md)
- Historico detalhado de execucao por rodada: [../archive/plans/codex-enterprise-execution.md](../archive/plans/codex-enterprise-execution.md)
- Historico especifico da migracao Qwen3: [../archive/reports/status/qwen3-8b-migration.md](../archive/reports/status/qwen3-8b-migration.md)

## Leitura correta deste documento

- Este arquivo e um snapshot de estado, nao um changelog.
- Se um detalhe depender de sequencia temporal, a referencia correta esta em `docs/archive/`.
- Em caso de divergencia entre status e SSOT tematico, prevalece o documento canonico da trilha correspondente.
