# Treinamento: Limites, Configuracoes e Boas Praticas (2026)

**Autor:** Fillipe Guerra  
**Data:** 03 de Marco de 2026  
**Objetivo:** SSOT dos limites/configuracoes de treinamento, pipeline em fila, avaliacao e promocao/rollback.

---

## 1. Configuracoes editaveis via UI (System Settings)

Todas as chaves abaixo sao lidas de `system_config` (PostgreSQL) e podem ser editadas na UI em **Configuracoes do Sistema**.  
Se a chave nao existir no banco, o backend usa fallback de ambiente/default.

### 1.1 Gates de dados e dataset (20GB recomendado)

| Chave | Default | Efeito |
|---|---:|---|
| `MIN_ONDEMAND_DATASET_SIZE` | `20` | Minimo de exemplos aprovados para run `on_demand` e `custom_job`. |
| `MIN_SCHEDULED_DATASET_SIZE_INCREMENTAL` | `50` | Minimo de exemplos para run agendada incremental. |
| `MIN_SCHEDULED_DATASET_SIZE_FULL` | `200` | Minimo de exemplos para run agendada completa. |
| `TRAINING_QUALITY_MIN_RATIO` | `0.60` | Qualidade minima para liberar run. |
| `TRAINING_DATASET_MAX_ROWS` | `5000` | Cap de linhas no dataset montado para treino. |
| `TRAINING_TRAIN_EVAL_SPLIT_RATIO` | `0.90` | Split treino/avaliacao (ex.: 90/10). |

### 1.2 Execucao GPU e slices

| Chave | Default | Efeito |
|---|---:|---|
| `TRAINING_SLICE_STEPS` | `10` | Passos por requisicao ao gpu-trainer. |
| `TRAINING_GPU_TIMEOUT_MS` | `120000` | Timeout por slice no gpu-trainer. |
| `maxSeqLen` | `1536` | Limite de sequencia para cenarios de 20GB VRAM. |

### 1.3 Hyperparams e presets

| Chave | Default | Efeito |
|---|---:|---|
| `TRAINING_DEFAULT_HYPERPARAMS_JSON` | `{"epochs":2,"learningRate":0.0001,"batchSize":2,"maxSeqLen":1536,"gradientAccumulationSteps":4,"warmupSteps":100,"loraRank":16,"loraAlpha":32,"loraDropout":0.05}` | Base de hyperparams usada no snapshot do run. |
| `TRAINING_PRESET_SAFE_JSON` | `{"epochs":2,"learningRate":0.0001,"batchSize":2,"maxSeqLen":1536,"gradientAccumulationSteps":4,"warmupSteps":100,"loraRank":16,"loraAlpha":32,"loraDropout":0.05}` | Preset conservador para 20GB. |
| `TRAINING_PRESET_STANDARD_JSON` | `{"epochs":3,"learningRate":0.0002,"batchSize":2,"maxSeqLen":1536,"gradientAccumulationSteps":4,"warmupSteps":100,"loraRank":16,"loraAlpha":32,"loraDropout":0.05}` | Preset balanceado. |
| `TRAINING_PRESET_LARGE_JSON` | `{"epochs":1,"learningRate":0.0001,"batchSize":2,"maxSeqLen":1536,"gradientAccumulationSteps":8,"warmupSteps":100,"loraRank":16,"loraAlpha":32,"loraDropout":0.05}` | Preset para dataset maior com seguranca de VRAM. |

Campos suportados nos JSONs:
- `epochs`
- `learningRate`
- `batchSize`
- `maxSeqLen`
- `gradientAccumulationSteps`
- `warmupSteps`
- `loraRank`
- `loraAlpha`
- `loraDropout`

> Os defaults recomendados de 20GB estao alinhados com o trainer em `docker/gpu/lora-trainer/app/main.py` (base segura: `maxSeqLen=1536`, `batchSize=2`, `lr=1e-4`).

### 1.4 Agenda e promocao automatica

| Chave | Default | Efeito |
|---|---:|---|
| `AUTO_LEARNING_CRON_INCREMENTAL` | `0 3 * * 0` | Cron default de runs incrementais. |
| `AUTO_LEARNING_CRON_FULL` | `0 1 1,15 * *` | Cron default de runs completos. |
| `AUTO_LEARNING_INCLUDE_IMAGES` | `true` | Include-images default para runs automaticas. |
| `TRAINING_EVAL_MAX_LOSS` | `2.0` | Limiar de `eval_loss` para aprovar avaliacao. |
| `TRAINING_AUTO_PROMOTE_SCHEDULED` | `false` | Se `true`, run agendada promove automaticamente somente quando avaliacao passa. |

---

## 2. Pipeline unificado (SSOT)

Todos os gatilhos (`custom_job`, `on_demand`, `scheduled`) sao **enqueue-only**:

1. Handler HTTP/scheduler valida input com Zod.
2. Cria `fine_tuning_jobs` + `lora_jobs` com snapshot de configuracao.
3. Enfileira payload no Redis Stream `alice:training:fine-tuning`.
4. Worker consome fila com idempotencia/lock distribuido.
5. `TrainingRunner` executa preparo de dataset, treino por slices, avaliacao e persistencia de metricas.

Nao existe trabalho pesado dentro de handler HTTP.

---

## 3. Avaliacao e gate de promocao

### 3.1 Estados de avaliacao (`fine_tuning_jobs.evaluation_status`)

- `pending`
- `running`
- `passed`
- `failed`
- `skipped`

Regra atual:
- Se `eval_loss` existe: passa quando `eval_loss <= TRAINING_EVAL_MAX_LOSS`.
- Se so `perplexity` existe: converte via `ln(perplexity)` e aplica o mesmo limiar.
- Sem metrica de avaliacao: `skipped`.

### 3.2 Estados de promocao (`fine_tuning_jobs.promotion_status`)

- `candidate`
- `staged`
- `active`
- `rejected`
- `rolled_back`

Comportamento:
- Default: run concluido vira `candidate` (nao ativa automaticamente).
- Se `TRAINING_AUTO_PROMOTE_SCHEDULED=true` e run agendada `passed`: promocao automatica para `active`.
- Se gate falha: `rejected`.

---

## 4. Promocao manual e rollback seguro

Endpoints:
- `POST /api/training/jobs/:id/promote`
- `POST /api/training/jobs/:id/rollback`

Garantias de seguranca:
- Ativacao de adapter por swap atomico no filesystem (temp -> rename).
- Transacao DB para flip de flags ativas.
- Em falha de transacao, tentativa de reversao do filesystem.
- Historico em `model_versions` e status de promocao em `fine_tuning_jobs`.

---

## 5. Boas praticas operacionais

- Ajustar gates no `system_config` antes de aumentar carga de treino.
- Priorizar presets (`safe/standard/large`) na UI e usar override apenas quando necessario.
- Manter avaliacao ativa e limiar (`TRAINING_EVAL_MAX_LOSS`) coerente com baseline.
- Usar promocao manual em ambientes criticos; habilitar auto-promocao agendada somente com gate validado.
- Sempre monitorar fila Redis, status do worker e metricas por slice.

---

## 6. Referencias internas

- `apps/training-service/src/training-runner.ts`
- `apps/training-service/src/workers/training-fine-tuning-worker.ts`
- `apps/training-service/src/lora-job-manager.ts`
- `apps/training-service/src/index.ts`
- `packages/database/src/system-config.ts`
- `packages/shared-utils/src/training-queues.ts`
- `docker/gpu/lora-trainer/app/main.py`
