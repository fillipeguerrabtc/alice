# Training: Limites e Configuracoes de Referencia

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Objetivo

Registrar os limites e knobs canonicos do treinamento que podem ser alterados por `system_config`, sem repetir explicacoes de negocio nem procedimento operacional de runbook.

## Precedencia de configuracao

1. Valor persistido em `system_config`.
2. Fallback de ambiente carregado pelo servico.
3. Default canonico do codigo.

## Gates de dataset

| Chave | Default atual | Faixa aceita | Papel |
| --- | --- | --- | --- |
| `MIN_ONDEMAND_DATASET_SIZE` | `20` | `1..100000` | minimo para `on_demand` e `custom_job` |
| `MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL` | `50` | `1..100000` | minimo para run incremental agendada |
| `MIN_SCHEDULED_DATASET_SIZE_FULL` | `200` | `1..100000` | minimo para run full agendada |
| `TRAINING_QUALITY_MIN_RATIO` | `0.60` | `0..1` | gate minimo de qualidade do dataset |
| `TRAINING_DATASET_MAX_ROWS` | `5000` | `100..1000000` | cap total de linhas do dataset persistido |
| `TRAINING_TRAIN_EVAL_SPLIT_RATIO` | `0.90` | `0.5..0.99` | split treino/avaliacao |

## Execucao GPU

| Chave | Default atual | Faixa aceita | Papel |
| --- | --- | --- | --- |
| `TRAINING_SLICE_STEPS` | `10` | `1..100000` | passos por slice no `gpu-trainer` |
| `TRAINING_GPU_TIMEOUT_MS` | `120000` | `1000..3600000` | timeout por slice de treino |
| `TRAINING_MAX_INFLIGHT_RUNS_PER_TENANT` | `5` | `1..1000` | concorrencia maxima de runs por tenant |

## Hyperparams suportados

Os JSONs de hyperparams e presets validam o mesmo contrato compartilhado:

| Campo | Regra atual |
| --- | --- |
| `epochs` | inteiro `1..50` |
| `learningRate` | numero `> 0` e `< 1` |
| `batchSize` | inteiro `1..64` |
| `maxSeqLen` | inteiro `256..32768` |
| `gradientAccumulationSteps` | inteiro `1..128` |
| `warmupSteps` | inteiro `0..10000` |
| `loraRank` | inteiro `4..128` |
| `loraAlpha` | inteiro `8..256` |
| `loraDropout` | numero `0..0.5` |
| `lrSchedulerType` | `constant`, `constant_with_warmup`, `linear`, `cosine`, `cosine_with_restarts`, `polynomial`, `inverse_sqrt`, `reduce_lr_on_plateau` |
| `maxGradNorm` | numero `> 0` e `<= 100` |
| `targetModules` | array nao vazio de strings |

## Presets canonicos atuais

| Chave | Default atual |
| --- | --- |
| `TRAINING_DEFAULT_HYPERPARAMS_JSON` | `epochs=2`, `learningRate=0.0001`, `batchSize=2`, `maxSeqLen=1536`, `gradientAccumulationSteps=4`, `warmupSteps=100`, `loraRank=16`, `loraAlpha=32`, `loraDropout=0.05`, `lrSchedulerType=linear`, `maxGradNorm=1`, `targetModules=[q_proj,v_proj]` |
| `TRAINING_PRESET_SAFE_JSON` | mesmo baseline conservador do default |
| `TRAINING_PRESET_STANDARD_JSON` | `epochs=3`, `learningRate=0.0002`, `batchSize=2`, `maxSeqLen=1536`, `gradientAccumulationSteps=4`, `warmupSteps=100`, `loraRank=16`, `loraAlpha=32`, `loraDropout=0.05`, `lrSchedulerType=linear`, `maxGradNorm=1`, `targetModules=[q_proj,v_proj]` |
| `TRAINING_PRESET_LARGE_JSON` | `epochs=1`, `learningRate=0.0001`, `batchSize=2`, `maxSeqLen=1536`, `gradientAccumulationSteps=8`, `warmupSteps=100`, `loraRank=16`, `loraAlpha=32`, `loraDropout=0.05`, `lrSchedulerType=linear`, `maxGradNorm=1`, `targetModules=[q_proj,v_proj]` |

## Agenda e promocao

| Chave | Default atual | Papel |
| --- | --- | --- |
| `AUTO_LEARNING_CRON_INCREMENTAL` | `0 3 * * 0` | agenda incremental |
| `AUTO_LEARNING_CRON_FULL` | `0 1 1,15 * *` | agenda full |
| `AUTO_LEARNING_INCLUDE_IMAGES` | `true` | inclui imagens quando a rotina automatica suportar |
| `TRAINING_EVAL_MAX_LOSS` | `2.0` | gate de avaliacao |
| `TRAINING_AUTO_PROMOTE_SCHEDULED` | `false` | promocao automatica apenas quando habilitada |
| `TRAINING_PROMOTION_REQUIRE_EVAL_PASSED` | `true` | exige avaliacao aprovada para promover |
| `TRAINING_PROMOTION_REQUIRE_APPROVAL_GATES` | `true` | exige gates de aprovacao |
| `TRAINING_PROMOTION_REQUIRE_DUAL_APPROVAL` | `false` | dual approval desabilitado por default |
| `TRAINING_PROMOTION_MIN_APPROVALS` | `2` | minimo de aprovacoes quando a politica exigir |

## Regras operacionais

- `POST /api/training/jobs` continua sendo o ponto de criacao de job customizado.
- Promocao e rollback continuam expostos por `POST /api/training/jobs/:id/promote` e `POST /api/training/jobs/:id/rollback`.
- O treinamento segue modelo `enqueue-only`; request HTTP nao executa treino pesado inline.
- Mudanca de limite deve ser feita primeiro em `system_config`, nao por ajuste ad hoc em payload ou documento.

## Referencias

- [overview.md](overview.md)
- [learning-system.md](learning-system.md)
- [auto-collect-governance.md](auto-collect-governance.md)
- [../runbooks/training-gpu-validation.md](../runbooks/training-gpu-validation.md)
