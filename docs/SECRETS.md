# Guia Completo de Secrets e Webhooks - Alice Enterprise Platform

## Visão Geral

Este documento contém:
1. **Todos os secrets necessários** para a plataforma Alice Enterprise
2. **Guia completo para reconfigurar webhooks e OAuth** para a nova URL Hetzner

**Arquitetura:** Replit é APENAS editor de código. Produção 100% na Hetzner Cloud.
**LLM:** Llama 4 Maverick (400B parâmetros) via Salad Cloud GPUs
**URL de Produção:** `https://yesyoudeserve.duckdns.org`
**URL ERPNext:** `https://erp.yesyoudeserve.duckdns.org`
**IP:** 46.224.46.93

---

## ⚠️ IMPORTANTE: O que precisa ser reconfigurado

| Item | Onde Alterar | O que Muda |
|------|--------------|------------|
| **Secrets GitHub** | GitHub Actions | ❌ NÃO precisa alterar |
| **URLs de Webhook** | Dashboard do provedor | ✅ PRECISA alterar |
| **URLs de Callback OAuth** | Dashboard do provedor | ✅ PRECISA alterar |

**Resumo:** Os secrets (API keys, tokens) permanecem os mesmos. Apenas as URLs precisam apontar para a nova URL Hetzner.

---

## 🔄 GUIA DE RECONFIGURAÇÃO DE WEBHOOKS E OAUTH

### 1. STRIPE PORTUGAL

**Dashboard:** https://dashboard.stripe.com

#### 1.1 Reconfigurar Webhooks

1. Acesse **Stripe Dashboard** → **Developers** → **Webhooks**
2. Clique no webhook existente (que aponta para Replit)
3. Clique **"..."** → **"Update details"**
4. Altere a **Endpoint URL** de:
   ```
   https://SEU-REPLIT-ANTIGO.replit.dev/webhook/stripe
   ```
   Para:
   ```
   https://yesyoudeserve.duckdns.org/webhook/stripe
   ```
5. Clique **"Update endpoint"**

**OU** crie um novo webhook:
1. **Webhooks** → **Add endpoint**
2. **Endpoint URL:** `https://yesyoudeserve.duckdns.org/webhook/stripe`
3. **Events to send:** Selecione:
   - `customer.created`
   - `customer.updated`
   - `customer.deleted`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `checkout.session.completed`
   - `subscription.created`
   - `subscription.updated`
   - `subscription.deleted`
4. Clique **"Add endpoint"**
5. **IMPORTANTE:** Copie o novo **Signing Secret** (começa com `whsec_`)
6. Atualize no GitHub Actions: `STRIPE_WEBHOOK_SECRET`

#### 1.2 Verificar API Keys

As API Keys (`STRIPE_SECRET_KEY` e `STRIPE_PUBLISHABLE_KEY`) **NÃO mudam**.

---

### 2. GOOGLE OAUTH

**Console:** https://console.cloud.google.com/apis/credentials

#### 2.1 Atualizar Redirect URIs

1. Acesse **Google Cloud Console** → **APIs & Services** → **Credentials**
2. Clique no seu **OAuth 2.0 Client ID** (Web application)
3. Na seção **"Authorized redirect URIs"**:
   - **Remova:** `https://SEU-REPLIT-ANTIGO.replit.dev/api/auth/callback/google`
   - **Adicione:** `https://yesyoudeserve.duckdns.org/api/auth/callback/google`
4. Na seção **"Authorized JavaScript origins"**:
   - **Remova:** `https://SEU-REPLIT-ANTIGO.replit.dev`
   - **Adicione:** `https://yesyoudeserve.duckdns.org`
5. Clique **"Save"**

**Secrets no GitHub:** `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` **NÃO mudam**.

---

### 3. GITHUB OAUTH

**Settings:** https://github.com/settings/developers

#### 3.1 Atualizar OAuth App

1. Acesse **GitHub** → **Settings** → **Developer settings** → **OAuth Apps**
2. Clique na sua aplicação "Alice Enterprise"
3. Atualize os campos:
   - **Homepage URL:** `https://yesyoudeserve.duckdns.org`
   - **Authorization callback URL:** `https://yesyoudeserve.duckdns.org/api/auth/callback/github`
4. Clique **"Update application"**

**Secrets no GitHub:** `OAUTH_GITHUB_CLIENT_ID` e `OAUTH_GITHUB_CLIENT_SECRET` **NÃO mudam**.

---

### 4. MICROSOFT/AZURE AD OAUTH

**Portal:** https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps

