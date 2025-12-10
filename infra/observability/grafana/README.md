# Grafana SSO com Alice IdP

**Autor:** Fillipe Guerra  
**Data:** 09 de Dezembro de 2025

## Visão Geral

O Grafana OSS 11.1.4 está configurado para usar **Alice Enterprise Platform** como Identity Provider (IdP) único via OAuth 2.0/OIDC.

## Arquitetura

```
┌─────────────────┐       OAuth 2.0        ┌─────────────────┐
│                 │ ◄────────────────────► │                 │
│   Grafana OSS   │   Authorization Code   │   Alice IdP     │
│     11.1.4      │         + PKCE         │  (auth-service) │
│                 │                        │                 │
└─────────────────┘                        └─────────────────┘
         │                                          │
         │                                          │
         ▼                                          ▼
    Role Mapping                              PostgreSQL
    - super_admin → Admin                     (oauth_clients)
    - admin → Admin
    - manager → Editor
    - viewer/guest → Viewer
```

## Configuração

### 1. Variáveis de Ambiente Obrigatórias

```bash
# Segurança
GF_SECURITY_ADMIN_PASSWORD=<senha-forte>
GF_SECURITY_SECRET_KEY=<secret-32-chars-min>

# OAuth Alice
GF_AUTH_GENERIC_OAUTH_CLIENT_ID=grafana-sso
GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET=5eAD6BBTuxplWz2bVmZcHW3tO0TSotR3_3da9gS6sHw

# Alice IdP
ALICE_OIDC_ISSUER=https://yesyoudeserve.duckdns.org

# Database
GF_DATABASE_HOST=postgres:5432
GF_DATABASE_NAME=grafana
GF_DATABASE_USER=grafana
GF_DATABASE_PASSWORD=<senha-db>
```

### 2. Cliente OAuth (já registrado no banco)

```sql
SELECT client_id, redirect_uris, scopes FROM oauth_clients WHERE client_id = 'grafana-sso';
```

Resultado esperado:
- **client_id**: `grafana-sso`
- **redirect_uris**: `https://grafana.yesyoudeserve.duckdns.org/login/generic_oauth`
- **scopes**: `openid, profile, email, groups, roles`

### 3. Role Mapping

| Alice Role   | Grafana Role | Permissões                        |
|--------------|--------------|-----------------------------------|
| super_admin  | Admin        | Controle total + gerenciamento    |
| admin        | Admin        | Controle total                    |
| manager      | Editor       | Criar/editar dashboards e alertas |
| operator     | Viewer       | Visualizar dashboards e alertas   |
| viewer       | Viewer       | Apenas visualização               |
| guest        | Viewer       | Apenas visualização (limitada)    |

### 4. Deploy

```bash
cd infra/observability/grafana
docker-compose -f docker-compose.grafana.yml up -d
```

## Fluxo de Autenticação

1. Usuário acessa `https://grafana.yesyoudeserve.duckdns.org`
2. Clica em "Sign in with Alice Enterprise"
3. Redirecionado para Alice IdP (`/oauth/authorize`)
4. Autentica via:
   - Credenciais locais
   - Google OAuth
   - GitHub OAuth
   - SAML 2.0 (Azure AD/Okta)
5. Após autenticação, callback para Grafana (`/login/generic_oauth`)
6. Grafana recebe tokens e extrai claims
7. Role é mapeada conforme tabela acima
8. Sessão criada no Grafana

## Identity Provisioning

O sistema **Identity Provisioning** (Outbox Pattern) sincroniza automaticamente:

- **Criação de usuário**: Quando usuário é criado no Alice, é provisionado no Grafana
- **Atualização de role**: Quando role muda no Alice, atualiza no Grafana
- **Deleção de usuário**: Quando usuário é removido do Alice, é desativado no Grafana

## Troubleshooting

### Erro: "OIDC token validation failed"
- Verificar se `ALICE_OIDC_ISSUER` está correto
- Verificar se o issuer no token JWT corresponde ao configurado

### Erro: "Invalid redirect_uri"
- Verificar se o redirect_uri no banco corresponde ao configurado no Grafana
- Deve ser: `https://grafana.yesyoudeserve.duckdns.org/login/generic_oauth`

### Erro: "Role not assigned"
- Verificar se o claim `role` está presente no token
- Verificar JMESPath no `role_attribute_path`

### Logs
```bash
docker logs alice-grafana -f --tail 100
```

## Referências

- [Grafana OAuth Documentation](https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/configure-authentication/generic-oauth/)
- [OIDC Specification](https://openid.net/specs/openid-connect-core-1_0.html)
- [Alice OIDC Provider](../../apps/auth-service/src/oidc/)

---

*Autor: Fillipe Guerra*  
*Documentação em Português Brasileiro*  
*Atualizado: 09 de Dezembro de 2025*  
*Total de Containers: 41 (5 infraestrutura + 8 Alice + 15 ERPNext + 12 observability + 1 backup)*
