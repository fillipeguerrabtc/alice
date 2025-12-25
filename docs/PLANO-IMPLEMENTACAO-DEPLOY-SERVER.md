# Plano de Implementação: Deploy Server Separado (Enterprise)

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0

## 🎯 Objetivo

Implementar arquitetura enterprise-grade com **Deploy Server separado** para CI/CD e **Production Server dedicado** apenas para aplicação.

## 📋 Arquitetura Proposta

```
┌─────────────────────────────────────────────────────────────────┐
│                    GITHUB ACTIONS (Cloud)                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Build & Push Images → GHCR                                │  │
│  │  Security Scan (Trivy)                                     │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             │ OIDC Token / Runner Registration
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│         DEPLOY SERVER (Hetzner CX11 - Mínimo)                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  GitHub Actions Self-Hosted Runner                       │  │
│  │  - Apenas CI/CD e deploy                                  │  │
│  │  - Sem aplicação de produção                              │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Docker (para builds/testes locais)                       │  │
│  │  - Não roda containers de produção                        │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             │ SSH/API (isolado, apenas deploy)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│         PRODUCTION SERVER (Hetzner GPU - Robusto)               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Docker Compose (50 containers)                          │  │
│  │  - Apenas serviços de produção                           │  │
│  │  - Sem runners, sem CI/CD                                │  │
│  │  - Isolado e protegido                                   │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 💰 Requisitos e Custos

### Deploy Server (Novo - Mínimo)

**Recomendação: Hetzner CX11 ou CPX11**

| Modelo | vCPU | RAM | SSD | Custo/mês | Recomendado? |
|--------|------|-----|-----|-----------|--------------|
| **CX11** | 1 | 4GB | 20GB | ~€4.51 | ✅ **Sim (mínimo)** |
| **CPX11** | 2 | 4GB | 40GB | ~€4.75 | ✅ Sim (melhor) |
| **CX21** | 2 | 4GB | 40GB | ~€5.83 | ⚠️ Overkill |

**Requisitos Mínimos:**
- ✅ 1 vCPU (suficiente para runner)
- ✅ 4GB RAM (runner usa ~500MB-1GB)
- ✅ 20GB SSD (suficiente para código e cache)
- ✅ Ubuntu 24.04 LTS
- ✅ Acesso SSH ao Production Server

**Justificativa:**
- Runner do GitHub Actions é leve (~500MB-1GB RAM)
- Não roda containers de produção (apenas deploy)
- Cache de imagens pode ser limpo periodicamente
- **CX11 é suficiente e mais econômico**

### Production Server (Existente - GPU)

**Manter servidor atual:**
- Hetzner GPU Server (RTX 4090, 24GB VRAM)
- 50 containers de produção
- **Sem runner, sem CI/CD** (apenas aplicação)

## 📝 Plano de Implementação

### Fase 1: Provisionamento do Deploy Server (1-2 horas)

#### 1.1 Criar Servidor Hetzner

```bash
# Via Console Hetzner ou API
- Location: Nuremberg (mesma região do Production Server)
- Image: Ubuntu 24.04 LTS
- Type: CX11 (1 vCPU, 4GB RAM, 20GB SSD)
- SSH Key: Adicionar sua chave pública
- Name: alice-deploy-server
- IPv4: Habilitado
```

#### 1.2 Configurar Acesso SSH

```bash
# No Deploy Server
ssh root@<deploy-server-ip>

# Configurar SSH para Production Server
ssh-keygen -t ed25519 -C "alice-deploy-runner" -f ~/.ssh/id_ed25519_deploy
cat ~/.ssh/id_ed25519_deploy.pub

# Copiar chave pública para Production Server
ssh-copy-id -i ~/.ssh/id_ed25519_deploy.pub root@<production-server-ip>

# Testar conexão
ssh -i ~/.ssh/id_ed25519_deploy root@<production-server-ip> "echo 'SSH OK'"
```

#### 1.3 Instalar Dependências Básicas

```bash
# No Deploy Server
apt-get update
apt-get install -y \
    curl \
    git \
    docker.io \
    docker-compose-plugin \
    jq \
    python3 \
    python3-pip

# Adicionar usuário ao grupo docker
usermod -aG docker $USER

# Verificar Docker
docker --version
docker compose version
```

### Fase 2: Instalar GitHub Actions Runner (30 minutos)

#### 2.1 Baixar e Configurar Runner

```bash
# No Deploy Server
cd /opt
mkdir -p actions-runner
cd actions-runner

# Baixar runner mais recente (2025)
RUNNER_VERSION="2.311.0"
curl -o actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz -L \
    https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz

tar xzf actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz

# Configurar runner
./config.sh \
    --url https://github.com/fillipeguerrabtc/alice \
    --token <RUNNER_REGISTRATION_TOKEN> \
    --name hetzner-deploy-runner \
    --work /opt/actions-runner/_work \
    --labels hetzner,deploy,self-hosted,linux \
    --replace

# Instalar como serviço systemd
sudo ./svc.sh install
sudo ./svc.sh start

