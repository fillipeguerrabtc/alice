# Plano de Migração: Deploy SSH → Enterprise-Grade

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0

## Análise da Situação Atual

### Problemas Identificados

1. **Deploy via SSH (`appleboy/ssh-action`)**
   - ❌ Scripts inline no workflow (difícil manutenção e versionamento)
   - ❌ Sem cache local de imagens Docker (pull do GHCR toda vez)
   - ❌ Sem versionamento automático de infraestrutura
   - ❌ Rollback manual baseado em arquivos de manifesto
   - ❌ Falta de auditoria e rastreabilidade completa
   - ❌ Dependência de SSH keys (menos seguro que OIDC)

2. **Versionamento**
   - ⚠️ Tags baseadas em SHA (não semântico)
   - ⚠️ Sem versionamento de configuração de infraestrutura
   - ⚠️ Rollback não versionado

3. **Cache**
   - ⚠️ Imagens Docker baixadas do GHCR toda vez (lento)
   - ⚠️ Sem registry local no Hetzner
   - ⚠️ Dependências não cacheadas localmente

## Solução Enterprise-Grade (2025/2026)

### Opção 1: GitHub Actions Self-Hosted Runner (Recomendada)

**Benefícios:**
- ✅ Execução direta no servidor Hetzner (zero latência)
- ✅ Acesso direto a Docker, GPU, volumes
- ✅ Sem necessidade de SSH keys (usa tokens OIDC)
- ✅ Integração nativa com GitHub Actions
- ✅ Logs e métricas centralizados no GitHub
- ✅ Cache local de imagens Docker
- ✅ Versionamento automático via Git tags

**Arquitetura:**
```
GitHub Actions (Cloud)
    ↓ (jobs executam no runner)
Hetzner GPU Server (Self-Hosted Runner)
    ↓ (executa diretamente)
Docker Compose (50 containers)
```

**Implementação:**
1. Instalar GitHub Actions runner no servidor Hetzner
2. Configurar runner como `self-hosted`
3. Migrar jobs de deploy para usar `runs-on: self-hosted`
4. Remover dependência de SSH keys

### Opção 2: GitOps com ArgoCD (Avançada)

**Benefícios:**
- ✅ Deploy automático baseado em commits Git
- ✅ Versionamento completo de infraestrutura
- ✅ Rollback automático via `git revert`
- ✅ Auditoria completa (quem, quando, o quê)
- ✅ Sync automático (detecta mudanças no Git)

**Arquitetura:**
```
GitHub Repository
    ↓ (push de mudanças)
ArgoCD (monitora Git)
    ↓ (aplica mudanças)
Kubernetes/Docker Compose
```

**Implementação:**
1. Instalar ArgoCD no servidor Hetzner
2. Migrar docker-compose para Helm charts
3. Configurar ArgoCD para monitorar repositório Git
4. Deploy automático via Git push

### Opção 3: Docker Registry Local (Cache Enterprise)

**Benefícios:**
- ✅ Cache local de imagens (10-100x mais rápido)
- ✅ Reduz tráfego de rede
- ✅ Versionamento automático de imagens
- ✅ Replicação automática do GHCR

**Implementação:**
1. Instalar Harbor/Portus no servidor Hetzner
2. Configurar replicação do GHCR
3. Atualizar docker-compose para usar registry local

## Recomendação: Abordagem Híbrida

### Fase 1: Self-Hosted Runner (Prioritária - Semana 1)

**Por quê primeiro:**
- Maior impacto imediato (zero latência, sem SSH)
- Implementação mais simples
- Remove dependência de SSH keys
- Mantém compatibilidade com workflow atual

**Implementação:**
```bash
# No servidor Hetzner
cd /opt/alice
mkdir actions-runner && cd actions-runner
curl -o actions-runner-linux-x64-2.311.0.tar.gz -L \
  https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz
tar xzf ./actions-runner-linux-x64-2.311.0.tar.gz

# Configurar runner
./config.sh --url https://github.com/USERNAME/REPO \
  --token TOKEN \
  --name hetzner-gpu-runner \
  --work /opt/alice/actions-runner/_work \
  --labels hetzner,gpu,self-hosted

# Instalar como serviço systemd
sudo ./svc.sh install
sudo ./svc.sh start
```

