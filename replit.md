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
| 6 | SEM SOLUÇÕES TEMPORÁRIAS | Proibido workarounds e mocks |
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

### Em Desenvolvimento

| Capacidade | Progresso |
|------------|-----------|
| Integração RAG + Chat | 50% |
| Dashboard Admin | 30% |
| Analytics | Planejado |

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

- Modelo: Llama 4 Maverick (400B)
- Embeddings: text-embedding-3-small
- Circuit breaker: 30s timeout

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
