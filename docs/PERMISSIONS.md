# Alice Enterprise - Gestão de Permissões

## Visão Geral

Este documento descreve o sistema de gestão de permissões da plataforma Alice Enterprise, implementado como Single Source of Truth (SSOT) para garantir consistência entre todos os scripts e componentes.

**Data de Implementação:** 19 de Janeiro de 2026  
**Data de Atualização:** 22 de Janeiro de 2026  
**Versão:** 1.4.2  
**Autor:** Fillipe Guerra

> **ATUALIZAÇÃO v1.1.0 (09/01/2026):** Adicionada Regra 5 para remoção agressiva de bits especiais
> com `chmod a-st` e validação imediata após chmod. Corrige problema onde `chmod 0755` não
> removia setgid bit em alguns filesystems.
>
> **ATUALIZAÇÃO v1.2.0 (17/01/2026):** Documentado diretório de logs do Caddy no SSOT e na tabela de permissões.
>
> **ATUALIZAÇÃO v1.3.0 (19/01/2026):** Ajuste de GID do Redis para 1000 (grupo `redis` nas imagens Alpine 7.x).
>
> **ATUALIZAÇÃO v1.3.1 (19/01/2026):** Adicionada gestão RBAC de permissões e grupos organizacionais (UI + API).
>
> **ATUALIZAÇÃO v1.3.2 (19/01/2026):** Correção de cache global para permissões por role e queries dinâmicas no painel.
>
> **ATUALIZAÇÃO v1.3.3 (18/01/2026):** Resolver RBAC combina permissões do DB com PERMISSION_MAP base.
>
> **ATUALIZAÇÃO v1.4.0 (22/01/2026):** Permissão Core expandida (ética/moral/legal/guardrails/NSFW + system prompt + criador) e auto-atribuição de permissões para admin/super_admin.

## Single Source of Truth (SSOT)

### Arquivo Central

**Localização:** `infra/scripts/permissions-config.sh`

Todas as configurações de UIDs, GIDs e permissões são definidas **SOMENTE** neste arquivo. Qualquer outro script que precise dessas informações deve fazer `source` deste arquivo.

### Arquitetura

```
permissions-config.sh (SSOT)
         ↓
    ┌────────────────────────────┬─────────────────────────────────┐
    ↓                            ↓                                 ↓
prepare-production-server.sh  fix-production-permissions.sh  (scripts futuros)
         ↓                            ↓
    Cria diretórios           Valida/corrige permissões
         ↓                            ↓
    ┌────────────────────────────────┘
    ↓
Servidor de produção com permissões corretas
```

### Benefícios

- ✅ **Zero Duplicação**: Valores definidos em um único lugar
- ✅ **Zero Inconsistência**: Todos os scripts usam a mesma fonte
- ✅ **Manutenção Simples**: Alterar UID/GID em um lugar atualiza tudo
- ✅ **Validação Robusta**: Script centralizado valida recursivamente
- ✅ **Conformidade CLAUDE.md**: Regra 2 (Não duplicar), Regra 6 (Enterprise-grade)

## Permissões por Serviço

### Tabela de UIDs/GIDs

| Serviço | UID | GID | User Name | Permissões | Justificativa |
|---------|-----|-----|-----------|------------|---------------|
| **PostgreSQL** | 70 | 70 | postgres | 700 | Security hardening obrigatório (PostgreSQL docs) |
| **pgBackRest Spool** | 70 | 70 | postgres | 755 | Logs de backup |
| **Redis Alice** | 999 | 1000 | redis | 755 | Alpine Redis (grupo `redis` = 1000) |
| **Caddy** | 1000 | 1000 | caddy | 755 | Web server, serve certificados públicos |
| **Caddy Config** | 1000 | 1000 | caddy | 755 | Configurações Caddy |
| **Caddy Logs** | 1000 | 1000 | caddy | 755 | Logs do reverse proxy |
| **SearXNG** | 977 | 977 | searxng | 755 | Metabusca interna |
| **MinIO** | 0 | 0 | root | 755 | Object storage (requer root) |
| **Qdrant** | 0 | 0 | root | 755 | Banco vetorial (requer root) |
| **Jaeger** | 10001 | 10001 | jaeger | 755 | Tracing (distroless) |
| **Prometheus** | 65534 | 65534 | nobody | 755 | Métricas (Alpine nobody) |
| **Grafana** | 472 | 472 | grafana | 755 | Dashboards |
| **Loki** | 10001 | 10001 | loki | 755 | Logs (distroless) |
| **Langfuse DB** | 70 | 70 | postgres | 700 | PostgreSQL strict mode |
| **ClickHouse** | 101 | 101 | clickhouse | 755 | OLAP Langfuse |
| **Vector** | 0 | 0 | root | 755 | Agregador de logs |
| **ERPNext Sites** | 1000 | 1000 | frappe | 755 | Sites Frappe |
| **ERPNext MariaDB** | 999 | 999 | mysql | 755 | Banco ERPNext |
| **ERPNext Redis** | 999 | 1000 | redis | 755 | Cache/Queue ERPNext |
| **Uploads** | 1000 | 1000 | node | 755 | RAG multimodal |
| **Backups PostgreSQL** | 70 | 70 | postgres | 755 | pgBackRest backups |
| **Secrets** | 0 | 0 | root | 700 | Apenas root pode ler |

