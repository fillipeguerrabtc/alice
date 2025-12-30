# Como Verificar se o Pipeline Está Usando Runner Próprio

**Autor:** Fillipe Guerra  
**Data:** 27 de Dezembro de 2025

## Status Atual dos Runners

### Arquitetura 100% Self-Hosted (Enterprise 2025)

O pipeline Alice usa **100% self-hosted runner** (Hetzner CPX32 - 4 vCPU, 8GB RAM) seguindo melhores práticas enterprise 2025:

| Tipo de Job | Runner | Motivo |
|-------------|--------|--------|
| **CI/Tests** | **Self-hosted** (`[self-hosted, linux, deploy]`) | Controle total, compliance, custos previsíveis |
| **Builds Docker** | **Self-hosted** (`[self-hosted, linux, deploy]`) | Recursos dedicados, sem rate limits, cache GHCR funciona |
| **Security Scans** | **Self-hosted** (`[self-hosted, linux, deploy]`) | Isolamento na infra própria, compliance |
| **Deploy** | **Self-hosted** (`[self-hosted, linux, deploy]`) | Acesso SSH ao servidor de produção |

### Todos os Workflows

**Todos os jobs** em todos os 3 workflows usam runner próprio (self-hosted):

```yaml
runs-on: [self-hosted, linux, deploy]  # ← Runner próprio Hetzner CPX32
```

**Pipeline Enterprise - Jobs por Workflow:**

| Workflow | Jobs (todos self-hosted) |
|----------|--------------------------|
| **CI** | detect-changes, build-and-check, security-and-compliance, trigger-release |
| **Release** | create-release, build-images, trigger-deploy |
| **Deploy** | validate-and-prepare, image-security-scan, deploy, health-check, rollback, register-success |

> **Otimização (27/12/2025):** Todos os jobs foram migrados para self-hosted runner. Anteriormente alguns usavam `ubuntu-latest`.

## Como Verificar se o Runner Próprio Está Sendo Usado

### 1. Verificar na Interface do GitHub Actions

1. Acesse: `https://github.com/fillipeguerrabtc/alice/actions`
2. Selecione um workflow run do `production-deploy.yml` (Deploy Hetzner)
3. Expanda o job `Deploy Hetzner`
4. Procure por:
   - Runner: `self-hosted` ou nome do runner
   - Labels: `self-hosted, linux, deploy`

**✅ Se mostrar "self-hosted runner":** Está usando runner próprio  
**❌ Se mostrar "ubuntu-latest":** Está usando GitHub-hosted (erro de configuração)

### 2. Verificar Status do Runner no Deploy Server

```bash
# Conectar ao Deploy Server
ssh alice-hetzner  # Ou: ssh -i ~/.ssh/alice-deploy root@46.224.46.93

# Verificar se o runner está rodando
systemctl status actions.runner.fillipeguerrabtc-alice.*.service

# Ver logs do runner
journalctl -u actions.runner.fillipeguerrabtc-alice.*.service -f

# Verificar se o runner está online no GitHub
cd /opt/actions-runner
./run.sh --check  # Mostra status de conexão
```

### 2.1. Configurar Passwordless Sudo (Obrigatório para Self-Hosted Runner)

O runner self-hosted precisa de **passwordless sudo** configurado para executar comandos de limpeza de disco.

**Opção 1: Configurar passwordless sudo para usuário do runner (Recomendado)**

```bash
# No Deploy Server, verificar usuário do runner
cd /opt/actions-runner
cat .runner  # Verificar usuário configurado

# Configurar passwordless sudo (substituir USER pelo usuário do runner)
echo "USER ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/actions-runner
sudo chmod 0440 /etc/sudoers.d/actions-runner

# Testar
sudo -n whoami  # Deve retornar root sem pedir senha
```

**Opção 2: Usar sudo -n nos workflows (Já implementado)**

Os workflows já usam `sudo -n` (non-interactive), mas ainda requer passwordless sudo configurado. Se não estiver configurado, os comandos falharão silenciosamente (devido ao `|| true`).

