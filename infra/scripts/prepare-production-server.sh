#!/bin/bash
# =============================================================================
# Alice Enterprise Platform - Production Server Preparation Script
# =============================================================================
# Autor: Fillipe Guerra
# Data: 07 de Janeiro de 2026
# Versão: 1.0.0
#
# PROPÓSITO:
#   Script idempotente para preparar servidor de produção Hetzner GEX44
#   com todas as dependências, estruturas de diretórios e permissões
#   necessárias para deploy dos 50 containers Alice.
#
# VALIDAÇÕES:
#   - Servidor correto (178.63.41.108)
#   - GPU disponível (NVIDIA)
#   - Docker + NVIDIA Container Toolkit
#
# ESTRUTURA CRIADA:
#   - /opt/alice (30+ diretórios)
#   - Networks Docker externas
#   - Permissões específicas por serviço (999, 472, 65534, etc)
#
# EXECUÇÃO:
#   sudo ./prepare-production-server.sh
#
# IDEMPOTÊNCIA:
#   - Pode ser executado múltiplas vezes sem problemas
#   - Verifica antes de criar (mkdir -p, network create || true)
#   - Não sobrescreve dados existentes
#
# REFERÊNCIAS:
#   - CLAUDE.md Regra 6: Enterprise-grade, sem workarounds
#   - CLAUDE.md Regra 16: Fail-fast, validações robustas
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NVIDIA_RUNTIME_CHECK_SCRIPT="${SCRIPT_DIR}/check-nvidia-runtime.sh"

# =============================================================================
# VALIDAÇÕES PRÉ-REQUISITOS
# =============================================================================

echo ""
echo "🔍 VALIDAÇÕES PRÉ-REQUISITOS"
echo "============================================="

# -----------------------------------------------------------------------------
# 1. Validar servidor correto (178.63.41.108)
# -----------------------------------------------------------------------------
echo "📍 Validando servidor de produção..."

if ! hostname -I | grep -qw "178.63.41.108"; then
  echo "❌ ERRO: Este NÃO é o servidor de produção!"
  echo ""
  echo "   IPs encontrados: $(hostname -I)"
  echo "   IP esperado: 178.63.41.108"
  echo ""
  echo "Este script DEVE ser executado no Production Server (Hetzner GEX44)."
  exit 1
fi

echo "   ✅ Servidor de produção correto (178.63.41.108)"

# -----------------------------------------------------------------------------
# 2. Validar GPU disponível
# -----------------------------------------------------------------------------
echo "🎮 Validando GPU NVIDIA..."

if ! command -v nvidia-smi &> /dev/null; then
  echo "❌ ERRO: nvidia-smi não encontrado!"
  echo ""
  echo "Este servidor precisa de GPU para rodar os containers de inferência."
  echo ""
  echo "Instalação necessária:"
  echo "  1. NVIDIA Driver"
  echo "  2. NVIDIA Container Toolkit"
  exit 1
fi

echo "   ✅ nvidia-smi encontrado"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

# -----------------------------------------------------------------------------
# 3. Validar Docker
# -----------------------------------------------------------------------------
echo "🐳 Validando Docker..."

if ! command -v docker &> /dev/null; then
  echo "❌ ERRO: Docker não encontrado!"
  echo ""
  echo "Instalação necessária:"
  echo "  1. Docker Engine"
  echo "  2. Docker Compose"
  exit 1
fi

DOCKER_VERSION=$(docker --version)
echo "   ✅ Docker encontrado: $DOCKER_VERSION"

# -----------------------------------------------------------------------------
# 4. Validar runtime NVIDIA, Docker e CDI
# -----------------------------------------------------------------------------
echo "🧪 Validando runtime NVIDIA, Docker e CDI..."

if [[ ! -f "$NVIDIA_RUNTIME_CHECK_SCRIPT" ]]; then
  echo "❌ ERRO: Script crítico não encontrado!"
  echo ""
  echo "   Caminho esperado: $NVIDIA_RUNTIME_CHECK_SCRIPT"
  echo "   A validação de drift CDI é obrigatória antes do deploy."
  exit 1
fi

