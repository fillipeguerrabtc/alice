# Grafana da stack de observabilidade

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 18 de Marco de 2026

## Escopo local

Este README cobre apenas o conteudo de `infra/observability/grafana/`: configuracao do Grafana, file provisioning de datasources, dashboards e alerting, alem do compose isolado usado para troubleshooting local.

Arquitetura global da observabilidade, pipeline de entrega e deploy oficial da stack ficam nos SSOTs de `docs/operations/`.

## SSOT relacionado

| Assunto | Documento |
| --- | --- |
| observabilidade da plataforma | [docs/operations/observability.md](../../../docs/operations/observability.md) |
| deploy da stack oficial | [docs/operations/deploy.md](../../../docs/operations/deploy.md) |
| stack oficial `OBSERVABILITY` | [infra/docker/stacks/docker-compose.observability.yml](../../docker/stacks/docker-compose.observability.yml) |
| dashboards fonte do app | [apps/observability-service/README.md](../../../apps/observability-service/README.md) |

## O que existe nesta pasta

| Caminho | Papel local |
| --- | --- |
| `grafana.ini` | configuracao isolada de auth, seguranca, database e plugins |
| `provisioning/datasources/datasources.yml` | datasources provisionadas no boot |
| `provisioning/dashboards/` | pastas e JSONs provisionados por dominio |
| `provisioning/alerting/` | regras, contact points e notification policies |
| `docker-compose.grafana.yml` | compose isolado de Grafana para troubleshooting |

## Uso local isolado

Execute a partir de `infra/observability/grafana`:

```bash
docker compose -f docker-compose.grafana.yml up -d
docker compose -f docker-compose.grafana.yml down
```

Variaveis obrigatorias para o compose isolado:

- `GF_SECURITY_ADMIN_PASSWORD`
- `GF_SECURITY_SECRET_KEY`
- `GF_DATABASE_PASSWORD`
- `GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET`
- `ALICE_OIDC_ISSUER`

## Notas de manutencao

- O compose oficial de producao nao e `docker-compose.grafana.yml`; ele continua em [infra/docker/stacks/docker-compose.observability.yml](../../docker/stacks/docker-compose.observability.yml).
- Este README nao replica o role mapping nem o fluxo completo de OIDC; a configuracao ativa deve ser verificada diretamente em `grafana.ini` e, quando aplicavel, no compose oficial da stack.
- Quando houver atualizacao de dashboards nas fontes do app, confirme a sincronizacao do material provisionado antes do deploy da stack `OBSERVABILITY`.

## Limites deste README

- Nao descreve a arquitetura completa da stack.
- Nao substitui runbooks, deploy global ou SSOTs de operacao.
- Nao documenta regras de agentes, release ou pipeline.