### Notas Importantes

## Permissões RBAC (Aplicação)

Além das permissões de filesystem (SSOT), a plataforma usa RBAC em nível de aplicação.

- **Permissão Core:** `admin:alice_core:write` controla edição do core da Alice (ética, moral, legal, guardrails, NSFW, system prompt e identidade do criador).
- **Gestão de Permissões:** CRUD de permissões e atribuição por role via painel de Usuários.
- **Grupos Organizacionais:** agrupamento de usuários sem impacto direto em RBAC.
- **Resolver DB + Base:** combina `role_permissions` com o `PERMISSION_MAP` por role para compatibilidade.
- **Admin/Super Admin:** recebem automaticamente TODAS as permissões existentes e novas (sem possibilidade de remoção).

### Core da Alice (DB)

- **Origem:** configurado no banco `assistant_settings` por tenant.
- **Edição:** exclusiva para `admin:alice_core:write`.
- **Observação:** campos pendentes são exibidos no painel de configuração da Alice para correção imediata.

#### PostgreSQL e Langfuse DB (permissão 700)

```bash
# OBRIGATÓRIO: PostgreSQL requer modo restrito para data directory
# REF: https://www.postgresql.org/docs/16/runtime-config-file-locations.html
chmod 0700 /opt/alice/data/postgres
chmod 0700 /opt/alice/data/langfuse-db
```

**Por que 700?**
- PostgreSQL verifica permissões do data directory na inicialização
- Se permissões forem muito abertas, PostgreSQL recusa iniciar
- Este é um requisito de segurança do PostgreSQL, não uma preferência

#### Caddy (permissão 755)

```bash
# CORRETO: Web server precisa servir certificados públicos
chmod 0755 /opt/alice/data/caddy
```

