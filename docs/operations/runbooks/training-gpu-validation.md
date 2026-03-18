# Runbook de Validacao Training GPU

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Objetivo

Validar o pipeline real de treino com GPU, fila e orquestracao, sem misturar este procedimento com overview conceitual de treinamento.

## Quando usar

- Validacao operacional apos mudanca em training, gpu-manager ou compose GPU.
- Confirmacao de que o orquestrador alterna corretamente entre serving e training.
- Coleta de evidencias antes de promover correcoes relacionadas a treino em producao.

## Pre-requisitos

- `training-service` e `gpu-manager` saudaveis.
- Token com permissoes:
  - `training:fine_tuning_jobs:read`
  - `training:training_data:manage`
- `tenantId` valido.
- `namespaceId` valido quando a validacao precisar disparar treino on-demand.

## Execucao somente de validacao

```bash
bash infra/scripts/validate-gpu-fine-tuning.sh \
  --base-url https://yesyoudeserve.duckdns.org \
  --auth-token "$ADMIN_BEARER_TOKEN" \
  --tenant-id "<tenant-uuid>"
```

## Execucao com disparo on-demand

```bash
bash infra/scripts/validate-gpu-fine-tuning.sh \
  --base-url https://yesyoudeserve.duckdns.org \
  --auth-token "$ADMIN_BEARER_TOKEN" \
  --tenant-id "<tenant-uuid>" \
  --namespace-id "<namespace-uuid>" \
  --trigger-run
```

## Evidencias minimas

- `01-health.json`
- `02-queue-status.json`
- `03-gpu-orchestrator-state.json`
- `04-run-status.json`
- `05-run-start.json` quando `--trigger-run`

## Criterio de sucesso

- Health do training em `OK`.
- Estado do orquestrador retornado sem erro operacional.
- Fila acessivel e com resposta valida.
- Quando houver disparo, o run precisa ser aceito e enfileirado com idempotencia.

## Troubleshooting rapido

### Run fica presa em fila

- Verificar logs do `gpu-manager` e do `training-service`.
- Confirmar se o host consegue executar o compose do `gpu-trainer` sem erro de permissao relacionado a `.env.prod`.
- Se houver erro de permissao no compose principal, tratar como incidente operacional; o fallback dedicado so cobre esse caso especifico e nao substitui correcao de ambiente.

### `GET /api/gpu/orchestrator/state` retorna erro

- Conferir se `alice-gpu-manager` recebeu `DATABASE_URL` no stack `ALICE`.
- Validar logs de persistencia de snapshot/evento de runtime.
- Se o estado duravel falhar, o servico ainda deve responder com o estado em memoria; ausencia total de resposta indica degradacao real do orquestrador.

## Referencias

- [../training/overview.md](../training/overview.md)
- [../training/learning-system.md](../training/learning-system.md)
- [../../architecture/gpu-manager.md](../../architecture/gpu-manager.md)
