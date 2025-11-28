# Alice - Plataforma Enterprise de IA Autônoma

## Visão Geral

Alice é uma plataforma enterprise de IA autônoma pronta para produção, alimentada pelo modelo **Llama 4 Maverick (400B parâmetros)** hospedado no Salad Cloud. Seu propósito principal é fornecer uma solução de IA totalmente autônoma que resolve desafios críticos empresariais:

- **Privacidade Absoluta**: Todos os dados permanecem na infraestrutura controlada
- **Custos Previsíveis**: Sem cobranças por token de terceiros
- **Customização Ilimitada**: Capacidades de fine-tuning para necessidades específicas

A plataforma resolve problemas de dependência de APIs externas (mudanças de preço, descontinuações), preocupações de privacidade com servidores de terceiros, e custos imprevisíveis associados à cobrança por tokens.

Capacidades principais: chat em tempo real com streaming, deduplicação, multi-tenancy, RBAC (Controle de Acesso Baseado em Função), backend RAG para embeddings e busca vetorial, e integrações com pagamentos (Stripe, Wise), CRM (ERPNext), e comunicação (Twilio, Resend). A plataforma também possui capacidades avançadas de IA como geração de imagens (FLUX.1 Schnell), auto-aprendizado agressivo, e stack de observabilidade robusto.

---

## Preferências do Usuário

### 16 Regras Fundamentais

| # | Regra | Descrição |
|---|-------|-----------|
| 1 | **LER ANTES DE AGIR** | Inspecionar arquivos antes de implementar |
| 2 | **NÃO DUPLICAR** | Verificar código existente primeiro |
| 3 | **WORKFLOW ESTRUTURADO** | Diagnóstico → Plano → Aprovação → Implementação |
| 4 | **APROVAÇÃO OBRIGATÓRIA** | Pedir aprovação antes de mudanças grandes |
| 5 | **NÃO MENTIR** | Dizer "não sei" quando não souber |
| 6 | **SEM SOLUÇÕES TEMPORÁRIAS** | **PROIBIDO**: workarounds, mocks, dados hardcoded, in-memory storage, valores default falsos. TODA lógica deve ser enterprise-grade com persistência real em PostgreSQL |
| 7 | **MUDANÇAS CIRÚRGICAS** | Diagnosticar causa raiz antes de agir. Analisar impacto em componentes dependentes. Implementar mudança isolada. |
| 8 | **QUALIDADE OBRIGATÓRIA** | TypeScript strict, zero any, Pino |
| 9 | **VALIDAÇÃO CONTÍNUA** | Testar após cada micro-passo |
| 10 | **DOCUMENTAÇÃO PT-BR** | TODA documentação em português |
| 11 | **SEGUIR DOCS OFICIAIS** | Melhores práticas 2025 |
| 12 | **PRODUÇÃO HETZNER** | Deploy via GitHub Actions |
| 13 | **INTERNACIONALIZAÇÃO** | PT-BR primário, EN secundário |
| 14 | **VERIFICAR SECRETS** | Checar variáveis existentes |
| 15 | **MICROSSERVIÇOS** | Código em apps/, compartilhado em packages/ |
| 16 | **MELHORES PRÁTICAS** | API Gateway, health checks, circuit breakers |

### Preferências de Idioma

| Contexto | Idioma |
|----------|--------|
| Documentação | Português Brasileiro |
| Comentários no código | Português Brasileiro |
| Mensagens de log | Português Brasileiro |
| Nomes de variáveis | Inglês |
| Termos técnicos | Inglês (OAuth, JWT, etc.) |

### Ambiente de Desenvolvimento vs Produção

| Ambiente | Local | Propósito | Regras |
|----------|-------|-----------|--------|
| DESENVOLVIMENTO | Replit | IDE e preview de UI | Dados de preview permitidos APENAS em `server/index-dev.ts` |
| PRODUÇÃO | Hetzner Cloud | Sistema enterprise real | **PROIBIDO** mocks/hardcoded (Regra 6) |

**IMPORTANTE**: Código em `apps/` (microsserviços) vai para produção via GitHub Actions. `server/index-dev.ts` é APENAS para preview no Replit e NÃO é deployado para produção.

---

## Arquitetura do Sistema

Alice emprega arquitetura de microsserviços, com cada serviço rodando em seu próprio container e comunicando via API Gateway (Traefik). O sistema prioriza soluções enterprise-grade, privacidade de dados e escalabilidade.

### Microsserviços

| Serviço | Porta | Função |
|---------|-------|--------|
| `frontend` | 5000 | React SPA |
| `api-gateway` | 80/443 | Traefik |
| `auth` | 3001 | OAuth/SAML, auth local, RBAC |
| `chat` | 3002 | LLM, WebSocket, streaming, persistência |
| `rag` | 3003 | Embeddings, busca vetorial |
| `training` | 3004 | Coleta de dados, deduplicação, fine-tuning |
| `integrations` | 3005 | Proxies de serviços externos |
| `observability` | 3007/9090/3000/16686 | Stack de monitoramento |