### 3. Verificar Labels do Runner

O runner deve estar registrado com as labels: `self-hosted`, `linux`, `deploy`

```bash
# No servidor, verificar arquivo de configuração
cat /opt/actions-runner/.runner

# Deve conter:
# "labels": ["self-hosted", "linux", "deploy"]
```

### 4. Verificar no GitHub Repository Settings

1. Acesse: `https://github.com/fillipeguerrabtc/alice/settings/actions/runners`
2. Verifique se há um runner **ativo** com labels:
   - `self-hosted`
   - `linux`
   - `deploy`
3. Status deve ser **"Online"** (verde)

### 5. Testar com Workflow de Teste

Se necessário, criar um workflow temporário para testar:

```yaml
name: Test Self-Hosted Runner

on:
  workflow_dispatch:

jobs:
  test-runner:
    runs-on: [self-hosted, linux, deploy]
    steps:
      - name: Verify runner
        run: |
          echo "Runner OS: ${{ runner.os }}"
          echo "Runner Name: ${{ runner.name }}"
          hostname
          uname -a
```

## Se o Runner Próprio NÃO Estiver Sendo Usado

### Possíveis Causas

1. **Runner offline**: Runner não está rodando no Deploy Server
2. **Labels incorretas**: Runner não tem as labels `self-hosted, linux, deploy`
3. **Runner não registrado**: Runner não foi registrado no repositório
4. **Falha de conexão**: Runner não consegue conectar ao GitHub

### Solução

1. Verificar se o runner está rodando: `systemctl status actions.runner.*.service`
2. Reiniciar o runner: `systemctl restart actions.runner.*.service`
3. Verificar logs: `journalctl -u actions.runner.*.service -f`
4. Re-registrar se necessário (ver documentação de setup do runner)

## Arquitetura de Runners: Comparação de Abordagens (2025)

### Opção 1: Híbrida (Antiga - Não Mais Utilizada)

- **GitHub-hosted** para CI/builds (isolamento, escalabilidade)
- **Self-hosted** apenas para deploy (acesso SSH)

**Vantagens:**
- ✅ Builds mais rápidos (paralelos, isolados, sem concorrência)
- ✅ Cache GHCR funciona perfeitamente (compartilhado)
- ✅ Isolamento de segurança nos scans
- ✅ Menor carga no servidor próprio
- ✅ Escalabilidade automática (GitHub provisiona runners sob demanda)
- ✅ Zero manutenção dos runners de CI/build

**Desvantagens:**
- ❌ Builds Docker podem ser limitados por rate limits do GitHub
- ❌ Menos controle sobre o ambiente de build
- ❌ Custos potenciais se exceder limites gratuitos do GitHub
- ❌ Dados passam pelo GitHub (compliance limitado)

### Opção 2: 100% Self-Hosted (Atual - Implementada 27/12/2025) ✅

- Todos os jobs rodam no runner próprio (Deploy Server CPX32 - 4 vCPU, 8GB RAM)

**Vantagens (2025):**
- ✅ **Controle total** sobre ambiente de execução
- ✅ **Custos previsíveis** (servidor fixo, sem surpresas do GitHub)
- ✅ **Sem rate limits** do GitHub Actions
- ✅ **Cache local** pode ser mais rápido (mesmo servidor)
- ✅ **Isolamento completo** da infraestrutura própria
- ✅ **Compliance/Governança**: Dados nunca saem da infraestrutura própria
- ✅ **Performance**: Recursos dedicados, sem concorrência com outros projetos

**Desvantagens:**
- ❌ Requer manutenção do runner (atualizações, monitoramento)
- ❌ Escalabilidade limitada (1 servidor)
- ❌ Se servidor cair, toda pipeline para
- ❌ Builds paralelos limitados pela capacidade do servidor
- ❌ Cache não compartilhado entre execuções (a menos que use Registry Cache)

### Opção 3: Self-Hosted para Builds, GitHub-hosted para CI/Tests

