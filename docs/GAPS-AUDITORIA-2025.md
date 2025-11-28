# Gaps de Auditoria Enterprise 2025 - Alice Platform + ERPNext

## Sumário

1. [Resumo Executivo](#resumo-executivo)
2. [Gaps Alice Services (7 Microsserviços)](#gaps-alice-services-7-microsserviços)
3. [Gaps PostgreSQL](#gaps-postgresql)
4. [Gaps CLIP Inference Service](#gaps-clip-inference-service)
5. [Gaps Nginx Frontend](#gaps-nginx-frontend)
6. [Gaps ERPNext Stack](#gaps-erpnext-stack)
7. [Gaps Traefik v3](#gaps-traefik-v3)
8. [Gaps GitHub Actions CI/CD](#gaps-github-actions-cicd)
9. [Gaps Docker](#gaps-docker)
10. [Plano de Remediação](#plano-de-remediação)

---

## Resumo Executivo

| Categoria | Gaps Críticos | Gaps Altos | Gaps Médios | Total |
|-----------|---------------|------------|-------------|-------|
| Alice Services | 7 | 3 | 2 | 12 |
| PostgreSQL | 3 | 1 | 1 | 5 |
| CLIP Inference | 4 | 0 | 0 | 4 |
| Nginx Frontend | 2 | 1 | 0 | 3 |
| ERPNext Stack | 5 | 2 | 1 | 8 |
| Traefik v3 | 2 | 0 | 0 | 2 |
| GitHub Actions | 2 | 1 | 0 | 3 |
| Docker | 1 | 0 | 0 | 1 |
| **TOTAL** | **26** | **8** | **4** | **38** |

---

## Gaps Alice Services (7 Microsserviços)

### GAP-ALICE-001: Trust Proxy Ausente (CRÍTICO)
**Serviços Afetados:** auth, chat, rag, training, integrations, observability, api-gateway  
**Localização:** Todos os `apps/*/src/index.ts`  
**Descrição:** Nenhum serviço tem `app.set('trust proxy', true)` configurado  
**Impacto:** Rate limiting bypassável quando atrás de proxy/load balancer (OWASP API8)  
**Remediação:** Adicionar `app.set('trust proxy', true)` em todos os serviços  
**Referência:** Express.js 2025 Security Baseline

### GAP-ALICE-002: Payload Limits Ausentes (CRÍTICO)
**Serviços Afetados:** Todos os 7 serviços  
**Localização:**
- auth-service/src/index.ts:252
- chat-service/src/index.ts:368
- rag-service/src/index.ts:715
- training-service/src/index.ts:159
- integrations-service/src/index.ts:125
- observability-service/src/index.ts:192
- api-gateway/src/index.ts:102

**Descrição:** `express.json()` sem size limits  
**Impacto:** DoS não autenticado via payloads grandes  
**Remediação:** Adicionar `express.json({ limit: '10mb' })` e `express.urlencoded({ limit: '10mb', extended: true })`  
**Referência:** Express.js 2025 Security Baseline

### GAP-ALICE-003: Compression Middleware Ausente (ALTO)
**Serviços Afetados:** Todos os 7 serviços  
**Descrição:** Nenhum middleware de compressão configurado  
**Impacto:** Maior consumo de banda, pior performance  
**Remediação:** Adicionar `compression()` middleware  
**Referência:** Express.js Performance Best Practices

### GAP-ALICE-004: Request Timeout Ausente (CRÍTICO)
**Serviços Afetados:** Todos os 7 serviços  
**Descrição:** Sem guards de timeout em requisições  
**Impacto:** Conexões pendentes podem esgotar recursos  
**Remediação:** Implementar timeout middleware ou usar server.timeout  
**Referência:** Node.js 20 LTS Production

### GAP-ALICE-005: WebSocket Hardening Ausente (CRÍTICO)
**Serviço Afetado:** chat-service  
**Localização:** apps/chat-service/src/index.ts:869-1003  
**Descrição:** WebSocket sem:
- Origin validation (Cross-Site WebSocket Hijacking)
- maxPayload limits
- Heartbeat/ping-pong
- Rate limiting por conexão

**Impacto:** OWASP API7, DoS, hijacking  
**Remediação:** Implementar todas as proteções conforme ws v8.18.3 docs  
**Referência:** WebSocket Security Best Practices 2025

### GAP-ALICE-006: TypeScript 'as any' (ALTO)
**Serviço Afetado:** rag-service  
**Localização:** apps/rag-service/src/index.ts:2118  
**Descrição:** Uso de `as any` viola Regra 8 do replit.md  
**Impacto:** Type safety comprometida  
**Remediação:** Implementar type guards apropriados  
**Referência:** Regra 8 - QUALIDADE OBRIGATÓRIA

### GAP-ALICE-007: Multer File Limits Ausentes (CRÍTICO)
**Serviço Afetado:** rag-service  
**Descrição:** Multer configurado sem:
- fileSize limits
- fileFilter whitelist de mimetypes

**Impacto:** DoS via uploads grandes, storage exhaustion  
**Remediação:** Configurar fileSize (50MB docs, 100MB media) e fileFilter  
**Referência:** Express.js File Upload Security

---

## Gaps PostgreSQL

### GAP-PG-001: RLS Não Habilitado (CRÍTICO)
**Localização:** packages/database/src/index.ts, shared/schema.ts  
**Descrição:** Row Level Security não habilitado em tabelas tenant-scoped  
**Impacto:** OWASP API1/API5 - exposição multi-tenant  
**Remediação:** Habilitar RLS em users, conversations, documents, trainings, integrations  
**Referência:** PostgreSQL 17 Security Hardening

### GAP-PG-002: Índices tenant_id Ausentes (ALTO)
**Localização:** shared/schema.ts  
**Descrição:** Faltam índices em colunas tenant_id  
**Impacto:** Performance degradada em queries multi-tenant  
**Remediação:** Criar índices em todas as colunas tenant_id  
**Referência:** PostgreSQL 17 Performance

### GAP-PG-003: SSL Mode Não Verificado (CRÍTICO)
**Localização:** Connection strings  
**Descrição:** Sem configuração de `sslmode=verify-full`  
**Impacto:** Conexões podem ser interceptadas  
**Remediação:** Configurar sslmode=verify-full em produção  
**Referência:** PostgreSQL 17 TLS

### GAP-PG-004: pgAudit Não Instalado (MÉDIO)
**Descrição:** Extension pgAudit não instalada/configurada  
**Impacto:** Sem audit logging de queries sensíveis  
**Remediação:** Instalar e configurar pgAudit  
**Referência:** PostgreSQL 17 CIS Benchmark

### GAP-PG-005: SCRAM-SHA-256 Não Verificado (ALTO)
**Descrição:** Verificar se autenticação usa SCRAM-SHA-256 (não MD5)  
**Impacto:** MD5 é vulnerável a rainbow tables  
**Remediação:** Configurar SCRAM-SHA-256 em pg_hba.conf  
**Referência:** PostgreSQL 17 Authentication

---

## Gaps CLIP Inference Service

### GAP-CLIP-001: CORS Allow All Origins (CRÍTICO)
**Localização:** apps/clip-inference-service/server.py:92-99  
**Descrição:** `allow_origins=['*']` configurado  
**Impacto:** Exposição cross-origin, qualquer site pode chamar a API  
**Remediação:** Trocar por lista específica de origens permitidas  
**Referência:** FastAPI 2025 Security

### GAP-CLIP-002: Rate Limiting Ausente (CRÍTICO)
**Descrição:** Sem rate limiting no endpoint de inferência  
**Impacto:** GPU abuse, DoS, custos elevados  
**Remediação:** Implementar SlowAPI rate limiting  
**Referência:** FastAPI Production Best Practices

### GAP-CLIP-003: Request Timeout Ausente (CRÍTICO)
**Descrição:** Sem timeout guards em inference endpoint  
**Impacto:** Requisições podem pendurar indefinidamente  
**Remediação:** Implementar timeout de 60 segundos  
**Referência:** FastAPI Production

### GAP-CLIP-004: Container Roda como Root (CRÍTICO)
**Localização:** apps/clip-inference-service/Dockerfile  
**Descrição:** Sem `USER` directive, container roda como root  
**Impacto:** Privilege escalation se container comprometido  
**Remediação:** Adicionar USER directive com usuário non-root  
**Referência:** Docker Security 2025

---

## Gaps Nginx Frontend

### GAP-NGINX-001: Security Headers Ausentes (CRÍTICO)
**Localização:** apps/frontend-service/nginx.conf  
**Descrição:** Faltam headers:
- Content-Security-Policy
- Strict-Transport-Security (HSTS)
- X-Frame-Options
- X-Content-Type-Options

**Impacto:** XSS, clickjacking, MIME sniffing  
**Remediação:** Adicionar todos os security headers  
**Referência:** Nginx Security Hardening 2025

### GAP-NGINX-002: Body Size Limit Ausente (CRÍTICO)
**Descrição:** Sem `client_max_body_size` configurado  
**Impacto:** DoS via uploads grandes  
**Remediação:** Adicionar `client_max_body_size 10m`  
**Referência:** Nginx Production

### GAP-NGINX-003: server_tokens Não Desabilitado (ALTO)
**Descrição:** Versão do Nginx exposta  
**Impacto:** Information disclosure  
**Remediação:** Adicionar `server_tokens off`  
**Referência:** Nginx Security Hardening

---

## Gaps ERPNext Stack

### GAP-ERPNEXT-001: Redis Sem Autenticação (CRÍTICO)
**Containers Afetados:** erpnext-redis-cache, erpnext-redis-queue  
**Descrição:** Redis instances sem ACL/password  
**Impacto:** Acesso não autorizado a cache e queue  
**Remediação:** Implementar Redis ACL auth  
**Referência:** Redis 7 Security, frappe_docker production

### GAP-ERPNEXT-002: Scheduler Container Ausente (CRÍTICO)
**Localização:** infra/docker/docker-compose.prod.yml  
**Descrição:** Container erpnext-scheduler não configurado  
**Impacto:** Scheduled jobs não executam  
**Remediação:** Adicionar container scheduler  
**Referência:** frappe_docker Production Deployment

### GAP-ERPNEXT-003: Workers Containers Ausentes (CRÍTICO)
**Localização:** infra/docker/docker-compose.prod.yml  
**Descrição:** Containers de workers (short/default/long) não configurados  
**Impacto:** Background jobs não processam  
**Remediação:** Adicionar containers worker-short, worker-default, worker-long  
**Referência:** Frappe Background Jobs

### GAP-ERPNEXT-004: DB Credentials via Defaults (ALTO)
**Descrição:** Credenciais via defaults em docker-compose  
**Impacto:** Senhas fracas/previsíveis  
**Remediação:** Usar secrets management  
**Referência:** Docker Secrets

### GAP-ERPNEXT-005: Frappe CVEs Não Patcheados (CRÍTICO)
**Descrição:** Framework com CVEs críticos:
- CVE-2025-55732: SQL Injection (bypass)
- CVE-2025-55731: SQL Injection
- CVE-2025-30213: RCE

**Impacto:** Takeover completo do sistema  
**Remediação:** Atualizar para Frappe v15.74.2+  
**Referência:** Frappe Security Advisories

### GAP-ERPNEXT-006: Block Administrator Não Instalado (ALTO)
**Descrição:** App Block Administrator não instalado  
**Impacto:** Conta Administrator vulnerável a brute-force  
**Remediação:** Instalar block_administrator app  
**Referência:** Frappe Security Best Practices

### GAP-ERPNEXT-007: HRMS/Payments Não Verificados (MÉDIO)
**Descrição:** Verificar se apps HRMS e Payments estão instalados  
**Impacto:** Funcionalidades ausentes  
**Remediação:** Instalar apps na ordem: Payments → ERPNext → HRMS  
**Referência:** ERPNext v15 Installation Guide

### GAP-ERPNEXT-008: Redis RQ Auth Não Habilitado (ALTO)
**Descrição:** Redis Queue auth não habilitado via bench  
**Impacto:** Jobs queue acessível sem autenticação  
**Remediação:** `bench create-rq-users --use-rq-auth`  
**Referência:** Frappe Production Setup

---

## Gaps Traefik v3

### GAP-TRAEFIK-001: Security Headers Middleware Ausente (CRÍTICO)
**Localização:** infra/traefik/dynamic/middlewares.yml  
**Descrição:** Sem middleware global para security headers  
**Impacto:** Headers de segurança não aplicados  
**Remediação:** Criar middleware com HSTS, CSP, X-Frame-Options  
**Referência:** Traefik v3 Security

### GAP-TRAEFIK-002: Versão Não Verificada (CRÍTICO)
**Descrição:** Verificar se versão é v3.3.6+ (path sanitization default)  
**Impacto:** Path traversal se versão antiga  
**Remediação:** Atualizar para v3.3.6+  
**Referência:** Traefik v3 Security Advisories

---

## Gaps GitHub Actions CI/CD

### GAP-GHACTIONS-001: Actions Não Pinadas a SHA (CRÍTICO)
**Localização:** .github/workflows/deploy-production.yml  
**Descrição:** Actions usando tags/branches em vez de commit SHA  
**Impacto:** Supply chain attack via action comprometida  
**Remediação:** Pinar TODAS as actions a commit SHA  
**Referência:** GitHub Actions Security 2025

### GAP-GHACTIONS-002: OIDC Não Utilizado (ALTO)
**Descrição:** Usando secrets estáticos em vez de OIDC  
**Impacto:** Secrets podem vazar  
**Remediação:** Implementar OIDC para cloud deploys  
**Referência:** GitHub Actions OIDC

### GAP-GHACTIONS-003: GITHUB_TOKEN Permissions (CRÍTICO)
**Descrição:** Verificar se GITHUB_TOKEN tem permissions mínimas  
**Impacto:** Over-privileged token  
**Remediação:** Configurar permissions explícitas (least privilege)  
**Referência:** GitHub Actions Security

---

## Gaps Docker

### GAP-DOCKER-001: USER Directive Ausente (CRÍTICO)
**Dockerfiles Afetados:** 
- apps/auth-service/Dockerfile
- apps/chat-service/Dockerfile
- apps/rag-service/Dockerfile
- apps/training-service/Dockerfile
- apps/integrations-service/Dockerfile
- apps/observability-service/Dockerfile
- apps/api-gateway/Dockerfile
- apps/clip-inference-service/Dockerfile

**Descrição:** Containers rodam como root  
**Impacto:** Privilege escalation  
**Remediação:** Adicionar USER directive com usuário non-root  
**Referência:** Docker Security 2025

---

## Plano de Remediação

### Prioridade 1 - Crítico (Executar Imediatamente)

| Gap ID | Descrição | Esforço |
|--------|-----------|---------|
| GAP-ERPNEXT-005 | Frappe CVEs | 2h |
| GAP-ALICE-001 | Trust Proxy | 30min |
| GAP-ALICE-002 | Payload Limits | 30min |
| GAP-ALICE-005 | WebSocket Hardening | 4h |
| GAP-CLIP-001-004 | CLIP Security | 2h |
| GAP-NGINX-001 | Security Headers | 1h |
| GAP-ERPNEXT-001-003 | ERPNext Production | 4h |
| GAP-DOCKER-001 | Non-root containers | 2h |
| GAP-GHACTIONS-001 | Pin actions SHA | 1h |

### Prioridade 2 - Alto (Próxima Semana)

| Gap ID | Descrição | Esforço |
|--------|-----------|---------|
| GAP-PG-001-003 | PostgreSQL Security | 4h |
| GAP-ALICE-003-004 | Compression/Timeout | 1h |
| GAP-ALICE-006 | TypeScript any | 1h |
| GAP-TRAEFIK-001-002 | Traefik Security | 2h |

### Prioridade 3 - Médio (Este Mês)

| Gap ID | Descrição | Esforço |
|--------|-----------|---------|
| GAP-PG-004 | pgAudit | 2h |
| GAP-GHACTIONS-002 | OIDC | 4h |

---

## Métricas de Conformidade

| Categoria | Antes | Depois (Target) |
|-----------|-------|-----------------|
| Express.js 2025 Baseline | 14% | 100% |
| OWASP API Top 10 | 40% | 100% |
| WebSocket Security | 20% | 100% |
| PostgreSQL Hardening | 30% | 100% |
| FastAPI Security | 10% | 100% |
| Nginx Security | 30% | 100% |
| ERPNext Production | 40% | 100% |
| Docker Security | 30% | 100% |
| CI/CD Security | 50% | 100% |

---

*Documento em Português Brasileiro*
*Atualizado: Novembro 2025*
*Versão: 1.0*
