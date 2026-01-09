# Alice Enterprise - Production Setup Guide

## 📋 Visão Geral

Este guia documenta o processo de setup inicial do servidor de produção para a plataforma Alice Enterprise. O guia cobre a configuração de permissões de diretórios, estrutura de dados e troubleshooting de problemas comuns.

**Versão:** 1.1.0 - SSOT Permissions  
**Data:** 09 de Janeiro de 2026  
**Autor:** Fillipe Guerra

## 🎯 Pré-requisitos

- Servidor Hetzner GPU GEX44 limpo
- Ubuntu 24.04.3 LTS
- Docker 29.1.3+ instalado
- Docker Compose v5.0.0+ instalado
- Acesso SSH como root
- Networks Docker criadas (`alice-network`, `erpnext-network`)

## 📁 Estrutura de Diretórios

### Hierarquia Base

```
/opt/alice/
├── data/              # Dados persistentes de bancos de dados
│   ├── postgres/      # PostgreSQL + pgvector (UID 70:70 Alpine, perms 700)
│   ├── pgbackrest-spool/  # pgBackRest working directory (UID 70:70, perms 755)
│   ├── redis-alice/   # Redis cache Alice (UID 999:999, perms 755)
│   ├── caddy/         # Caddy SSL certificates (UID 1000:1000, perms 755)
│   ├── caddy-config/  # Caddy configuration (UID 1000:1000, perms 755)
│   ├── searxng-config/  # SearXNG settings (UID 977:977, perms 755)
│   ├── minio/         # MinIO S3 storage (UID 0:0, perms 755)
│   ├── qdrant/        # Qdrant vector database (UID 0:0, perms 755)
│   ├── jaeger/        # Jaeger BadgerDB storage (UID 10001:10001, perms 755)
│   ├── langfuse-db/   # Langfuse PostgreSQL (UID 70:70 Alpine, perms 700)
│   ├── clickhouse/    # ClickHouse OLAP (UID 101:101, perms 755)
│   ├── vector/        # Vector aggregator (UID 0:0, perms 755)
│   ├── erpnext-sites/     # ERPNext sites data (UID 1000:1000, perms 755)
│   ├── erpnext-mariadb/   # MariaDB data (UID 999:999, perms 755)
│   ├── erpnext-redis-cache/  # Redis cache (UID 999:999, perms 755)
│   └── erpnext-redis-queue/  # Redis queue (UID 999:999, perms 755)
├── logs/              # Logs de serviços
│   ├── caddy/         # Caddy access/error logs (UID 1000:1000, perms 755)
│   ├── erpnext/       # ERPNext logs (UID 1000:1000, perms 755)
│   └── clickhouse/    # ClickHouse logs (UID 101:101, perms 755)
├── uploads/           # Uploads multimodais (UID 1000:1000, perms 755)
├── backups/           # Backups enterprise
│   └── postgresql/    # pgBackRest backups (UID 70:70 Alpine, perms 755)
├── secrets/           # Arquivos de secrets (UID 0:0, perms 700)
└── versions/          # Histórico de versões por stack

> **SSOT (09/01/2026):** Todas as permissões são definidas em `infra/scripts/permissions-config.sh`. Ver `docs/PERMISSIONS.md`.
```

## 🔧 Script de Permissões Automático (SSOT)

### Arquitetura SSOT (Single Source of Truth)

```
permissions-config.sh (SSOT - fonte única de verdade)
         ↓
    ┌────────────────────────────┬──────────────────────────────────┐
    ↓                            ↓                                  ↓
prepare-production-server.sh  fix-production-permissions.sh  (scripts futuros)
```

### Uso do Script `fix-production-permissions.sh`

O script enterprise automatiza a criação de diretórios com UIDs/GIDs corretos, lendo valores do SSOT (`permissions-config.sh`).

#### Modos de Operação

1. **Preview (Dry-Run)**
   ```bash
   sudo bash /opt/alice/app/infra/scripts/fix-production-permissions.sh --dry-run
   ```
   - Não modifica o sistema
   - Mostra o que será criado/alterado
   - Útil para auditoria antes de aplicar