- **Self-hosted** para builds Docker (recursos intensivos)
- **GitHub-hosted** para CI/tests rápidos

**Vantagens:**
- ✅ Balanceamento de recursos
- ✅ CI rápido (GitHub-hosted)
- ✅ Builds com controle total (self-hosted)

## Implementação: 100% Self-Hosted (27/12/2025)

### Contexto da Alice
- **Deploy Server**: Hetzner CPX32 (4 vCPU AMD EPYC, 8GB RAM, 160GB SSD - €10.49/mês)
- **Pipeline**: Builds Docker grandes (PyTorch, CUDA, ~50 imagens)
- **Necessidade**: Controle total, custos previsíveis, compliance

### Enterprise Hardening Aplicado (27/12/2025) ✅

**Otimizações de Kernel (`/etc/sysctl.d/99-github-runner.conf`):**
- `net.core.rmem_max = 16MB` - Buffers de rede para downloads rápidos
- `vm.swappiness = 10` - Preferir RAM sobre swap
- `fs.inotify.max_user_watches = 524288` - Suporte a muitos arquivos
- `fs.file-max = 2097152` - Limite de arquivos abertos do sistema

**Docker Daemon (`/etc/docker/daemon.json`):**
- BuildKit habilitado por padrão
- `max-concurrent-downloads: 10` - Builds paralelos
- `builder.gc.defaultKeepStorage: 20GB` - Limpeza automática de cache
- `live-restore: true` - Containers sobrevivem restart do Docker

**Limites de Recursos (`/etc/security/limits.d/99-runner.conf`):**
- `nofile: 1048576` - Arquivos abertos
- `nproc: 65535` - Processos
- `memlock: unlimited` - Memória bloqueada

**Service Systemd (Override):**
- `NODE_OPTIONS=--max-old-space-size=6144` - 6GB RAM para Node.js
- `Nice=-5` - Alta prioridade CPU
- `IOSchedulingClass=best-effort` - I/O otimizado

**Manutenção Automática:**
- Cron diário 3h: Limpeza de Docker cache, workspaces antigos, logs
- Docker GC: Mantém 20GB de cache build

### Migração Implementada ✅

**Justificativa da migração:**

1. **Custos**: Servidor CPX32 já estava pago, usar apenas para deploy era subutilização
2. **Builds grandes**: Docker builds com PyTorch/CUDA se beneficiam de recursos dedicados (4 vCPU, 8GB RAM)
3. **Cache**: Registry Cache GHCR funciona igualmente bem (não depende do tipo de runner)
4. **Compliance**: Dados e builds ficam 100% na infraestrutura própria
5. **Performance**: Recursos dedicados (4 vCPU paralelos), sem rate limits do GitHub
6. **Melhores práticas 2025**: Tendência para self-hosted em projetos enterprise

**Mudanças implementadas:**

1. ✅ Todos os workflows atualizados para usar `runs-on: [self-hosted, linux, deploy]`
2. ✅ Runner CPX32 configurado com labels corretas
3. ✅ NODE_OPTIONS otimizado: `--max-old-space-size=6144` (6GB de 8GB disponíveis)
4. ✅ Registry Cache GHCR mantido (já configurado) para otimizar builds
5. ✅ Documentação atualizada
6. ✅ **Enterprise Hardening**: Kernel tuning, Docker daemon, limits, systemd override, cron cleanup

### Workflows Migrados

- ✅ **ci.yml**: Todos os jobs migrados
- ✅ **release.yml**: Todos os jobs migrados
- ✅ **production-deploy.yml**: Todos os jobs migrados

## Conclusão

**Estado Atual:** **100% Self-Hosted** ✅ (Implementado 27/12/2025)

**Benefícios:**
- Controle total sobre ambiente de execução
- Custos previsíveis (servidor fixo)
- Compliance completo (dados na infra própria)
- Performance otimizada (recursos dedicados)
- Cache enterprise (Registry Cache GHCR)
