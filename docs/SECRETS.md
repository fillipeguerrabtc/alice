# Guia Completo de Secrets - Alice Enterprise Platform

**Autor:** Fillipe Guerra
**Data:** 21 de Dezembro de 2025

## Visão Geral

Este documento contém a lista completa de todos os secrets necessários para a plataforma Alice Enterprise, incluindo instruções de configuração para webhooks e OAuth.

**Total de Secrets:** 50 configurados no repositório GitHub (verificado em 25/12/2025)
**Arquitetura:** Cursor IDE é APENAS editor de código. Produção 100% na Hetzner Cloud.
**Total de Containers:** 50 em produção (8 infra + 8 Alice + 15 ERPNext + 14 observability + 4 GPU + 1 backup)
**Redis Alice:** Container dedicado para cache distribuído (segregação enterprise do ERPNext)
**LLM:** Mixtral 8x7B (MoE ~12B ativos, vLLM) via GPU Manager Service (Hetzner GPU)
**Trading:** KuCoin Futures BTC Perpetuals (XBTUSDTM)
**URL de Produção:** `https://yesyoudeserve.duckdns.org`
**URL ERPNext:** `https://erp.yesyoudeserve.duckdns.org`
**IP:** 46.224.46.93

> Atualização 21/12/2025: Fluxo CI deduplicado (push somente em `main` + PR em `main`) e correções de tipos no frontend destravando Release & Tag.

### Serviços que Utilizam Secrets

