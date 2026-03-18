# Migracao Qwen3-8B

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** arquivado e concluido

## Objetivo

Preservar um resumo historico da migracao para Qwen3 sem manter este arquivo como tracking cumulativo de rodadas.

## Resultado consolidado

- Serving canonico definido em `Qwen/Qwen3-8B-AWQ`.
- Base canonica de treino definida em `Qwen/Qwen3-8B`.
- Embeddings canonicos definidos em `Qwen/Qwen3-Embedding-0.6B`.
- Orquestracao GPU preemptiva consolidada entre `training-service`, `gpu-manager`, frontend e runtime.
- `reasoningMode` auditavel (`auto`, `thinking`, `non_thinking`) mantido no fluxo atual de chat e sinais IA.
- Compatibilidade com registros legados `Qwen2.5` preservada apenas como camada historica de leitura.

## Onde o estado atual vive agora

- Snapshot atual da plataforma: [../../../status/current-platform-status.md](../../../status/current-platform-status.md)
- Arquitetura de GPU: [../../../architecture/gpu-manager.md](../../../architecture/gpu-manager.md)
- Treinamento e aprendizado: [../../../operations/training/overview.md](../../../operations/training/overview.md) e [../../../operations/training/learning-system.md](../../../operations/training/learning-system.md)

## Onde o detalhamento historico vive agora

- Tracking de execucao por rodada: [../../plans/codex-enterprise-execution.md](../../plans/codex-enterprise-execution.md)
- Relatorios e validacoes fechadas relacionados a rollout permanecem em `docs/archive/reports/`

## Uso correto deste arquivo

- Este documento e apenas memoria historica arquivada.
- Novas mudancas de modelo, rollout ou operacao nao devem reabrir este arquivo como SSOT.
