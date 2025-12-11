# Guia Completo de Secrets - Alice Enterprise Platform

**Autor:** Fillipe Guerra
**Data:** 10 de Dezembro de 2025

## Visão Geral

Este documento contém a lista completa de todos os secrets necessários para a plataforma Alice Enterprise, incluindo instruções de configuração para webhooks e OAuth.

**Total de Secrets:** 41 configurados no repositório (38 obrigatórios pré-deploy + 3 opcionais pós-deploy)
**Arquitetura:** Cursor IDE é APENAS editor de código. Produção 100% na Hetzner Cloud.
**Total de Containers:** 41 em produção (5 infraestrutura + 8 Alice + 15 ERPNext + 12 observability + 1 backup)
**Redis Alice:** Container dedicado para cache distribuído (segregação enterprise do ERPNext)
**LLM:** Llama 4 Maverick (400B parâmetros) via Salad Cloud GPUs
**URL de Produção:** `https://yesyoudeserve.duckdns.org`
**URL ERPNext:** `https://erp.yesyoudeserve.duckdns.org`
**IP:** 46.224.46.93

### Serviços que Utilizam Secrets

| Categoria | Serviços | Secrets Relacionados |
|-----------|----------|----------------------|
| **Infraestrutura** | postgres, traefik, alice-redis | POSTGRES_PASSWORD, REDIS_PASSWORD, ACME_EMAIL |
| **Alice Auth** | alice-auth | SESSION_SECRET, GOOGLE_*, OAUTH_GITHUB_* |
| **Alice Chat** | alice-chat | SALAD_API_KEY, SALAD_ORGANIZATION_ID |
| **Alice CLIP** | alice-clip-inference | CLIP_API_TOKEN |
| **Alice Integrations** | alice-integrations | STRIPE_*, WISE_*, TWILIO_*, RESEND_* |
| **Alice Observability** | alice-observability, langfuse, langfuse-db | GRAFANA_*, LANGFUSE_*, LANGFUSE_DB_USER, LANGFUSE_DB_PASSWORD, LANGFUSE_DB_NAME |
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
| `HETZNER_VM_HOST` | `46.224.46.93` | IP do servidor |
| `HETZNER_VM_USER` | `root` | Usuário SSH |
| `HETZNER_SSH_PRIVATE_KEY` | Chave SSH completa | Incluir `-----BEGIN...-----END` |
| `GH_PAT` | Token GitHub | Personal Access Token com write:packages |
| `POSTGRES_PASSWORD` | Senha forte 32+ chars | `openssl rand -hex 32` |
| `REDIS_PASSWORD` | Senha Redis Alice (obrigatório) | `openssl rand -hex 32` |
| `SESSION_SECRET` | String aleatória 64+ chars | `openssl rand -hex 64` |
| `INTERNAL_API_SECRET` | Secret para comunicação S2S | `openssl rand -hex 32` |
| `ADMIN_USER` | Email do administrador global (Alice/ERPNext/Grafana) | Definir seu email corporativo |
| `ADMIN_PWD` | Senha do administrador global (mín. 8 chars) | Definir forte e exclusiva |

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

### FASE 3: Chat com IA (LLM)

