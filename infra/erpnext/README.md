# ERPNext SSO com Alice IdP

**Autor:** Fillipe Guerra  
**Data:** 09 de Dezembro de 2025

## Visão Geral

O ERPNext v15 está configurado para usar **Alice Enterprise Platform** como Identity Provider (IdP) único via OAuth 2.0/OIDC usando Social Login Keys.

## Arquitetura

```
┌─────────────────┐       OAuth 2.0        ┌─────────────────┐
│                 │ ◄────────────────────► │                 │
│    ERPNext      │   Authorization Code   │   Alice IdP     │
│    v15.88.0     │                        │  (auth-service) │
│                 │                        │                 │
└─────────────────┘                        └─────────────────┘
         │                                          │
         │                                          │
         ▼                                          ▼
    Role Mapping                              PostgreSQL
    - super_admin → System Manager           (oauth_clients)
    - admin → System Manager
    - manager → Accounts/Sales Manager
    - operator → Accounts/Sales User
    - viewer/guest → Guest
```

## Componentes

O stack ERPNext inclui:

| Container             | Imagem                       | Função                    |
|-----------------------|------------------------------|---------------------------|
| erpnext-db            | mariadb:10.11                | Banco de dados            |
| erpnext-redis         | redis:7-alpine               | Cache e filas             |
| erpnext-backend       | frappe/erpnext:v15.88.0      | Backend Python            |
| erpnext-frontend      | frappe/frappe-nginx:v15.88.0 | Servidor web              |
| erpnext-socketio      | frappe/frappe-socketio:v15.88.0| Real-time               |
| erpnext-scheduler     | frappe/erpnext:v15.88.0      | Jobs agendados            |
| erpnext-worker-*      | frappe/erpnext:v15.88.0      | Workers de background     |

**SEGURANÇA:** v15.88.0 corrige CVE-2025-55732 e CVE-2025-55731 (SQL Injection críticos).
Ver `docs/FRAPPE-PATCHING.md` para detalhes.

## Configuração

### 1. Variáveis de Ambiente Obrigatórias

```bash
# Database
ERPNEXT_DB_ROOT_PASSWORD=<senha-root-mariadb>
ERPNEXT_DB_PASSWORD=<senha-erpnext-mariadb>

# Admin
ERPNEXT_ADMIN_PASSWORD=<senha-admin>
ERPNEXT_SITE_NAME=erp.yesyoudeserve.duckdns.org

# OAuth Alice
ALICE_OAUTH_CLIENT_ID=erpnext-sso
ALICE_OAUTH_CLIENT_SECRET=CS8-Ru3CGECYdmYaExuv0CI0sVI01uHgRHNkuxzIcN8

# Alice IdP
ALICE_OIDC_ISSUER=https://yesyoudeserve.duckdns.org
```

### 2. Cliente OAuth (já registrado no banco)

```sql
SELECT client_id, redirect_uris, scopes FROM oauth_clients WHERE client_id = 'erpnext-sso';
```

Resultado esperado:
- **client_id**: `erpnext-sso`
- **redirect_uris**: `https://erp.yesyoudeserve.duckdns.org/api/method/frappe.integrations.oauth2_logins.login_via_oauth2`
- **scopes**: `openid, profile, email, groups, roles`

### 3. Role Mapping

| Alice Role   | ERPNext Roles                                    | Permissões                        |
|--------------|--------------------------------------------------|-----------------------------------|
| super_admin  | System Manager, Administrator                    | Controle total do sistema         |
| admin        | System Manager                                   | Gerenciamento do sistema          |
| manager      | Accounts Manager, Sales Manager, Purchase Manager| Gerenciamento de módulos          |
| operator     | Accounts User, Sales User, Purchase User         | Operações diárias                 |
| viewer       | Guest                                            | Apenas visualização               |
| guest        | Guest                                            | Acesso limitado                   |

### 4. Deploy

```bash
# 1. Criar a rede (se não existir)
docker network create alice-network

# 2. Iniciar o stack
cd infra/erpnext
docker-compose -f docker-compose.erpnext.yml up -d

# 3. Aguardar inicialização (primeira vez pode demorar)
docker logs -f alice-erpnext-backend

# 4. Configurar o Social Login Key
docker exec -it alice-erpnext-backend bash
cd frappe-bench
bench --site erp.yesyoudeserve.duckdns.org execute ../setup-sso.py
```

## Fluxo de Autenticação

1. Usuário acessa `https://erp.yesyoudeserve.duckdns.org`
2. Clica em "Login with Alice Enterprise"
3. Redirecionado para Alice IdP (`/oauth/authorize`)
4. Autentica via:
   - Credenciais locais
   - Google OAuth
   - GitHub OAuth
   - SAML 2.0 (Azure AD/Okta)
5. Após autenticação, callback para ERPNext
6. ERPNext recebe tokens e extrai claims
7. Role é mapeada conforme tabela acima
8. Sessão criada no ERPNext

## Identity Provisioning

O sistema **Identity Provisioning** (Outbox Pattern) sincroniza automaticamente:

- **Criação de usuário**: Quando usuário é criado no Alice, é provisionado no ERPNext
- **Atualização de role**: Quando role muda no Alice, atualiza roles no ERPNext
- **Deleção de usuário**: Quando usuário é removido do Alice, é desativado no ERPNext

### Verificar mapeamentos

```sql
-- No PostgreSQL (Alice)
SELECT * FROM external_user_mappings WHERE external_system = 'erpnext';

-- No MariaDB (ERPNext)
SELECT name, email, enabled FROM tabUser WHERE owner = 'Administrator';
```

## Troubleshooting

### Erro: "Invalid OAuth Client"
- Verificar se `ALICE_OAUTH_CLIENT_ID` está correto
- Verificar se o cliente existe no banco `oauth_clients`

### Erro: "Invalid redirect_uri"
- Verificar se o redirect_uri no banco corresponde ao configurado
- Deve ser: `https://erp.yesyoudeserve.duckdns.org/api/method/frappe.integrations.oauth2_logins.login_via_oauth2`

### Erro: "User not created"
- Verificar se `sign_ups` está habilitado no Social Login Key
- Verificar logs: `docker logs alice-erpnext-backend`

### Erro: "Role not assigned"
- Verificar se o Identity Provisioning está funcionando
- Verificar tabela `identity_provisioning_events` no PostgreSQL

### Logs
```bash
# Backend
docker logs alice-erpnext-backend -f --tail 100

# Worker
docker logs alice-erpnext-worker-default -f --tail 100

# Scheduler
docker logs alice-erpnext-scheduler -f --tail 100
```

## Integrações Futuras

O ERPNext será integrado com:

1. **Stripe** - Sincronização de pagamentos
2. **Wise** - Sincronização de transferências
3. **Twilio** - Notificações WhatsApp/SMS
4. **Resend** - Emails transacionais

## Referências

- [ERPNext Documentation](https://docs.erpnext.com/)
- [Frappe OAuth Integration](https://frappeframework.com/docs/user/en/guides/integration/oauth)
- [Social Login Keys](https://docs.erpnext.com/docs/user/manual/en/setting-up/users-and-permissions/social-login-keys)
- [Alice OIDC Provider](../../apps/auth-service/src/oidc/)

---

*Autor: Fillipe Guerra*  
*Documentação em Português Brasileiro*  
*Atualizado: 09 de Dezembro de 2025*  
*Total de Containers: 40 (5 infraestrutura + 8 Alice + 15 ERPNext + 11 observability + 1 backup)*