if ! bash "$NVIDIA_RUNTIME_CHECK_SCRIPT"; then
  echo ""
  echo "❌ ERRO: Host GPU inconsistente para deploy!"
  echo ""
  echo "   O runtime NVIDIA/CDI falhou na validação fail-fast."
  echo "   Isso bloqueia o deploy para evitar queda silenciosa de gpu-llm/gpu-embeddings."
  echo ""
  echo "💡 AÇÃO RECOMENDADA:"
  echo "   - Corrija o drift CDI antes de qualquer compose up"
  echo "   - Consulte o runbook docs/operations/runbooks/gpu-cdi-maintenance.md"
  exit 1
fi

echo "   ✅ Runtime NVIDIA, Docker e CDI consistentes"
echo ""

# =============================================================================
# CRIAÇÃO DE ESTRUTURA DE DIRETÓRIOS E PERMISSÕES
# =============================================================================
# CORREÇÃO ENTERPRISE 09/01/2026:
#
# CAUSA RAIZ IDENTIFICADA:
#   - Dois scripts (prepare-production-server.sh e fix-production-permissions.sh)
#     gerenciavam as mesmas permissões com valores DIFERENTES
#   - prepare-production-server.sh: langfuse-db=755, caddy=700, backups/postgresql=750
#   - fix-production-permissions.sh: langfuse-db=700, caddy=755, backups/postgresql=755
#   - RESULTADO: Validação sempre falhava por inconsistência
#
# SOLUÇÃO ENTERPRISE:
#   - Delegar TODA criação/configuração para fix-production-permissions.sh --create
#   - SSOT (Single Source of Truth) em permissions-config.sh
#   - Zero duplicação, zero inconsistência
#
# REF: CLAUDE.md Regra 2 (Não duplicar), Regra 6 (Enterprise-grade)
# REF: docs/PERMISSIONS.md para documentação completa
# =============================================================================

echo "📁 CRIANDO ESTRUTURA DE DIRETÓRIOS"
echo "============================================="

# -----------------------------------------------------------------------------
# Diretórios raiz (criados aqui pois são pré-requisito para o script SSOT)
# -----------------------------------------------------------------------------
echo "📝 Criando diretórios raiz..."
mkdir -p /opt/alice/{data,logs,uploads,backups,secrets,versions,app}
echo "   ✅ Diretórios raiz criados"
echo ""

# -----------------------------------------------------------------------------
# Delegar para script SSOT centralizado
# -----------------------------------------------------------------------------
# REF: CLAUDE.md Regra 2 (Não duplicar) - TODO código de permissões foi
#      removido deste script e centralizado em fix-production-permissions.sh
# -----------------------------------------------------------------------------

echo "🔧 DELEGANDO CRIAÇÃO DE DIRETÓRIOS E PERMISSÕES PARA SCRIPT CENTRALIZADO"
echo "============================================="
echo ""

FIX_PERMISSIONS_SCRIPT="${SCRIPT_DIR}/fix-production-permissions.sh"

# Verificar se o script SSOT existe
if [[ ! -f "$FIX_PERMISSIONS_SCRIPT" ]]; then
    echo "❌ ERRO CRÍTICO: fix-production-permissions.sh não encontrado!"
    echo "   Caminho esperado: $FIX_PERMISSIONS_SCRIPT"
    echo ""
    echo "   Este script é o SSOT (Single Source of Truth) para permissões."
    echo "   REF: CLAUDE.md Regra 2 (Não duplicar)"
    exit 1
fi

# Garantir permissão de execução
chmod +x "$FIX_PERMISSIONS_SCRIPT"

# Executar criação de diretórios e permissões via script centralizado
echo "📝 Executando fix-production-permissions.sh --create..."
echo ""

if ! sudo "$FIX_PERMISSIONS_SCRIPT" --create; then
    echo ""
    echo "❌ ERRO CRÍTICO: Falha ao criar diretórios e permissões!"
    echo ""
    echo "Detalhes da falha foram impressos acima pelo script de validação."
    echo ""
    echo "💡 SOLUÇÃO: Verifique os logs acima e tente novamente."
    exit 1
fi

