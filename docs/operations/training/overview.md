# Overview de Training

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Objetivo

Ser a porta de entrada da trilha de treinamento da Alice, consolidando o snapshot atual, os boundaries documentais e os links canonicos sem repetir runbook, historico de rodadas ou guia de negocio.

## Snapshot atual

- Serving de texto: `Qwen/Qwen3-8B-AWQ`.
- Base canonica de treino: `Qwen/Qwen3-8B`.
- Embeddings de texto: `Qwen/Qwen3-Embedding-0.6B`.
- GPU unica com orquestracao preemptiva por `alice-gpu-manager`.
- `qwen-trainer` continua on-demand; nao participa do steady state do deploy.
- Coleta e governanca ficam no `training-service`; inferencia e treino nao compartilham acesso direto aos containers GPU fora do orquestrador.
- Criacao de jobs usa `POST /api/training/jobs`; o fluxo legado especializado de trading nao e o caminho vigente.
- Compatibilidade com registros antigos de `Qwen2.5` existe apenas para leitura e transicao historica.

## Mapa da trilha

| Assunto | Documento |
| --- | --- |
| Visao geral e snapshot atual | [overview.md](overview.md) |
| Modelo de aprendizado e fluxo canonico | [learning-system.md](learning-system.md) |
| Limites, configuracoes e gates de promocao | [reference-limits.md](reference-limits.md) |
| Auto-collect, consentimento e policy gate | [auto-collect-governance.md](auto-collect-governance.md) |
| Validacao operacional em GPU real | [../runbooks/training-gpu-validation.md](../runbooks/training-gpu-validation.md) |
| Guia de negocio para uso do treinamento | [../../product/training-business-guide.md](../../product/training-business-guide.md) |

## Fluxo canonico resumido

1. Dados entram por chat, canais externos, importacao, documentos ou midia.
2. O `training-service` resolve `tenant`, `namespace`, `agent` e `domain`, aplicando quarentena quando o escopo nao e seguro.
3. O policy gate e a deduplicacao validam qualidade, consentimento e privacidade antes de liberar uso em dataset.
4. A selecao de dataset gera snapshot persistido em `training_dataset_versions`, e `lora_jobs.dataset_version_id` passa a referenciar esse manifesto imutavel.
5. O job e criado por `POST /api/training/jobs`, entra em fila e usa o orquestrador GPU para alternar entre `serving_ready` e `training_active`.
6. Promocao, ativacao e rollback continuam controlados por permissao e por gate de avaliacao.

## Boundaries documentais

- Este documento nao lista todos os endpoints nem todos os exemplos de payload.
- Limites de `system_config`, hyperparams e gates de promocao ficam em [reference-limits.md](reference-limits.md).
- Consentimento, sampling, caps diarios e policy gate ficam em [auto-collect-governance.md](auto-collect-governance.md).
- Passo a passo operacional de validacao GPU fica em [../runbooks/training-gpu-validation.md](../runbooks/training-gpu-validation.md).
- Historico de migracoes e rodadas fechadas fica em [../../archive/reports/status/qwen3-8b-migration.md](../../archive/reports/status/qwen3-8b-migration.md) e [../../archive/plans/codex-enterprise-execution.md](../../archive/plans/codex-enterprise-execution.md).

## SSOTs relacionados

- [../../architecture/gpu-manager.md](../../architecture/gpu-manager.md)
- [../../operations/deployment.md](../../operations/deployment.md)
- [learning-system.md](learning-system.md)
- [reference-limits.md](reference-limits.md)
- [auto-collect-governance.md](auto-collect-governance.md)
