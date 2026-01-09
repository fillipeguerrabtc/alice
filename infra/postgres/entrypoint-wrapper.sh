#!/bin/bash
# =============================================================================
# PostgreSQL Entrypoint Wrapper - Validação de Permissões Enterprise
# =============================================================================
# PROPÓSITO: Fail-fast se diretório PGDATA não tem permissões corretas
# BENEFÍCIO: Erro claro e acionável ao invés de "Permission denied" genérico
#
# FASE 2 do Plano de Correção Enterprise (09/01/2026):
#   - Defesa em profundidade para deploy resiliente
#   - Mensagens de erro claras com diagnóstico automático
#   - Ação corretiva explícita (comandos prontos para copiar)
#
# REFERÊNCIAS:
#   - CLAUDE.md Regra 6 (Enterprise-grade, sem workarounds)
#   - CLAUDE.md Regra 9 (Validação contínua)
#   - CLAUDE.md Regra 16 (Fail-fast)
#   - PostgreSQL Docker Official Image Best Practices 2025
#   - DEPLOYMENT.md Seção 8.2 (Permissões por serviço)
#
# Author: Fillipe Guerra
# Data: 09 de Janeiro de 2026
# =============================================================================

set -e

echo ""
echo "============================================="
echo "🔍 VALIDAÇÃO DE PERMISSÕES POSTGRESQL"
echo "============================================="
echo ""

# =============================================================================
# ESTÁGIO 1: Validar que PGDATA está configurado
# =============================================================================
if [ -z "$PGDATA" ]; then
  echo "❌ ERRO CRÍTICO: Variável PGDATA não está configurada"
  echo ""
  echo "📊 DIAGNÓSTICO:"
  echo "   A variável de ambiente PGDATA deve estar definida"
  echo "   Valor padrão esperado: /var/lib/postgresql/data"
  echo ""
  echo "🔧 AÇÃO NECESSÁRIA:"
  echo "   Verificar docker-compose.yml para presença de PGDATA no environment"
  echo ""
  echo "🔗 REFERÊNCIA:"
  echo "   https://hub.docker.com/_/postgres"
  exit 1
fi

echo "✅ PGDATA configurado: $PGDATA"

# =============================================================================
# ESTÁGIO 2: Validar que diretório existe
# =============================================================================
if [ ! -d "$PGDATA" ]; then
  echo ""
  echo "❌ ERRO CRÍTICO: Diretório $PGDATA não existe"
  echo ""
  echo "📊 DIAGNÓSTICO:"
  echo "   O volume bind mount não foi criado corretamente no host"
  echo ""
  echo "🔧 AÇÃO NECESSÁRIA (no servidor host):"
  echo "   sudo mkdir -p /opt/alice/data/postgres"
  echo "   sudo chown 999:999 /opt/alice/data/postgres"
  echo "   sudo chmod 700 /opt/alice/data/postgres"
  echo ""
  echo "🔗 REFERÊNCIA:"
  echo "   CLAUDE.md Regra 6 (Enterprise-grade)"
  echo "   DEPLOYMENT.md Seção 8.2 (Permissões por serviço)"
  exit 1
fi

echo "✅ Diretório existe: $PGDATA"

# =============================================================================
# ESTÁGIO 3: Validar que diretório é gravável pelo processo PostgreSQL
# =============================================================================
if [ ! -w "$PGDATA" ]; then
  # Capturar informações de diagnóstico
  ACTUAL_OWNER=$(stat -c '%U:%G (%u:%g)' "$PGDATA" 2>/dev/null || echo "DESCONHECIDO")
  ACTUAL_PERMS=$(stat -c '%a' "$PGDATA" 2>/dev/null || echo "DESCONHECIDO")
  MY_UID=$(id -u)
  MY_GID=$(id -g)
  MY_USER=$(id -un 2>/dev/null || echo "UID $MY_UID")
  
  echo ""
  echo "❌ ERRO CRÍTICO: Diretório $PGDATA não é gravável pelo container"
  echo ""
  echo "============================================="
  echo "📊 DIAGNÓSTICO COMPLETO"
  echo "============================================="
  echo ""
  echo "📁 INFORMAÇÕES DO DIRETÓRIO:"
  echo "   Path: $PGDATA"
  echo "   Ownership atual: $ACTUAL_OWNER"
  echo "   Permissões: $ACTUAL_PERMS"
  echo ""
  echo "🐳 INFORMAÇÕES DO CONTAINER:"
  echo "   Usuário do container: $MY_USER"
  echo "   UID do container: $MY_UID"
  echo "   GID do container: $MY_GID"
  echo ""
  echo "============================================="
  echo "🔧 AÇÕES NECESSÁRIAS (no servidor host)"
  echo "============================================="
  echo ""
  echo "   # Corrigir ownership para UID 999 (postgres)"
  echo "   sudo chown -R 999:999 /opt/alice/data/postgres"
  echo ""
  echo "   # Configurar permissões corretas (apenas owner)"
  echo "   sudo chmod 700 /opt/alice/data/postgres"
  echo ""
  echo "   # Validar correção"
  echo "   ls -ld /opt/alice/data/postgres"
  echo "   # Esperado: drwx------ ... 999 999 ..."
  echo ""
  echo "============================================="
  echo "🔗 REFERÊNCIAS"
  echo "============================================="
  echo ""
  echo "   - CLAUDE.md Regra 6 (Enterprise-grade)"
  echo "   - DEPLOYMENT.md Seção 8.2 (Permissões por serviço)"
  echo "   - PostgreSQL espera UID 999 como owner do PGDATA"
  echo ""
  exit 1
