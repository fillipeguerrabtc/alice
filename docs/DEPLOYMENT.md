# Alice Enterprise Platform - Guia de Deploy

**Autor:** Fillipe Guerra  
**Data:** 16 de Janeiro de 2026  
**Versão:** 10.1 - Rollback com cleanup completo e seguro

## Visão geral

Este guia descreve o deploy enterprise da plataforma Alice em produção (Hetzner GEX44), com pipeline CI/CD totalmente automatizado, rollback cirúrgico por stack e validações fail-fast.

### Arquitetura multi-stack (SSOT)

| Stack | Containers | Descrição | Docker Compose |
| --- | --- | --- | --- |
| **INFRA** | 11 | PostgreSQL, PgBouncer, Redis, Qdrant, Caddy, MinIO, SearXNG, Tor | `infra/docker/stacks/docker-compose.infra.yml` |
| **ALICE** | 8 + GPU | Microsserviços core + GPU Manager + serviços GPU | `infra/docker/stacks/docker-compose.alice.yml` |
| **OBSERVABILITY** | 13 | Prometheus, Grafana, Loki, Jaeger, Langfuse, ClickHouse | `infra/docker/stacks/docker-compose.observability.yml` |
| **ERPNEXT** | 15 | MariaDB, Redis Cache/Queue, Backend, Workers | `infra/docker/stacks/docker-compose.erpnext.yml` |
| **BACKUP** | 1 | pgBackRest enterprise | `infra/docker/stacks/docker-compose.backup.yml` |

## Workflows oficiais

- **Release & Tag:** `.github/workflows/release.yml`
- **Deploy Modular:** `.github/workflows/deploy-stack-modular.yml`

### Ordem de deploy (automática)

```text
prepare
  ↓
deploy-infra + health-infra
  ↓
drizzle-push
  ↓
deploy-alice + deploy-observability + deploy-erpnext + deploy-backup (paralelo)
  ↓
health-{stack} + rollback-{stack} (se necessário)
```

### Disparo manual (quando necessário)

```bash
# Deploy de um stack específico
gh workflow run deploy-stack-modular.yml -f stack=alice -f version=v1.0.0

# Deploy de todos os stacks
gh workflow run deploy-stack-modular.yml -f stack=all -f version=v1.0.0

# Dry run (validação sem deploy)
gh workflow run deploy-stack-modular.yml -f stack=observability -f version=v1.0.0 -f dry_run=true

# Rollback manual de um stack específico
gh workflow run deploy-stack-modular.yml -f stack=erpnext -f version=v1.0.0 -f rollback=true -f rollback_version=v0.9.0
```

### Rollback automático e cleanup (INFRA)

- Em falha de primeiro deploy (sem versão anterior), o rollback entra em modo **cleanup**.
- O cleanup remove **containers** e, quando **nenhum outro stack** estiver ativo, remove também **volumes, imagens e redes** do stack INFRA.
- Se houver outros stacks ativos, a limpeza completa é **bloqueada** para evitar impacto nos serviços em produção.

## Primeiro deploy (servidor limpo)

### Pré-requisitos do servidor

| Item | Validação | Como verificar |
| --- | --- | --- |
| IP correto | 178.63.41.108 | `hostname -I \| grep -w 178.63.41.108` |
| GPU disponível | NVIDIA RTX 4000 Ada | `nvidia-smi` |
| Docker | 29.1.3+ | `docker --version` |
| Docker Compose | 5.0.0+ | `docker compose version` |
| NVIDIA Container Toolkit | Instalado | `docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi` |
| Disco disponível | Mínimo 200GB livre | `df -h /opt/alice` |
| Memória RAM | 64GB | `free -h` |

### Preparação automática do servidor

O workflow executa o script idempotente `infra/scripts/prepare-production-server.sh` no job `prepare`.

**O que o script faz:**

- Valida IP/GPU/Docker
- Cria estrutura `/opt/alice`
- Configura permissões via SSOT
- Cria networks externas
- Valida permissões do PostgreSQL (fail-fast)

**Execução manual (opcional):**

```bash
ssh root@178.63.41.108
sudo /opt/alice/app/infra/scripts/prepare-production-server.sh
```

### Checklist essencial

- [ ] Secrets configurados no GitHub (`docs/SECRETS.md`)
- [ ] Chave SSH válida para `root@178.63.41.108`
- [ ] Release criada e publicada em GHCR
- [ ] Deploy disparado via workflow
- [ ] Health checks passaram para todos os stacks

## Secrets obrigatórios (referência)

Consulte `docs/SECRETS.md` para a lista completa. O deploy é fail-fast se secrets críticos estiverem ausentes.

**Secret adicional (opcional):**

- `PGBACKREST_ALLOW_STANZA_RESET` = `true`  
  Permite reset controlado de stanza em caso de mismatch entre banco e repositório pgBackRest.

## pgBackRest (stanza)

### Criação padrão

O init container `alice-pgbackrest-init` cria a stanza após o PostgreSQL estar healthy, usando `--no-online`.

### Stanza inconsistente (mismatch de system-id)

**Sintoma:**

- `ERROR: [028]: backup and archive info files exist but do not match the database`
- `ERROR: [103]: ArchiveMismatchError ... system-id ... do not match repo1 stanza ...`

**Causa:**

O PostgreSQL foi reinitializado, mas o repositório de backup contém metadados antigos.

**Solução controlada:**

1. Definir `PGBACKREST_ALLOW_STANZA_RESET=true` (secret no GitHub).
2. Reexecutar o deploy.

**Observação:** O reset remove metadados de backups anteriores da stanza. Use apenas quando o reinit do banco for intencional.

## Troubleshooting rápido

### pgBackRest init falha por cipher pass ausente

- Verificar secret `BACKUP_CIPHER_PASS` em GitHub.
- Verificar `.env.prod` no servidor.

```bash
docker logs alice-pgbackrest-init --tail 50
grep BACKUP_CIPHER_PASS /opt/alice/app/infra/docker/.env.prod | wc -c
```

### MinIO não inicializa ou bucket não é criado

```bash
docker logs alice-minio --tail 100
docker logs alice-minio-init --tail 50
```

### Docker Hub rate limit

Configure `DOCKERHUB_USERNAME` e `DOCKERHUB_TOKEN` nos secrets do GitHub.

## Validações pós-deploy

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
docker exec alice-postgres pg_isready
docker exec alice-pgbouncer pgbouncer -V
docker logs alice-caddy --tail 50
```

## Documentação relacionada

- `docs/ARQUITETURA.md`
- `docs/ARQUITETURA-GPU-MANAGER.md`
- `docs/OBSERVABILITY.md`
- `docs/PERMISSIONS.md`
- `docs/SECRETS.md`
- `docs/STATUS-REAL-ATUAL.md`