### Decisões UI/UX

- **Frontend**: React 18, TypeScript 5, Vite 5, shadcn/ui, Tailwind CSS
- **Internacionalização**: Suporta PT-BR (primário) e EN usando `react-i18next`
- **Dashboard IA**: Métricas de conversas, imagens, SLA, e circuit breakers
- **Painel Takeover/Handover**: Construído dentro do dashboard Alice para agentes humanos, integrando interações Web e WhatsApp

### Implementações Técnicas

#### Autenticação
- OAuth 2.0: Google, GitHub, Microsoft
- SAML 2.0: Azure AD, Okta
- Auth local com bcrypt
- Sistema RBAC de 6 níveis (super_admin, admin, manager, operator, viewer, guest)

#### Chat em Tempo Real
- WebSockets para streaming de tokens LLM
- Interação em tempo real garantida

#### Backend RAG
- Salad Cloud para embeddings
- pgvector para busca vetorial
- Chunking: 500 caracteres com 50 de overlap
- Circuit breaker: 30s/50%/30s

#### Geração de Imagens
- FLUX.1 Schnell (Apache 2.0)
- Self-hosted no Salad Cloud com GPUs RTX 3090/4090
- Imagens aprovadas contribuem para treinamento via Progressive LoRA
- Object Storage combinado com embeddings CLIP para RAG multimodal

#### Embeddings Multimodais
- CLIP ViT-L/14 (licença MIT)
- Self-hosted no Salad Cloud
- Embeddings de 768 dimensões para busca cross-modal

#### Takeover/Handover
- Painel customizado integrado ao dashboard
- Triggers automáticos baseados em scores de confiança, fallbacks e análise de sentimento

#### CI/CD
- Pipeline automatizado no GitHub Actions
- Build, push de imagens Docker, deploy SSH para Hetzner, health checks

---

## Produção (Hetzner Cloud)

### Informações do Servidor

| Parâmetro | Valor |
|-----------|-------|
| Provedor | Hetzner Cloud |
| Servidor | CX43 |
| vCPUs | 8 |
| RAM | 16GB |
| SSD | 160GB |
| IPv4 | **46.224.46.93** |
| Domínio Alice | https://yesyoudeserve.duckdns.org |
| Domínio ERPNext | https://erp.yesyoudeserve.duckdns.org |

### Acesso SSH

```bash
# Configurar chave SSH (executar uma vez por sessão Replit)
bash infra/scripts/setup-ssh-key.sh

# Acessar servidor
ssh root@46.224.46.93
```

### Scripts de Infraestrutura

Localização: `infra/scripts/`

| Script | Função |
|--------|--------|
| `setup-ssh-key.sh` | Configura chave SSH para acesso ao servidor Hetzner |
| `setup-hetzner.sh` | Provisiona servidor Hetzner com Docker e dependências |
| `setup-ssl.sh` | Configura certificados SSL/TLS via Let's Encrypt |
| `backup.sh` | Backup do banco de dados e volumes Docker |
| `restore.sh` | Restaura backup do banco de dados |

### Pipeline CI/CD

1. Push para branch main
2. Build imagens Docker
3. Push para GHCR (GitHub Container Registry)
4. Deploy SSH para Hetzner
5. Health checks

---

## Dependências Externas

### Salad Cloud

| Componente | Modelo | Função |
|------------|--------|--------|
| LLM | Llama 4 Maverick (400B params) | Capacidades core de IA (entrada multimodal, saída texto) |
| Embeddings | text-embedding-3-small | Para RAG |
| Geração de Imagens | FLUX.1 Schnell (Apache 2.0) | Criação de conteúdo visual |
| Inferência CLIP | CLIP ViT-L/14 (MIT) | Embeddings multimodais (container group self-hosted) |

### Integrações

| Serviço | Função |
|---------|--------|
| Stripe Portugal | Pagamentos EUR via SEPA, integração webhook |
| Wise | Transferências globais em 50+ moedas |
| ERPNext | CRM e ERP integrado (usa `frappe_docker`) |
| Twilio | Comunicação WhatsApp e SMS |
| Resend | Serviços de email transacional |
| PostgreSQL | Banco primário com extensão pgvector |
| Prometheus 3.0 | Coleta de métricas e alertas |
| Grafana OSS 11.3 | Dashboards e visualização |
| Jaeger 1.62 | Tracing distribuído |
| OpenTelemetry Collector | Instrumentação unificada |
| Langfuse 2.x | Métricas específicas de LLM |
| Traefik | API Gateway para roteamento e terminação SSL |
| GitHub Actions | Pipelines CI/CD |

---

## Secrets

### Categorias

