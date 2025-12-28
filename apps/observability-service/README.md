# Observability Service - Alice Enterprise Platform

**Autor:** Fillipe Guerra  
**Data:** 14 de Dezembro de 2025

Stack de observabilidade **SEPARADO e INDEPENDENTE** para garantir monitoramento mesmo se o sistema principal travar.

**Contexto:** Este é o serviço de observabilidade dos 51 containers da plataforma Alice Enterprise (8 infraestrutura + 7 Alice + 15 ERPNext + 14 observability + 6 GPU + 1 backup).

## Componentes

| Componente | Porta | Tecnologia | Licença | Função |
|------------|-------|------------|---------|--------|
| Prometheus | 9090 | Prometheus 3.8.1 | Apache 2.0 | Coleta de métricas |
| Grafana | 3000 | Grafana OSS 12.3.1 | AGPL 3.0 | Dashboards e alertas |
| Jaeger | 16686 | Jaeger 2.13.0 | Apache 2.0 | Distributed tracing |
| OTel Collector | 4317/4318 | OpenTelemetry Collector 0.142.0 | Apache 2.0 | Instrumentação |
| Langfuse Web | 3006 | Langfuse 3.140.0 | MIT | Métricas LLM (UI) |
| Langfuse Worker | interno | Langfuse 3.140.0 | MIT | Processamento assíncrono/migrations |
| Langfuse DB | 5433 | PostgreSQL 16 | PostgreSQL | Persistência Langfuse |
| Health Checker | 3010 | Node.js/Express | - | Status do stack |
| Vector | 8686 | Vector 0.51.1 | MPL 2.0 | Agregação de logs → Loki (metrics expostas para Prometheus) |
| Alertmanager | interno | Alertmanager 0.27.0 | Apache 2.0 | Alertas (Prometheus) |
| node-exporter | interno | node-exporter 1.8.2 | Apache 2.0 | Métricas do host |
| cadvisor | 9101 | cadvisor 0.49.1 | Apache 2.0 | Métricas de containers |

## Métricas LLM Específicas

| Métrica | Descrição | Importância |
|---------|-----------|-------------|
| Token Usage | Tokens entrada/saída por request | Custo e otimização |
| TTFT | Time to First Token | Experiência do usuário |
| Request Latency | Latência total da resposta | Performance |
| Error Rate | Taxa de falhas e timeouts | Confiabilidade |
| Cost per Request | Custo por chamada de modelo | Budget |
| RAG Retrieval Time | Tempo de busca vetorial | Qualidade RAG |

## Deploy

### Produção (100% Automático via GitHub Actions)

**O deploy é totalmente automatizado.** Ao fazer push para a branch `main`:

1. GitHub Actions faz build das imagens Docker
2. Push para GitHub Container Registry (GHCR)
3. SSH para Hetzner VM
4. Docker Compose inicia todos os serviços
5. Health checks validam o stack

**Nenhum comando manual é necessário em produção.**

### Desenvolvimento Local (apenas para testes)

```bash
# Copiar variáveis de ambiente
cp .env.example .env

# Iniciar stack completo
cd apps/observability-service
docker-compose up -d

# Verificar status
docker-compose ps

# Ver logs
docker-compose logs -f

# Parar
docker-compose down
```

## URLs de Acesso (Produção)

| Serviço | URL | Descrição |
|---------|-----|-----------|
| Grafana | https://observability.yesyoudeserve.duckdns.org | Dashboards e alertas |
| Prometheus | https://metrics.yesyoudeserve.duckdns.org | Métricas e consultas |
| Jaeger | https://traces.yesyoudeserve.duckdns.org | Distributed tracing |
| Langfuse | https://langfuse.yesyoudeserve.duckdns.org | LLM observability |
| Alertmanager | https://alertmanager.yesyoudeserve.duckdns.org | Alertas e notificações |
| Health API | https://yesyoudeserve.duckdns.org/api/observability/health | Health check endpoint |

## Configuração do API Gateway (Traefik)

O frontend Alice acessa os endpoints `/api/observability/*` através do API Gateway.
Em produção, configure o Traefik para rotear essas requisições para o observability-service:

