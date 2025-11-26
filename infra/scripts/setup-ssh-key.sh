#!/bin/bash
# =============================================================================
# Script para reconfigurar chave SSH do Replit para Hetzner
# =============================================================================
# Descrição: Recria a chave SSH a partir do replit.md quando o ambiente reinicia
# Uso: bash infra/scripts/setup-ssh-key.sh
# =============================================================================

set -e

mkdir -p ~/.ssh
chmod 700 ~/.ssh

# Chave privada documentada no replit.md
cat > ~/.ssh/id_ed25519 << 'EOF'
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACB09GBjXgDYcejx9vzOV/1BWCj51ta5qsqnO2g+R9zuRQAAAJgpMNluKTDZ
bgAAAAtzc2gtZWQyNTUxOQAAACB09GBjXgDYcejx9vzOV/1BWCj51ta5qsqnO2g+R9zuRQ
AAAEDz1NqTNS4IT4e4aibF92qUiE2NhenCyoGfHLMo6VAMq3T0YGNeANhx6PH2/M5X/UFY
KPnW1rmqyqc7aD5H3O5FAAAAE2FsaWNlLXJlcGxpdC1kZXBsb3kBAg==
-----END OPENSSH PRIVATE KEY-----
EOF

chmod 600 ~/.ssh/id_ed25519

# Adicionar host conhecido
ssh-keyscan -H 46.224.46.93 >> ~/.ssh/known_hosts 2>/dev/null || true

echo "Chave SSH configurada com sucesso!"
echo "Teste com: ssh root@46.224.46.93"
