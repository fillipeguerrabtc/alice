# Guia: GitHub Actions Self-Hosted Runner no Hetzner

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0

## Visão Geral

Este guia descreve como configurar um GitHub Actions Self-Hosted Runner no servidor Hetzner GPU para deploy enterprise-grade, eliminando a dependência de SSH e melhorando performance e segurança.

## Por que Self-Hosted Runner?

### Benefícios vs SSH

| Aspecto | SSH (Atual) | Self-Hosted Runner |
|---------|-------------|-------------------|
| **Latência** | ~500ms-2s (rede) | ~0ms (local) |
| **Segurança** | SSH keys | OIDC tokens (mais seguro) |
| **Performance** | Pull imagens do GHCR | Cache local + pull direto |
| **Manutenção** | Scripts inline | Scripts organizados |
| **Auditoria** | Logs SSH | GitHub Actions logs |
| **Versionamento** | Manual | Git tags automáticos |

## Pré-requisitos

- Servidor Hetzner GPU com Docker instalado
- Acesso root ao servidor
- Repositório GitHub com Actions habilitado
- Permissões para criar runners (admin do repositório)

## Passo 1: Obter Token de Registro

1. Acesse seu repositório no GitHub
2. Vá em **Settings** → **Actions** → **Runners**
3. Clique em **New self-hosted runner**
4. Selecione **Linux** e **x64**
5. **Copie o token de registro** (aparece no comando `./config.sh --token TOKEN`)

## Passo 2: Instalar Runner no Servidor

### Opção A: Script Automatizado (Recomendado)

```bash
# No servidor Hetzner (como root)
cd /opt/alice
curl -fsSL https://raw.githubusercontent.com/USERNAME/alice/main/infra/scripts/setup-github-runner.sh -o setup-github-runner.sh
chmod +x setup-github-runner.sh
sudo ./setup-github-runner.sh
```

O script irá:
- Baixar e instalar o runner
- Configurar como serviço systemd
- Configurar permissões Docker
- Iniciar o serviço automaticamente

### Opção B: Instalação Manual

```bash
# 1. Criar usuário (se não existir)
sudo useradd -r -m -s /bin/bash -d /opt/alice alice
sudo usermod -aG docker alice

# 2. Criar diretório do runner
sudo mkdir -p /opt/alice/actions-runner
cd /opt/alice/actions-runner

# 3. Baixar runner
RUNNER_VERSION="2.311.0"
curl -o actions-runner.tar.gz -L \
  https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz

# 4. Extrair
tar xzf actions-runner.tar.gz
rm actions-runner.tar.gz

# 5. Configurar runner
sudo -u alice ./config.sh \
  --url https://github.com/USERNAME/REPO \
  --token TOKEN_AQUI \
  --name hetzner-gpu-runner \
  --work /opt/alice/actions-runner/_work \
  --labels hetzner,gpu,self-hosted,linux \
  --replace

# 6. Instalar como serviço systemd
sudo ./svc.sh install alice
sudo systemctl enable actions.runner.USERNAME-REPO.hetzner-gpu-runner.service
sudo systemctl start actions.runner.USERNAME-REPO.hetzner-gpu-runner.service
```

## Passo 3: Verificar Instalação

```bash
# Verificar status do serviço
sudo systemctl status actions.runner.USERNAME-REPO.hetzner-gpu-runner.service

# Ver logs
sudo journalctl -u actions.runner.USERNAME-REPO.hetzner-gpu-runner.service -f

# Verificar se runner aparece no GitHub
# Settings → Actions → Runners → deve aparecer "hetzner-gpu-runner" como "Online"
```

## Passo 4: Atualizar Workflow

### Antes (SSH):

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.HETZNER_VM_HOST }}
          username: ${{ secrets.HETZNER_VM_USER }}
          key: ${{ secrets.HETZNER_SSH_PRIVATE_KEY }}
          script: |
            docker compose up -d
```

### Depois (Self-Hosted Runner):

```yaml
jobs:
  deploy:
    runs-on: self-hosted  # Runner no Hetzner GPU Server
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        
      - name: Login GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ github.token }}
          
      - name: Deploy
        run: |
          cd /opt/alice/app/infra/docker
          docker compose pull
          docker compose up -d
```

## Passo 5: Remover Dependência de SSH

Após validar que o deploy funciona com self-hosted runner:

1. **Remover secrets SSH** (opcional, manter como backup):
   - `HETZNER_SSH_PRIVATE_KEY`
   - `HETZNER_VM_HOST`
   - `HETZNER_VM_USER`

2. **Remover steps SSH** do workflow:
   - Remover `appleboy/ssh-action`
   - Remover configuração de SSH keys

3. **Atualizar documentação**:
   - Remover referências a SSH
   - Atualizar guias de deploy

## Comandos Úteis

### Gerenciar Runner

```bash
# Ver status
sudo systemctl status actions.runner.USERNAME-REPO.hetzner-gpu-runner.service

# Ver logs em tempo real
sudo journalctl -u actions.runner.USERNAME-REPO.hetzner-gpu-runner.service -f

# Reiniciar runner
sudo systemctl restart actions.runner.USERNAME-REPO.hetzner-gpu-runner.service

# Parar runner
sudo systemctl stop actions.runner.USERNAME-REPO.hetzner-gpu-runner.service

# Desinstalar runner
cd /opt/alice/actions-runner
sudo ./svc.sh stop
sudo ./svc.sh uninstall
```

### Troubleshooting

```bash
# Verificar se runner está conectado
curl -H "Authorization: token YOUR_TOKEN" \
  https://api.github.com/repos/USERNAME/REPO/actions/runners

# Verificar permissões Docker
sudo -u alice docker ps

# Verificar espaço em disco
df -h /opt/alice

# Limpar cache do runner (se necessário)
sudo -u alice rm -rf /opt/alice/actions-runner/_work/_temp
```

## Segurança

### Boas Práticas

1. **Runner como usuário não-root**
   - Runner roda como usuário `alice` (não root)
   - Permissões mínimas necessárias

2. **Secrets gerenciados pelo GitHub**
   - Não armazenar secrets no servidor
   - Usar GitHub Secrets (criptografados)

3. **Isolamento de jobs**
   - Cada job roda em diretório isolado (`_work`)
   - Limpeza automática após job

4. **Auditoria**
   - Todos os jobs são logados no GitHub Actions
   - Rastreabilidade completa (quem, quando, o quê)

## Performance

### Cache Local

Com self-hosted runner, você pode implementar cache local:

```yaml
- name: Pull images with cache
  run: |
    # Cache local de imagens Docker
    docker pull ${IMAGE}:${TAG} || docker pull ${IMAGE}:latest
    docker tag ${IMAGE}:${TAG} ${IMAGE}:local
```

### Build Local

Builds podem ser feitos diretamente no servidor:

```yaml
- name: Build locally
  run: |
    docker buildx build \
      --cache-from type=local,src=/opt/alice/.buildx-cache \
      --cache-to type=local,dest=/opt/alice/.buildx-cache,mode=max \
      -t ${IMAGE}:${TAG} .
```

## Próximos Passos

1. **Implementar cache local** (Docker registry local)
2. **Migrar para GitOps** (ArgoCD)
3. **Kubernetes** (opcional, futuro)

## Referências

- [GitHub Actions Self-Hosted Runners](https://docs.github.com/en/actions/hosting-your-own-runners)
- [Runner Installation](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/adding-self-hosted-runners)
- [Runner Security](https://docs.github.com/en/actions/hosting-your-own-runners/about-self-hosted-runners#self-hosted-runner-security)

