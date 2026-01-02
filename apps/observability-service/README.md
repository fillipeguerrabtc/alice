# Observability Service - Alice Enterprise Platform

**Autor:** Fillipe Guerra  
**Data:** 02 de Janeiro de 2026
**Versão:** 3.2.0 - Critical Pipeline Fixes

Stack de observabilidade **SEPARADO e INDEPENDENTE** para garantir monitoramento mesmo se o sistema principal travar.

**Contexto:** Este é o serviço de observabilidade dos 50 containers da plataforma Alice Enterprise (7 infraestrutura + 7 Alice + 15 ERPNext + 14 observability + 6 GPU + 1 backup).

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
| Health Checker | 3007 | Node.js/Express | - | Status do stack |
| Vector | 8686 | Vector 0.51.1 | MPL 2.0 | Agregação de logs → Loki (metrics expostas para Prometheus) |
| node-exporter | interno | node-exporter 1.8.2 | Apache 2.0 | Métricas do host |

> **NOTA 01/01/2026**: Alertmanager removido. Alertas gerenciados via **Grafana Alerting**.
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
| Health API | https://yesyoudeserve.duckdns.org/api/observability/health | Health check endpoint |

> **Alertas**: Gerenciados via Grafana Alerting (menu Alerting no Grafana).

## Configuração do API Gateway (Caddy)

O frontend Alice acessa os endpoints `/api/observability/*` através do Caddy.
Em produção, o Caddyfile em `infra/docker/Caddyfile` gerencia o roteamento automaticamente:

```caddy
observability.yesyoudeserve.duckdns.org {
	import security_headers
	
	reverse_proxy grafana:3000 {
		import proxy_headers
	}
}
```

O roteamento para a API de observabilidade é feito via subpath:

```caddy
handle /api/observability/* {
    reverse_proxy alice-observability:3007 {
        import proxy_headers
    }
}
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
│  │   :3006     │  │    :3007      │  │       :5433         │   │
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
*Versão 3.2.0 - 02 de Janeiro de 2026*
*Tecnologias: Node.js 22 LTS (Alpine 3.21), pnpm 10.26.2, TypeScript 5.9.3*
*Total de Containers: 50 (7 infraestrutura + 7 Alice + 15 ERPNext + 14 observability + 6 GPU + 1 backup)*
