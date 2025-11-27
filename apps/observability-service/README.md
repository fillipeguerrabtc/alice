# Observability Service - Alice Enterprise Platform

Stack de observabilidade **SEPARADO e INDEPENDENTE** para garantir monitoramento mesmo se o sistema principal travar.

## Componentes

| Componente | Porta | Tecnologia | Licença | Função |
|------------|-------|------------|---------|--------|
| Prometheus | 9090 | Prometheus 3.0 | Apache 2.0 | Coleta de métricas |
| Grafana | 3000 | Grafana OSS 11.3 | AGPL 3.0 | Dashboards e alertas |
| Jaeger | 16686 | Jaeger 1.62 | Apache 2.0 | Distributed tracing |
| OTel Collector | 4317/4318 | OpenTelemetry | Apache 2.0 | Instrumentação |
| Langfuse | 3006 | Langfuse 2.x | MIT | Métricas LLM |
| Health Checker | 3007 | Node.js/Express | - | Status do stack |

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

```bash
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

| Serviço | URL |
|---------|-----|
| Grafana | https://observability.yesyoudeserve.duckdns.org |
| Prometheus | https://prometheus.yesyoudeserve.duckdns.org |
| Jaeger | https://tracing.yesyoudeserve.duckdns.org |
| Langfuse | https://llm-metrics.yesyoudeserve.duckdns.org |
| Health API | https://api.yesyoudeserve.duckdns.org/observability |

## Endpoints do Health Checker

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/health` | GET | Health check simples |
| `/api/observability/health` | GET | Status completo do stack |
| `/api/observability/services/:name` | GET | Status individual |
| `/api/observability/urls` | GET | URLs de acesso |
| `/metrics` | GET | Métricas Prometheus |

## Variáveis de Ambiente

```env
# Grafana
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=alice2025

# Langfuse
LANGFUSE_DB_PASSWORD=langfuse2025
LANGFUSE_AUTH_SECRET=alice-langfuse-secret-2025
LANGFUSE_SALT=alice-langfuse-salt-2025
```

## Alertas Configurados

- **LLMHighLatency**: P95 > 30s por 5 minutos
- **LLMCriticalLatency**: P99 > 60s por 2 minutos
- **LLMHighErrorRate**: Taxa de erros > 5%
- **CircuitBreakerOpen**: Circuit breaker aberto
- **HighTokenUsage**: > 1M tokens/hora
- **RAGHighRetrievalTime**: P95 > 3s

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
└── README.md
```

---

*Documentação em Português Brasileiro (Regra 10 replit.md)*