#### 4.1 Atualizar Redirect URIs

1. Acesse **Azure Portal** → **App registrations** → Sua aplicação
2. Vá em **Authentication** → **Platform configurations** → **Web**
3. Na seção **"Redirect URIs"**:
   - **Remova:** `https://SEU-REPLIT-ANTIGO.replit.dev/api/auth/callback/microsoft`
   - **Adicione:** `https://yesyoudeserve.duckdns.org/api/auth/callback/microsoft`
4. Clique **"Save"**

**Secrets no GitHub:** `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` **NÃO mudam**.

---

### 5. TWILIO (WHATSAPP/SMS)

**Console:** https://console.twilio.com

#### 5.1 Atualizar Webhook do WhatsApp Sandbox

1. Acesse **Twilio Console** → **Messaging** → **Try it out** → **Send a WhatsApp message**
2. Ou: **Messaging** → **Settings** → **WhatsApp sandbox settings**
3. Atualize os campos:
   - **When a message comes in:** 
     ```
     https://yesyoudeserve.duckdns.org/webhook/twilio/whatsapp
     ```
   - **Status callback URL:**
     ```
     https://yesyoudeserve.duckdns.org/webhook/twilio/status
     ```
4. Clique **"Save"**

#### 5.2 Para Número de Produção (se tiver)

1. **Phone Numbers** → **Manage** → **Active numbers**
2. Clique no seu número WhatsApp
3. Atualize:
   - **A MESSAGE COMES IN:** `https://yesyoudeserve.duckdns.org/webhook/twilio/whatsapp`
   - **STATUS CALLBACK URL:** `https://yesyoudeserve.duckdns.org/webhook/twilio/status`
4. Clique **"Save"**

**Secrets no GitHub:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER` **NÃO mudam**.

---

### 6. RESEND (EMAIL)

**Dashboard:** https://resend.com/domains

#### 6.1 Verificar Domínio (Opcional)

Se você quer enviar emails de `@yesyoudeserve.duckdns.org`:

1. Acesse **Resend** → **Domains** → **Add Domain**
2. Adicione: `yesyoudeserve.duckdns.org`
3. Configure os registros DNS no DuckDNS (se suportado) ou use o domínio padrão Resend

**Nota:** Geralmente Resend funciona sem webhook. A API Key é suficiente.

**Secret no GitHub:** `RESEND_API_KEY` **NÃO muda**.

---

### 7. SALAD CLOUD (LLM)

**Dashboard:** https://portal.salad.com

Salad Cloud usa apenas API Key para autenticação. **Não há webhooks para configurar.**

**Secrets no GitHub:** `SALAD_API_KEY` e `SALAD_ORGANIZATION_ID` **NÃO mudam**.

---

### 8. DUCKDNS

**Site:** https://www.duckdns.org

#### 8.1 Verificar IP do Domínio

1. Acesse **DuckDNS** e faça login
2. Verifique se o domínio `yesyoudeserve` aponta para: `46.224.46.93`
3. Se não, atualize o IP manualmente ou configure atualização automática

**Não há secrets para configurar no GitHub para DuckDNS.**

---

## 📋 CHECKLIST DE RECONFIGURAÇÃO

Use este checklist para garantir que tudo foi reconfigurado:

### URLs de Webhook

| Provedor | URL Nova | Status |
|----------|----------|--------|
| Stripe Webhook | `https://yesyoudeserve.duckdns.org/webhook/stripe` | ⬜ |
| Twilio WhatsApp | `https://yesyoudeserve.duckdns.org/webhook/twilio/whatsapp` | ⬜ |
| Twilio Status | `https://yesyoudeserve.duckdns.org/webhook/twilio/status` | ⬜ |

### URLs de OAuth Callback

| Provedor | URL Nova | Status |
|----------|----------|--------|
| Google | `https://yesyoudeserve.duckdns.org/api/auth/callback/google` | ⬜ |
| GitHub | `https://yesyoudeserve.duckdns.org/api/auth/callback/github` | ⬜ |
| Microsoft | `https://yesyoudeserve.duckdns.org/api/auth/callback/microsoft` | ⬜ |

### Secrets no GitHub (Não Alterar)

