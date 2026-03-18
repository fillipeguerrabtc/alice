# SLO Burn Rate Validation Runbook

Data: 2026-03-05  
Escopo: jornadas críticas (chat stream, trading signal, training queue, rag ingest)

## Objetivo
- Validar recording rules e alertas de burn-rate por jornada.
- Confirmar exposição de métricas derivadas para operação SRE.

## Pré-requisitos
- Prometheus acessível no ambiente alvo.
- Rules de observabilidade carregadas.

## Execução
```bash
bash infra/scripts/validate-slo-burn-rates.sh \
  --prometheus-url https://metrics.yesyoudeserve.duckdns.org
```

## Evidências mínimas
- `01-slo-burn-rate-all.json`
- `02-slo-burn-rate-chat-stream.json`
- `03-slo-burn-rate-trading-signal.json`
- `04-slo-burn-rate-training-queue.json`
- `05-slo-burn-rate-rag-ingest.json`
- `06-queue-lag-seconds.json`

## Critério de sucesso
- Retorno `status=success` nas queries.
- Séries disponíveis para `alice_slo_burn_rate{journey=...}`.
- Série disponível para `alice_queue_lag_seconds`.