**Por que 755?**
- Caddy é reverse proxy público (portas 443/80)
- Precisa servir certificados SSL (Let's Encrypt)
- Permissão 700 impediria leitura de certificados por processos relacionados
- REF: https://caddyserver.com/docs/conventions#file-locations

#### Backups PostgreSQL (permissão 755)

```bash
# CORRETO: Root deve poder ler backups para restore manual
chmod 0755 /opt/alice/backups/postgresql
```

**Por que 755?**
- Root precisa acessar backups para restore de emergência
- pgBackRest roda como UID 70 (postgres)
- Permissão 750 impediria scripts de root ler backups

## Regras Enterprise

### Regra 1: NUNCA Hardcode UIDs/GIDs/Permissões

```bash
# ❌ INCORRETO - Valores hardcoded
chown -R 70:70 /opt/alice/data/postgres
chmod 700 /opt/alice/data/postgres

# ✅ CORRETO - Usar SSOT
source "${SCRIPT_DIR}/permissions-config.sh"
# Arrays PERMISSIONS_CONFIG e VALIDATION_EXCEPTIONS disponíveis
```

### Regra 2: SEMPRE Source permissions-config.sh

```bash
# No início do script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/permissions-config.sh"
```

### Regra 3: ÚNICA Exceção - Validação Crítica Inline

Se precisar validar permissões inline (ex: em workflow), use comentário REF:

```bash
# Validação inline PostgreSQL (REF: permissions-config.sh - POSTGRES_UID=70)
if [ "$(stat -c '%u' /opt/alice/data/postgres)" != "70" ]; then
    echo "Erro: PostgreSQL data dir tem UID incorreto"
    exit 1
fi
```

### Regra 4: Usar chmod 0xxx (com prefixo zero)

```bash
# ❌ INCORRETO - chmod 755 NÃO remove bits especiais
chmod 755 /path/to/dir  # Se dir tinha 2755 (setgid), mantém 2755!

# ✅ CORRETO - chmod 0755 explicitamente zera bits especiais
chmod 0755 /path/to/dir  # Garante exatamente 755, remove setgid/setuid/sticky
```

### Regra 5: Remoção Agressiva de Bits Especiais (09/01/2026)

**Problema Identificado:** Em alguns sistemas/filesystems, `chmod 0755` **não remove** o setgid bit mesmo com prefixo 0.

**Solução Enterprise (3 passos):**

```bash
# PASSO 1: Remover bits especiais EXPLICITAMENTE
chmod a-st /path/to/dir  # Remove setuid(s), setgid(s), sticky(t)

# PASSO 2: Aplicar permissões desejadas
chmod 0755 /path/to/dir

# PASSO 3: Validar IMEDIATAMENTE (fail-fast)
new_perms=$(stat -c '%a' /path/to/dir)
if [[ "${#new_perms}" -gt 3 ]]; then
    echo "ERRO: chmod não funcionou - investigar ACLs, mount options, SELinux"
    exit 1
fi
```

**Diagnóstico se chmod falhar:**
```bash
# Verificar ACLs
getfacl /path/to/dir

# Verificar mount options
mount | grep $(df /path/to/dir | tail -1 | awk '{print $1}')

# Verificar SELinux/AppArmor
getenforce 2>/dev/null || echo "SELinux não instalado"
aa-status 2>/dev/null || echo "AppArmor não instalado"

# Verificar chattr
lsattr /path/to/dir
```

**REF:** CLAUDE.md Regra 7 (Causa raiz), Regra 9 (Validação contínua)

## Scripts de Gestão

### fix-production-permissions.sh

Script principal para criar, validar e corrigir permissões.

```bash
# Preview das mudanças (sem aplicar)
sudo ./fix-production-permissions.sh --dry-run

# Criar diretórios e aplicar permissões
sudo ./fix-production-permissions.sh --create

# Validar permissões existentes
sudo ./fix-production-permissions.sh --validate
```

### prepare-production-server.sh

Script de preparação do servidor que delega para fix-production-permissions.sh:

```bash
# Prepara servidor completo (inclui permissões via SSOT)
sudo ./prepare-production-server.sh
```

## Troubleshooting

### Erro: "Validação de permissões falhou"

**Sintoma:**
```
[✗] ❌ INVÁLIDO: Permissões incorretas em /opt/alice/data/clickhouse
          Esperado: 0755 (sem bits especiais)
          Atual:    2755
          NOTA: Bits especiais detectados (setuid/setgid/sticky) - devem ser removidos
```

**Causa:** Diretório tem bits especiais (setgid neste caso) que não foram removidos pelo `chmod 0755`.

**Solução (v1.1.0+):**
```bash
# O script agora usa remoção agressiva (chmod a-st + chmod 0xxx + validação)
sudo /opt/alice/app/infra/scripts/fix-production-permissions.sh --create
```

**Se ainda falhar após v1.1.0:**
```bash
# 1. Remover manualmente os bits especiais
sudo chmod a-st /opt/alice/data/clickhouse

# 2. Aplicar permissões
sudo chmod 0755 /opt/alice/data/clickhouse

# 3. Verificar
stat -c '%a' /opt/alice/data/clickhouse
# Esperado: 755 (3 dígitos)

# 4. Se ainda mostrar 4 dígitos, investigar:
getfacl /opt/alice/data/clickhouse
mount | grep /opt
getenforce
```

**Histórico (09/01/2026):**
- **Problema:** `chmod 0755` não removia setgid bit no servidor Hetzner
- **Causa:** Alguns filesystems/mount options ignoram prefixo 0 do chmod
- **Solução:** Usar `chmod a-st` ANTES do `chmod 0xxx` para garantir remoção

### Erro: "permissions-config.sh: No such file"

**Sintoma:**
```
❌ ERRO CRÍTICO: permissions-config.sh não encontrado em /opt/alice/app/infra/scripts
```

**Causa:** Script SSOT não foi copiado para o servidor.

**Solução:**
1. Verificar se rsync do workflow copiou todos os arquivos
2. Verificar step "Sincronizar código e configs para servidor" no workflow

### Erro: "PostgreSQL permission denied"

**Sintoma:**
```
FATAL: data directory "/var/lib/postgresql/data" has invalid permissions
DETAIL: Permissions should be u=rwx (0700) or u=rwx,g=rx (0750).
```

**Causa:** Diretório PostgreSQL tem permissões incorretas.

**Solução:**
```bash
sudo chmod 0700 /opt/alice/data/postgres
sudo chown -R 70:70 /opt/alice/data/postgres
```

## Referências

- **CLAUDE.md Regra 2:** Não duplicar código
- **CLAUDE.md Regra 6:** Zero hardcoded, tudo enterprise-grade
- **CLAUDE.md Regra 7:** Identificar causa raiz antes de implementar
- **CLAUDE.md Regra 10:** Documentar em PT-BR
- **PostgreSQL Security:** https://www.postgresql.org/docs/16/runtime-config-file-locations.html
- **Caddy Best Practices:** https://caddyserver.com/docs/conventions#file-locations
- **chmod man page:** Bits especiais (setuid=4, setgid=2, sticky=1)

## Histórico de Mudanças

| Data | Versão | Descrição |
|------|--------|-----------|
| 09/01/2026 | 1.0.0 | Implementação inicial SSOT |

---

## Apêndice: ADR - Correção do Loop Infinito de Permissões (PR#74)

> **Consolidado de:** `docs/PR74-FIX-RECURSIVE-PERMISSIONS.md` (arquivo removido)

### Problema Identificado

**Fonte**: Cursor Bot Review da PR#73

Bug lógico crítico causava loop infinito na validação de permissões:
- `create_mode()` verificava ownership **SOMENTE** do diretório pai (usando `stat`)
- `validate_mode()` também verificava **SOMENTE** do diretório pai
- Se pai tinha UID correto mas filhos tinham UID errado: `chown -R` **NUNCA** rodava
- Validação SEMPRE falhava → Re-executar `--create` produzia O MESMO ERRO infinitamente

### Cenário de Falha

```bash
/opt/alice/data/postgres/
├── [drwx------ 70:70]     .              # ✅ PAI correto
├── [drwx------ root:root] base/          # ❌ FILHO errado
├── [drwx------ root:root] global/        # ❌ FILHO errado
└── [-rw------- root:root] PG_VERSION     # ❌ ARQUIVO errado
```

**Execução BUGADA:**
```bash
$ sudo bash fix-production-permissions.sh --create
# stat /opt/alice/data/postgres retorna 70:70 (PAI correto)
# UID do pai está correto → PULA chown -R! ❌
✅ postgres: Ownership correto  # FALSO POSITIVO!
# MAS OS FILHOS AINDA ESTÃO ERRADOS! → Loop infinito
```

### Solução Implementada

```bash
# ANTES (BUGADO)
current_uid=$(stat -c '%u' "$path")      # ❌ Verifica SÓ o pai
if [[ "$current_uid" != "$uid" ]]; then
    chown "${uid}:${gid}" "$path"         # ❌ SEM -R
fi

# DEPOIS (CORRETO)
# Verificar se há QUALQUER arquivo com UID ou GID incorreto (recursivo)
wrong_files=$(find "$path" \( ! -user "$uid" -o ! -group "$gid" \) -print -quit 2>/dev/null)
if [[ -n "$wrong_files" ]]; then
    chown -R "${uid}:${gid}" "$path"      # ✅ COM -R
fi
```

### Critérios de Aceitação (Todos Atingidos)

- ✅ `create_mode` usa `find` (recursivo) ANTES de decidir se roda `chown -R`
- ✅ `validate_mode` usa mesma lógica (consistência)
- ✅ Performance otimizada: `find ... -print -quit` para em primeiro erro
- ✅ Cenário de loop infinito é corrigido na primeira execução
- ✅ Cenário normal (tudo correto) não executa `chown -R` desnecessariamente

### Impacto

Sem esta correção, os seguintes containers crashariam com "Permission denied":
- PostgreSQL, MariaDB, Redis, Qdrant, Langfuse DB

**COM A CORREÇÃO: Todos esses cenários são corrigidos automaticamente!** ✅

**REF:** CLAUDE.md Regra 6 (Enterprise-grade, sem workarounds)