echo ""
echo "✅ Estrutura de diretórios e permissões configuradas via SSOT"
echo ""

# =============================================================================
# CRIAÇÃO DE NETWORKS DOCKER EXTERNAS
# =============================================================================

echo "🌐 CRIANDO NETWORKS DOCKER EXTERNAS"
echo "============================================="

# alice-network (subnet específica 172.28.0.0/16)
if ! docker network inspect alice-network > /dev/null 2>&1; then
  echo "📝 Criando network alice-network..."
  docker network create --driver bridge --subnet 172.28.0.0/16 alice-network
  echo "   ✅ alice-network criada"
else
  echo "   ✅ alice-network já existe"
fi

echo ""

# =============================================================================
# VALIDAÇÃO FINAL
# =============================================================================
# CORREÇÃO ENTERPRISE 09/01/2026:
#   - Usar fix-production-permissions.sh --validate (consistência total)
#   - Validação recursiva de TODOS os diretórios (não apenas PostgreSQL)
#   - Zero código duplicado
# REF: CLAUDE.md Regra 2 (Não duplicar)
# =============================================================================

echo "✅ VALIDAÇÃO FINAL"
echo "============================================="

# -----------------------------------------------------------------------------
# Validar TODAS as permissões via script centralizado (SSOT)
# -----------------------------------------------------------------------------
echo "🧪 Validando TODOS os diretórios recursivamente via script centralizado..."
echo ""

if ! sudo "$FIX_PERMISSIONS_SCRIPT" --validate; then
    echo ""
    echo "❌ ERRO: Validação recursiva de permissões falhou!"
    echo ""
    echo "Detalhes da falha foram impressos acima pelo script de validação."
    echo ""
    echo "💡 SOLUÇÃO RÁPIDA (se for primeiro deploy):"
    echo "   Execute o script de correção novamente:"
    echo "   sudo $FIX_PERMISSIONS_SCRIPT --create"
    echo ""
    exit 1
fi

echo ""
echo "   ✅ Todas as permissões validadas OK (recursivamente)"

# -----------------------------------------------------------------------------
# Teste de escrita via Docker (validação adicional crítica para PostgreSQL)
# -----------------------------------------------------------------------------
echo ""
echo "🧪 Teste de escrita Docker para PostgreSQL..."

POSTGRES_DIR="/opt/alice/data/postgres"

# NOTA: Este teste é mantido mesmo com validação centralizada porque
#       verifica a integração Docker+Volume+Permissões, não apenas permissões do host
if ! docker run --rm --user 70:70 -v "$POSTGRES_DIR:/test:rw" alpine:3.21 touch /test/.write-test 2>/dev/null; then
    echo "❌ ERRO: Usuário 70 (postgres Alpine) NÃO consegue escrever no volume Docker"
    ls -ld "$POSTGRES_DIR"
    exit 1
fi

# Limpar arquivo de teste (via Docker para consistência)
docker run --rm --user 70:70 -v "$POSTGRES_DIR:/test:rw" alpine:3.21 rm -f /test/.write-test 2>/dev/null || true
echo "   ✅ Teste de escrita Docker PostgreSQL OK"

# -----------------------------------------------------------------------------
# Validar networks Docker
# -----------------------------------------------------------------------------
echo ""
echo "🧪 Validando networks Docker..."

if ! docker network inspect alice-network > /dev/null 2>&1; then
    echo "❌ ERRO: alice-network não existe!"
    exit 1
fi

echo "   ✅ Networks Docker OK"
echo ""

# =============================================================================
# SUCESSO
# =============================================================================

echo "🎉 SUCESSO!"
echo "============================================="
echo ""
echo "Servidor de produção preparado com sucesso!"
echo ""
echo "Próximos passos:"
echo "  1. Execute o workflow de deploy: deploy-stack-modular.yml"
echo "  2. O deploy criará automaticamente os containers"
echo "  3. Monitore os logs em /opt/alice/logs/"
echo ""
echo "Estrutura criada:"
echo "  - /opt/alice/ (30+ diretórios)"
echo "  - Networks Docker: alice-network"
echo "  - Permissões configuradas para 13 serviços"
echo ""
echo "============================================="
