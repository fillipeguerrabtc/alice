# Frappe Framework Patching - Guia de Atualização de Segurança

**Autor:** Fillipe Guerra  
**Data:** 25 de Janeiro de 2026

## Sumário

1. [CVEs Críticos Ativos](#cves-críticos-ativos)
2. [Versões Mínimas Seguras](#versões-mínimas-seguras)
3. [Procedimento de Atualização](#procedimento-de-atualização)
4. [Validação Pós-Atualização](#validação-pós-atualização)
5. [Rollback em Caso de Falha](#rollback-em-caso-de-falha)

---

## CVEs Críticos Ativos

### SQL Injection (Múltiplas Vulnerabilidades)

| CVE | CVSS | Descrição | Status |
|-----|------|-----------|--------|
| CVE-2025-55732 | 8.7 | Bypass do patch CVE-2025-52895 | CRÍTICO |
| CVE-2025-55731 | 8.8 | Data leakage via SQL injection | CRÍTICO |
| CVE-2025-52895 | 8.7 | Input validation failure | CORRIGIDO v15.58.0 |
| CVE-2025-30212 | 6.6 | build_filter_conditions method | CORRIGIDO v15.51.0 |
| CVE-2025-56380 | N/A | frappe.client.get_value API (PoC público) | CRÍTICO |

### Remote Code Execution (RCE)

| CVE | CVSS | Descrição | Status |
|-----|------|-----------|--------|
| CVE-2025-30213 | 8.2 | Crafted documents execute arbitrary code | CRÍTICO |

### Information Disclosure

| CVE | CVSS | Descrição | Status |
|-----|------|-----------|--------|
| CVE-2025-30214 | 8.0 | Sensitive data extraction | CORRIGIDO v15.52.0 |
| CVE-2025-52896 | 8.6 | Password reset token leakage | CORRIGIDO v15.58.0 |

### XSS (Cross-Site Scripting)

| CVE | CVSS | Descrição | Status |
|-----|------|-----------|--------|
| CVE-2025-52898 | 8.7 | File upload XSS | CORRIGIDO v15.58.0 |

### SSRF/LFI

| CVE | CVSS | Descrição | Status |
|-----|------|-----------|--------|
| CVE-2025-26240 | N/A | pdfkit from_string exploitation | CORRIGIDO v15.58.0 |

---

## Versões Mínimas Seguras

| Branch | Versão Mínima | Data Release | Observações |
|--------|---------------|--------------|-------------|
| **v15** | **v15.95.0** | Jan 2026 | Inclui TODOS os patches SQL injection |
| v14 | v14.96.15 | Nov 2025 | Para instalações legadas |

**STATUS ALICE:** ✅ v15.95.0 configurado em `infra/versions.env` (25/01/2026)

---

## Procedimento de Atualização

### Pré-Requisitos

1. Backup completo do banco de dados
2. Backup dos arquivos de site
3. Janela de manutenção programada (30-60 minutos)
4. Acesso SSH ao servidor de produção

### Passo 1: Backup Completo

```bash
# SSH para o servidor Hetzner
ssh root@178.63.41.108

# Navegar para diretório Alice
cd /opt/alice/app/infra/docker

# Backup do MariaDB ERPNext
docker compose -f docker-compose.prod.yml exec erpnext-mariadb \
  mysqldump -u root -p${ERPNEXT_MYSQL_ROOT_PASSWORD} \
  --all-databases > /opt/alice/backups/erpnext_$(date +%Y%m%d_%H%M%S).sql

# Backup dos sites ERPNext
docker compose -f docker-compose.prod.yml exec erpnext-backend \
  bench --site all backup --backup-path /home/frappe/frappe-bench/sites/backups

# Copiar backups para host
docker cp alice-erpnext-backend:/home/frappe/frappe-bench/sites/backups \
  /opt/alice/backups/sites_$(date +%Y%m%d_%H%M%S)
```

### Passo 2: Parar Serviços ERPNext

```bash
# Parar workers e scheduler primeiro (evita jobs corrompidos)
docker compose -f docker-compose.prod.yml stop \
  erpnext-worker-long \
  erpnext-worker-default \
  erpnext-worker-short \
  erpnext-scheduler

# Aguardar jobs finalizarem
sleep 30

# Parar demais serviços
docker compose -f docker-compose.prod.yml stop \
  erpnext-websocket \
  erpnext-frontend \
  erpnext-backend
```

### Passo 3: Atualizar Imagem Docker

```bash
# Editar docker-compose.prod.yml
# Alterar de:
#   image: frappe/erpnext:v15
# Para:
#   image: frappe/erpnext:v15.95.0

# Ou usar variável de ambiente:
export ERPNEXT_VERSION=v15.95.0

# Pull nova imagem
docker compose -f docker-compose.prod.yml pull \
  erpnext-backend \
  erpnext-frontend \
  erpnext-websocket \
  erpnext-scheduler \
  erpnext-worker-short \
  erpnext-worker-default \
  erpnext-worker-long
```

### Passo 4: Executar Migrations

```bash
# Iniciar apenas backend para migrations
docker compose -f docker-compose.prod.yml up -d erpnext-backend

# Aguardar backend iniciar
sleep 30

# Executar migrations
docker compose -f docker-compose.prod.yml exec erpnext-backend \
  bench --site all migrate

# Verificar se há erros
docker compose -f docker-compose.prod.yml logs erpnext-backend --tail 100
```

### Passo 5: Reiniciar Serviços

```bash
# Reiniciar todos os serviços ERPNext
docker compose -f docker-compose.prod.yml up -d \
  erpnext-backend \
  erpnext-frontend \
  erpnext-websocket \
  erpnext-scheduler \
  erpnext-worker-short \
  erpnext-worker-default \
  erpnext-worker-long

# Aguardar inicialização
sleep 60
```

---

## Validação Pós-Atualização

### Health Checks

```bash
# Verificar versão do Frappe
docker compose -f docker-compose.prod.yml exec erpnext-backend \
  bench version

# Deve mostrar:
# frappe v15.95.0 ou superior
# erpnext v15.x.x

# Health check do site
curl -sf https://erp.yesyoudeserve.duckdns.org/api/method/frappe.ping

# Verificar logs por erros
docker compose -f docker-compose.prod.yml logs --tail 50 \
  erpnext-backend \
  erpnext-scheduler
```

### Testes Funcionais

1. **Login de usuário:** Testar login no ERPNext
2. **Criar documento:** Criar um Sales Order de teste
3. **Background jobs:** Verificar se scheduler está processando
4. **WebSocket:** Verificar se notificações real-time funcionam

### Verificar CVEs Corrigidos

```bash
# Testar endpoint que era vulnerável (deve retornar erro ou resposta segura)
curl -X POST "https://erp.yesyoudeserve.duckdns.org/api/method/frappe.client.get_value" \
  -H "Content-Type: application/json" \
  -d '{"doctype":"User","filters":{"name":"Administrator"},"fieldname":["name","email"]}'
```

---

## Rollback em Caso de Falha

### Se a atualização falhar:

```bash
# Parar todos os serviços ERPNext
docker compose -f docker-compose.prod.yml stop \
  erpnext-backend erpnext-frontend erpnext-websocket \
  erpnext-scheduler erpnext-worker-short erpnext-worker-default erpnext-worker-long

# Restaurar backup do MariaDB
docker compose -f docker-compose.prod.yml exec -T erpnext-mariadb \
  mysql -u root -p${ERPNEXT_MYSQL_ROOT_PASSWORD} < /opt/alice/backups/erpnext_YYYYMMDD_HHMMSS.sql

# Reverter para imagem anterior
# Editar docker-compose.prod.yml de volta para:
#   image: frappe/erpnext:v15

# Reiniciar com imagem antiga
docker compose -f docker-compose.prod.yml up -d \
  erpnext-backend erpnext-frontend erpnext-websocket \
  erpnext-scheduler erpnext-worker-short erpnext-worker-default erpnext-worker-long
```

---

## Recomendações Adicionais

### 1. Instalar Block Administrator App

Protege conta Administrator contra brute-force:

```bash
docker compose -f docker-compose.prod.yml exec erpnext-backend \
  bench get-app https://github.com/AdeDesigns/block_administrator.git

docker compose -f docker-compose.prod.yml exec erpnext-backend \
  bench --site erp.yesyoudeserve.duckdns.org install-app block_administrator
```

### 2. Configurar RQ Auth

Habilita autenticação para Redis Queue:

```bash
docker compose -f docker-compose.prod.yml exec erpnext-backend \
  bench create-rq-users --use-rq-auth
```

### 3. Monitoramento de Segurança

- Configurar alertas para falhas de login
- Monitorar logs de auditoria do Frappe
- Habilitar 2FA para usuários admin

---

*Autor: Fillipe Guerra*
*Documento em Português Brasileiro*
*Atualizado: 02 de Janeiro de 2026*
*Versão: 1.6 - Critical Pipeline Fixes*
*Total de Containers: 50 (7 infraestrutura + 7 Alice + 15 ERPNext + 14 observability + 6 GPU + 1 backup)*