fi

echo "✅ Diretório é gravável pelo UID $(id -u)"

# =============================================================================
# ESTÁGIO 4: Teste de escrita real (defesa em profundidade)
# =============================================================================
echo ""
echo "🧪 Executando teste de escrita real..."

TEST_FILE="$PGDATA/.entrypoint-write-test-$$"
if ! touch "$TEST_FILE" 2>/dev/null; then
  ACTUAL_OWNER=$(stat -c '%U:%G (%u:%g)' "$PGDATA" 2>/dev/null || echo "DESCONHECIDO")
  ACTUAL_PERMS=$(stat -c '%a' "$PGDATA" 2>/dev/null || echo "DESCONHECIDO")
  
  echo ""
  echo "❌ ERRO CRÍTICO: Falha no teste de escrita em $PGDATA"
  echo ""
  echo "📊 DIAGNÓSTICO:"
  echo "   Ownership: $ACTUAL_OWNER"
  echo "   Permissões: $ACTUAL_PERMS"
  echo "   Container UID: $(id -u)"
  echo ""
  echo "💡 POSSÍVEIS CAUSAS:"
  echo "   - SELinux/AppArmor bloqueando acesso"
  echo "   - Filesystem montado como read-only"
  echo "   - Problemas de quota de disco"
  echo "   - ACLs bloqueando acesso"
  echo ""
  echo "🔧 AÇÃO NECESSÁRIA:"
  echo "   # Verificar espaço em disco"
  echo "   df -h /opt/alice/data/postgres"
  echo ""
  echo "   # Verificar SELinux (se aplicável)"
  echo "   getenforce 2>/dev/null || echo 'SELinux não instalado'"
  echo ""
  echo "   # Re-aplicar permissões"
  echo "   sudo chown -R 999:999 /opt/alice/data/postgres"
  echo "   sudo chmod 700 /opt/alice/data/postgres"
  exit 1
fi

# Limpar arquivo de teste
rm -f "$TEST_FILE" 2>/dev/null || true

echo "✅ Teste de escrita OK"

# =============================================================================
# ESTÁGIO 5: Validação de espaço em disco (warning apenas)
# =============================================================================
echo ""
echo "💾 Verificando espaço em disco..."

# Obter espaço disponível em MB
AVAILABLE_MB=$(df -m "$PGDATA" 2>/dev/null | tail -1 | awk '{print $4}')
TOTAL_MB=$(df -m "$PGDATA" 2>/dev/null | tail -1 | awk '{print $2}')

if [ -n "$AVAILABLE_MB" ] && [ "$AVAILABLE_MB" -lt 1024 ]; then
  echo ""
  echo "⚠️  AVISO: Espaço em disco baixo!"
  echo ""
  echo "   Disponível: ${AVAILABLE_MB}MB"
  echo "   Total: ${TOTAL_MB}MB"
  echo ""
  echo "   PostgreSQL pode falhar se disco ficar cheio durante operação."
  echo "   Considere expandir o volume ou limpar arquivos desnecessários."
  echo ""
elif [ -n "$AVAILABLE_MB" ]; then
  echo "✅ Espaço em disco OK: ${AVAILABLE_MB}MB disponível"
else
  echo "⚠️  Não foi possível verificar espaço em disco (não crítico)"
fi

# =============================================================================
# SUCESSO - Prosseguir com entrypoint padrão do PostgreSQL
# =============================================================================
echo ""
echo "============================================="
echo "✅ VALIDAÇÃO CONCLUÍDA COM SUCESSO"
echo "============================================="
echo ""
echo "   UID do container: $(id -u)"
echo "   PGDATA: $PGDATA"
echo "   Ownership: OK"
echo "   Permissões: OK"
echo "   Escrita: OK"
echo ""
echo "🚀 Iniciando PostgreSQL..."
echo ""

# Executar entrypoint padrão do PostgreSQL
# O docker-entrypoint.sh da imagem oficial faz:
# - initdb se PGDATA vazio
# - Executa scripts em /docker-entrypoint-initdb.d/
# - Inicia o servidor PostgreSQL
exec docker-entrypoint.sh "$@"
