# Observabilidade da Plataforma

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

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
