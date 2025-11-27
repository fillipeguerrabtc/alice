# Alice Enterprise Platform - Guia de Deploy

## Visão Geral da Arquitetura

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           REPLIT (IDE APENAS)                            │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Edição de código, revisão, planejamento                          │  │
│  │  NÃO executa a aplicação - apenas desenvolvimento                 │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                              Git Push
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       GITHUB ACTIONS CI/CD                               │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  1. Build Pacotes Compartilhados                                   │  │
│  │  2. Build Imagens Docker                                           │  │
│  │  3. Push para GHCR                                                 │  │
│  │  4. SSH para Hetzner VM                                            │  │
│  │  5. Deploy Docker Compose                                          │  │
│  │  6. Health Checks                                                  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Nota: Pipeline básico. Lint, Trivy e aprovação manual são opcionais.   │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    PRODUÇÃO (Hetzner Cloud - CX43)                       │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │             CX43 (8 vCPUs, 16GB RAM, 160GB SSD)                   │  │
│  │                                                                    │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │                     TRAEFIK v3.0                             │  │  │
│  │  │           (API Gateway + SSL Automático)                     │  │  │
│  │  │                   :80 / :443                                 │  │  │
│  │  └──────────────────────┬──────────────────────────────────────┘  │  │
│  │                         │                                          │  │
│  │     ┌───────────────────┼───────────────────┐                     │  │
│  │     ▼                   ▼                   ▼                     │  │
│  │  ┌──────────────────────────────────────────────────────────┐    │  │
│  │  │              MICROSERVIÇOS ALICE                          │    │  │
│  │  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │    │  │
│  │  │  │Frontend│ │  Auth  │ │  Chat  │ │  RAG   │ │Training│  │    │  │
│  │  │  │ :3000  │ │ :3001  │ │ :3002  │ │ :3003  │ │ :3004  │  │    │  │
│  │  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘  │    │  │
│  │  │                      ┌────────┐                           │    │  │
│  │  │                      │Integra.│                           │    │  │
│  │  │                      │ :3005  │                           │    │  │
│  │  │                      └────────┘                           │    │  │
│  │  └──────────────────────────────────────────────────────────┘    │  │
│  │                         │                                          │  │
│  │  ┌──────────────────────┴──────────────────────────────────────┐  │  │
│  │  │                      ERPNEXT STACK                           │  │  │
│  │  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐               │  │  │
│  │  │  │Frontend│ │Backend │ │MariaDB │ │ Redis  │               │  │  │
│  │  │  │ :8080  │ │ :8000  │ │ :3306  │ │ :6379  │               │  │  │
│  │  │  └────────┘ └────────┘ └────────┘ └────────┘               │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  │                         │                                          │  │
│  │  ┌──────────────────────┴──────────────────────────────────────┐  │  │
│  │  │                      DATABASES                               │  │  │
│  │  │        ┌─────────────────────────────────────────┐          │  │  │
│  │  │        │  PostgreSQL 16 + pgvector               │          │  │  │
│  │  │        │           :5432                          │          │  │  │
│  │  │        └─────────────────────────────────────────┘          │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  │                         │                                          │  │
│  │                   SaladCloud GPUs                                  │  │
│  │                (Llama 4 Maverick 400B)                             │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Recursos Hetzner CX43:                                             │ │
│  │  • vCPUs: 8 (AMD EPYC)                                             │ │
│  │  • RAM: 16GB                                                        │ │
│  │  • SSD: 160GB NVMe                                                  │ │
│  │  • Tráfego: 20TB/mês                                                │ │
│  │  • IPv4 + IPv6                                                      │ │
│  │  • Custo: €9.49/mês                                                 │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Recursos Utilizados

### Hetzner Cloud (Produção)

| Recurso | Especificação | Custo |
|---------|---------------|-------|
| CX43 (Cost-Optimized) | 8 vCPU, 16GB RAM, 160GB SSD | €8.99/mês |
| IPv4 Público | Endereço dedicado | €0.50/mês |
| Volumes (Opcional) | Expansão de disco | €0.044/GB/mês |
| Snapshots | Backup automático | €0.012/GB/mês |
| **Total Base** | | **€9.49/mês** |

### GitHub (Gratuito)

| Recurso | Free Tier | Nosso Uso |
|---------|-----------|-----------|
| Actions (Público) | Ilimitado | Todo CI/CD |
| Actions (Privado) | 2000 min/mês | ~500 min |
| Container Registry | 500MB | Imagens Docker |

### SaladCloud (Pago - GPUs para LLM)

| Recurso | Custo |
|---------|-------|
| Horas GPU | $0.10-0.30/hora |
| Llama 4 Maverick | Sob demanda |