| Secret | Descrição | Status |
|--------|-----------|--------|
| `HETZNER_API_TOKEN` | Token API Hetzner | ✅ OK |
| `HETZNER_VM_HOST` | IP: 46.224.46.93 | ✅ OK |
| `HETZNER_VM_USER` | Usuário: root | ✅ OK |
| `HETZNER_SSH_PRIVATE_KEY` | Chave SSH privada | ✅ OK |
| `SESSION_SECRET` | Chave sessões Express | ✅ OK |
| `POSTGRES_PASSWORD` | Senha PostgreSQL | ✅ OK |
| `STRIPE_SECRET_KEY` | API Key Stripe | ✅ OK |
| `STRIPE_PUBLISHABLE_KEY` | Chave pública Stripe | ✅ OK |
| `STRIPE_WEBHOOK_SECRET` | ⚠️ **ATUALIZAR SE CRIAR NOVO WEBHOOK** | ⚠️ Verificar |
| `GOOGLE_CLIENT_ID` | OAuth Google | ✅ OK |
| `GOOGLE_CLIENT_SECRET` | OAuth Google | ✅ OK |
| `OAUTH_GITHUB_CLIENT_ID` | OAuth GitHub | ✅ OK |
| `OAUTH_GITHUB_CLIENT_SECRET` | OAuth GitHub | ✅ OK |
| `SALAD_API_KEY` | API Salad Cloud | ✅ OK |
| `SALAD_ORGANIZATION_ID` | Org ID Salad | ✅ OK |
| `TWILIO_ACCOUNT_SID` | Twilio | ✅ OK |
| `TWILIO_AUTH_TOKEN` | Twilio | ✅ OK |
| `TWILIO_WHATSAPP_NUMBER` | Número WhatsApp | ✅ OK |
| `RESEND_API_KEY` | API Resend | ✅ OK |

---

## 🆕 SECRETS ADICIONAIS PARA ERPNEXT

Após o primeiro deploy, você precisará adicionar estes secrets:

| Secret | Descrição | Como Obter |
|--------|-----------|------------|
| `ERPNEXT_MYSQL_ROOT_PASSWORD` | Senha root MariaDB | Gerar: `openssl rand -base64 24` |
| `ERPNEXT_DB_PASSWORD` | Senha usuário ERPNext | Gerar: `openssl rand -base64 24` |
| `ERPNEXT_API_KEY` | API Key ERPNext | Após setup: ERPNext → User → API Access |
| `ERPNEXT_API_SECRET` | API Secret ERPNext | Gerado junto com API Key |

---

## 🔐 COMO ADICIONAR/ATUALIZAR SECRETS NO GITHUB

1. Vá para o repositório → **Settings**
2. Menu lateral → **Secrets and variables** → **Actions**
3. Para **adicionar novo:** Clique **"New repository secret"**
4. Para **atualizar:** Clique no secret → **"Update"**
5. Digite/atualize o valor
6. Clique **"Add secret"** ou **"Update secret"**

---

## ⚠️ IMPORTANTE: STRIPE_WEBHOOK_SECRET

Se você **criar um novo endpoint** no Stripe (em vez de editar o existente), você receberá um **novo Signing Secret**.

**Neste caso, você DEVE atualizar no GitHub:**

1. Stripe Dashboard → Webhooks → Seu endpoint → "Signing secret" → "Reveal"
2. Copie o novo valor (começa com `whsec_...`)
3. Atualize no GitHub: `STRIPE_WEBHOOK_SECRET`

---

## 🛡️ SEGURANÇA - BOAS PRÁTICAS

- ✅ Secrets criptografados em repouso no GitHub
- ✅ Valores mascarados automaticamente nos logs do CI/CD
- ✅ Arquivo `.env.prod` gerado automaticamente e NUNCA commitado
- ✅ Sempre use HTTPS para webhooks
- ✅ Valide assinaturas de webhook (Stripe, Twilio)

### Gerador de Senhas Seguras

```bash
# Gerar SESSION_SECRET (32+ caracteres)
openssl rand -base64 32

# Gerar senha PostgreSQL
openssl rand -base64 24

# Gerar senha ERPNext MariaDB
openssl rand -base64 24
```

---

## 📞 SUPORTE DOS PROVEDORES

| Provedor | Documentação |
|----------|--------------|
| Stripe | https://stripe.com/docs/webhooks |
| Google OAuth | https://developers.google.com/identity/protocols/oauth2 |
| GitHub OAuth | https://docs.github.com/en/developers/apps/building-oauth-apps |
| Microsoft OAuth | https://docs.microsoft.com/en-us/azure/active-directory/develop/v2-oauth2-auth-code-flow |
| Twilio | https://www.twilio.com/docs/usage/webhooks |
| Resend | https://resend.com/docs |

---

*Documento atualizado em: Novembro 2025*
*Versão: 3.0 - Arquitetura PROD-only Hetzner Cloud*