| Categoria | Serviços | Secrets Relacionados |
|-----------|----------|----------------------|
| **Infraestrutura** | postgres, traefik, alice-redis | POSTGRES_PASSWORD, REDIS_PASSWORD, ACME_EMAIL |
| **Alice Auth** | alice-auth | SESSION_SECRET, GOOGLE_*, OAUTH_GITHUB_* |
| **Alice Chat** | alice-chat | GPU_MANAGER_URL (opcional, default: http://gpu-manager-service:3010) |
| **Alice RAG (GPU + Web Search)** | alice-rag | GPU_MANAGER_URL, SEARXNG_URL |
| **GPU Manager Service** | gpu-manager-service | GPU_MANAGER_URL, INTERNAL_API_SECRET, REDIS_URL |
| **Alice Integrations** | alice-integrations | STRIPE_*, WISE_*, TWILIO_*, RESEND_*, KUCOIN_* |
| **Alice Trading** | alice-integrations | KUCOIN_API_KEY, KUCOIN_API_SECRET, KUCOIN_API_PASSPHRASE |
| **Alice Observability** | alice-observability, langfuse, langfuse-db | GRAFANA_*, LANGFUSE_*, LANGFUSE_DB_USER, LANGFUSE_DB_PASSWORD, LANGFUSE_DB_NAME |
| **Web Search (SearXNG)** | alice-searxng | SEARXNG_SECRET_KEY |
| **ERPNext** | erpnext-* | ERPNEXT_*, REDIS_CACHE_PASSWORD, REDIS_QUEUE_PASSWORD |
| **Deploy** | GitHub Actions | HETZNER_*, GH_PAT |

---

## Onde Configurar

| Local | O que vai lá | Observação |
|-------|--------------|------------|
| **GitHub Secrets** | Todos os secrets de produção | CI/CD cria `.env.prod` automaticamente |
| **Variáveis de Ambiente Local** | Apenas para desenvolvimento (`.env`) | NÃO usado em produção |
| **Hetzner .env.prod** | Criado automaticamente | Gerado pelo GitHub Actions |

---

## Secrets por Fase de Deploy

### FASE 1: Deploy Mínimo Funcional (OBRIGATÓRIOS)

Estes são necessários para o deploy funcionar:

| Secret | Valor | Descrição |
|--------|-------|-----------|
| `HETZNER_VM_HOST` | `46.224.46.93` | IP do Production Server (GPU Server) |
| `HETZNER_VM_USER` | `root` | Usuário SSH do Production Server (legado) |
| `HETZNER_SSH_PRIVATE_KEY` | Chave SSH completa | Incluir `-----BEGIN...-----END` (legado) |
| `PRODUCTION_SERVER_HOST` | `46.224.46.93` | IP do Production Server (para Deploy Server) |
| `PRODUCTION_SERVER_USER` | `alice-deploy` | Usuário SSH dedicado no Production Server (enterprise) |
| `GH_PAT` | Token GitHub | Personal Access Token com `repo`, `write:packages`, `workflow` (ou permissão total) |

> **ENTERPRISE-GRADE (25/12/2025):** Para arquitetura com Deploy Server separado, use `PRODUCTION_SERVER_HOST` e `PRODUCTION_SERVER_USER`. `HETZNER_VM_HOST` e `HETZNER_VM_USER` são mantidos apenas para compatibilidade (fallback SSH).
| `POSTGRES_PASSWORD` | Senha forte 32+ chars | `openssl rand -hex 32` |
| `REDIS_PASSWORD` | Senha Redis Alice (obrigatório) | `openssl rand -hex 32` |
| `SESSION_SECRET` | String aleatória 64+ chars | `openssl rand -hex 64` |
| `INTERNAL_API_SECRET` | Secret para comunicação S2S | `openssl rand -hex 32` |
| `ADMIN_USER` | Email do administrador global (Alice/ERPNext/Grafana) | Definir seu email corporativo |
| `ADMIN_PWD` | Senha do administrador global (mín. 8 chars) | Definir forte e exclusiva |
| `DOCKERHUB_USERNAME` | Username Docker Hub | Evita rate limit (100 pulls/6h anônimo) |
| `DOCKERHUB_TOKEN` | Access Token Docker Hub | [hub.docker.com/settings/security](https://hub.docker.com/settings/security) |

### FASE 2: Autenticação (mínimo 1 provider)

**Google OAuth:**

| Secret | Onde Obter |
|--------|------------|
| `GOOGLE_CLIENT_ID` | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) |
| `GOOGLE_CLIENT_SECRET` | [console.cloud.google.com](https://console.cloud.google.com/apis/credentials) |

**Configuração:**
1. Acesse Google Cloud Console → APIs & Services → Credentials
2. Crie OAuth 2.0 Client ID (Web application)
3. Authorized redirect URIs: `https://yesyoudeserve.duckdns.org/api/auth/callback/google`
4. Authorized JavaScript origins: `https://yesyoudeserve.duckdns.org`

**GitHub OAuth:**

| Secret | Onde Obter |
|--------|------------|
| `OAUTH_GITHUB_CLIENT_ID` | [github.com/settings/developers](https://github.com/settings/developers) |
| `OAUTH_GITHUB_CLIENT_SECRET` | [github.com/settings/developers](https://github.com/settings/developers) |

**Configuração:**
1. Settings → Developer settings → OAuth Apps → New OAuth App
2. Homepage URL: `https://yesyoudeserve.duckdns.org`
3. Authorization callback URL: `https://yesyoudeserve.duckdns.org/api/auth/callback/github`

⚠️ **IMPORTANTE:** O GitHub NÃO permite secrets começando com `GITHUB_`. Use `OAUTH_GITHUB_` como prefixo.

### FASE 3: GPU Manager Service (Gerenciamento Centralizado de Requisições GPU)

**ARQUITETURA ENTERPRISE (25/12/2025):** Todos os serviços GPU (LLM, Embeddings, FLUX, ASR) são gerenciados pelo GPU Manager Service, que roda localmente no servidor Hetzner GPU.

| Secret | Onde Obter | Descrição |
|--------|------------|-----------|
| `HUGGINGFACE_TOKEN` | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) → New token → Read (sem write) | Token de acesso read-only do HuggingFace (obrigatório para download de modelos) |
| `GPU_MANAGER_URL` | Opcional (default: `http://gpu-manager-service:3010`) | URL do GPU Manager Service (usado internamente pelos serviços) |
| `INTERNAL_API_SECRET` | Gerar com `openssl rand -hex 32` | Secret para comunicação segura entre serviços (já configurado na FASE 1) |

**NOTA:** O GPU Manager Service gerencia automaticamente:
- Fila priorizada de requisições (chat > trading > embeddings > outros)
- Monitoramento de VRAM em tempo real (nvidia-smi)
- Circuit breakers por serviço GPU
- Retry logic com backoff exponencial
- Métricas Prometheus (latência, fila, VRAM, erros)

### FASE 4: Pagamentos Stripe (receber EUR/SEPA)

| Secret | Onde Obter |
|--------|------------|
| `STRIPE_SECRET_KEY` | [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) |
| `STRIPE_PUBLISHABLE_KEY` | dashboard.stripe.com/apikeys |
| `STRIPE_WEBHOOK_SECRET` | dashboard.stripe.com/webhooks |
| `STRIPE_WEBHOOK_BASE_URL` | Base URL para webhooks (opcional, default: `https://yesyoudeserve.duckdns.org`) |

**Configuração de Webhook:**
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Endpoint URL: `https://yesyoudeserve.duckdns.org/webhook/stripe`
3. Eventos:
   - `customer.created`, `customer.updated`, `customer.deleted`
   - `payment_intent.succeeded`, `payment_intent.payment_failed`
   - `invoice.paid`, `invoice.payment_failed`
   - `checkout.session.completed`
   - `subscription.created`, `subscription.updated`, `subscription.deleted`
4. Copie o Signing Secret (começa com `whsec_`)

### FASE 5: Pagamentos Wise (enviar globalmente)

| Secret | Onde Obter |
|--------|------------|
| `WISE_API_KEY` | [wise.com/settings](https://wise.com/settings) → API Tokens |
| `WISE_PROFILE_ID` | URL: `wise.com/user/account/XXXXX` |
| `WISE_WEBHOOK_SECRET` | wise.com/settings → Webhooks (opcional, gerado após configurar webhook) |
| `WISE_SANDBOX` | `true` para sandbox, `false` para produção (opcional, default: `false`) |

**Configuração:**
1. Wise Business → Settings → API Tokens → Add new token
2. Permissões: `Read balances`, `Read transfers`, `Create transfers`
3. Profile ID está na URL quando você acessa sua conta

**Nota:** Use `WISE_SANDBOX=false` em produção.

### FASE 5b: Trading KuCoin Futures (BTC Perpetuals)

| Secret | Onde Obter |
|--------|------------|
| `KUCOIN_PRO_API_KEY` | [kucoin.com/account/api](https://www.kucoin.com/account/api) |
| `KUCOIN_PRO_API_SECRET` | kucoin.com/account/api (mostrado apenas 1 vez ao criar) |
| `KUCOIN_PRO_API_PASSPHRASE` | Definido por você ao criar a API Key |
| `KUCOIN_PRO_BASE_URL` | Opcional. Default: `https://api-futures.kucoin.com` |
| `KUCOIN_SANDBOX_MODE` | `true` para sandbox, `false` para produção (default: `false`) |

**Configuração:**
1. KuCoin → Profile → API Management → Create API
2. Permissions necessárias: `Futures Trading`, `General`
3. IP Whitelist: Adicionar IP do servidor Hetzner (46.224.46.93)
4. Importante: **Guarde o API Secret imediatamente** - só é mostrado 1 vez

**Sandbox para Testes:**
- URL: `https://api-sandbox-futures.kucoin.com`
- Criar conta separada em sandbox: [sandbox-futures.kucoin.com](https://sandbox-futures.kucoin.com)
- Definir `KUCOIN_SANDBOX_MODE=true` para usar sandbox

**Endpoints Implementados (integrations-service):**
- `/api/integrations/trading/status` - Status do serviço
- `/api/integrations/trading/market/:symbol` - Dados de mercado
- `/api/integrations/trading/account` - Saldo da conta
- `/api/integrations/trading/orders` - Gerenciamento de ordens
- `/api/integrations/trading/signals` - Sinais do Mixtral LLM

### FASE 5c: Qdrant - Banco Vetorial para Texto (4096 dimensões)

| Secret | Onde Obter |
|--------|------------|
| `QDRANT_API_KEY` | Gerar com `openssl rand -hex 32` |

**Configuração:**
1. Gerar API Key: `openssl rand -hex 32`
2. Adicionar como GitHub Secret: `QDRANT_API_KEY`
3. O container `alice-qdrant` usa esta key para autenticação

**Arquitetura de Embeddings:**
- **Qdrant (4096 dim):** Qwen3-Embedding-8B para texto (Trading + RAG)
- **PostgreSQL pgvector (1024 dim):** OpenCLIP ViT-H/14 para imagens

**Por que Qdrant para Trading:**
- pgvector HNSW suporta máx 4000 dim (halfvec) / 2000 dim (vector)
- Qdrant suporta HNSW com 4096+ dimensões (pgvector limita em 4000 para halfvec)
- Qwen3-Embedding-8B (4096 dim, 8B params) oferece qualidade superior para texto

**Portas:**
- `6333`: REST API (usada pelo integrations-service)
- `6334`: gRPC (não exposta externamente)

### FASE 6: Comunicação (WhatsApp/SMS/Email)

**Twilio:**

| Secret | Onde Obter |
|--------|------------|
| `TWILIO_ACCOUNT_SID` | [console.twilio.com](https://console.twilio.com) |
| `TWILIO_AUTH_TOKEN` | console.twilio.com |
| `TWILIO_WHATSAPP_NUMBER` | console.twilio.com/whatsapp |

**Configuração de Webhook:**
1. Messaging → Settings → WhatsApp sandbox settings
2. When a message comes in: `https://yesyoudeserve.duckdns.org/api/integrations/twilio/webhook/whatsapp`
3. Status callback URL: `https://yesyoudeserve.duckdns.org/api/integrations/twilio/webhook/status`

**Resend (Integração Simplificada via API Key):**

| Secret | Onde Obter |
|--------|------------|
| `RESEND_API_KEY` | [resend.com/api-keys](https://resend.com/api-keys) |
| *(sem variável FROM)* | O sender padrão é `onboarding@resend.dev` (permitido sem domínio verificado) |

**Importante - Alertmanager usa relay SMTP do Resend:**
- O Resend oferece um relay SMTP (`smtp.resend.com:587`) que aceita a **API Key como senha**
- O arquivo `/opt/alice/secrets/alertmanager/smtp_password` deve conter a `RESEND_API_KEY`
- Username fixo: `resend`
- Não é necessário domínio verificado para usar `onboarding@resend.dev` como remetente

### FASE 6.1: CORS (origens frontend) — OBRIGATÓRIO EM PRODUÇÃO

| Secret | Valor Esperado | Descrição |
|--------|----------------|-----------|
| `CORS_ORIGIN` | `https://yesyoudeserve.duckdns.org` (ou domínio final) | Origin principal usado pelo `auth-service` |
| `CORS_ORIGINS` | Lista separada por vírgula, sem espaços. Ex: `https://yesyoudeserve.duckdns.org,https://admin.yesyoudeserve.duckdns.org` | Usado por chat, integrations, rag, training, observability |

> Defina pelo menos um dos dois. Se apenas `CORS_ORIGINS` estiver setado, o workflow derivará `CORS_ORIGIN` a partir do primeiro item.

### FASE 7: ERPNext (CRM/ERP)

**🔴 OBRIGATÓRIOS para Deploy** (deploy FALHA sem eles):

| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `ERPNEXT_MYSQL_ROOT_PASSWORD` | Senha root MariaDB | `openssl rand -base64 24` |
| `ERPNEXT_DB_PASSWORD` | Senha usuário ERPNext no DB | `openssl rand -base64 24` |
| `ERPNEXT_ADMIN_PASSWORD` | Senha admin do site ERPNext | `openssl rand -base64 24` |
| `REDIS_CACHE_PASSWORD` | Senha Redis Cache (ACL) | `openssl rand -hex 32` ⚠️ **OBRIGATÓRIO HEX** |
| `REDIS_QUEUE_PASSWORD` | Senha Redis Queue (ACL) | `openssl rand -hex 32` ⚠️ **OBRIGATÓRIO HEX** |

**⚠️ IMPORTANTE - Senhas Redis (Atualizado 22/12/2025):**
- As senhas Redis **DEVEM** ser geradas com `openssl rand -hex 32` (hexadecimal)
- **NÃO USE** `openssl rand -base64` para senhas Redis!
- Motivo: Base64 produz caracteres `+`, `/`, `=` que quebram URLs Redis
- Erro típico: `ValueError: Port could not be cast to integer value`
- Hexadecimal (0-9, a-f) é 100% URL-safe

**🟢 OPCIONAIS** (podem ser configurados após ERPNext rodando):

| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `ERPNEXT_API_KEY` | API Key para integrations-service | ERPNext → User → API Access → Generate Keys |
| `ERPNEXT_API_SECRET` | API Secret para integrations-service | Gerado junto com API Key |

**Nota:** Os secrets obrigatórios usam `:?` no docker-compose (required). Os opcionais usam `:-` (fallback vazio).

### FASE 8: Observabilidade (Métricas LLM)

| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `LANGFUSE_SECRET_KEY` | Chave secreta Langfuse | `openssl rand -hex 32` com prefixo `sk-lf-` |
| `LANGFUSE_NEXT_AUTH_SECRET` | Chave de autenticação | `openssl rand -hex 32` |
| `LANGFUSE_SALT` | **OBRIGATÓRIO v3** - Salt para hashing | `openssl rand -base64 16` |
| `LANGFUSE_ENCRYPTION_KEY` | **OBRIGATÓRIO v3** - Chave 256-bit hex | `openssl rand -hex 32` |
| `GRAFANA_ADMIN_USER` | Usuário admin Grafana (usa ADMIN_USER por padrão) | Recomenda-se igual ao ADMIN_USER |
| `GRAFANA_ADMIN_PASSWORD` | Senha admin Grafana (usa ADMIN_PWD por padrão) | Recomenda-se igual ao ADMIN_PWD |
| `SMTP_PASSWORD` (arquivo) | **API Key do Resend** para relay SMTP do Alertmanager | O workflow escreve a `RESEND_API_KEY` em `/opt/alice/secrets/alertmanager/smtp_password` |

**⚠️ IMPORTANTE - Langfuse v3 + ClickHouse (Atualizado 19/12/2025):**
- Langfuse foi atualizado para v3.139.0 que requer novas variáveis obrigatórias:
  - `LANGFUSE_SALT`: String aleatória para hashing (gerar com `openssl rand -base64 16`)
  - `LANGFUSE_ENCRYPTION_KEY`: Chave 256-bit hex (gerar com `openssl rand -hex 32`)
- Nova arquitetura v3 inclui container `langfuse-worker` para processamento assíncrono
- **ClickHouse 24.8** é backend OLAP obrigatório para Langfuse v3:
  - `CLICKHOUSE_USER`: Usuário do ClickHouse (ex: `langfuse`)
  - `CLICKHOUSE_PASSWORD`: Senha segura (gerar com `openssl rand -base64 32`)

**Observação sobre Alertmanager + Resend:**
- O Alertmanager usa o relay SMTP do Resend (`smtp.resend.com:587`) para enviar alertas por email
- A "senha SMTP" é na verdade a **API Key do Resend** (integração simplificada)
- Username fixo: `resend` | Sender: `onboarding@resend.dev` (não requer domínio verificado)
- O arquivo de senha é montado em `/run/secrets/smtp_password` no container

**Observação:** Langfuse usa PostgreSQL dedicado na porta 5433 (separado do banco principal).

### FASE 9: Backup (pgBackRest)

| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `BACKUP_CIPHER_PASS` | Senha para criptografia AES-256 dos backups | `openssl rand -hex 32` |
| `PGBACKREST_STANZA` | (Opcional) Override da stanza; default: `alice_prod` (alinhado ao pgbackrest.conf) | Definir somente se for usar stanza diferente |

**Uso:** Criptografa backups do PostgreSQL via pgBackRest. Obrigatório para PITR (Point-in-Time Recovery) seguro.

### FASE 10: Web Search (SearXNG)
| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `SEARXNG_SECRET_KEY` | Chave secreta da instância SearXNG (protege endpoints internos) | `openssl rand -hex 64` e adicionar no GitHub Secrets |

### Domínio e SSL

| Secret | Descrição |
|--------|-----------|
| `ACME_EMAIL` | Email para certificados Let's Encrypt |

---

## Checklist de Verificação

> **Status atualizado em:** 20 de Dezembro de 2025  
> **Resumo:** 54 secrets de produção ✅ configurados no repositório. Pendentes opcionais pós-deploy: `ERPNEXT_API_KEY`, `ERPNEXT_API_SECRET`, `WISE_WEBHOOK_SECRET`.

### Infraestrutura

| Secret | Status |
|--------|--------|
| `HETZNER_VM_HOST` | ✅ |
| `HETZNER_VM_USER` | ✅ |
| `HETZNER_SSH_PRIVATE_KEY` | ✅ |
| `GH_PAT` | ✅ |
| `POSTGRES_PASSWORD` | ✅ |
| `REDIS_PASSWORD` | ✅ |
| `SESSION_SECRET` | ✅ |
| `INTERNAL_API_SECRET` | ✅ |

### Docker Hub (Rate Limit)

| Secret | Status |
|--------|--------|
| `DOCKERHUB_USERNAME` | ✅ (adicionado 20/12/2025) |
| `DOCKERHUB_TOKEN` | ✅ (adicionado 20/12/2025) |

### OAuth (pelo menos 1)

| Secret | Status |
|--------|--------|
| `GOOGLE_CLIENT_ID` | ✅ |
| `GOOGLE_CLIENT_SECRET` | ✅ |
| `OAUTH_GITHUB_CLIENT_ID` | ✅ |
| `OAUTH_GITHUB_CLIENT_SECRET` | ✅ |

### GPU Manager Service (Hetzner GPU GEX44)

| Secret | Status |
|--------|--------|
| `HUGGINGFACE_TOKEN` | ✅ (obrigatório para downloads de modelos - Mixtral, Qwen3, OpenCLIP, FLUX, Canary) |

> **NOTA (25/12/2025):** Todos os serviços GPU agora rodam localmente no servidor Hetzner GPU GEX44. Não são necessários secrets externos para GPU (Salad Cloud removido).

### Stripe (Pagamentos)

| Secret | Status |
|--------|--------|
| `STRIPE_SECRET_KEY` | ✅ |
| `STRIPE_PUBLISHABLE_KEY` | ✅ |
| `STRIPE_WEBHOOK_SECRET` | ✅ |
| `STRIPE_WEBHOOK_BASE_URL` | ⏳ Opcional (hoje ausente; fallback `https://yesyoudeserve.duckdns.org`) |

### Wise (Transferências)

| Secret | Status |
|--------|--------|
| `WISE_API_KEY` | ✅ |
| `WISE_PROFILE_ID` | ✅ |
| `WISE_WEBHOOK_SECRET` | ⏳ Opcional (gerar após configurar webhook no Wise Dashboard) |
| `WISE_SANDBOX` | ⏳ Opcional (default aplicado: `false`) |

### KuCoin Futures (Trading BTC)

| Secret | Status |
|--------|--------|
| `KUCOIN_PRO_API_KEY` | ✅ |
| `KUCOIN_PRO_API_SECRET` | ✅ |
| `KUCOIN_PRO_API_PASSPHRASE` | ✅ |
| `KUCOIN_PRO_BASE_URL` | ✅ |
| `KUCOIN_SANDBOX_MODE` | ⏳ Opcional (default: `false`) |

### Comunicação

| Secret | Status |
|--------|--------|
| `TWILIO_ACCOUNT_SID` | ✅ |
| `TWILIO_AUTH_TOKEN` | ✅ |
| `TWILIO_WHATSAPP_NUMBER` | ✅ |
| `RESEND_API_KEY` | ✅ |

### CORS (Origens Frontend) — OBRIGATÓRIO

| Secret | Status |
|--------|--------|
| `CORS_ORIGINS` | ✅ (criado em 10/12/2025) |

### ERPNext

| Secret | Status | Obrigatório |
|--------|--------|-------------|
| `ERPNEXT_MYSQL_ROOT_PASSWORD` | ✅ | 🔴 Sim |
| `ERPNEXT_DB_PASSWORD` | ✅ | 🔴 Sim |
| `ERPNEXT_ADMIN_PASSWORD` | ✅ | 🔴 Sim |
| `REDIS_CACHE_PASSWORD` | ✅ | 🔴 Sim |
| `REDIS_QUEUE_PASSWORD` | ✅ | 🔴 Sim |
| `ERPNEXT_API_KEY` | ⏳ (gerar após deploy via ERPNext) | 🟢 Não |
| `ERPNEXT_API_SECRET` | ⏳ (gerar após deploy via ERPNext) | 🟢 Não |

### Observabilidade

| Secret | Status |
|--------|--------|
| `LANGFUSE_SECRET_KEY` | ✅ |
| `LANGFUSE_NEXT_AUTH_SECRET` | ✅ |
| `LANGFUSE_SALT` | ✅ **OBRIGATÓRIO v3** |
| `LANGFUSE_ENCRYPTION_KEY` | ✅ **OBRIGATÓRIO v3** |
| `SMTP_PASSWORD` (arquivo) | ✅ |
| `LANGFUSE_DB_USER` | ✅ |
| `LANGFUSE_DB_PASSWORD` | ✅ **NÃO use caracteres especiais** (`@:/?#%[]`) - libpq não suporta encoding automático em connection strings. Workflow valida e rejeita (fail-fast) |
| `LANGFUSE_DB_NAME` | ✅ |
| `GRAFANA_ADMIN_USER` | ✅ |
| `GRAFANA_ADMIN_PASSWORD` | ✅ |
| `ACME_EMAIL` | ✅ |

### ClickHouse (Langfuse v3 OLAP Backend)

| Secret | Status |
|--------|--------|
| `CLICKHOUSE_USER` | ✅ **OBRIGATÓRIO Langfuse v3** (adicionado 19/12/2025) |
| `CLICKHOUSE_PASSWORD` | ✅ **OBRIGATÓRIO Langfuse v3** (adicionado 19/12/2025) |

### Web Search (SearXNG)

| Secret | Status |
|--------|--------|
| `SEARXNG_SECRET_KEY` | ✅ |

### Backup (pgBackRest)

| Secret | Status |
|--------|--------|
| `BACKUP_CIPHER_PASS` | ✅ |

### Qdrant (Banco Vetorial Texto 4096 dim)

| Secret | Status |
|--------|--------|
| `QDRANT_API_KEY` | ✅ |

---

## URLs de Callback e Webhook

### OAuth Callbacks

| Provedor | URL de Callback |
|----------|-----------------|
| Google | `https://yesyoudeserve.duckdns.org/api/auth/callback/google` |
| GitHub | `https://yesyoudeserve.duckdns.org/api/auth/callback/github` |

### Webhooks

| Provedor | URL do Webhook |
|----------|----------------|
| Stripe | `https://yesyoudeserve.duckdns.org/webhook/stripe` |
| Twilio WhatsApp | `https://yesyoudeserve.duckdns.org/api/integrations/twilio/webhook/whatsapp` |
| Twilio Status | `https://yesyoudeserve.duckdns.org/api/integrations/twilio/webhook/status` |
| Wise | `https://yesyoudeserve.duckdns.org/api/integrations/wise/webhook` |

---

## Como Adicionar Secrets no GitHub

1. Acesse o repositório → **Settings**
2. Menu lateral → **Secrets and variables** → **Actions**
3. Para **adicionar novo:** Clique **"New repository secret"**
4. Para **atualizar:** Clique no secret → **"Update"**
5. Digite/atualize o valor
6. Clique **"Add secret"** ou **"Update secret"**

---

## Geradores de Senhas Seguras

```bash
# Senha 64 caracteres hexadecimais (RECOMENDADO - URL-safe)
# Use para: REDIS_PASSWORD, REDIS_CACHE_PASSWORD, REDIS_QUEUE_PASSWORD
openssl rand -hex 32

# Senha 128 caracteres hexadecimais (para secrets longos)
openssl rand -hex 64

# Senha base64 (24 caracteres) - para secrets que NÃO são usados em URLs
# NÃO use para senhas Redis! Base64 produz +, /, = que quebram URLs
openssl rand -base64 24
```

**⚠️ Regra de Ouro para Senhas Redis:**
- Sempre use `openssl rand -hex 32` para senhas que serão usadas em URLs
- Hexadecimal (0-9, a-f) é 100% URL-safe
- Base64 (+, /, =) causa `ValueError: Port could not be cast to integer value`

---

## Segurança - Boas Práticas

- ✅ Secrets criptografados em repouso no GitHub
- ✅ Valores mascarados automaticamente nos logs do CI/CD
- ✅ Arquivo `.env.prod` gerado automaticamente e NUNCA commitado
- ✅ Sempre use HTTPS para webhooks
- ✅ Valide assinaturas de webhook (Stripe, Twilio)
- ✅ Rotacione chaves periodicamente
- ✅ Use secrets diferentes para dev e prod

---

## Suporte dos Provedores

| Provedor | Documentação |
|----------|--------------|
| Stripe | https://stripe.com/docs/webhooks |
| Google OAuth | https://developers.google.com/identity/protocols/oauth2 |
| GitHub OAuth | https://docs.github.com/en/developers/apps/building-oauth-apps |
| Twilio | https://www.twilio.com/docs/usage/webhooks |
| Resend | https://resend.com/docs |
| Wise | https://docs.wise.com/ |
| GPU Manager Service | Local (Hetzner GEX44) |

---

*Autor: Fillipe Guerra*  
*Documento atualizado em: 23 de Dezembro de 2025*
*Versão: 7.9 - Verificação Completa SearXNG*
*Total de Secrets: 54 no GitHub + opcionais pós-deploy (ERPNEXT_API_KEY, ERPNEXT_API_SECRET, WISE_WEBHOOK_SECRET)*  
*Total de Containers: 45 (8 infra + 7 Alice + 15 ERPNext + 14 observability + 1 backup)*  
*Backup: Volume Hetzner 100GB local (/opt/alice/backups)*  
*Redis Alice: Container dedicado para cache distribuído (segregação enterprise)*  
*GPU Manager Service (25/12/2025): Todos os serviços GPU migrados para Hetzner GPU GEX44 - GPU Manager Service gerencia requisições localmente*
*Pipeline Unificada (25/12/2025): GPU services integrados em docker-compose.prod.yml - todos os serviços GPU rodam localmente no servidor Hetzner GEX44*  
*ARQUITETURA ENTERPRISE (17/12/2025): Qwen3-Embedding-8B Apache 2.0 (4096 dim → Qdrant) | OpenCLIP MIT (1024 dim → pgvector)*  
*Bug Fixes (17/12/2025): TODOS embeddings texto → Qdrant | KuCoin sync 'active' | documents.embedding corrigido | Risk Config API | orderValue multiplier*  
*Análise de Licenças: Qwen3 é ÚNICO modelo top-tier com licença comercial. Fin-E5/Linq-Embed/NV-Embed são CC BY-NC (Non-Commercial).*  
*LANGFUSE v3: LANGFUSE_SALT e LANGFUSE_ENCRYPTION_KEY obrigatórios + langfuse-worker container*
*Docker Hub (20/12/2025): DOCKERHUB_USERNAME e DOCKERHUB_TOKEN adicionados - evita rate limit 100 pulls/6h anônimo*
