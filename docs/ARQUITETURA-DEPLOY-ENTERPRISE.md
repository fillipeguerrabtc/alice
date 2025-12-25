# Arquitetura de Deploy Enterprise - Hetzner Cloud

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0

## Visão Geral

Este documento descreve a arquitetura enterprise-grade para deploy automatizado da Alice Platform no Hetzner Cloud, seguindo as melhores práticas de 2025/2026.

## Problemas da Abordagem Atual (SSH)

### Limitações Identificadas

1. **Deploy via SSH (`appleboy/ssh-action`)**
   - ❌ Scripts inline no workflow (difícil manutenção)
   - ❌ Sem versionamento automático de infraestrutura
   - ❌ Cache de imagens Docker não otimizado (pull toda vez)
   - ❌ Sem integração nativa com Hetzner Cloud API
   - ❌ Rollback manual baseado em commits (não versionado)
   - ❌ Falta de auditoria e rastreabilidade completa

2. **Versionamento**
   - ⚠️ Tags de imagens baseadas em SHA (não semântico)
   - ⚠️ Sem versionamento de configuração de infraestrutura
   - ⚠️ Rollback baseado em arquivos de manifesto (não versionado)

3. **Cache**
   - ⚠️ Imagens Docker são baixadas do GHCR toda vez
   - ⚠️ Sem registry local no Hetzner para cache
   - ⚠️ Dependências não são cacheadas localmente

## Solução Enterprise-Grade (2025/2026)

### Arquitetura Proposta

```
┌─────────────────────────────────────────────────────────────────┐
│                    GITHUB ACTIONS (Cloud)                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Build & Push Images → GHCR (com cache registry)          │  │
│  │  Security Scan (Trivy)                                    │  │
│  │  Generate Infrastructure Config (Terraform/Helm)          │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────┬──────────────────────────────────────┘
                             │
                             │ Git Push (Infrastructure as Code)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              HETZNER GPU SERVER (Self-Hosted Runner)             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  GitHub Actions Self-Hosted Runner                        │  │
│  │  - Executa jobs diretamente no servidor                    │  │
│  │  - Zero latência de rede                                   │  │
│  │  - Acesso direto a Docker/GPU                              │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Docker Registry Local (Harbor/Portus)                    │  │
│  │  - Cache de imagens do GHCR                               │  │
│  │  - Pull local (10-100x mais rápido)                        │  │
│  │  - Versionamento automático                                │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  GitOps Controller (ArgoCD/Flux)                          │  │
│  │  - Monitora repositório Git                               │  │
│  │  - Deploy automático baseado em commits                   │  │
│  │  - Rollback automático via Git revert                     │  │
│  │  - Versionamento completo de infraestrutura               │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Docker Compose (ou Kubernetes)                           │  │
│  │  - 50 containers gerenciados                              │  │
│  │  - Health checks automáticos                               │  │
│  │  - Rollback automático                                    │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Componentes Enterprise

### 1. GitHub Actions Self-Hosted Runner

**Benefícios:**
- ✅ Execução direta no servidor Hetzner (zero latência)
- ✅ Acesso direto a Docker, GPU, volumes
- ✅ Sem necessidade de SSH keys
- ✅ Integração nativa com GitHub Actions
- ✅ Logs e métricas centralizados no GitHub

**Implementação:**
```yaml
# .github/workflows/deploy-production.yml
jobs:
  deploy:
    runs-on: self-hosted  # Runner no Hetzner GPU Server
    steps:
      - uses: actions/checkout@v4
      - name: Deploy
        run: |
          # Executa diretamente no servidor
          docker compose up -d
```

**Setup do Runner:**
```bash
# No servidor Hetzner
mkdir actions-runner && cd actions-runner
curl -o actions-runner-linux-x64-2.311.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz
tar xzf ./actions-runner-linux-x64-2.311.0.tar.gz
./config.sh --url https://github.com/USERNAME/REPO --token TOKEN
./run.sh
```

### 2. Docker Registry Local (Harbor/Portus)

**Benefícios:**
- ✅ Cache local de imagens (10-100x mais rápido)
- ✅ Reduz tráfego de rede (não baixa do GHCR toda vez)
- ✅ Versionamento automático de imagens
- ✅ Replicação automática do GHCR
- ✅ Scanning de vulnerabilidades local

**Implementação:**
```yaml
# docker-compose.registry.yml
services:
  harbor:
    image: goharbor/harbor-core:v2.10.0
    ports:
      - "5000:5000"
    environment:
      REGISTRY_URL: harbor.local
      REGISTRY_REPLICATION: |
        - name: ghcr
          type: docker-hub
          url: https://ghcr.io
          username: ${GITHUB_ACTOR}
          password: ${GITHUB_TOKEN}
