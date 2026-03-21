# Observabilidade da Plataforma

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 21 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Consolidar a arquitetura operacional de observabilidade da Alice sem misturar backlog de correcoes ou historico de auditoria dentro do SSOT.

## Escopo

- metricas
- logs
- traces
- dashboards
- alerting
- sinais operacionais de backup e SLO

## Stack de observabilidade

| Componente | Papel |
| --- | --- |
| Prometheus | coleta, recording rules e metricas derivadas |
| Grafana | dashboards e unified alerting |
| Loki | agregacao de logs |
| Promtail / Vector | coleta e roteamento de logs |
| Jaeger | tracing distribuido |
| Langfuse | observabilidade de LLM |
| ClickHouse | armazenamento do Langfuse |
| node-exporter / cAdvisor | sinais de host e containers |

## Fontes de verdade

| Assunto | SSOT |
| --- | --- |
| dashboards | `apps/observability-service/config/grafana/dashboards/*.json` |
| provisionamento Grafana | `infra/observability/grafana/provisioning/` |
| regras Prometheus | `infra/observability/rules/` e `apps/observability-service/config/prometheus/rules/` |
| compose da stack | `infra/docker/stacks/docker-compose.observability.yml` |

## Modelo de sinais

### Metricas

- Aplicacoes expostas em `/metrics`.
- Metricas de host e containers vindas de `node-exporter` e `cAdvisor`.
- Recording rules de jornada como `alice_slo_burn_rate` e `alice_queue_lag_seconds`.

### Logs

- Logs estruturados dos containers entram via coleta do host.
- Loki e Vector sao usados para consolidacao, consulta e roteamento.

### Traces

- Jaeger concentra traces distribuidos.
- Correlacao de contexto e `traceId` faz parte do fluxo operacional esperado.

## Dashboards e sincronizacao

- O SSOT dos dashboards fica no app de observabilidade.
- O deploy sincroniza esse material para o diretorio de provisionamento antes de subir a stack `OBSERVABILITY`.
- O objetivo e evitar drift entre dashboard de desenvolvimento e dashboard provisionado em producao.

## Alerting

- O runtime oficial de alertas e o Grafana Unified Alerting.
- Prometheus continua relevante para recording rules e metricas derivadas.
- Regras e rotas de notificacao ficam provisionadas em `infra/observability/grafana/provisioning/alerting/`.

### Sinal canonico de ingestao de training

- O alerta operacional `Training sem novos dados` deve usar o estado persistido de `training_data`, nunca apenas contadores de processo.
- A serie canonica e `alice_training_data_last_persisted_at_seconds{source_type="all",source="all"}`, atualizada pelo `training-service` a partir do PostgreSQL.
- `alice_training_data_persisted_total{source_type,source,status}` serve para explicar volume real por origem e status.
- `alice_training_data_persisted_age_seconds` e a recording rule oficial para medir idade do ultimo registro persistido.

### Separacao obrigatoria de estados

- `Sem novos dados persistidos`: o sinal existe, a fonte esta saudavel, mas `alice_training_data_persisted_age_seconds > 21600`.
- `Sinal ausente`: o `training-service` esta `UP`, mas `absent_over_time(alice_training_data_last_persisted_at_seconds{source_type="all",source="all"}[10m])` ficou verdadeiro.
- `Fonte persistida indisponivel`: o refresh duravel falhou ou ficou estagnado, observado por `alice_training_persisted_signal_source_available{source="training_data"}` e `alice_training_persisted_signal_last_refresh_timestamp_seconds{source="training_data"}`.

### Troubleshooting do alerta de training

- Confirmar se existem linhas recentes em `training_data` antes de investigar contadores HTTP ou counters de processo.
- Se o alerta principal disparar, validar `alice_training_data_last_persisted_at_seconds`, `alice_training_data_persisted_total` e os logs do `training-service`.
- Se o alerta de sinal ausente disparar, revisar exposicao de `/metrics`, scraping do Prometheus e provisioning de alertas.
- Se o alerta de fonte indisponivel disparar, revisar conectividade do `training-service` com PostgreSQL e o scheduler interno de metricas.
- `alice_training_data_collected_total`, `alice_http_requests_total{route="/api/training/data"}` e `alice_training_auto_collect_attempt_total` continuam uteis para throughput, mas nao sao fonte primaria para afirmar ausencia de ingestao duravel.

## Jornadas operacionais obrigatorias

- `chat-stream`
- `trading-signal`
- `training-queue`
- `rag-ingest`

Essas jornadas devem ter:

- metricas disponiveis
- paines visiveis
- burn rate calculado
- alertas roteados

## Checklist minimo pos-deploy

- `Prometheus /targets` com jobs principais em `UP`
- dashboards sincronizados no Grafana
- alertas provisionados carregados
- logs de containers chegando ao Loki
- traces navegaveis no Jaeger
- series `alice_slo_burn_rate{journey=...}` disponiveis

## Referencias operacionais

- Runbook de SLO: [docs/operations/runbooks/slo-burn-rate-validation.md](runbooks/slo-burn-rate-validation.md)
- DR game day: [docs/operations/runbooks/dr-game-day.md](runbooks/dr-game-day.md)
- Deploy da stack: [docs/operations/deploy.md](deploy.md)