| Secret | Onde Obter |
|--------|------------|
| `SALAD_API_KEY` | [portal.salad.com](https://portal.salad.com) → API Keys |
| `SALAD_ORGANIZATION_ID` | portal.salad.com → Settings |
| `CLIP_API_TOKEN` | Token gerado internamente para autenticar requests ao CLIP inference (`openssl rand -hex 32`) |

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
| `CORS_ORIGINS` | Lista separada por vírgula, sem espaços. Ex: `https://yesyoudeserve.duckdns.org,https://admin.yesyoudeserve.duckdns.org` | Usado por chat, integrations, rag, training, observability, clip-service |

> Defina pelo menos um dos dois. Se apenas `CORS_ORIGINS` estiver setado, o workflow derivará `CORS_ORIGIN` a partir do primeiro item.

### FASE 7: ERPNext (CRM/ERP)

**🔴 OBRIGATÓRIOS para Deploy** (deploy FALHA sem eles):

| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `ERPNEXT_MYSQL_ROOT_PASSWORD` | Senha root MariaDB | `node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"` |
| `ERPNEXT_DB_PASSWORD` | Senha usuário ERPNext no DB | `node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"` |
| `ERPNEXT_ADMIN_PASSWORD` | Senha admin do site ERPNext | `node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"` |
| `REDIS_CACHE_PASSWORD` | Senha Redis Cache (ACL) | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `REDIS_QUEUE_PASSWORD` | Senha Redis Queue (ACL) | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

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
| `GRAFANA_ADMIN_USER` | Usuário admin Grafana (usa ADMIN_USER por padrão) | Recomenda-se igual ao ADMIN_USER |
| `GRAFANA_ADMIN_PASSWORD` | Senha admin Grafana (usa ADMIN_PWD por padrão) | Recomenda-se igual ao ADMIN_PWD |
| `SMTP_PASSWORD` (arquivo) | **API Key do Resend** para relay SMTP do Alertmanager | O workflow escreve a `RESEND_API_KEY` em `/opt/alice/secrets/alertmanager/smtp_password` |

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

### Domínio e SSL

| Secret | Descrição |
|--------|-----------|
| `ACME_EMAIL` | Email para certificados Let's Encrypt |

---

## Checklist de Verificação

> **Status atualizado em:** 10 de Dezembro de 2025  
> **Resumo:** Todos os 40 secrets de produção ✅ configurados. `CORS_ORIGINS` adicionado. Pendentes opcionais pós-deploy: `ERPNEXT_API_KEY`, `ERPNEXT_API_SECRET`, `WISE_WEBHOOK_SECRET`.

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

### OAuth (pelo menos 1)

| Secret | Status |
|--------|--------|
| `GOOGLE_CLIENT_ID` | ✅ |
| `GOOGLE_CLIENT_SECRET` | ✅ |
| `OAUTH_GITHUB_CLIENT_ID` | ✅ |
| `OAUTH_GITHUB_CLIENT_SECRET` | ✅ |

### Salad Cloud (LLM)

| Secret | Status |
|--------|--------|
| `SALAD_API_KEY` | ✅ |
| `SALAD_ORGANIZATION_ID` | ✅ |
| `CLIP_API_TOKEN` | ⏳ Pendente (gerar com `openssl rand -hex 32`) |

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
| `SMTP_PASSWORD` (arquivo) | ✅ |
| `LANGFUSE_DB_USER` | ✅ |
| `LANGFUSE_DB_PASSWORD` | ✅ **NÃO use caracteres especiais** (`@:/?#%[]`) - libpq não suporta encoding automático em connection strings. Workflow valida e rejeita (fail-fast) |
| `LANGFUSE_DB_NAME` | ✅ |
| `GRAFANA_ADMIN_PASSWORD` | ✅ |
| `ACME_EMAIL` | ✅ |

### Backup (pgBackRest)

| Secret | Status |
|--------|--------|
| `BACKUP_CIPHER_PASS` | ✅ |

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
# Senha 32 caracteres (hex)
openssl rand -hex 32

# Senha 24 caracteres (base64)
openssl rand -base64 24

# Senha 64 caracteres (hex)
openssl rand -hex 64
```

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
| Salad Cloud | https://docs.salad.com/ |

---

*Autor: Fillipe Guerra*  
*Documento atualizado em: 10 de Dezembro de 2025*  
*Versão: 6.5*  
*Total de Secrets: 40 configurados (37 obrigatórios + 3 opcionais pós-deploy)*  
*Total de Containers: 41 (5 infraestrutura + 8 Alice + 15 ERPNext + 12 observability + 1 backup)*  
*Backup: Volume Hetzner 100GB local (/opt/alice/backups)*  
*Redis Alice: Container dedicado para cache distribuído (segregação enterprise)*  
*CORS_ORIGINS: Adicionado em 10/12/2025 para permitir requisições do frontend*
