# Alice Enterprise Platform - Guia de Deploy

**Autor:** Fillipe Guerra  
**Data:** 28 de Janeiro de 2026  
**Versão:** 11.9 - Healthchecks condicionados a deploy_executed

## Visão geral

Este guia descreve o deploy enterprise da plataforma Alice em produção (Hetzner GEX44), com pipeline CI/CD totalmente automatizado, rollback cirúrgico por stack e validações fail-fast.

## Timezone (padrão enterprise)

- **Host e containers:** UTC para consistência de logs, métricas e tracing.
- **UI e Chat:** timezone do usuário (dashboard) com fallback em `America/Sao_Paulo`.
- **Motivo:** UTC evita ambiguidades (DST/offsets) e facilita correlação entre stacks.

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
drizzle-push (executa somente quando há diff real)
  ↓
deploy-alice + deploy-observability + deploy-erpnext + deploy-backup (paralelo)
  ↓
health-{stack} + rollback-{stack} (se necessário)
```

### Healthchecks condicionados ao deploy bem-sucedido

Os jobs de health check rodam **apenas quando o deploy do stack foi realmente executado e concluiu com sucesso** (`needs.deploy-<stack>.outputs.deploy_executed == 'true'`). Isso evita falsos “skipped” quando o deploy terminou OK, e também garante pular healthchecks quando o deploy foi pulado.

### Builds Docker e warning do pnpm (`approve-builds`)

Durante o build das imagens, o `pnpm` pode emitir aviso de **scripts ignorados** se `NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS` não estiver definido no **build stage** do Dockerfile.  
Para evitar esse warning e manter o build determinístico, todos os Dockerfiles Node.js devem exportar:

```
ENV NPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true
```

Isso **não afeta o desenvolvimento local**, apenas o ambiente do build da imagem.

## ERPNext - sincronização de assets e configs

O `erpnext-configurator` sincroniza **assets completos** e arquivos de configuração para o volume `erpnext_sites` sem remover diretórios internos do container. Isso evita falhas por mountpoints gerados pelo próprio image (`VOLUME` em `/home/frappe/frappe-bench/sites` e `/home/frappe/frappe-bench/sites/assets`).

- Origem dos assets: `/home/frappe/frappe-bench/sites/assets` (imagem).
- Destino: `/mnt/erpnext-sites/assets` (volume persistente).
- Configurações sincronizadas: `apps.txt` e `common_site_config.json`.

### ERPNext - build de assets com Node (NVM)

O `erpnext-create-site` executa `bench build --production` para gerar bundles CSS/JS. A imagem oficial do ERPNext já inclui Node via **NVM**, mas **login shell** (`bash -l`) pode sobrescrever `PATH` e quebrar a detecção do `node`. Para evitar isso, o build roda com `bash -c` preservando o `PATH` do container e faz bootstrap do NVM quando necessário (sem instalação runtime).

- **Causa raiz típica:** `node: not found` durante `bench build --production`.
- **Correção aplicada:** validação explícita de `node` + `nvm use` quando necessário.
- **Resultado:** assets gerados de forma determinística e sem dependência de login shell.

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
- O cleanup remove **containers**, **volumes** e **imagens** do stack INFRA.
- Redes compartilhadas são removidas **somente** quando não há containers anexados.
- Outros stacks não são removidos, mas podem perder dependências se INFRA for limpo.

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

**Atalho Windows (PowerShell):**

- Chave: `C:\Users\filli\.ssh\alice-deploy`
- Config: `C:\Users\filli\.ssh\config` (alias `alice-prod`)
- Comando direto: `ssh -i C:\Users\filli\.ssh\alice-deploy root@178.63.41.108`

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

**ACME resiliente (ZeroSSL + Let's Encrypt):**

- O Caddy usa **ZeroSSL como emissor primário** e **Let's Encrypt como fallback**.
- Secrets obrigatórios: `ZEROSSL_EAB_KID` e `ZEROSSL_EAB_HMAC_KEY` (EAB).

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

1. Reexecutar o deploy com input `pgbackrest_allow_stanza_reset=true`.

**Via GitHub CLI:**

```bash
gh workflow run deploy-stack-modular.yml \
  -f stack=infra \
  -f version=v1.0.0 \
  -f pgbackrest_allow_stanza_reset=true
```

**Via GitHub UI:**

- Actions → Deploy - Production (Modular) → Run workflow
- Marcar checkbox `pgbackrest_allow_stanza_reset`

**Observação:** O reset remove metadados de backups anteriores da stanza. Use apenas quando o reinit do banco for intencional.

**Comportamento seguro adicional:**

- Se o repositório **não possui backups** para a stanza (`/var/lib/pgbackrest/backup/<stanza>` vazio), o init container executa **reset automático** para destravar a criação da stanza.
- Se **existirem backups**, o reset **continua bloqueado** e exige `PGBACKREST_ALLOW_STANZA_RESET=true`.

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

### ERPNext sem CSS/JS (assets 404)

**Sintoma:** páginas abrem com HTML sem estilos/scripts e `/assets/*` retorna 404.  
**Causa raiz:** `assets.json` desatualizado em relação aos bundles reais.  
**Correção aplicada:** `erpnext-configurator` sincroniza `assets.json` da imagem oficial para o volume `erpnext_sites` (sem depender de Node), ajusta permissões do volume e executa `bench` com `setpriv --keep-groups` (necessário com `no-new-privileges` para evitar erro de `setgroups`).

### Logs de falha por stack (rollback imediato)

**Sintoma:** rollback executa logo após falha e os containers podem sumir.  
**Correção aplicada:** um diagnóstico rápido (tail) é impresso na tela e os logs completos são compactados no servidor e enviados como artifact do GitHub Actions quando o deploy falha.

**Onde encontrar:** Artifacts por stack no job de deploy:

- `infra-deploy-logs-<run_id>-<run_attempt>`
- `alice-deploy-logs-<run_id>-<run_attempt>`
- `observability-deploy-logs-<run_id>-<run_attempt>`
- `erpnext-deploy-logs-<run_id>-<run_attempt>`
- `backup-deploy-logs-<run_id>-<run_attempt>`

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
