# Runbook de Validacao de SLO Burn Rate

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** runbook

## Objetivo

Validar recording rules e alertas de burn rate das jornadas criticas da plataforma.

## Jornadas cobertas

- `chat-stream`
- `trading-signal`
- `training-queue`
- `rag-ingest`

## Preconditions

- Prometheus acessivel no ambiente alvo
- regras e dashboards da stack `OBSERVABILITY` carregados

## Execucao

```bash
bash infra/scripts/validate-slo-burn-rates.sh \
  --prometheus-url https://metrics.yesyoudeserve.duckdns.org
```

## Evidencias minimas

- `01-slo-burn-rate-all.json`
- `02-slo-burn-rate-chat-stream.json`
- `03-slo-burn-rate-trading-signal.json`
- `04-slo-burn-rate-training-queue.json`
- `05-slo-burn-rate-rag-ingest.json`
- `06-queue-lag-seconds.json`

## Criterio de sucesso

- todas as consultas retornam `status=success`
- existe serie para `alice_slo_burn_rate{journey=...}`
- existe serie para `alice_queue_lag_seconds`

## Referencias

- [../observability.md](../observability.md)