```

### 3. GitOps com ArgoCD

**Benefícios:**
- ✅ Deploy automático baseado em commits Git
- ✅ Versionamento completo de infraestrutura
- ✅ Rollback automático via `git revert`
- ✅ Auditoria completa (quem, quando, o quê)
- ✅ Sync automático (detecta mudanças no Git)

**Implementação:**
```yaml
# argocd-app.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: alice-platform
spec:
  project: default
  source:
    repoURL: https://github.com/USERNAME/alice
    targetRevision: main
    path: infra/docker
  destination:
    server: https://kubernetes.default.svc
    namespace: alice
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

### 4. Versionamento Automático

**Estratégia:**
- **Imagens Docker**: Tags semânticas (`v1.0.0`) + SHA (`v1.0.0-abc1234`)
- **Infraestrutura**: Git tags + Helm charts versionados
- **Configuração**: ConfigMaps versionados no Kubernetes

**Exemplo:**
```yaml
# .github/workflows/release.yml
- name: Create Release
  uses: actions/create-release@v1
  with:
    tag_name: v${{ github.run_number }}
    release_name: Release v${{ github.run_number }}
    
- name: Tag Images
  run: |
    docker tag ${IMAGE}:latest ${IMAGE}:v${{ github.run_number }}
    docker tag ${IMAGE}:latest ${IMAGE}:v${{ github.run_number }}-${GITHUB_SHA::7}
    docker push ${IMAGE}:v${{ github.run_number }}
    docker push ${IMAGE}:v${{ github.run_number }}-${GITHUB_SHA::7}
```

### 5. Cache Enterprise

**Estratégias:**
1. **Registry Cache**: Harbor replica imagens do GHCR
2. **Layer Cache**: Docker BuildKit cache local
3. **Dependency Cache**: pnpm/npm cache em volume persistente
4. **Build Cache**: GitHub Actions cache para builds

**Implementação:**
```yaml
# .github/workflows/deploy-production.yml
- name: Setup pnpm cache
  uses: actions/cache@v4
  with:
    path: ~/.pnpm-store
    key: pnpm-${{ runner.os }}-${{ hashFiles('**/pnpm-lock.yaml') }}
    
- name: Build with cache
  run: |
    docker buildx build \
      --cache-from type=local,src=/tmp/.buildx-cache \
      --cache-to type=local,dest=/tmp/.buildx-cache,mode=max \
      -t ${IMAGE}:${TAG} .
```

## Comparação: SSH vs Enterprise

| Aspecto | SSH (Atual) | Enterprise (Proposto) |
|---------|-------------|----------------------|
| **Latência** | ~500ms-2s (rede) | ~0ms (local) |
| **Versionamento** | Manual (commits) | Automático (Git tags + Helm) |
| **Cache** | Sem cache local | Registry local (10-100x mais rápido) |
| **Rollback** | Manual (scripts) | Automático (Git revert) |
| **Auditoria** | Logs SSH | GitHub Actions + ArgoCD |
| **Manutenção** | Scripts inline | Infrastructure as Code |
| **Segurança** | SSH keys | OIDC + Runner tokens |
| **Escalabilidade** | Manual | Automático (Kubernetes) |

## Migração Gradual

### Fase 1: Self-Hosted Runner (Semana 1)
- ✅ Instalar GitHub Actions runner no Hetzner
- ✅ Migrar jobs de deploy para `runs-on: self-hosted`
- ✅ Remover dependência de SSH keys

### Fase 2: Registry Local (Semana 2)
- ✅ Instalar Harbor/Portus
- ✅ Configurar replicação do GHCR
- ✅ Atualizar docker-compose para usar registry local

### Fase 3: GitOps (Semana 3-4)
- ✅ Instalar ArgoCD
- ✅ Migrar docker-compose para Helm charts
- ✅ Configurar sync automático

### Fase 4: Kubernetes (Opcional - Futuro)
- ✅ Migrar de Docker Compose para Kubernetes
- ✅ Auto-scaling baseado em métricas
- ✅ High availability automático

## Benefícios Finais

1. **Performance**
   - Deploy 10-100x mais rápido (cache local)
   - Zero latência de rede (runner local)

2. **Confiabilidade**
   - Rollback automático (Git revert)
   - Health checks automáticos
   - Self-healing (ArgoCD)

3. **Manutenibilidade**
   - Infrastructure as Code (Git versionado)
   - Scripts organizados (não inline)
   - Documentação automática

4. **Segurança**
   - OIDC (sem SSH keys)
   - Auditoria completa
   - Secrets gerenciados (HashiCorp Vault)

5. **Escalabilidade**
   - Kubernetes ready
   - Auto-scaling
   - Multi-region support

## Próximos Passos

1. **Revisar esta proposta** e aprovar arquitetura
2. **Implementar Fase 1** (Self-Hosted Runner)
3. **Testar em ambiente de staging**
4. **Migrar produção gradualmente**
5. **Documentar processo completo**

---

**Referências:**
- [GitHub Actions Self-Hosted Runners](https://docs.github.com/en/actions/hosting-your-own-runners)
- [Harbor Registry](https://goharbor.io/)
- [ArgoCD GitOps](https://argo-cd.readthedocs.io/)
- [Hetzner Cloud API](https://docs.hetzner.cloud/)