2. **Criação/Correção**
   ```bash
   sudo bash /opt/alice/app/infra/scripts/fix-production-permissions.sh --create
   ```
   - Cria diretórios faltantes
   - Aplica UIDs/GIDs corretos
   - Ajusta permissões
   - **REQUER ROOT**

3. **Validação**
   ```bash
   bash /opt/alice/app/infra/scripts/fix-production-permissions.sh --validate
   ```
   - Verifica se estrutura está correta
   - Exit 0 = tudo OK
   - Exit 1 = problemas encontrados
   - Usado no CI/CD

### Quando Executar o Script

- ✅ **Servidor limpo** - Primeira vez após limpeza completa
- ✅ **Após adicionar novos serviços** - Quando novos containers são adicionados
- ✅ **Troubleshooting de permissões** - Quando containers têm "Permission denied"
- ✅ **Antes de cada deploy** - Garante integridade (já integrado no workflow)

## 🐛 Troubleshooting de Problemas Comuns

### PostgreSQL - "Permission denied" ou "initdb failed"

**Sintomas:**
```
initdb: error: could not access directory "/var/lib/postgresql/data": Permission denied
RestartCount: 306
```

**Causa Raiz:**
- Diretório `/opt/alice/data/postgres` não existe ou tem owner incorreto
- PostgreSQL Alpine container roda como **UID 70** (não 999)
- Diretório criado como root:root pelo Docker

**Solução:**
```bash
sudo bash /opt/alice/app/infra/scripts/fix-production-permissions.sh --create
```

**Verificação:**
```bash
ls -ld /opt/alice/data/postgres
# Esperado: drwx------ 70 70 ... /opt/alice/data/postgres
```

### Jaeger - "mkdir /badger/key: permission denied"

**Sintomas:**
```
Error: failed to initialize storage 'badger_main': Error Creating Dir: "/badger/key" err: mkdir /badger/key: permission denied
Status: Restarting (restart loop infinito)
```

**Causa Raiz:**
- Diretório `/opt/alice/data/jaeger` não existe ou tem owner incorreto
- Jaeger container roda como UID 10001
- Volume não declarado em `docker-compose.base.yml`

**Solução:**
1. Criar diretório com permissões corretas:
   ```bash
   sudo bash /opt/alice/app/infra/scripts/fix-production-permissions.sh --create
   ```

2. Volume declarado em `docker-compose.base.yml` (linha 213-218):
   ```yaml
   jaeger_data:
     name: alice-jaeger-data
     driver: local
     driver_opts:
       type: none
       o: bind
       device: /opt/alice/data/jaeger
   ```

3. Jaeger container usa volume nomeado (não bind direto):
   ```yaml
   volumes:
     - jaeger_data:/badger
   ```

**Verificação:**
```bash
ls -ld /opt/alice/data/jaeger
# Esperado: drwxr-xr-x 10001 10001 ... /opt/alice/data/jaeger

docker inspect jaeger --format='{{.State.Status}}'
# Esperado: running (não restarting)
```

### alice-observability - Healthcheck Bloqueado (401 Unauthorized)

**Sintomas:**
```json
{"level":"warn","module":"observability-health","path":"/live","ip":"::1","msg":"Tentativa de acesso não autorizado"}
FailingStreak: 1931
Status: unhealthy
```

**Causa Raiz:**
- Middleware `requireInternalAuth` bloqueava endpoints `/live` e `/ready`
- Docker healthcheck não passa header `Authorization`
- Apenas `/health` era permitido sem autenticação

**Solução (JÁ APLICADA):**
Middleware atualizado para permitir probes Kubernetes/Docker:
```typescript
// apps/observability-service/src/index.ts (linha 47-54)
if (['/health', '/live', '/ready'].includes(req.path)) {
  return next();
}
```

**Justificativa:**
- `/health` - Healthcheck simples para load balancers
- `/live` - Liveness probe (processo está vivo?)
- `/ready` - Readiness probe (pronto para tráfego?)
- **OWASP 2025:** Healthchecks não expõem dados sensíveis, mas devem ser acessíveis para orquestração

