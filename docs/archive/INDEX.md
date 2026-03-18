# Indice de Historico Arquivado - Alice

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** indice

## Objetivo

Preservar rastreabilidade documental de planos, relatorios, revisoes, snapshots e notas historicas sem poluir o espaco canonico do SSOT.

## Escopo do archive

- Conteudos historicos, datados, fechados ou mantidos apenas por rastreabilidade.
- Material sem precedencia sobre os documentos vigentes mapeados em [docs/INDEX.md](../INDEX.md).
- Evidencias temporais que nao devem permanecer no espaco canonico tematico.

## Estrutura vigente

- `docs/archive/plans/`: planos, trackers e rollouts temporais movidos da raiz de `docs/`.
- `docs/archive/reports/implementation/`: relatorios de correcao, execucao e refatoracao por rodada.
- `docs/archive/reports/reviews/`: reviews e revisoes tecnicas datadas.
- `docs/archive/reports/validation/`: relatorios de validacao e fechamento.
- `docs/archive/reports/status/`: snapshots e migracoes temporais preservadas como historico.
- `docs/archive/root/`: markdowns datados que antes estavam soltos na raiz do repositorio.
- `docs/archive/ops/`: notas operacionais historicas fora do SSOT.
- `docs/archive/relatorios/`: lote legado arquivado antes da taxonomia atual.

## Referencias principais

- Planos arquivados: `docs/archive/plans/codex-enterprise-execution.md`, `docs/archive/plans/enterprise-implementation-blocks.md`, `docs/archive/plans/enterprise-corrections.md`, `docs/archive/plans/trading-refactor.md`
- Implementacao arquivada: `docs/archive/reports/implementation/agentic-refactor-2026-02-27.md`, `docs/archive/reports/implementation/modularizacao-shared-chat-3-2026-03-17.md`
- Reviews arquivadas: `docs/archive/reports/reviews/chat-enterprise-review-2026-03-12.md`, `docs/archive/reports/reviews/chat-enterprise-review-2026-03-15.md`
- Status arquivado: `docs/archive/reports/status/qwen3-8b-migration.md`
- Raiz arquivada: `docs/archive/root/trading-critical-errors-2026-02-16.md`
- Operacoes arquivadas: `docs/archive/ops/rag-doc-processing-2026-03-01.md`

## Regra de uso

- Em caso de divergencia entre historico arquivado e documentacao canonica, prevalecem os SSOT definidos em [docs/INDEX.md](../INDEX.md).