**Workflow atualizado:**
```yaml
jobs:
  deploy:
    runs-on: self-hosted  # Runner no Hetzner GPU Server
    steps:
      - uses: actions/checkout@v4
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

### Fase 2: Docker Registry Local (Semana 2)

**Por quê segundo:**
- Melhora significativa de performance (cache local)
- Reduz dependência de GHCR
- Facilita rollback (imagens locais)

**Implementação:**
```yaml
# docker-compose.registry.yml
services:
  registry:
    image: registry:2.8.3
    ports:
      - "5000:5000"
    volumes:
      - registry-data:/var/lib/registry
    environment:
      REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY: /var/lib/registry
      
  registry-proxy:
    image: nginx:alpine
    ports:
      - "443:443"
    volumes:
      - ./registry-nginx.conf:/etc/nginx/nginx.conf
```

### Fase 3: GitOps com ArgoCD (Opcional - Futuro)

**Por quê terceiro:**
- Requer migração para Kubernetes (mais complexo)
- Benefícios maiores para ambientes multi-servidor
- Pode ser adicionado depois sem impacto

## Comparação: SSH vs Enterprise

| Aspecto | SSH (Atual) | Self-Hosted Runner | GitOps (ArgoCD) |
|---------|-------------|-------------------|-----------------|
| **Latência** | ~500ms-2s | ~0ms | ~0ms |
| **Segurança** | SSH keys | OIDC tokens | OIDC tokens |
| **Versionamento** | Manual | Git tags | Git + Helm |
| **Cache** | Sem cache | Cache local | Cache local |
| **Rollback** | Manual | Git revert | Git revert |
| **Auditoria** | Logs SSH | GitHub Actions | ArgoCD + Git |
| **Manutenção** | Scripts inline | Scripts organizados | IaC (Helm) |
| **Complexidade** | Baixa | Média | Alta |
| **Tempo de Implementação** | - | 1 semana | 3-4 semanas |

## Plano de Implementação Detalhado

### Semana 1: Self-Hosted Runner

**Dia 1-2: Setup do Runner**
- [ ] Instalar GitHub Actions runner no Hetzner
- [ ] Configurar como serviço systemd
- [ ] Testar conexão com GitHub
- [ ] Configurar labels e grupos

**Dia 3-4: Migração do Workflow**
- [ ] Criar novo job `deploy-self-hosted`
- [ ] Migrar steps de deploy para runner local
- [ ] Remover dependência de SSH keys
- [ ] Testar deploy em ambiente de staging

**Dia 5: Validação e Rollout**
- [ ] Testar deploy completo
- [ ] Validar health checks
- [ ] Documentar processo
- [ ] Fazer deploy em produção

### Semana 2: Docker Registry Local

**Dia 1-2: Setup do Registry**
- [ ] Instalar Harbor/Portus
- [ ] Configurar replicação do GHCR
- [ ] Configurar autenticação
- [ ] Testar pull/push de imagens

**Dia 3-4: Integração**
- [ ] Atualizar docker-compose para usar registry local
- [ ] Configurar cache de imagens
- [ ] Testar deploy com cache local
- [ ] Medir performance (antes/depois)

**Dia 5: Otimização**
- [ ] Configurar retenção de imagens
- [ ] Configurar limpeza automática
- [ ] Documentar processo
- [ ] Fazer deploy em produção

## Benefícios Esperados

### Performance
- **Deploy 10-100x mais rápido** (cache local + zero latência)
- **Pull de imagens 10-100x mais rápido** (registry local)
- **Builds mais rápidos** (cache de layers)

### Segurança
- **Sem SSH keys** (usa OIDC tokens)
- **Auditoria completa** (GitHub Actions logs)
- **Secrets gerenciados** (GitHub Secrets)

### Manutenibilidade
- **Scripts organizados** (não inline)
- **Versionamento automático** (Git tags)
- **Rollback automático** (Git revert)

### Escalabilidade
- **Kubernetes ready** (preparado para futuro)
- **Multi-runner support** (escalar horizontalmente)
- **Auto-scaling** (com Kubernetes)

## Próximos Passos

1. **Revisar este plano** e aprovar abordagem
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

