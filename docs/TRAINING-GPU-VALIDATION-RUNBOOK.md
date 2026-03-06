# Runbook de Validação Training GPU

**Autor:** Fillipe Guerra  
**Data:** 06 de Março de 2026  
**Escopo:** validação enterprise de fine-tuning real em GPU

## Objetivo
- Comprovar que o pipeline de treino executa com GPU real (sem mocks).
- Validar fila, orquestrador e execução on-demand por tenant/namespace.

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

## Incidente conhecido (06/03/2026)
- **Sintoma observado:** run permanece "na fila" e não evolui para `preparing/training`.
- **Causa raiz real:** `gpu-manager` falha no `docker compose` ao usar `--env-file /opt/alice/compose/.env.prod` com erro de permissão (`permission denied`) no ambiente de produção.
- **Correção aplicada no código:** fallback controlado no orquestrador:
  - primeira tentativa mantém `--env-file` (comportamento padrão);
  - se o erro for especificamente de permissão no env-file, reexecuta sem `--env-file` usando variáveis já disponíveis no processo do container;
  - para outros erros, falha imediata (sem fallback indevido).
