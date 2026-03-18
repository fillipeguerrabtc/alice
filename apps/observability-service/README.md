# Observability Service

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026
**Status:** ativo
**Tipo:** readme local

## Escopo local

Este README cobre apenas o subsistema em `apps/observability-service`: a API HTTP de observabilidade, o compose local desta pasta e os arquivos locais de dashboards, datasources e regras usados durante desenvolvimento e troubleshooting.

Arquitetura global, operacao da stack `OBSERVABILITY`, release e deploy ficam nos SSOTs de `docs/`.

## SSOT relacionado

| Assunto | Documento |
| --- | --- |
| observabilidade da plataforma | [docs/operations/observability.md](../../docs/operations/observability.md) |
| deploy da stack oficial | [docs/operations/deploy.md](../../docs/operations/deploy.md) |
| provisionamento Grafana em `infra/` | [infra/observability/grafana/README.md](../../infra/observability/grafana/README.md) |

## O que existe nesta pasta

| Caminho | Papel local |
| --- | --- |
| `src/index.ts` | sobe a API HTTP, Swagger, metricas e middlewares de autenticacao |
| `src/observability-*.ts` | rotas e logica de health, metricas, admin, bootstrap e backup |
| `config/grafana/dashboards/` | dashboards fonte usados no compose local e como base de sincronizacao |
| `config/grafana/provisioning/` | datasources e provisioning do Grafana local desta pasta |
| `config/prometheus/` | scrape config e alert rules locais |
| `config/otel/` | configuracao local do OpenTelemetry Collector |
| `docker-compose.yml` | stack local de desenvolvimento desta pasta |

## Comandos locais

Execute a partir de `apps/observability-service`:

```bash
pnpm dev
pnpm typecheck
pnpm lint
pnpm build
docker compose up -d
docker compose down
```

Se preferir executar pela raiz do monorepo:

```bash
pnpm --filter @alice/observability-service dev
pnpm --filter @alice/observability-service typecheck
pnpm --filter @alice/observability-service lint
pnpm --filter @alice/observability-service build
```

## Endpoints principais

| Endpoint | Uso |
| --- | --- |
| `/health` | health check simples |
| `/live` e `/ready` | sinais de liveness e readiness |
| `/metrics` | metricas Prometheus do proprio servico |
| `/api/observability/health` | status agregado do stack monitorado |
| `/api/observability/services/:name` | health por dependencia |
| `/api/observability/urls` | URLs internas e externas cadastradas |
| `/api/docs` | Swagger / OpenAPI do servico |

## Variaveis locais mais relevantes

| Variavel | Uso |
| --- | --- |
| `PORT` | porta da API, com default `3007` |
| `INTERNAL_API_SECRET` | autenticacao interna obrigatoria em producao |
| `CORS_ORIGINS` | origens permitidas em producao |
| `PROMETHEUS_URL`, `GRAFANA_URL`, `JAEGER_URL`, `LANGFUSE_URL` | endpoints internos monitorados |
| `PROMETHEUS_EXTERNAL_URL`, `GRAFANA_EXTERNAL_URL`, `JAEGER_EXTERNAL_URL`, `LANGFUSE_EXTERNAL_URL` | links externos retornados pelas rotas administrativas |
| `.env.example` | defaults usados pelo compose local desta pasta |

Rotas alem de `/health`, `/live`, `/ready` e `/metrics` exigem sessao valida ou autenticacao interna.

## Limites deste README

- Nao replica arquitetura global da plataforma.
- Nao descreve pipeline, release ou deploy de producao.
- Nao substitui runbooks operacionais nem o SSOT de observabilidade em `docs/operations/`.