**Verificação:**
```bash
docker exec alice-observability wget -qO- http://localhost:3007/live
# Esperado: {"status":"alive",...}

docker inspect alice-observability --format='{{.State.Health.Status}}'
# Esperado: healthy
```

### alice-frontend - NGINX Unhealthy

**Sintomas:**
```
wget: can't connect to remote host: Connection refused
Status: unhealthy (FailingStreak: 1931)
```

**Causa Raiz:**
- NGINX Alpine precisa escrever em `/var/lib/nginx` para logs temporários
- Sem tmpfs, filesystem read-only causa falha

**Solução (JÁ APLICADA):**
Tmpfs configurado em `docker-compose.alice.yml` (linha 78-85):
```yaml
tmpfs:
  - /tmp:mode=1777,size=64M
  - /var/cache/nginx:mode=1777,size=32M
  - /var/run:mode=1777,size=8M
  - /var/lib/nginx:mode=1777,size=16M
```

**Verificação:**
```bash
docker exec alice-frontend ls -ld /var/lib/nginx
# Esperado: drwxrwxrwx ... /var/lib/nginx

docker exec alice-frontend wget -qO- http://localhost:80/
# Esperado: HTML do frontend
```

## 🚀 Workflow de Deploy Automático

### Integração CI/CD

O script de permissões está integrado no workflow `deploy-stack-modular.yml`:

```yaml
# Job: prepare (linha 252)
- name: Setup Data Directories and Permissions
  run: |
    # 1. Executar em modo --create
    sudo bash /opt/alice/app/infra/scripts/fix-production-permissions.sh --create
    
    # 2. Validar integridade
    bash /opt/alice/app/infra/scripts/fix-production-permissions.sh --validate
    
    # 3. Fail-fast se validação falhar
    if [ $? -ne 0 ]; then
      echo "❌ Validação de permissões falhou!"
      exit 1
    fi
```

### Ordem de Execução

1. **validate** - Validar inputs (stack, versão, rollback)
2. **prepare** - Gerar .env.prod, verificar imagens, **SETUP PERMISSÕES**
3. **deploy-infra** - Deploy stack INFRA (PostgreSQL, Redis, etc.)
4. **deploy-alice/observability/erpnext/backup** - Deploy stacks paralelo
5. **health-{stack}** - Health checks com retry logic
6. **rollback-{stack}** - Rollback automático se falhar
7. **notify** - Relatório consolidado

## 📊 Tabela de UIDs/GIDs de Containers (SSOT)

> **Fonte de verdade:** `infra/scripts/permissions-config.sh`

| Container | UID | GID | User Name | Permissão | Justificativa |
|-----------|-----|-----|-----------|-----------|---------------|
| **PostgreSQL** | **70** | **70** | postgres | **700** | Alpine UID - security hardening obrigatório |
| **Langfuse DB** | **70** | **70** | postgres | **700** | PostgreSQL Alpine - strict mode |
| **pgBackRest** | **70** | **70** | pgbackrest | 755 | Alpine UID - compartilha com PostgreSQL |
| Redis | 999 | 999 | redis | 755 | - |
| MariaDB | 999 | 999 | mysql | 755 | ERPNext |
| Caddy | 1000 | 1000 | caddy | **755** | Serve certificados públicos |
| SearXNG | 977 | 977 | searxng | 755 | - |
| Jaeger | 10001 | 10001 | jaeger | 755 | - |
| ClickHouse | 101 | 101 | clickhouse | 755 | - |
| Grafana | 472 | 472 | grafana | 755 | - |
| Prometheus | 65534 | 65534 | nobody | 755 | - |
| Node.js services | 1000 | 1000 | node | 755 | - |
| MinIO | 0 | 0 | root | 755 | - |
| Qdrant | 0 | 0 | root | 755 | - |
| Vector | 0 | 0 | root | 755 | - |

**IMPORTANTE:** Sempre usar UIDs numéricos explícitos (ex: `70:70`) ao invés de nomes (ex: `postgres:postgres`) para evitar ambiguidade entre host e container.

## 🔐 Segurança e Boas Práticas

