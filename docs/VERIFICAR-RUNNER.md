# Como Verificar se o Pipeline Está Usando Runner Próprio

**Autor:** Fillipe Guerra  
**Data:** 27 de Dezembro de 2025

## Status Atual dos Runners

### Arquitetura 100% Self-Hosted (Enterprise 2025)

O pipeline Alice usa **100% self-hosted runner** (Hetzner CX22) seguindo melhores práticas enterprise 2025:

| Tipo de Job | Runner | Motivo |
|-------------|--------|--------|
| **CI/Tests** | **Self-hosted** (`[self-hosted, linux, deploy]`) | Controle total, compliance, custos previsíveis |
| **Builds Docker** | **Self-hosted** (`[self-hosted, linux, deploy]`) | Recursos dedicados, sem rate limits, cache GHCR funciona |
| **Security Scans** | **Self-hosted** (`[self-hosted, linux, deploy]`) | Isolamento na infra própria, compliance |
| **Deploy** | **Self-hosted** (`[self-hosted, linux, deploy]`) | Acesso SSH ao servidor de produção |

### Todos os Workflows

**Todos os jobs** em todos os workflows usam runner próprio:

```yaml
deploy:
  name: Deploy Hetzner Cloud
  runs-on: [self-hosted, linux, deploy]  # ← Runner próprio
```

Todos os outros jobs usam GitHub-hosted:
- `validate-trigger`: `ubuntu-latest`
- `code-quality`: `ubuntu-latest`
- `security-scan`: `ubuntu-latest`
- `build-docker`: `ubuntu-latest` (builds Docker)
- `image-security-scan`: `ubuntu-latest`
- `health-check`: `ubuntu-latest`

## Como Verificar se o Runner Próprio Está Sendo Usado

### 1. Verificar na Interface do GitHub Actions

1. Acesse: `https://github.com/fillipeguerrabtc/alice/actions`
2. Selecione um workflow run do `deploy-production.yml`
3. Expanda o job `Deploy Hetzner Cloud`
4. Procure por:
   - Runner: `self-hosted` ou nome do runner
   - Labels: `self-hosted, linux, deploy`

**✅ Se mostrar "self-hosted runner":** Está usando runner próprio  
**❌ Se mostrar "ubuntu-latest":** Está usando GitHub-hosted (erro de configuração)

### 2. Verificar Status do Runner no Deploy Server

```bash
# Conectar ao Deploy Server
ssh alice-hetzner  # Ou: ssh -i ~/.ssh/alice-deploy root@5.78.77.83

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

- Todos os jobs rodam no runner próprio (Deploy Server CX22)

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
- **Deploy Server**: Hetzner CX22 (servidor dedicado para runner)
- **Pipeline**: Builds Docker grandes (PyTorch, CUDA, ~50 imagens)
- **Necessidade**: Controle total, custos previsíveis, compliance

### Migração Implementada ✅

**Justificativa da migração:**

1. **Custos**: Servidor CX22 já estava pago, usar apenas para deploy era subutilização
2. **Builds grandes**: Docker builds com PyTorch/CUDA se beneficiam de recursos dedicados
3. **Cache**: Registry Cache GHCR funciona igualmente bem (não depende do tipo de runner)
4. **Compliance**: Dados e builds ficam 100% na infraestrutura própria
5. **Performance**: Recursos dedicados, sem rate limits do GitHub
6. **Melhores práticas 2025**: Tendência para self-hosted em projetos enterprise

**Mudanças implementadas:**

1. ✅ Todos os workflows atualizados para usar `runs-on: [self-hosted, linux, deploy]`
2. ✅ Runner CX22 configurado com labels corretas
3. ✅ Registry Cache GHCR mantido (já configurado) para otimizar builds
4. ✅ Documentação atualizada

### Workflows Migrados

- ✅ **ci.yml**: Todos os jobs migrados
- ✅ **release.yml**: Todos os jobs migrados
- ✅ **deploy-production.yml**: Todos os jobs migrados

## Conclusão

**Estado Atual:** **100% Self-Hosted** ✅ (Implementado 27/12/2025)

**Benefícios:**
- Controle total sobre ambiente de execução
- Custos previsíveis (servidor fixo)
- Compliance completo (dados na infra própria)
- Performance otimizada (recursos dedicados)
- Cache enterprise (Registry Cache GHCR)
