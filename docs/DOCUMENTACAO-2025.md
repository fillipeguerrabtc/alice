# Documentação Oficial 2025 - Stack Alice Enterprise + ERPNext

## Sumário

1. [Stack Alice (7 Microsserviços Node.js)](#stack-alice-7-microsserviços-nodejs)
2. [Stack ERPNext Completo](#stack-erpnext-completo)
3. [Infraestrutura e Segurança](#infraestrutura-e-segurança)
4. [CVEs Críticos Frappe Framework](#cves-críticos-frappe-framework)
5. [Referências Oficiais](#referências-oficiais)

---

## Stack Alice (7 Microsserviços Node.js)

### Express.js 2025 Security Baseline

| Configuração | Requisito | Descrição |
|--------------|-----------|-----------|
| `app.set('trust proxy', true)` | OBRIGATÓRIO | Necessário para rate limiting funcionar atrás de load balancer/proxy |
| `app.disable('x-powered-by')` | OBRIGATÓRIO | Ocultar versão do Express |
| `express.json({ limit: '10mb' })` | OBRIGATÓRIO | Prevenir DoS via payload grande |
| `express.urlencoded({ limit: '10mb', extended: true })` | OBRIGATÓRIO | Limitar body urlencoded |
| Helmet middleware | OBRIGATÓRIO | Headers de segurança automáticos |
| Compression middleware | RECOMENDADO | Compressão gzip para respostas |
| Request timeout | OBRIGATÓRIO | Prevenir conexões pendentes |
| TLS 1.2+ | OBRIGATÓRIO | Comunicação criptografada |

### OWASP API Security Top 10 (2023)

| Código | Nome | Mitigação |
|--------|------|-----------|
| API1 | Broken Object Level Authorization (BOLA) | Verificar tenant_id em TODAS as queries |
| API2 | Broken Authentication | JWT com expiração curta, refresh tokens |
| API3 | Broken Object Property Level Authorization | Validar campos permitidos por role |
| API4 | Unrestricted Resource Consumption | Rate limiting, payload limits |
| API5 | Broken Function Level Authorization (BFLA) | RBAC granular por endpoint |
| API6 | Unrestricted Access to Sensitive Business Flows | Throttling em operações críticas |
| API7 | Server Side Request Forgery (SSRF) | Validar URLs, allowlist de destinos |
| API8 | Security Misconfiguration | Trust proxy, headers, disable debug |
| API9 | Improper Inventory Management | Documentar TODAS as APIs |
| API10 | Unsafe Consumption of APIs | Validar respostas de terceiros |

### Node.js 20 LTS Security Patches

| CVE | Tipo | Descrição | Mitigação |
|-----|------|-----------|-----------|
| CVE-2025-27210 | Path Traversal | Escape de diretório | Atualizar Node.js, validar paths |
| CVE-2025-23165 | HTTP Parser | Parsing malicioso | Atualizar Node.js |
| CVE-2025-23083 | Worker Permission Bypass | Bypass de permissões | Atualizar Node.js |

### WebSocket (ws v8.18.3) Security

| Configuração | Valor | Descrição |
|--------------|-------|-----------|
| Protocolo | WSS (TLS) | NUNCA usar ws:// em produção |
| Origin Validation | Allowlist específica | Prevenir Cross-Site WebSocket Hijacking |
| maxPayload | 10MB | Prevenir DoS via mensagens grandes |
| Heartbeat (ping/pong) | 30 segundos | Detectar conexões mortas |
| Rate Limiting | 30 msg/10s por conexão | Prevenir flood |
| JWT Authentication | Token no handshake | Autenticação obrigatória |
| Message Validation | Schema validation | Prevenir injection |

**CVE Corrigida:**
- CVE-2024-37890 (DoS via headers) - Corrigida em ws@8.17.1+

### PostgreSQL 17 Hardening

| Configuração | Requisito | Descrição |
|--------------|-----------|-----------|
| Row Level Security (RLS) | OBRIGATÓRIO | Isolamento multi-tenant |
| SCRAM-SHA-256 | OBRIGATÓRIO | Substituir MD5 |
| SSL/TLS | sslmode=verify-full | Conexão criptografada |
| pgAudit | RECOMENDADO | Audit logging |
| Índices tenant_id | OBRIGATÓRIO | Performance em queries multi-tenant |

**RLS Policy Template:**
```sql
ALTER TABLE tabela ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tabela
    USING (tenant_id = current_setting('app.current_tenant')::uuid);
```

---

## Stack ERPNext Completo

### ERPNext v15 - Módulos

| Módulo | Descrição | Status |
|--------|-----------|--------|
| Accounting | Contabilidade, razão, balanço | Core |
| Sales/Selling | Vendas, cotações, pedidos | Core |
| CRM | Leads, oportunidades, campanhas | Core |
| Stock/Inventory | Estoque, armazéns, batch/serial | Core |
| Buying/Procurement | Compras, fornecedores, RFQ | Core |
| Manufacturing | BOM, work orders, job cards | Core |
| Assets | Ativos fixos, depreciação | Core |
| Projects | Projetos, tarefas, timesheets | Core |
| HR/Payroll | Funcionários, folha (HRMS separado) | App Separado |
| Quality | Inspeções, procedimentos | Core |
| Support/Helpdesk | Tickets, SLA, manutenção | Core |
| Website | CMS, e-commerce, blog | Core |

### Frappe Framework v15 - CVEs Críticos

| CVE | Tipo | CVSS | Versão Corrigida |
|-----|------|------|------------------|
| CVE-2025-55732 | SQL Injection | 8.7 | v15.74.2, v14.96.15 |
| CVE-2025-55731 | SQL Injection | 8.8 | v15.74.2, v14.96.15 |
| CVE-2025-52895 | SQL Injection | 8.7 | v15.58.0, v14.94.3 |
| CVE-2025-30213 | RCE | 8.2 | v15.52.0, v14.91.0 |
| CVE-2025-30214 | Info Disclosure | 8.0 | v15.52.0, v14.91.0 |
| CVE-2025-52896 | Password Reset Token Leak | 8.6 | v15.58.0, v14.94.3 |
| CVE-2025-52898 | XSS via file upload | 8.7 | v15.58.0, v14.94.3 |
| CVE-2025-30212 | SQL Injection | 6.6 | v15.51.0, v14.89.0 |
| CVE-2025-26240 | SSRF/LFI via pdfkit | N/A | v15.58.0 |
| LDAP Injection | Auth Bypass | N/A | Sanitizar input LDAP |
| bench run-patch | RCE | N/A | Restringir acesso sudo |

**AÇÃO OBRIGATÓRIA:** Atualizar para Frappe v15.74.2+

### ERPNext Docker (frappe_docker) - Containers Produção

| Container | Função | Obrigatório |
|-----------|--------|-------------|
| erpnext-backend | Gunicorn workers | SIM |
| erpnext-frontend | Nginx static files | SIM |
| erpnext-websocket | SocketIO real-time | SIM |
| erpnext-scheduler | Scheduled jobs | SIM |
| erpnext-worker-short | Background jobs curtos | SIM |
| erpnext-worker-default | Background jobs padrão | SIM |
| erpnext-worker-long | Background jobs longos | SIM |
| erpnext-redis-cache | Redis caching | SIM |
| erpnext-redis-queue | Redis RQ jobs | SIM |
| erpnext-mariadb | Database | SIM |
| erpnext-configurator | Initial setup | Setup only |
| erpnext-create-site | Site creation | Setup only |

### MariaDB 10.11 Production Tuning

| Configuração | Valor Recomendado | Descrição |
|--------------|-------------------|-----------|
| innodb_buffer_pool_size | 70-80% RAM | Cache de dados |
| max_connections | Baseado em workers | Conexões simultâneas |
| character-set-server | utf8mb4 | Suporte unicode completo |
| collation-server | utf8mb4_unicode_ci | Ordenação unicode |

### Redis 7 Security

| Configuração | Requisito | Descrição |
|--------------|-----------|-----------|
| ACL | OBRIGATÓRIO | Substituir AUTH simples |
| TLS | RECOMENDADO | Criptografia em trânsito |
| bind | 127.0.0.1 ou rede interna | Não expor publicamente |
| rename-command FLUSHDB "" | OBRIGATÓRIO | Desabilitar comandos perigosos |
| rename-command CONFIG "" | OBRIGATÓRIO | Desabilitar CONFIG |
| maxmemory-policy | allkeys-lru | Eviction policy |

**Redis ACL Template:**
```acl
user default off
user frappe_user on >SENHA_SEGURA ~* +@all
```

---

## Infraestrutura e Segurança

### FastAPI (CLIP Inference Service)

| Configuração | Requisito | Descrição |
|--------------|-----------|-----------|
| CORS allow_origins | Lista específica | NUNCA usar ["*"] |
| SlowAPI rate limiting | OBRIGATÓRIO | Prevenir abuso GPU |
| Request timeout | 60 segundos | Prevenir hanging |
| JWT + bcrypt | OBRIGATÓRIO | Autenticação |
| Security headers middleware | OBRIGATÓRIO | HSTS, CSP, X-Frame-Options |
| TrustedHostMiddleware | OBRIGATÓRIO | Validar Host header |
| Dockerfile USER | Non-root | Container security |

### Nginx Security Headers

```nginx
server_tokens off;

add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "0" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; object-src 'none';" always;

client_max_body_size 10m;

ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
ssl_prefer_server_ciphers on;
```

### Traefik v3 Security

| Configuração | Requisito | Descrição |
|--------------|-----------|-----------|
| Versão | v3.3.6+ | Path sanitization default |
| Security headers middleware | OBRIGATÓRIO | HSTS, CSP, X-Frame-Options |
| Trusted IPs | OBRIGATÓRIO | Para forwarded headers |
| TLS 1.2+ | OBRIGATÓRIO | Criptografia mínima |

### Docker Security 2025

| Configuração | Requisito | Descrição |
|--------------|-----------|-----------|
| USER directive | OBRIGATÓRIO | Non-root container |
| --cap-drop ALL | RECOMENDADO | Drop all capabilities |
| --security-opt=no-new-privileges | RECOMENDADO | Prevent privilege escalation |
| --read-only | RECOMENDADO | Read-only filesystem |
| Resource limits | OBRIGATÓRIO | CPU/memory limits |

**Dockerfile Template:**
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS runner
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
WORKDIR /app
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .
USER nodejs
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### GitHub Actions CI/CD Security

| Configuração | Requisito | Descrição |
|--------------|-----------|-----------|
| Pin actions to SHA | OBRIGATÓRIO | Immutable releases |
| OIDC | RECOMENDADO | Substituir secrets estáticos |
| GITHUB_TOKEN permissions | Mínimo necessário | Least privilege |
| Environment protection | OBRIGATÓRIO | Aprovação para produção |
| Secret scanning | ATIVAR | Detectar vazamentos |

**Example Secure Action:**
```yaml
permissions:
  contents: read
  packages: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@8f4b7f84864484a7bf31766abe9204da3cbe65b3
```

---

## CVEs Críticos Frappe Framework

### Vulnerabilidades Ativas (Novembro 2025)

**SQL Injection (Múltiplas):**
- CVE-2025-55732: Bypass do patch CVE-2025-52895
- CVE-2025-55731: Data leakage
- CVE-2025-52895: Input validation failure
- CVE-2025-30212: build_filter_conditions method
- CVE-2025-56380: frappe.client.get_value API (PoC público)

**RCE:**
- CVE-2025-30213: Crafted documents execute arbitrary code
- bench run-patch: Python code execution

**Information Disclosure:**
- CVE-2025-30214: Sensitive data extraction
- CVE-2025-52896: Password reset token leakage

**XSS:**
- CVE-2025-52898: File upload XSS

**SSRF/LFI:**
- CVE-2025-26240: pdfkit from_string exploitation

**LDAP Injection:**
- ldap_settings.py reset_password method

### Versões Mínimas Seguras

| Branch | Versão Mínima | Observações |
|--------|---------------|-------------|
| v15 | v15.74.2 | Inclui TODOS os patches SQL injection |
| v14 | v14.96.15 | Para quem ainda usa v14 |

---

## Referências Oficiais

### Documentação

| Tecnologia | URL Oficial |
|------------|-------------|
| Express.js | https://expressjs.com/en/guide/behind-proxies.html |
| OWASP API Top 10 | https://owasp.org/API-Security/editions/2023/en/0x00-header/ |
| Node.js Security | https://nodejs.org/en/blog/vulnerability |
| PostgreSQL 17 | https://www.postgresql.org/docs/17/index.html |
| WebSocket ws | https://github.com/websockets/ws |
| FastAPI Security | https://fastapi.tiangolo.com/tutorial/security/ |
| ERPNext Docs | https://docs.erpnext.com/ |
| Frappe Security | https://frappe.io/security |
| frappe_docker | https://github.com/frappe/frappe_docker |
| Redis Security | https://redis.io/docs/latest/operate/rc/security/ |
| Traefik v3 | https://doc.traefik.io/traefik/ |
| Docker Security | https://docs.docker.com/develop/security-best-practices/ |
| GitHub Actions Security | https://docs.github.com/en/actions/security-guides |

### Ferramentas de Auditoria

| Ferramenta | Propósito |
|------------|-----------|
| npm audit | Vulnerabilidades Node.js |
| Snyk | Análise de dependências |
| Trivy | Scanner de containers |
| Bandit | Security linter Python |
| pip-audit | Vulnerabilidades Python |
| Safety | CVE database Python |

---

*Documento em Português Brasileiro*
*Atualizado: Novembro 2025*
*Versão: 1.0*