### Princípios de Segurança

1. **Least Privilege:** Cada container roda com UID não-root quando possível
2. **Isolation:** Diretórios de dados separados por serviço
3. **No New Privileges:** Todos os containers usam `security_opt: no-new-privileges`
4. **Read-Only Root:** Containers sem escrita necessária usam `read_only: true`

### Permissões Defensivas

- **700 (rwx-------):** PostgreSQL, Langfuse DB, Secrets
  - Apenas owner pode ler/escrever/executar
  - Dados sensíveis (senhas, chaves de criptografia)

- **755 (rwxr-xr-x):** Maioria dos serviços
  - Owner pode escrever
  - Group e outros podem ler/executar
  - Logs, caches, dados não sensíveis

### Auditoria de Permissões

```bash
# Verificar TODAS as permissões de uma vez
bash /opt/alice/app/infra/scripts/fix-production-permissions.sh --validate

# Verificar diretório específico
ls -ld /opt/alice/data/postgres
stat -c '%a %U:%G %n' /opt/alice/data/postgres

# Encontrar permissões incorretas
find /opt/alice -type d -not -perm 755 -and -not -perm 700 2>/dev/null
```

## 📝 Checklist de Setup Inicial

### Primeira Vez no Servidor

- [ ] Servidor Hetzner provisionado e acessível via SSH
- [ ] Docker e Docker Compose instalados
- [ ] Networks Docker criadas (`alice-network`, `erpnext-network`)
- [ ] Código clonado em `/opt/alice/app`
- [ ] Secrets configurados no GitHub
- [ ] Script de permissões executado: `sudo bash fix-production-permissions.sh --create`
- [ ] Validação passou: `bash fix-production-permissions.sh --validate`
- [ ] Deploy inicial via workflow CI/CD

### Verificação Pós-Deploy

```bash
# 1. Verificar todos os containers estão running
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.State}}"

# 2. Verificar nenhum container em restart loop
docker ps --filter "status=restarting"

# 3. Verificar logs de containers críticos
docker logs alice-postgres --tail 50
docker logs jaeger --tail 50
docker logs alice-observability --tail 50

# 4. Verificar health checks
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "healthy|unhealthy"

# 5. Verificar permissões
bash /opt/alice/app/infra/scripts/fix-production-permissions.sh --validate
```

## 🆘 Suporte e Troubleshooting

### Logs Úteis

```bash
# Logs do workflow de deploy (via GitHub Actions UI)
# https://github.com/fillipeguerrabtc/alice/actions

# Logs de container específico
docker logs <container-name> --tail 100 --follow

# Logs de inicialização do PostgreSQL
docker logs alice-postgres 2>&1 | grep "database system is ready"

# Verificar estado de health checks
docker inspect <container-name> --format='{{json .State.Health}}'
```

### Comandos de Diagnóstico

```bash
# Verificar mounts de volumes
docker inspect <container-name> --format='{{json .Mounts}}' | jq

# Verificar usuário do processo dentro do container
docker exec <container-name> id

# Testar conectividade entre containers
docker exec alice-chat ping -c 3 alice-postgres

# Verificar uso de disco
df -h /opt/alice
du -sh /opt/alice/data/*
```

## 📚 Referências

- **CLAUDE.md** - Regras e convenções do projeto
  - Regra 2: NÃO DUPLICAR (SSOT)
  - Regra 6: Enterprise-grade, sem workarounds
  - Regra 11: Melhores práticas 2025
  - Regra 12: Deploy Hetzner GPU
  - Regra 16: Health checks e circuit breakers

- **PERMISSIONS.md** - **SSOT de permissões (UIDs/GIDs/permissões)**
- **DEPLOYMENT.md** - Guia completo de deployment
- **ARQUITETURA.md** - Arquitetura multi-stack modular
- **Docker Compose Documentation** - https://docs.docker.com/compose/
- **Docker Security Best Practices** - https://docs.docker.com/engine/security/

---

**Versão:** 1.1.0  
**Última Atualização:** 09 de Janeiro de 2026  
**Autor:** Fillipe Guerra  
**License:** MIT
