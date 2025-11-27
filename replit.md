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
| 6 | SEM SOLUÇÕES TEMPORÁRIAS | PROIBIDO: workarounds, mocks, dados hardcoded, in-memory storage, valores default falsos. TODA lógica deve ser enterprise-grade com persistência real em PostgreSQL |
| 7 | MUDANÇAS MÍNIMAS | Foco cirúrgico no problema |
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
| Busca Vetorial HNSW | Produção | pgvector nativo com índices HNSW |

### Ambiente de Desenvolvimento (Replit)

IMPORTANTE - Distinção DEV vs PRODUÇÃO:

| Ambiente | Local | Propósito | Regras |
|----------|-------|-----------|--------|
| DEV | Replit | IDE e preview de UI | Dados de preview permitidos em server/index-dev.ts |
| PRODUÇÃO | Hetzner Cloud | Sistema enterprise real | PROIBIDO mocks/hardcoded (Regra 6) |

O código em apps/ (microserviços) vai para produção via GitHub Actions (Regra 12).
O arquivo server/index-dev.ts é APENAS para preview no Replit e NÃO vai para produção.

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

## Integrações

### Salad Cloud

LLM Principal:
- Modelo: Llama 4 Maverick (400B parâmetros, 17B ativos MoE)
- Multimodal: INPUT apenas (entende texto, imagens, vídeo)
- Output: Texto apenas (NÃO gera imagens)
- Contexto: 1M tokens
- Embeddings: text-embedding-3-small
- Circuit breaker: 30s timeout

Geração de Imagens:
- Modelo: FLUX.1 Schnell (Apache 2.0)
- Self-hosted: Container Group próprio
- GPU: RTX 3090/4090 (24GB VRAM)
- Velocidade: 1-3 segundos/imagem

Inferência CLIP (Embeddings Multimodais):
- Modelo: CLIP ViT-L/14 (Licença MIT)
- Dimensão: 768 (mesmo espaço vetorial para texto e imagem)
- Self-hosted: Container Group próprio (apps/clip-inference-service/)

### Stripe Portugal

- Pagamentos em EUR via SEPA
- Webhooks de checkout e pagamento

### Wise

- Transferências internacionais
- 50+ moedas suportadas

### ERPNext

- CRM e ERP integrado

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

## Padrões de Código

### Logging

Usar Pino. console.log é PROIBIDO.

### TypeScript

Modo strict. any é PROIBIDO.

### Health Check

Obrigatório em /api/servico/health.

---

## Índices pgvector HNSW (Enterprise-Grade)

Busca vetorial nativa com índices HNSW para performance O(log N):

| Índice | Tabela | Coluna | Dimensão | Operador |
|--------|--------|--------|----------|----------|
| idx_media_uploads_clip_embedding_hnsw | media_uploads | clip_embedding | 768 (CLIP ViT-L/14) | vector_cosine_ops |
| idx_document_chunks_embedding_hnsw | document_chunks | embedding | 1536 (text-embedding-3-small) | vector_cosine_ops |

Configuração HNSW: m=16, ef_construction=64

Endpoints migrados para busca nativa pgvector:
- /api/media/search - Busca semântica de imagens
- /api/rag/search - Busca de documentos
- /api/rag/context - Contexto RAG
- /api/rag/agentic - Busca agentic híbrida

---

## Sistema de Handover/Takeover

### Conversation Orchestrator

O sistema de handover/takeover (511 linhas em `apps/chat-service/src/conversation-orchestrator.ts`) permite transição suave entre atendimento por IA e humano:

| Funcionalidade | Descrição |
|----------------|-----------|
| Takeover | Agente humano assume conversa do bot |
| Handback | Devolve conversa para o bot |
| Escalação Automática | Triggers baseados em sentimento e keywords |
| SLA | Timeout de 30 minutos para primeira resposta |
| Prioridades | low, medium, high, urgent |

### Triggers de Escalação

| Trigger | Descrição |
|---------|-----------|
| negative_sentiment | Sentimento negativo detectado |
| frustration_keywords | Palavras como "falar com humano", "gerente" |
| repeated_questions | Perguntas repetidas (loop detectado) |
| explicit_request | Pedido explícito de atendimento humano |
| sla_breach | SLA ultrapassado |

### Canais Suportados

| Canal | Status | Endpoint |
|-------|--------|----------|
| Web | Produção | WebSocket /ws/chat |
| WhatsApp | Produção | /api/integrations/twilio/webhook/whatsapp |
| API | Produção | /api/chat/* |

---

## Alterações Recentes (Novembro 2025)

### Twilio/WhatsApp Webhooks (Tarefa Atual)

Implementadas rotas completas de webhook Twilio no integrations-service:
- `POST /api/integrations/twilio/webhook/whatsapp` - Recebe mensagens WhatsApp
- `POST /api/integrations/twilio/webhook/status` - Status de entrega
- `POST /api/integrations/twilio/send` - Enviar mensagens manualmente
- `GET /api/integrations/twilio/status` - Status da integração

### Migração Drizzle no CI/CD

Adicionado step de migração `db:push` no GitHub Actions:
- Inicia PostgreSQL antes dos serviços
- Executa migração via container temporário
- Garante tabelas criadas antes de iniciar aplicação

### Secrets Wise

Adicionados secrets Wise ao deploy workflow e docker-compose:
- WISE_API_KEY
- WISE_PROFILE_ID
- WISE_WEBHOOK_SECRET
- WISE_SANDBOX

---

Documento em Português Brasileiro
Versão 5.2 - Novembro 2025
