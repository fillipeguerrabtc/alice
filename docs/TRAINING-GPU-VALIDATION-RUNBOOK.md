# Training GPU Validation Runbook

Data: 2026-03-05  
Escopo: validação enterprise de fine-tuning real em GPU

## Objetivo
- Comprovar que o pipeline de treino executa com GPU real (não mock).
- Validar fila, orchestrator e execução on-demand por tenant/namespace.

## Pré-requisitos
- `training-service` e `gpu-manager` operacionais.
- Token com permissões:
  - `training:fine_tuning_jobs:read`
  - `training:training_data:manage`
- `tenantId` válido para o ambiente alvo.

## Execução (somente validação)
```bash
bash infra/scripts/validate-gpu-fine-tuning.sh \
  --base-url https://yesyoudeserve.duckdns.org \
  --auth-token "$ADMIN_BEARER_TOKEN" \
  --tenant-id "<tenant-uuid>"
```

## Execução (com disparo on-demand)
```bash
bash infra/scripts/validate-gpu-fine-tuning.sh \
  --base-url https://yesyoudeserve.duckdns.org \
  --auth-token "$ADMIN_BEARER_TOKEN" \
  --tenant-id "<tenant-uuid>" \
  --namespace-id "<namespace-uuid>" \
  --trigger-run
```

## Evidências mínimas
- `01-health.json`
- `02-queue-status.json`
- `03-gpu-orchestrator-state.json`
- `04-run-status.json`
- `05-run-start.json` (quando `--trigger-run`)

## Critério de sucesso
- Health do training OK.
- Fila e orchestrator retornam status válido.
- Run on-demand é aceito e enfileirado com idempotência.
