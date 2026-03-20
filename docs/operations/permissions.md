# Permissoes Operacionais

**Author:** Fillipe Guerra
**Data:** 18 de Marco de 2026
**Atualizado:** 20 de Marco de 2026
**Status:** ativo
**Tipo:** ssot

## Objetivo

Definir o SSOT de permissoes operacionais da Alice, separando filesystem de autorizacao aplicacional e removendo historico de incidentes do documento canonico.

## Fonte de verdade

- Script SSOT: [`infra/scripts/permissions-config.sh`](../../infra/scripts/permissions-config.sh)
- Scripts consumidores:
  - `infra/scripts/prepare-production-server.sh`
  - `infra/scripts/fix-production-permissions.sh`

Nenhum workflow ou script operacional deve hardcodear UID, GID ou modo de diretorio fora desse SSOT.

## Camadas de permissao

### Filesystem

Usada para garantir que volumes, logs, backups e secrets respeitem os requisitos reais das imagens e do host.

### Aplicacao

Usada para RBAC e guardrails do produto. Esta trilha nao substitui a governanca de filesystem.

## Diretorios base

| Path | Owner | Modo | Papel |
| --- | --- | --- | --- |
| `/opt/alice` | `0:0` | `755` | raiz operacional |
| `/opt/alice/data` | `0:0` | `755` | pai dos volumes persistentes |
| `/opt/alice/logs` | `0:0` | `755` | pai de logs por servico |
| `/opt/alice/backups` | `0:0` | `755` | pai de backups |
| `/opt/alice/uploads` | `1000:1000` | `755` | uploads e artefatos da aplicacao |
| `/opt/alice/secrets` | `0:0` | `700` | secrets locais do host |

## Diretivas mais sensiveis

| Path | Owner | Modo | Motivo |
| --- | --- | --- | --- |
| `/opt/alice/data/postgres` | `70:70` | `700` | requisito estrito do PostgreSQL |
| `/opt/alice/data/langfuse-db` | `70:70` | `700` | banco PostgreSQL do Langfuse |
| `/opt/alice/data/redis-alice` | `999:1000` | `755` | runtime Redis |
| `/opt/alice/data/caddy` | `1000:1000` | `755` | certificados e runtime do Caddy |
| `/opt/alice/data/qdrant` | `0:0` | `755` | volume do banco vetorial |
| `/opt/alice/data/lora-adapters` | `0:0` | `755` | adapters lidos por GPU e escritos pelo fluxo operacional |
| `/opt/alice/data/grafana` | `472:472` | `755` | dados do Grafana |
| `/opt/alice/data/prometheus` | `65534:65534` | `755` | dados do Prometheus |
| `/opt/alice/data/loki` | `10001:10001` | `755` | dados do Loki |
| `/opt/alice/data/clickhouse` | `101:101` | `755` | dados do ClickHouse |
| `/opt/alice/backups/postgresql` | `70:70` | `755` | leitura operacional de restore |

## Regras operacionais

- Sempre `source` em `permissions-config.sh`.
- Nunca usar valores hardcoded fora do SSOT.
- Preferir `chmod 0xxx` e validacao imediata.
- Remover bits especiais de forma agressiva quando houver evidencia de deriva.
- Tratar excecoes documentadas apenas via `VALIDATION_EXCEPTIONS` do SSOT.

## Ferramentas de operacao

```bash
sudo infra/scripts/fix-production-permissions.sh --dry-run
sudo infra/scripts/fix-production-permissions.sh --create
sudo infra/scripts/fix-production-permissions.sh --validate
sudo infra/scripts/prepare-production-server.sh
```

## RBAC aplicacional

- A trilha de aplicacao continua usando RBAC no dominio de autenticacao.
- `admin:alice_core:write` permanece o boundary de escrita do core da Alice.
- Admin e super admin continuam com atribuicao automatica das permissoes vigentes.

## Delegacao agentic

- Fluxo iniciado no chat deve herdar exatamente o envelope efetivo da dashboard: permissoes resolvidas, `customRoleId`, `permissionsVersion`, `grantsVersion`, ownership e grants do recurso.
- Nenhuma acao agentic sensivel pode executar fora do `agent_action_catalog`.
- `prompt template` e `tool policy` apenas restringem exposicao e execucao; nunca concedem permissao adicional.
- `deny` de governanca sempre prevalece sobre `allow`.

## Pipeline de autorizacao agentic

1. `RBAC/AuthZ` resolve o envelope efetivo do usuario.
2. `Capability Layer` resolve `actionKey`, `capabilityId`, permissao requerida, `resourceType` e `riskLevel`.
3. `tool policy` e governanca de prompt restringem o subconjunto de tools/capabilities expostas ao modelo.
4. O chat pre-autoriza a acao, calcula `payloadHash` e registra trilha imutavel.
5. A execucao downstream exige `delegated_execution_token` com TTL curto e uso unico.
6. O servico alvo revalida ator, tenant, `actionKey`, permissao, recurso, governanca, approval state e `payloadHash`.

## Service accounts

- `service_accounts` sao exclusivas para fluxos autonomos de sistema.
- Conta de servico nao pode mascarar ator humano.
- Cada conta deve declarar explicitamente `allowedActionKeys`, `namespaceScope`, `agentScope` e estado `enabled`.
- Fluxos iniciados por usuario nunca podem degradar para conta de servico privilegiada.

## Referencias

- [docs/operations/deploy.md](deploy.md)
- [docs/operations/secrets.md](secrets.md)
- [docs/architecture/platform.md](../architecture/platform.md)