### DuckDNS (Gratuito)

| Recurso | Custo |
|---------|-------|
| Subdomínio dinâmico | Gratuito |
| Atualizações automáticas | Gratuito |

---

## Instruções de Configuração

### 1. Criar Servidor Hetzner Cloud

1. Acesse [console.hetzner.cloud](https://console.hetzner.cloud)
2. Crie novo projeto ou use "Default"
3. **Servers** → **Add Server**
4. Configure:
   - **Location:** Nuremberg (recomendado) ou Helsinki
   - **Image:** Ubuntu 24.04
   - **Type:** Cost-Optimized → **CX43**
   - **SSH Key:** Adicione sua chave pública
   - **IPv4:** Habilitado
   - **Name:** `alice-prod`
5. Clique **Create & Buy now**
6. Anote o IP público (ex: `46.224.46.93`)

### 2. Configurar DNS (DuckDNS)

1. Acesse [duckdns.org](https://www.duckdns.org)
2. Faça login com sua conta
3. Crie um subdomínio: `yesyoudeserve`
4. Atualize o IP para o IP público do servidor Hetzner
5. Domínio resultante: `yesyoudeserve.duckdns.org`

### 3. Gerar API Token Hetzner

1. Console Hetzner → **Security** → **API Tokens**
2. Clique **Generate API Token**
3. Description: `github-actions-alice`
4. Permissions: **Read & Write**
5. Copie o token (mostrado apenas uma vez!)

### 4. Configurar GitHub Secrets

Vá para: Repositório → **Settings** → **Secrets and variables** → **Actions**

**Secrets Obrigatórios:**

```bash
# ========== INFRAESTRUTURA HETZNER ==========
HETZNER_API_TOKEN=seu-token-api-hetzner
HETZNER_VM_HOST=46.224.46.93
HETZNER_VM_USER=root
HETZNER_SSH_PRIVATE_KEY=-----BEGIN OPENSSH PRIVATE KEY-----...

# ========== POSTGRESQL ==========
POSTGRES_PASSWORD=senha-segura-gerada

# ========== SESSÃO E SEGURANÇA ==========
SESSION_SECRET=seu-session-secret-seguro

# ========== STRIPE (RECEBER PAGAMENTOS) ==========
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# ========== WISE (ENVIAR PAGAMENTOS GLOBAIS) ==========
# Circuit Breaker: timeout 15s, error threshold 50%, reset 30s
WISE_API_KEY=xxxxx
WISE_PROFILE_ID=xxxxx
WISE_WEBHOOK_SECRET=xxxxx  # opcional para webhooks

# ========== OAUTH GOOGLE ==========
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx

# ========== OAUTH GITHUB (NOME CORRIGIDO!) ==========
OAUTH_GITHUB_CLIENT_ID=Ov23xxxxx
OAUTH_GITHUB_CLIENT_SECRET=xxxxx

# ========== SALAD CLOUD (LLM) ==========
SALAD_API_KEY=sua-api-key
SALAD_ORGANIZATION_ID=org_xxxxx

# ========== TWILIO (WHATSAPP) ==========
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=xxxxx
TWILIO_WHATSAPP_NUMBER=+14155238886

# ========== RESEND (EMAIL) ==========
RESEND_API_KEY=re_xxxxx

# ========== DOMÍNIO E SSL ==========
ACME_EMAIL=seu-email@exemplo.com
```

**⚠️ IMPORTANTE:** O GitHub NÃO permite secrets começando com `GITHUB_`. Use `OAUTH_GITHUB_` como prefixo.

### 5. Configurar Servidor Hetzner (Primeira vez)

```bash
# Conectar via SSH
ssh root@46.224.46.93

# Atualizar sistema
apt update && apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com | sh

# Instalar Docker Compose
apt install docker-compose-plugin -y

# Verificar instalação
docker --version
docker compose version

# Configurar firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Criar estrutura de pastas
mkdir -p /opt/alice/{data,logs,ssl,backups}
mkdir -p /opt/alice/data/{postgres,mariadb,redis,erpnext}
```

### 6. Primeiro Deploy

O deploy é **100% automático** via GitHub Actions:

1. Faça commit e push para a branch `main`
2. O GitHub Actions irá:
   - Build dos containers
   - Push para GHCR
   - SSH para Hetzner
   - Deploy via Docker Compose
   - Health checks
3. Acesse: `https://yesyoudeserve.duckdns.org`

---

## Fluxo de Deploy

### Deploy Automático (push para main)

```
1. Push para branch main
2. Pipeline CI/CD executa:
   - Build pacotes compartilhados
   - Build imagens Docker
   - Push para GHCR
3. Deploy para Hetzner:
   - SSH para VM
   - Pull das novas imagens
   - Docker Compose up
   - Health checks
```

**Nota:** Pipeline básico configurado. Lint, testes e scans de segurança podem ser adicionados conforme necessário.

### Deploy Manual

```bash
# Via GitHub UI
Actions → Deploy to Production → Run workflow

# Via CLI
gh workflow run deploy-production.yml
```

---

## Rollback

### Automático
Rollback automático acontece se health checks falharem após deploy.

### Manual

```bash
# SSH para o servidor
ssh root@46.224.46.93

# Listar imagens disponíveis
docker images | grep alice

# Rollback para versão anterior
docker pull ghcr.io/SEU-REPO/alice-auth:SHA-ANTERIOR
docker compose -f /opt/alice/docker-compose.prod.yml up -d --force-recreate alice-auth
```

---

## Monitoramento

### Logs

```bash
# Ver logs de todos os containers
cd /opt/alice && docker compose logs -f

# Logs de serviço específico
docker logs -f alice-auth

# Logs do Traefik (API Gateway)
docker logs -f traefik
```

### Health Checks

```bash
# Verificar status dos serviços
docker compose ps

# Testar endpoints
curl -s https://yesyoudeserve.duckdns.org/api/health
curl -s https://yesyoudeserve.duckdns.org/api/auth/health
```

### Recursos do Servidor

```bash
# CPU, memória, processos
htop

# Disco
df -h

# Docker stats
docker stats
```

---

## Backup

### PostgreSQL (Alice)

```bash
# Backup manual
docker exec alice-postgres pg_dump -U alice alice_db > /opt/alice/backups/alice_$(date +%Y%m%d).sql

# Restore
cat backup.sql | docker exec -i alice-postgres psql -U alice alice_db
```

### MariaDB (ERPNext)

```bash
# Backup manual
docker exec erpnext-mariadb mysqldump -u root -p$MYSQL_ROOT_PASSWORD erpnext > /opt/alice/backups/erpnext_$(date +%Y%m%d).sql

# Restore
cat backup.sql | docker exec -i erpnext-mariadb mysql -u root -p$MYSQL_ROOT_PASSWORD erpnext
```

### Backup Automatizado

O script `/opt/alice/scripts/backup.sh` roda via cron diariamente às 3h da manhã.

---

## Resumo de Custos

| Componente | Custo Mensal |
|------------|--------------|
| Hetzner CX43 | €8.99 |
| IPv4 Público | €0.50 |
| DuckDNS | $0 (gratuito) |
| GitHub Actions | $0 (gratuito) |
| **SaladCloud GPUs** | **Variável ($50-200)** |
| **Total Infraestrutura** | **~€9.49/mês** |
| **Total com LLM** | **~$60-210/mês** |

---

## Resolução de Problemas

### Problemas de Conexão SSH

```bash
# Verificar chave SSH
ssh -v root@46.224.46.93

# Verificar permissões da chave
chmod 600 ~/.ssh/id_rsa
```

### Container não inicia

```bash
# Ver logs detalhados
docker logs alice-auth --tail 100

# Verificar recursos
htop
df -h

# Reiniciar container
docker compose restart alice-auth
```

### SSL não funciona

```bash
# Verificar Traefik
docker logs traefik

# Verificar certificados
docker exec traefik cat /letsencrypt/acme.json | jq '.le.Certificates'
```

### Firewall bloqueando

```bash
# Verificar regras
ufw status verbose

# Adicionar porta
ufw allow PORTA/tcp
```

---

## Scripts Disponíveis

| Script | Descrição |
|--------|-----------|
| `infra/scripts/setup-hetzner.sh` | Configura Docker e dependências na VM |
| `infra/scripts/backup.sh` | Backup do banco de dados |
| `infra/scripts/restore.sh` | Restore do banco de dados |

---

## Arquivos de Configuração

| Arquivo | Descrição |
|---------|-----------|
| `.github/workflows/deploy-production.yml` | Pipeline CI/CD completo |
| `infra/docker/docker-compose.prod.yml` | Stack Docker para produção |
| `infra/docker/.env.prod.example` | Exemplo de variáveis de ambiente |

---

## URLs de Produção

| Serviço | URL |
|---------|-----|
| Alice Frontend | https://yesyoudeserve.duckdns.org |
| Alice API | https://yesyoudeserve.duckdns.org/api |
| ERPNext | https://erp.yesyoudeserve.duckdns.org |
| Traefik Dashboard | https://traefik.yesyoudeserve.duckdns.org (protegido) |

---

*Documento atualizado em: Novembro 2025*
*Versão: 3.0 - Arquitetura PROD-only Hetzner Cloud*
