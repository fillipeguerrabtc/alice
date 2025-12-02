#!/bin/bash
# =============================================================================
# Script para configurar chave SSH para deploy Hetzner
# =============================================================================
# Descrição: Configura chave SSH a partir de variável de ambiente (GitHub Secret)
# Uso: bash infra/scripts/setup-ssh-key.sh
#
# IMPORTANTE (Regra 6 - replit.md): NUNCA armazenar chaves privadas no código!
# A chave deve ser configurada como GitHub Secret: HETZNER_SSH_PRIVATE_KEY
# =============================================================================

set -e

# Validação enterprise-grade: Chave SSH deve vir de variável de ambiente
if [ -z "${HETZNER_SSH_PRIVATE_KEY}" ]; then
    echo "ERRO: Variável de ambiente HETZNER_SSH_PRIVATE_KEY não definida!"
    echo ""
    echo "Para configurar no GitHub Actions:"
    echo "  1. Vá em Settings → Secrets and variables → Actions"
    echo "  2. Crie um secret chamado HETZNER_SSH_PRIVATE_KEY"
    echo "  3. Cole o conteúdo da chave privada (incluindo BEGIN e END)"
    echo ""
    echo "Para gerar uma nova chave (se necessário):"
    echo "  ssh-keygen -t ed25519 -C 'alice-deploy' -f ~/.ssh/id_ed25519_alice"
    echo ""
    exit 1
fi

# Criar diretório SSH com permissões corretas
mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Escrever chave privada a partir da variável de ambiente
echo "${HETZNER_SSH_PRIVATE_KEY}" > ~/.ssh/id_ed25519
chmod 600 ~/.ssh/id_ed25519

# Adicionar host conhecido (Hetzner server)
if [ -n "${HETZNER_SERVER_IP}" ]; then
    ssh-keyscan -H "${HETZNER_SERVER_IP}" >> ~/.ssh/known_hosts 2>/dev/null || true
    echo "Host conhecido adicionado: ${HETZNER_SERVER_IP}"
else
    echo "AVISO: HETZNER_SERVER_IP não definido, pulando ssh-keyscan"
fi

echo "Chave SSH configurada com sucesso!"