```yaml
# docker-compose.yml ou traefik/dynamic/observability.yml
http:
  routers:
    observability-api:
      rule: "PathPrefix(`/api/observability`)"
      service: observability-service
      middlewares:
        - auth-session
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt

  services:
    observability-service:
      loadBalancer:
        servers:
          - url: "http://observability-health:3007"

  middlewares:
    auth-session:
      forwardAuth:
        address: "http://auth-service:3001/api/auth/verify"
        trustForwardHeader: true
```

### Autenticação

- **Desenvolvimento (Cursor IDE)**: Sem autenticação (INTERNAL_API_SECRET não configurado)
- **Produção**: ForwardAuth middleware valida sessão do usuário via auth-service

O frontend usa `credentials: 'include'` para enviar cookies de sessão automaticamente.

## Endpoints do Health Checker

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/health` | GET | Health check simples |
| `/api/observability/health` | GET | Status completo do stack |
| `/api/observability/services/:name` | GET | Status individual |
| `/api/observability/urls` | GET | URLs de acesso |
| `/metrics` | GET | Métricas Prometheus |

## Variáveis de Ambiente

Consulte `.env.example` para a lista completa. Em produção, configure via GitHub Secrets:

| Secret | Descrição |
|--------|-----------|
| `GRAFANA_ADMIN_PASSWORD` | Senha do admin Grafana |
| `LANGFUSE_SECRET_KEY` | Chave secreta Langfuse (prefixo `sk-lf-`) |
| `LANGFUSE_NEXT_AUTH_SECRET` | Chave de autenticação Langfuse |

## Alertas Configurados

| Alerta | Condição | Severidade |
|--------|----------|------------|
| LLMHighLatency | P95 > 30s por 5 min | warning |
| LLMCriticalLatency | P99 > 60s por 2 min | critical |
| LLMHighErrorRate | Taxa de erros > 5% | warning |
| CircuitBreakerOpen | Circuit breaker aberto | critical |
| HighTokenUsage | > 1M tokens/hora | warning |
| RAGHighRetrievalTime | P95 > 3s | warning |

## Persistência de Dados

| Componente | Volume | Caminho no Container |
|------------|--------|----------------------|
| Prometheus | prometheus_data | /prometheus |
| Grafana | grafana_data | /var/lib/grafana |
| Langfuse PostgreSQL | langfuse_postgres_data | /var/lib/postgresql/data |

## Estrutura de Arquivos

```
apps/observability-service/
├── config/
│   ├── grafana/
│   │   ├── dashboards/
│   │   │   └── llm-metrics.json
│   │   └── provisioning/
│   │       ├── dashboards/
│   │       │   └── dashboards.yml
│   │       └── datasources/
│   │           └── datasources.yml
│   ├── otel/
│   │   └── otel-collector.yml
│   └── prometheus/
│       ├── prometheus.yml
│       └── rules/
│           └── llm-alerts.yml
├── src/
│   └── index.ts
├── docker-compose.yml
├── Dockerfile
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                     OBSERVABILITY STACK                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Prometheus  │  │   Grafana   │  │   Jaeger    │              │
│  │   :9090     │──│   :3000     │  │  :16686     │              │
│  └──────┬──────┘  └─────────────┘  └──────┬──────┘              │
│         │                                  │                     │
│  ┌──────┴──────────────────────────────────┴──────┐             │
│  │              OTel Collector                     │             │
│  │         :4317 (gRPC) / :4318 (HTTP)            │             │
│  └────────────────────────────────────────────────┘             │
│                           │                                      │
│  ┌─────────────┐  ┌───────┴───────┐  ┌─────────────────────┐   │
│  │  Langfuse   │  │Health Checker │  │ Langfuse PostgreSQL │   │
│  │   :3006     │  │    :3010      │  │       :5433         │   │
│  └──────┬──────┘  └───────────────┘  └──────────┬──────────┘   │
│         └────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
                              │
                   Recebe métricas de
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MICROSERVIÇOS ALICE                           │
│  Auth (:3001) │ Chat (:3002) │ RAG (:3003) │ Training (:3004)   │
└─────────────────────────────────────────────────────────────────┘
```

---

*Autor: Fillipe Guerra*
*Documentação em Português Brasileiro (Regra 10 CLAUDE.md)*
*Versão 2.7.0 - 17 de Dezembro de 2025*
*Tecnologias: Node.js 22 LTS, pnpm 10.24.0, TypeScript 5.9.3*
*Total de Containers: 51 (8 infraestrutura + 7 Alice + 15 ERPNext + 14 observability + 6 GPU + 1 backup)*