# Verificar status
sudo systemctl status actions.runner.*.hetzner-deploy-runner.service
```

#### 2.2 Obter Token de Registração

1. GitHub → Repositório → **Settings** → **Actions** → **Runners**
2. Clique **New self-hosted runner**
3. Copie o token (ex: `AXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`)
4. Use no comando `./config.sh --token`

### Fase 3: Configurar SSH para Production Server (15 minutos)

#### 3.1 Criar Usuário Dedicado no Production Server

```bash
# No Production Server
useradd -r -m -s /bin/bash -d /opt/alice-deploy alice-deploy
usermod -aG docker alice-deploy

# Criar diretório .ssh
mkdir -p /home/alice-deploy/.ssh
chmod 700 /home/alice-deploy/.ssh

# Adicionar chave pública do Deploy Server
echo "<chave-publica-deploy-server>" >> /home/alice-deploy/.ssh/authorized_keys
chmod 600 /home/alice-deploy/.ssh/authorized_keys
chown -R alice-deploy:alice-deploy /home/alice-deploy/.ssh
```

#### 3.2 Configurar SSH no Deploy Server

```bash
# No Deploy Server
cat > ~/.ssh/config <<EOF
Host production-server
    HostName <production-server-ip>
    User alice-deploy
    IdentityFile ~/.ssh/id_ed25519_deploy
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
EOF

chmod 600 ~/.ssh/config

# Testar conexão
ssh production-server "echo 'SSH OK'"
```

### Fase 4: Atualizar Scripts e Workflow (1 hora)

#### 4.1 Criar Script de Deploy Remoto

```bash
# Criar infra/scripts/deploy-remote.sh
# Este script será executado no Deploy Server
# e fará deploy remoto no Production Server
```

#### 4.2 Atualizar Workflow

```yaml
# .github/workflows/deploy-production.yml
jobs:
  deploy:
    runs-on: [self-hosted, hetzner, deploy]  # Runner no Deploy Server
    steps:
      - name: Deploy to Production Server
        run: |
          ssh production-server "cd /opt/alice/app && ./deploy-local.sh"
```

### Fase 5: Testar e Validar (30 minutos)

#### 5.1 Testar Deploy Manual

```bash
# No Deploy Server (via SSH ou diretamente)
cd /opt/alice/app
./infra/scripts/deploy-remote.sh
```

#### 5.2 Validar Workflow

1. Disparar workflow manualmente no GitHub
2. Verificar logs do runner
3. Validar deploy no Production Server
4. Verificar health checks

## 🔒 Segurança

### Hardening do Deploy Server

```bash
# 1. Firewall (apenas SSH e GitHub Actions)
ufw allow 22/tcp
ufw enable

# 2. Fail2ban
apt-get install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# 3. Atualizações automáticas
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# 4. Desabilitar root login (opcional)
# Editar /etc/ssh/sshd_config
# PermitRootLogin no
```

### Hardening do Production Server

```bash
# 1. Firewall (apenas SSH do Deploy Server)
ufw allow from <deploy-server-ip> to any port 22
ufw enable

# 2. Limitar acesso SSH apenas do Deploy Server
# Editar /etc/ssh/sshd_config
# AllowUsers alice-deploy@<deploy-server-ip>
```

## 📊 Comparação: Antes vs Depois

| Aspecto | Antes (Runner em Prod) | Depois (Runner Separado) |
|---------|------------------------|--------------------------|
| **Segurança** | ❌ Runner em produção | ✅ Isolado |
| **Isolamento** | ❌ CI/CD + Produção | ✅ Separado |
| **Compliance** | ❌ Dificulta | ✅ Facilita |
| **Custo** | ✅ Sem custo extra | ✅ ~€4.51/mês (CX11) |
| **Manutenção** | ⚠️ Misturado | ✅ Separado |
| **Escalabilidade** | ❌ Limitada | ✅ Um runner → múltiplos servidores |

## ✅ Checklist de Implementação

- [ ] Provisionar Hetzner CX11 (Deploy Server)
- [ ] Configurar SSH entre Deploy Server e Production Server
- [ ] Instalar GitHub Actions Runner no Deploy Server
- [ ] Configurar usuário dedicado no Production Server
- [ ] Criar script `deploy-remote.sh`
- [ ] Atualizar workflow para usar runner separado
- [ ] Testar deploy manual
- [ ] Validar workflow completo
- [ ] Documentar processo
- [ ] Remover runner do Production Server (se existir)

## 🚀 Próximos Passos

1. **Aprovar este plano**
2. **Provisionar Deploy Server** (Hetzner CX11)
3. **Seguir Fase 1-5** sequencialmente
4. **Testar e validar**
5. **Documentar processo completo**

## 💡 Dicas

- **CX11 é suficiente** para runner (não precisa de mais recursos)
- **Mesma região** (Nuremberg) reduz latência entre servidores
- **SSH key dedicada** apenas para deploy (não usar chave pessoal)
- **Monitorar logs** do runner nos primeiros deploys
- **Backup** da configuração do runner (token, etc.)

---

**Custo Total Adicional:** ~€4.51/mês (Hetzner CX11)  
**Benefício:** Arquitetura enterprise-grade, segurança aprimorada, compliance-friendly

