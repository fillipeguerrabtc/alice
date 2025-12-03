# Guia Completo de Secrets - Alice Enterprise Platform

**Autor:** Fillipe Guerra

## Visão Geral

Este documento contém a lista completa de todos os secrets necessários para a plataforma Alice Enterprise, incluindo instruções de configuração para webhooks e OAuth.

**Arquitetura:** Cursor IDE é APENAS editor de código. Produção 100% na Hetzner Cloud.
**Total de Containers:** 26 em produção (4 infraestrutura + 8 Alice + 12 ERPNext + 2 backup/logs)
**LLM:** Llama 4 Maverick (400B parâmetros) via Salad Cloud GPUs
**URL de Produção:** `https://yesyoudeserve.duckdns.org`
**URL ERPNext:** `https://erp.yesyoudeserve.duckdns.org`
**IP:** 46.224.46.93

### Serviços que Utilizam Secrets

| Categoria | Serviços | Secrets Relacionados |
|-----------|----------|----------------------|
| **Infraestrutura** | postgres, traefik | POSTGRES_PASSWORD, ACME_EMAIL |
| **Alice Auth** | alice-auth | SESSION_SECRET, GOOGLE_*, OAUTH_GITHUB_* |
| **Alice Chat** | alice-chat | SALAD_API_KEY, SALAD_ORGANIZATION_ID |
| **Alice Integrations** | alice-integrations | STRIPE_*, WISE_*, TWILIO_*, RESEND_* |
| **Alice Observability** | alice-observability | GRAFANA_*, LANGFUSE_* |
| **ERPNext** | erpnext-* | ERPNEXT_* |
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
| `SESSION_SECRET` | String aleatória 64+ chars | `openssl rand -hex 64` |

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

### FASE 4: Pagamentos Stripe (receber EUR/SEPA)

| Secret | Onde Obter |
|--------|------------|
| `STRIPE_SECRET_KEY` | [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) |
| `STRIPE_PUBLISHABLE_KEY` | dashboard.stripe.com/apikeys |
| `STRIPE_WEBHOOK_SECRET` | dashboard.stripe.com/webhooks |

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
| `WISE_WEBHOOK_SECRET` | wise.com/settings → Webhooks (opcional) |

**Configuração:**
1. Wise Business → Settings → API Tokens → Add new token
2. Permissões: `Read balances`, `Read transfers`, `Create transfers`
3. Profile ID está na URL quando você acessa sua conta

**Nota:** Defina `WISE_SANDBOX=true` para usar API de testes.

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

**Resend:**

| Secret | Onde Obter |
|--------|------------|
| `RESEND_API_KEY` | [resend.com/api-keys](https://resend.com/api-keys) |

### FASE 7: ERPNext (CRM/ERP)

| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `ERPNEXT_MYSQL_ROOT_PASSWORD` | Senha root MariaDB | `openssl rand -base64 24` |
| `ERPNEXT_DB_PASSWORD` | Senha usuário ERPNext | `openssl rand -base64 24` |
| `ERPNEXT_API_KEY` | API Key ERPNext | Após setup: ERPNext → User → API Access |
| `ERPNEXT_API_SECRET` | API Secret ERPNext | Gerado junto com API Key |

**Nota:** API Keys do ERPNext são geradas após o primeiro deploy.

### FASE 8: Observabilidade (Métricas LLM)

| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `LANGFUSE_SECRET_KEY` | Chave secreta Langfuse | `openssl rand -hex 32` com prefixo `sk-lf-` |
| `LANGFUSE_NEXT_AUTH_SECRET` | Chave de autenticação | `openssl rand -hex 32` |
| `GRAFANA_ADMIN_PASSWORD` | Senha admin Grafana | Senha segura de sua escolha |

**Observação:** Langfuse usa PostgreSQL dedicado na porta 5433 (separado do banco principal).

### Domínio e SSL

| Secret | Descrição |
|--------|-----------|
| `ACME_EMAIL` | Email para certificados Let's Encrypt |

---

## Checklist de Verificação

### Infraestrutura

| Secret | Status |
|--------|--------|
| `HETZNER_VM_HOST` | ⬜ |
| `HETZNER_VM_USER` | ⬜ |
| `HETZNER_SSH_PRIVATE_KEY` | ⬜ |
| `GH_PAT` | ⬜ |
| `POSTGRES_PASSWORD` | ⬜ |
| `SESSION_SECRET` | ⬜ |

### OAuth (pelo menos 1)

| Secret | Status |
|--------|--------|
| `GOOGLE_CLIENT_ID` | ⬜ |
| `GOOGLE_CLIENT_SECRET` | ⬜ |
| `OAUTH_GITHUB_CLIENT_ID` | ⬜ |
| `OAUTH_GITHUB_CLIENT_SECRET` | ⬜ |

### Salad Cloud (LLM)

| Secret | Status |
|--------|--------|
| `SALAD_API_KEY` | ⬜ |
| `SALAD_ORGANIZATION_ID` | ⬜ |

### Stripe (Pagamentos)

| Secret | Status |
|--------|--------|
| `STRIPE_SECRET_KEY` | ⬜ |
| `STRIPE_PUBLISHABLE_KEY` | ⬜ |
| `STRIPE_WEBHOOK_SECRET` | ⬜ |

### Wise (Transferências)

| Secret | Status |
|--------|--------|
| `WISE_API_KEY` | ⬜ |
| `WISE_PROFILE_ID` | ⬜ |
| `WISE_WEBHOOK_SECRET` | ⬜ (opcional) |

### Comunicação

| Secret | Status |
|--------|--------|
| `TWILIO_ACCOUNT_SID` | ⬜ |
| `TWILIO_AUTH_TOKEN` | ⬜ |
| `TWILIO_WHATSAPP_NUMBER` | ⬜ |
| `RESEND_API_KEY` | ⬜ |

### ERPNext

| Secret | Status |
|--------|--------|
| `ERPNEXT_MYSQL_ROOT_PASSWORD` | ⬜ |
| `ERPNEXT_DB_PASSWORD` | ⬜ |
| `ERPNEXT_API_KEY` | ⬜ (após deploy) |
| `ERPNEXT_API_SECRET` | ⬜ (após deploy) |

### Observabilidade

| Secret | Status |
|--------|--------|
| `LANGFUSE_SECRET_KEY` | ⬜ |
| `LANGFUSE_NEXT_AUTH_SECRET` | ⬜ |
| `GRAFANA_ADMIN_PASSWORD` | ⬜ |
| `ACME_EMAIL` | ⬜ |

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
*Documento atualizado em: Dezembro 2025*
*Versão: 5.3 - Consolidado com 26 Containers Enterprise*
*Total de Containers: 26 (4 infraestrutura + 8 Alice + 12 ERPNext + 2 backup/logs)*
