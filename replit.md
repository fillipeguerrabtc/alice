# Alice - Plataforma Enterprise de IA Autônoma

## Sumário

1. [Visão Geral do Projeto](#visão-geral-do-projeto)
2. [Regras Críticas](#regras-críticas)
3. [Estado Atual](#estado-atual)
4. [Arquitetura](#arquitetura)
5. [Serviços](#serviços)
6. [Integrações](#integrações)
7. [Segurança](#segurança)
8. [Infraestrutura](#infraestrutura)

---

## Visão Geral do Projeto

### O Que é a Alice?

Alice é uma plataforma enterprise de inteligência artificial autônoma, pronta para produção. Utiliza o modelo **Llama 4 Maverick (400B parâmetros)** hospedado na Salad Cloud, garantindo:

- **Autonomia Total**: Sem dependência de APIs externas
- **Privacidade Absoluta**: Dados nunca saem da infraestrutura controlada
- **Custos Previsíveis**: Sem cobrança por token de terceiros
- **Customização Ilimitada**: Fine-tuning específico para cada cliente

### Problema Resolvido

1. **Dependência de Terceiros**: APIs externas podem mudar preços ou descontinuar
2. **Privacidade de Dados**: Dados sensíveis em servidores de terceiros
3. **Custos Imprevisíveis**: Cobrança por token gera faturas astronômicas

---

## Regras Críticas

### As 16 Regras Fundamentais

| Número | Regra | Descrição |
|--------|-------|-----------|
| 1 | LER ANTES DE AGIR | Inspecionar arquivos antes de implementar |
| 2 | NÃO DUPLICAR | Verificar código existente primeiro |
| 3 | WORKFLOW ESTRUTURADO | Diagnóstico → Plano → Aprovação → Implementação |
| 4 | APROVAÇÃO OBRIGATÓRIA | Pedir aprovação antes de mudanças grandes |
| 5 | NÃO MENTIR | Dizer "não sei" quando não souber |
| 6 | SEM SOLUÇÕES TEMPORÁRIAS | **PROIBIDO**: workarounds, mocks, dados hardcoded, in-memory storage, valores default falsos. TODA lógica deve ser enterprise-grade com persistência real em PostgreSQL |
| 7 | DADOS OFICIAIS | Foco cirúrgico no problema e melhores praticas das documentaçoes oficiais atuais |
| 8 | QUALIDADE OBRIGATÓRIA | TypeScript strict, zero any, Pino |
| 9 | VALIDAÇÃO CONTÍNUA | Testar após cada micro-passo |
| 10 | DOCUMENTAÇÃO PT-BR | TODA documentação em português |
| 11 | SEGUIR DOCS OFICIAIS | Melhores práticas 2025 |
| 12 | PRODUÇÃO HETZNER | Deploy via GitHub Actions |
| 13 | INTERNACIONALIZAÇÃO | PT-BR primário, EN secundário |
| 14 | VERIFICAR SECRETS | Checar variáveis existentes |
| 15 | MICROSSERVIÇOS | Código em apps/, compartilhado em packages/ |
| 16 | MELHORES PRÁTICAS | API Gateway, health checks, circuit breakers |

### Preferências de Idioma

| Contexto | Idioma |
|----------|--------|
| Documentação | Português Brasileiro |
| Comentários no código | Português Brasileiro |
| Mensagens de log | Português Brasileiro |
| Nomes de variáveis | Inglês |
| Termos técnicos | Inglês (OAuth, JWT, etc.) |

---

## Estado Atual

### Funcionalidades em Produção

| Capacidade | Status | Descrição |
|------------|--------|-----------|
| Modelo de IA | Produção | Llama 4 Maverick via Salad Cloud |
| Chat Tempo Real | Produção | WebSocket com streaming |
| Deduplicação | Produção | SemHash para dados duplicados |
| Multi-tenant | Produção | Isolamento por tenant_id |
| RBAC | Produção | 6 níveis de permissão |
| RAG Backend | Produção | Embeddings e busca vetorial |
| Stripe | Produção | Receber pagamentos EUR |
| Wise | Produção | Enviar pagamentos globais |
| ERPNext | Produção | CRM integrado |
| Twilio | Produção | WhatsApp e SMS |
| Resend | Produção | Email transacional |
| Autenticação | Produção | OAuth 2.0 e SAML 2.0 |
| Traefik | Produção | Gateway com SSL |
| CI/CD | Produção | GitHub Actions |

### Em Desenvolvimento

| Capacidade | Progresso |
|------------|-----------|
| Integração RAG + Chat | 80% |
| Dashboard Admin | 100% |
| Detecção de Geração de Imagem | 100% |
| Auto-aprendizado Agressivo | 100% |
| FLUX.1 Schnell (Imagens) | 100% |
| Observability Stack | 100% |
| Analytics | Planejado |

### Ambiente de Desenvolvimento (Replit)

| Componente | Status | Descrição |
|------------|--------|-----------|
| Frontend React | Funcional | Vite dev server na porta 5000 |
| Servidor Dev | Funcional | Express com dados de preview (apenas para UI) |
| Autenticação Dev | Funcional | Rotas /api/auth/* para testar UI |
| Dashboard APIs | Funcional | Dados de preview para visualização |
| Integrations Service | Funcional | Proxy para porta 3005 |

**IMPORTANTE - Distinção DEV vs PRODUÇÃO:**

| Ambiente | Local | Propósito | Regras |
|----------|-------|-----------|--------|
| DEV | Replit | IDE e preview de UI | Dados de preview permitidos em `server/index-dev.ts` |
| PRODUÇÃO | Hetzner Cloud | Sistema enterprise real | **PROIBIDO** mocks/hardcoded (Regra 6) |

O código em `apps/` (microserviços) vai para produção via GitHub Actions (Regra 12). 
O arquivo `server/index-dev.ts` é APENAS para preview no Replit e NÃO vai para produção.

### Recém Concluído (Fase 6.5)

| Capacidade | Status | Descrição |
|------------|--------|-----------|
| Dashboard IA | Produção | Métricas de conversas, imagens, SLA, circuit breakers |
| Takeover/Handover | Produção | Painel completo para agentes humanos (Web + WhatsApp) |
| Galeria de Imagens | Produção | Sistema de rating, aprovação para training, multi-tenant |
| Agentic RAG | Produção | Busca híbrida (interna + Brave Search), classificador inteligente |
| Imagens Inline no Chat | Produção | Skeleton loading, rating, fullscreen, download |

### Planejado (Tarefas Enterprise Restantes)

| Capacidade | Fase | Descrição |
|------------|------|-----------|
| Multimodal Avançado | 9 | Áudio e vídeo |
| Crawling | 11 | Web scraping automático |
| Analytics Avançado | 12 | Relatórios e dashboards customizados |

### Arquitetura de Observabilidade (IMPLEMENTADA)

**Princípio Crítico:** Microserviço de observabilidade SEPARADO e INDEPENDENTE para garantir monitoramento mesmo se o sistema principal travar.

| Componente | Porta | Tecnologia | Licença | Função |
|------------|-------|------------|---------|--------|
| Prometheus | 9090 | Prometheus 3.0 | Apache 2.0 | Coleta de métricas |
| Grafana | 3000 | Grafana OSS | AGPL 3.0 | Dashboards e alertas |
| Jaeger | 16686 | Jaeger | Apache 2.0 | Distributed tracing |
| OTel Collector | 4317/4318 | OpenTelemetry | Apache 2.0 | Instrumentação |
| Langfuse | 3006 | Langfuse | MIT | Métricas LLM |

**Métricas específicas para LLM:**

| Métrica | Descrição | Importância |
|---------|-----------|-------------|
| Token Usage | Tokens entrada/saída por request | Custo e otimização |
| TTFT | Time to First Token | Experiência do usuário |
| Request Latency | Latência total da resposta | Performance |
| Error Rate | Taxa de falhas e timeouts | Confiabilidade |
| Cost per Request | Custo por chamada de modelo | Budget |
| RAG Retrieval Time | Tempo de busca vetorial | Qualidade RAG |

**Stack implementada (todas open source):**
- **Prometheus 3.0** (Apache 2.0): Coleta de métricas com alertas LLM
- **Grafana OSS 11.3** (AGPL 3.0): Dashboards e visualização
- **Jaeger 1.62** (Apache 2.0): Distributed tracing
- **OpenTelemetry Collector** (Apache 2.0): Instrumentação unificada
- **Langfuse 2.x** (MIT): Métricas específicas para LLM
- **Health Checker** (Custom): API de status do stack

**Localização:** `apps/observability-service/`

**Deploy:** 100% automático via GitHub Actions (Regra 12)

---

## Decisões Arquiteturais Confirmadas

### Schedule de Aprendizado (Uso Verticalizado)

| Componente | Frequência | Justificativa |
|------------|------------|---------------|
| RAG update | Tempo real | Documentos disponíveis imediatamente |
| Auto-indexação | Diário | Uso verticalizado exige aprendizado rápido |
| Fine-tuning incremental | A cada 4 dias | LoRA com dados novos (agressivo) |
| Fine-tuning completo | Quinzenal | Retreino mais profundo |

### Pub/Sub Real-time

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Tecnologia | PostgreSQL NOTIFY | Simplicidade, suficiente para escala inicial |
| Fallback | Tabela conversation_states | Garantia de persistência |
| Migração futura | Redis se >1k msg/s | Apenas se escala exigir |

### Geração de Imagens

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Modelo | FLUX.1 Schnell | Estado da arte 2025, Apache 2.0 |
| Hospedagem | Salad Cloud (self-hosted) | Sem API externa, custo previsível |
| Aprendizado | Progressive LoRA | Imagens aprovadas entram no training |
| Storage | Object Storage + CLIP embeddings | RAG multimodal |

### Takeover/Handover

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Twilio Flex | Não usar | Custo alto ($1/hora/agente) |
| Painel | Custom na Alice | Integrado ao dashboard |
| SLA Default | 30 minutos | Best practice prioridade média |
| Triggers automáticos | Confiança <70%, 3+ fallbacks, sentimento negativo | Pesquisa 2025 |

---

## Arquitetura

### Serviços Principais

| Serviço | Porta | Função |
|---------|-------|--------|
| frontend | 5000 | React SPA |
| api-gateway | 80/443 | Traefik |
| auth | 3001 | OAuth/SAML |
| chat | 3002 | LLM + WebSocket |
| rag | 3003 | Embeddings |
| training | 3004 | Fine-tuning |
| integrations | 3005 | Stripe, Wise, etc. |
| observability | 9090/3000/16686/3006 | Prometheus, Grafana, Jaeger, Langfuse |

---

## Serviços

### 1. Frontend (Porta 5000)

- React 18 + TypeScript 5 + Vite 5
- shadcn/ui + Tailwind CSS
- TanStack Query + Wouter
- react-i18next para PT-BR/EN

### 2. Autenticação (Porta 3001)

- OAuth 2.0: Google, GitHub, Microsoft
- SAML 2.0: Azure AD, Okta
- Autenticação local com bcrypt
- RBAC com 6 roles

### 3. Chat (Porta 3002)

- WebSocket para tempo real
- Proxy para Salad Cloud
- Streaming de tokens
- Persistência de mensagens

### 4. RAG (Porta 3003)

- Embeddings via Salad Cloud
- pgvector para busca vetorial
- Chunking: 500 chars, 50 overlap
- Circuit breaker: 30s/50%/30s

### 5. Training (Porta 3004)

- Coleta de dados de treinamento
- SemHash para deduplicação
- Gestão de jobs fine-tuning

### 6. Integrações (Porta 3005)

- Stripe: pagamentos EUR
- Wise: transferências globais (15s/50%/30s)
- ERPNext: CRM (10s/50%/30s)
- Twilio: WhatsApp/SMS
- Resend: emails

---

## Integrações

### Salad Cloud

**LLM Principal:**
- Modelo: Llama 4 Maverick (400B parâmetros, 17B ativos MoE)
- Multimodal: INPUT apenas (entende texto, imagens, vídeo)
- Output: Texto apenas (NÃO gera imagens)
- Contexto: 1M tokens
- Embeddings: text-embedding-3-small
- Circuit breaker: 30s timeout

**Geração de Imagens:**
- Modelo: FLUX.1 Schnell (Apache 2.0)
- Self-hosted: Container Group próprio
- GPU: RTX 3090/4090 (24GB VRAM)
- Velocidade: 1-3 segundos/imagem
- Custo: ~$0.20/hora = ~$20 por 100k imagens

**Inferência CLIP (Embeddings Multimodais):**
- Modelo: CLIP ViT-L/14 (Licença MIT - uso comercial permitido)
- Dimensão: 768 (mesmo espaço vetorial para texto e imagem)
- Self-hosted: Container Group próprio (`apps/clip-inference-service/`)
- GPU: RTX 3060+ (12GB VRAM suficiente)
- Custo: ~$0.10/hora
- Endpoint: `POST /inference/clip` com `{ text }` ou `{ image }`
- Variável de ambiente: `SALAD_CLIP_ENDPOINT` aponta para este container
- Busca cross-modal: texto → imagem, imagem → imagem

**Deploy do Container CLIP na Salad Cloud:**

| Passo | Comando/Ação |
|-------|--------------|
| Construir imagem | `docker build -t clip-inference:latest ./apps/clip-inference-service` |
| Enviar para registry | `docker push ghcr.io/ORG/clip-inference:latest` |
| Criar Container Group | Portal Salad Cloud ou API |
| GPU recomendada | RTX 3060/3070/3090 |
| Porta | 8080 (Container Gateway) |
| Health check | `GET /health` |

### Stripe Portugal

- Pagamentos em EUR via SEPA
- Webhooks de checkout e pagamento

### Wise

- Transferências internacionais
- 50+ moedas suportadas
- Circuit breaker: 15s timeout

### ERPNext

- CRM e ERP integrado
- Circuit breaker: 10s timeout

**Implementação Docker (frappe_docker oficial):**

Baseado 100% na documentação oficial: https://github.com/frappe/frappe_docker

| Serviço | Função | Restart |
|---------|--------|---------|
| erpnext-mariadb | MariaDB 10.11 (utf8mb4) | always |
| erpnext-redis-cache | Cache Redis 7 | always |
| erpnext-redis-queue | Filas Redis 7 | always |
| erpnext-configurator | Configura common_site_config.json | no (one-shot) |
| erpnext-create-site | Cria site na primeira instalação | no (one-shot) |
| erpnext-backend | Gunicorn/Python (bench serve) | always |
| erpnext-frontend | Nginx | always |
| erpnext-websocket | Socket.io tempo real | always |
| erpnext-scheduler | Tarefas agendadas | always |
| erpnext-worker-* | Workers de fila (short/default/long) | always |

**Ordem de Inicialização:**
1. mariadb + redis-cache + redis-queue (healthcheck)
2. configurator (cria common_site_config.json)
3. create-site (cria site se não existir - IDEMPOTENTE)
4. backend + frontend + websocket + scheduler + workers

**Idempotência do create-site:**
- Verifica existência do diretório do site ANTES de qualquer ação
- Se site existe: exit 0 (deploy subsequente funciona)
- Se não existe: aguarda common_site_config.json e cria site

**Secrets GitHub Actions:**

| Secret | Descrição | Padrão |
|--------|-----------|--------|
| ERPNEXT_MYSQL_ROOT_PASSWORD | Senha root MariaDB | erpnext_root_password |
| ERPNEXT_ADMIN_PASSWORD | Senha admin ERPNext | admin |
| ERPNEXT_DB_PASSWORD | Senha usuário erpnext | (obrigatório) |
| ERPNEXT_API_KEY | API Key para integrations | (após setup) |
| ERPNEXT_API_SECRET | API Secret para integrations | (após setup) |

**Primeira Instalação:**
- Credenciais padrão: Administrator / admin
- ALTERAR imediatamente após primeiro acesso!
- Site: erp.yesyoudeserve.duckdns.org

### Twilio

- WhatsApp e SMS

### Resend

- Emails transacionais

---

## Segurança

### Práticas Implementadas

| Prática | Implementação |
|---------|---------------|
| Senhas | bcrypt 12 rounds |
| Cookies | HttpOnly, Secure, SameSite |
| CSRF | State parameter OAuth |
| Rate limiting | Por IP e endpoint |
| Isolamento | tenant_id em queries |

### Hierarquia RBAC

| Role | Nível | Acesso |
|------|-------|--------|
| super_admin | 1 | Total |
| admin | 2 | Tenant |
| manager | 3 | Namespaces |
| operator | 4 | Operação |
| viewer | 5 | Leitura |
| guest | 6 | Mínimo |

---

## Infraestrutura

### Desenvolvimento (Replit)

- IDE para edição de código
- Debugging e testes locais
- Operações git

### Produção (Hetzner Cloud)

| Especificação | Valor |
|---------------|-------|
| Tipo | CX43 |
| vCPUs | 8 |
| RAM | 16 GB |
| SSD | 160 GB |
| IPv4 | 46.224.46.93 |
| Custo | 9.49 EUR/mês |

### URLs de Produção

| Serviço | URL |
|---------|-----|
| Frontend | https://yesyoudeserve.duckdns.org |
| API | https://yesyoudeserve.duckdns.org/api |
| ERPNext | https://erp.yesyoudeserve.duckdns.org |

---

## CI/CD

### Pipeline

1. Push para main
2. Build imagens Docker
3. Push para GHCR
4. Deploy SSH para Hetzner
5. Health checks

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
| OAuth | GOOGLE_CLIENT_ID |
| Twilio | TWILIO_ACCOUNT_SID |
| Resend | RESEND_API_KEY |

---

## Padrões de Código

### Logging

Usar Pino. console.log é PROIBIDO.

### TypeScript

Modo strict. any é PROIBIDO.

### Health Check

Obrigatório em /api/servico/health.

---

*Documento em Português Brasileiro*
*Versão 5.0 - Novembro 2025*