| Categoria | Secrets |
|-----------|---------|
| Database | DATABASE_URL |
| Sessão | SESSION_SECRET |
| Salad | SALAD_API_KEY |
| Stripe | STRIPE_SECRET_KEY |
| Wise | WISE_API_KEY |
| OAuth | GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET |
| Twilio | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN |
| Resend | RESEND_API_KEY |
| GitHub | GH_PAT (Personal Access Token) |

---

## Padrões de Código

### Logging

Usar **Pino**. `console.log` é **PROIBIDO**.

### TypeScript

Modo **strict**. `any` é **PROIBIDO**.

### Health Check

**Obrigatório** em `/api/servico/health` para todos os serviços.

---

## TypeScript Build System - SOLUÇÃO ENTERPRISE (28/11/2024)

### Problema Original

Dois problemas críticos identificados:

1. **pnpm deploy não copiava pacotes internos**: Os pacotes `@alice/shared`, `@alice/database`, etc. não eram incluídos no container final
2. **Ordem de build incorreta**: O script `build:packages` usava `--stream` (paralelo), causando `@alice/database` tentar compilar antes de `@alice/shared` existir

Erros resultantes:
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/packages/shared/src/schema'
error TS2307: Cannot find module '@alice/shared' or its corresponding type declarations
```

### Solução Implementada: esbuild Bundling + Topological Sort

#### Correção 1: Ordem de Build + Limpeza de Cache (package.json)

```json
// ANTES (paralelo - causava erro de ordem)
"build:packages": "pnpm --filter '@alice/*' --stream run build"

// DEPOIS (cross-platform cleanup + topological sort)
"build:packages": "node -e \"...cleanup...\" && pnpm -r --filter '@alice/*' run build"
```

**Duas correções combinadas:**
1. **Limpeza cross-platform**: Script Node.js inline deleta `.tsbuildinfo` de todos os pacotes antes do build (evita builds incrementais que "skipam" emissão)
2. **Topological sort**: Flag `-r` (recursive) do pnpm respeita ordem de dependências, garantindo `@alice/shared` → `@alice/database` → serviços

#### Correção 2: Dockerfiles Enterprise 3-Stage

Arquitetura de 3 stages nos Dockerfiles:

1. **Builder Stage**: Instala todas as deps com `--frozen-lockfile`, compila pacotes, cria bundle com esbuild
2. **Pruner Stage**: Usa `pnpm deploy --prod` para extrair dependências de produção (determinístico)
3. **Runner Stage**: Copia `node_modules` do pruner + `bundle.js` do builder

### Arquivos Criados/Modificados

| Arquivo | Função |
|---------|--------|
| `scripts/build-service.mjs` | Script de build com esbuild para microsserviços |
| `package.json` | Script `build:packages` corrigido para ordem topológica |
| `apps/*/package.json` | Scripts atualizados: `build` usa esbuild |
| `apps/*/Dockerfile` | Dockerfiles enterprise 3-stage (builder → pruner → runner) |
| `packages/*/tsconfig.json` | TypeScript project references configuradas |

### Dependências Entre Pacotes

```
@alice/shared          (base - sem dependências internas)
    ↓
@alice/database        (depende de shared)
    ↓
@alice/config          (depende de shared)
@alice/logger          (depende de shared)
@alice/shared-utils    (depende de shared)
    ↓
Serviços (auth, chat, rag, training, integrations)
```

### Comando de Build

```bash
# Build de todos os pacotes e serviços (ordem topológica)
pnpm run build:packages

# Build de um serviço específico
node scripts/build-service.mjs auth-service
```

### Tamanho dos Bundles

| Serviço | Tamanho | Dependências Externas |
|---------|---------|----------------------|
| auth-service | 121.2kb | 32 pacotes |
| chat-service | 303.9kb | 17 pacotes |
| rag-service | 323.3kb | 17 pacotes |
| training-service | 274.8kb | 15 pacotes |
| integrations-service | 295.2kb | 16 pacotes |

### Servidor Limpo (28/11/2024)

O servidor Hetzner foi **completamente limpo** para o próximo deploy:
- 0 containers
- 0 imagens
- 0 volumes
- Disco: 2.5G usado de 150G (2%)

### Correção pnpm v10 - inject-workspace-packages (28/11/2024)

**Problema**: pnpm v10 mudou comportamento de `pnpm deploy` em workspaces.

**Erro no CI**:
```
ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE  By default, starting from pnpm v10, 
we only deploy from workspaces that have "inject-workspace-packages=true" set
```

**Solução**: Criado arquivo `.npmrc` na raiz do projeto com:
```
inject-workspace-packages=true
```

Esta configuração permite que `pnpm deploy` funcione corretamente dentro dos containers Docker, injetando automaticamente as dependências do workspace (`@alice/shared`, `@alice/database`, etc.).

---

*Documento em Português Brasileiro*
*Versão 5.5 - Novembro 2025*
