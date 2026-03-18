# Arquitetura do GPU Manager

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Objetivo

Descrever a arquitetura vigente do subsistema GPU da Alice, com foco em componentes, estados, contracts e limites operacionais.

## Escopo

- O documento cobre a coordenacao entre `alice-gpu-manager`, `gpu-llm`, `gpu-embeddings` e `qwen-trainer`.
- Procedimentos operacionais ficam em [docs/operations/runbooks/training-gpu-validation.md](../operations/runbooks/training-gpu-validation.md) e [docs/operations/deploy.md](../operations/deploy.md).
- Observabilidade fica em [docs/operations/observability.md](../operations/observability.md).

## Componentes

| Componente | Papel |
| --- | --- |
| `alice-gpu-manager` | fila priorizada, roteamento, protecao e arbitragem de capacidade |
| `gpu-llm` | inferencia de texto |
| `gpu-embeddings` | embeddings de texto para RAG |
| `qwen-trainer` | treinamento on-demand sob profile `gpu-training` |

## Modelo de capacidade

- A plataforma opera com GPU unica e capacidade mutuamente coordenada.
- `gpu-llm` e `gpu-embeddings` formam o estado de serving padrao.
- `qwen-trainer` nao sobe no `docker compose up` regular; ele e preparado para uso on-demand.
- O treinamento consome a capacidade GPU de modo exclusivo o suficiente para exigir transicao orquestrada de serving para training.

## Estados canonicios

Os estados expostos pelo orquestrador sao:

- `serving_ready`
- `serving_draining`
- `training_starting`
- `training_active`
- `training_finishing`
- `serving_restoring`
- `error`

## Fluxos principais

### Inferencia

1. `alice-chat`, `alice-rag` ou servicos dependentes chamam `alice-gpu-manager`.
2. O manager seleciona a fila e o backend de capacidade adequado.
3. `gpu-llm` atende requests de texto.
4. `gpu-embeddings` atende requests de embeddings.

### Entrada em treinamento

1. Um job de treino solicita `prepare-training`.
2. O manager drena serving, interrompe embeddings quando necessario e reserva capacidade.
3. `qwen-trainer` sobe apenas para o ciclo de treinamento.
4. O sistema permanece em estado de treino ate conclusao ou restauracao manual.

### Retorno para serving

1. O treino conclui ou a operacao aciona `restore-serving`.
2. O manager reconstroi o estado de serving.
3. `gpu-llm` e `gpu-embeddings` voltam a ser o baseline do runtime.

## Interfaces operacionais

### Endpoints

- `GET /api/gpu/orchestrator/state`
- `POST /api/gpu/orchestrator/prepare-training`
- `POST /api/gpu/orchestrator/restore-serving`
- `POST /api/gpu/orchestrator/return`

### Clientes internos esperados

- `alice-chat`
- `alice-rag`
- `alice-training`
- `alice-integrations`
- `alice-llm-gateway`

## Regras de operacao

- O manager e o boundary unico para uso da GPU pela plataforma.
- Falha de restauracao deve manter o sistema em postura fail-closed, nunca mascarar inconsistencias de runtime.
- A separacao entre serving e training e obrigatoria; bypass direto para containers GPU nao faz parte do fluxo suportado.
- A imagem `qwen-trainer` participa da `Release`, mas o container continua on-demand no `Deploy`.

## Entrega e deploy

- `Release` decide build versus retag das imagens GPU com a mesma governanca das demais imagens publicadas.
- `Deploy` usa `built_images` e, quando presente, `images-manifest.json` para diferenciar pull real, retag local e skip por digest.
- A validacao de health da stack `ALICE` considera `qwen-trainer` como on-demand, portanto sua ausencia em steady state e esperada.

## Observabilidade e runbooks

- Dashboards e alertas de GPU ficam em [docs/operations/observability.md](../operations/observability.md).
- Validacao de treino em GPU fica em [docs/operations/runbooks/training-gpu-validation.md](../operations/runbooks/training-gpu-validation.md).
- Recovery e restore operacional ficam em [docs/operations/runbooks/dr-game-day.md](../operations/runbooks/dr-game-day.md).
