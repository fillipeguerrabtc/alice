# Guia de Observabilidade - Alice Enterprise Platform

**Versão:** 2.6.2  
**Data:** 23 de Janeiro de 2026  
**Autor:** Fillipe Guerra

---

## 📋 AUDIT FINDINGS (13/01/2026)

### Problemas Críticos Identificados e Corrigidos

| # | Problema | Impacto | Correção | Status |
| --- | ---------- | --------- | ---------- | -------- |
| 1 | Prometheus NÃO coletava GPU Manager (3010) + GPU Services (8000-8001) | ZERO visibilidade de VRAM, filas, circuit breakers GPU | Adicionados 3 targets Prometheus | ✅ CORRIGIDO |
| 2 | Dashboards acoplados a nomes de modelos | Mudança de modelos (WS3) quebrava painéis/legendas | Dashboards revisados para **modelo-agnóstico (WS3-ready)** | ✅ CORRIGIDO |
| 3 | ZERO dashboard Trading (KuCoin BTC Futures) | Impossível monitorar P&L, ordens, posições | Criado alice-trading.json (8 painéis) | ✅ CORRIGIDO |
| 4 | Dashboard LLM incompleto | Impossível medir Response Cache (Greetings Gate) | Adicionados 8 painéis (cache, WebSocket, streaming) | ✅ CORRIGIDO |
| 5 | ZERO dashboard ERPNext | Impossível debugar workers, jobs, MariaDB | Criado alice-erpnext.json (13 painéis) | ✅ CORRIGIDO |
| 6 | Infra sem visibilidade de DB/Cache | Impossível monitorar Postgres/PgBouncer/Redis/Qdrant | Adicionados exporters (Postgres/PgBouncer/Redis) + scrape Qdrant `/metrics` | ✅ CORRIGIDO |
| 7 | Painéis "No data" (RBAC 0%, logs vazios) | Métricas/logs não aparecendo | Promtail atualizado para coletar logs reais dos containers (`/var/lib/docker/containers/*/*-json.log`) sem usar Docker socket (seguro) | ✅ CORRIGIDO |
| 8 | Circuit breaker HALF_OPEN não aparecia | Grafana mapeava HALF_OPEN como `2`, mas métrica usa `0.5` | Mapeamento dashboards corrigido para `0.5` (HALF-OPEN) | ✅ CORRIGIDO |
| 9 | Alertas "DatasourceNoData" em CPU/VRAM/Qdrant/Jaeger/Vector | Targets sem scrape válido geravam falsos positivos | Ajuste de targets + auth Qdrant + exporter Vector + métricas Jaeger | ✅ CORRIGIDO |
| 10 | Painéis com queries duplicadas (labels inconsistentes) | Semântica incorreta e confusão operacional | Queries alinhadas a métricas reais e labels corretos | ✅ CORRIGIDO |

### Checklist de validação (pós-deploy)

- **Prometheus (`/targets`)**: `alice-services`, `alice-gpu-services`, `node-exporter`, `cadvisor`, `qdrant`, `jaeger`, `vector` em **UP**.
- **Grafana**: dashboards Home, LLM/Chat, Agentic, GPU Manager, Trading, ERPNext provisionados.
- **Loki/Promtail**: logs do job `docker-containers` chegando com parsing JSON.
- **Alertas**: regras ativas para LLM, GPU, KuCoin e infraestrutura.

---

## 📋 VISÃO GERAL

A plataforma Alice implementa observabilidade **enterprise-grade** baseada em **melhores práticas 2025** do Grafana e Prometheus, seguindo os princípios de **SRE (Site Reliability Engineering)** e **Golden Signals**.

**Stack de Observabilidade:**

- **Prometheus 3.8.1** - Métricas (**17 jobs**; scrape 15-60s)
- **Grafana OSS 12.3.1** - Dashboards + Alerting
- **Loki 3.6.3** - Logs centralizados
- **Jaeger 2.13.0** - Distributed tracing (métricas via telemetry)
- **Langfuse 3.89** - LLM observability
- **Node Exporter 1.9.1** - Métricas de host
- **cAdvisor 0.52.1** - Métricas de containers

---

## 🎯 DASHBOARDS GRAFANA

### Acesso

- **URL:** `https://observability.yesyoudeserve.duckdns.org`
- **Auth:** SSO via Alice Auth Service (OAuth 2.0)
- **Permissões:** RBAC (Admin, SRE, Dev, Business)

### Provisionamento e SSOT (IMPORTANTE)

- **SSOT dos dashboards**: `apps/observability-service/config/grafana/dashboards/*.json`
- **Provisionamento (produção)**: `infra/observability/grafana/provisioning/dashboards/*` (conforme `alice-dashboards.yml`)
- **Sincronização no deploy**: o workflow `deploy-stack-modular.yml` copia os dashboards do SSOT para o diretório de provisionamento **antes** de subir o stack OBSERVABILITY, evitando deriva entre “dashboards do app” vs “dashboards provisionados”.

### Métricas Agentic

- **Ações por rota**: `alice_http_requests_total{route=~"/api/agentic.*|/api/agents.*"}`
- **Aprovações (rotas)**: `alice_http_requests_total{route=~"/api/chat/conversations/:id/approval-policy|/api/chat/pending-handoffs"}`
- **Latência (rotas)**: `alice_http_request_duration_seconds_bucket{route=~"/api/agentic.*|/api/agents.*"}`
- **Dashboard**: `apps/observability-service/config/grafana/dashboards/alice-agentic.json`

### Streaming Agentic (UI)

- **Objetivo**: exibir em tempo real as ações e ferramentas executadas durante uma resposta.
- **Protocolo**: eventos `agent_event` enviados via SSE/WS com payload redigido.
- **Segurança**: redaction automática de tokens/secrets antes de renderizar no frontend.

### Portal Home (Single Pane of Glass)

**UID:** `alice-home`  
**Quando usar:** Ponto de entrada para toda observabilidade

**Navegação rápida:**

- LLM/Chat
- GPU Manager
- Trading
- Infrastructure
- RAG
- Training
- ERPNext
- Traces (Jaeger)
- Alertas

---

### 1. Dashboard LLM/Chat (modelo-agnóstico)

**UID:** `llm-metrics`  
**Quando usar:** Debug de latência, erros de chat, performance LLM

**Métricas principais:**

- **Taxa de Erros (LLM):** `sum(rate(alice_llm_requests_total{status="error"}[5m])) / (sum(rate(alice_llm_requests_total[5m])) + 0.001)`
- **Tokens Gerados/Hora:** `increase(alice_llm_tokens_generated_total[1h])`
- **Tokens Prompt/Hora:** `increase(alice_llm_tokens_prompt_total[1h])`
- **Latência P95:** `histogram_quantile(0.95, sum(rate(alice_llm_inference_duration_seconds_bucket[5m])) by (le))`
- **TTFT P95:** `histogram_quantile(0.95, sum(rate(alice_llm_ttft_seconds_bucket[5m])) by (le))`
- **Circuit Breaker:** `alice_circuit_breaker_state{name=~".*llm.*"}`
- **Response Cache Hit Rate:** `alice_response_cache_hit_rate`
- **WebSocket Connections:** `alice_llm_active_sessions`

**Painéis:**

1. **KPIs LLM:** Taxa de erros, tokens, RPS, fallbacks, circuit breaker
2. **Latência LLM:** P50, P95, P99 (modelo-agnóstico)
3. **Chat & Streaming:** Response Cache (Greetings Gate), WebSocket connections, latência cache check
4. **RAG:** Busca vetorial, embeddings, chunks processados

**Alertas:**

- Taxa de erros > 10% por 5min
- Latência P95 > 5s por 5min
- Circuit breaker OPEN > 5min

---

### 2. Dashboard GPU Manager (modelo-agnóstico)

**UID:** `alice-gpu-manager`  
**Quando usar:** Monitorar VRAM, filas, circuit breakers GPU

**Métricas principais:**

- **VRAM Total Usage:** `(sum(alice_gpu_vram_used_bytes) / sum(alice_gpu_vram_total_bytes)) * 100`
- **VRAM Reservada por Capacidade:** `alice_gpu_vram_reserved_bytes{service="llm|embeddings|training"}`
- **Fila LLM:** `alice_gpu_manager_queue_depth{queue="llm"}`
- **Fila Embeddings:** `alice_gpu_manager_queue_depth{queue="embeddings"}`
- **Fila Training:** `alice_gpu_manager_queue_depth{queue="training"}`
- **Tempo na Fila P95:** `histogram_quantile(0.95, rate(alice_gpu_manager_queue_wait_duration_seconds_bucket[5m]))`
- **Circuit Breakers GPU:** `alice_circuit_breaker_state{name=~".*gpu.*"}`

**Painéis:**

1. **GPU VRAM Usage:** Total % + Stacked Area (capacidade: LLM/Embeddings/Training)
2. **Filas Redis:** Depth por tipo (LLM, embeddings, training) + tempo médio na fila
3. **Circuit Breakers:** Status de todos os breakers GPU
4. **Latência End-to-End:** LLM P50/P95/P99, Embeddings P95

**Alertas:**

- VRAM > 90% por 5min (crítico - OOM kill)
- Fila LLM > 10 por 2min
- Circuit breaker GPU OPEN > 3min

---

### 3. Dashboard Trading

**UID:** `alice-trading`  
**Quando usar:** Monitorar P&L, ordens, circuit breaker KuCoin

**Métricas principais:**

- **P&L Realizado (24h):** `alice_trading_pnl_realized_usd`
- **P&L Não Realizado:** `alice_trading_pnl_unrealized_usd`
- **Ordens Ativas:** `alice_trading_orders_active`
- **Circuit Breaker KuCoin:** `alice_circuit_breaker_state{name="kucoin_futures"}`
- **WS Conectado:** `alice_kucoin_ws_connected`
- **Reconexões/Erros:** `alice_kucoin_ws_reconnects_total` e `alice_kucoin_ws_errors_total`
- **Latência API P95:** `histogram_quantile(0.95, sum(rate(alice_integration_call_duration_seconds_bucket{integration="kucoin"}[5m])) by (le))`

**Painéis:**

1. **KPIs Trading:** P&L realizado/não realizado, ordens ativas, circuit breaker
2. **Sinais Técnicos:** RSI, Bollinger Bands
3. **Latência e Performance:** API KuCoin P95, circuit breakers status

**Alertas:**

- Circuit breaker KuCoin OPEN > 5min
- P&L negativo > $100
- Latência API > 1s por 5min

---

### 4. Dashboard Infrastructure

**UID:** `alice-infrastructure`  
**Quando usar:** Monitorar CPU, RAM, Disk, Network do servidor Hetzner

**Métricas principais:**

- **CPU Usage:** `100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`
- **RAM Usage:** `(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes * 100`
- **Disk Usage:** `(node_filesystem_size_bytes - node_filesystem_avail_bytes) / node_filesystem_size_bytes * 100`
- **Network Traffic:** `rate(node_network_receive_bytes_total[5m])`, `rate(node_network_transmit_bytes_total[5m])`
- **Container CPU:** `rate(container_cpu_usage_seconds_total[5m])`
- **Container Memory:** `container_memory_usage_bytes`

**Painéis:**

1. **Host Metrics:** CPU, RAM, Disk, Network (Node Exporter)
2. **Container Metrics:** CPU, Memory, Disk I/O (cAdvisor)
3. **Top Containers:** Por CPU, Memory

**Alertas:**

- CPU > 90% por 5min
- RAM > 90% por 5min
- Disk > 85% por 10min

---

### 5. Dashboard ERPNext

**UID:** `alice-erpnext`  
**Quando usar:** Monitorar workers Frappe, job queue, MariaDB, Redis

**Métricas principais:**

- **Workers Status:** `up{job="erpnext-worker-{default|short|long}"}`
- **Jobs Pendentes:** `alice_erpnext_queue_depth{status="pending"}`
- **Jobs Processando:** `alice_erpnext_queue_depth{status="processing"}`
- **Jobs Falhos (1h):** `increase(alice_erpnext_jobs_failed_total[1h])`
- **Jobs Completados (1h):** `increase(alice_erpnext_jobs_completed_total[1h])`
- **MariaDB Connections:** `mysql_global_status_threads_connected`
- **MariaDB Slow Queries:** `increase(mysql_global_status_slow_queries[1h])`
- **Redis Memory:** `(redis_memory_used_bytes / redis_memory_max_bytes) * 100`

**Painéis:**

1. **Workers Status:** 3x default, 3x short, 3x long
2. **Job Queue:** Pendentes, processando, falhos, completados
3. **Sync Status:** Wise transactions, Stripe events
4. **MariaDB & Redis:** Connections, slow queries, memory usage

**Alertas:**

- Worker DOWN > 2min
- Jobs pendentes > 50 por 5min
- MariaDB slow queries > 10 por 1h

---

## 🔍 PROMETHEUS TARGETS

### Targets Configurados (17 jobs)

| Job Name | Target | Scrape Interval | Métricas Principais |
| --- | --- | --- | --- |
| `prometheus` | localhost:9090 | 15s | Prometheus self-monitoring |
| `otel-collector` | otel-collector:8888 | 15s | OTel Collector metrics |
| `alice-auth-service` | alice-auth:3001 | 30s | HTTP, RBAC, sessions |
| `alice-chat-service` | alice-chat:3002 | 15s | LLM, tokens, streaming, Response Cache |
| `alice-rag-service` | alice-rag:3003 | 30s | Embeddings, vector search, Qdrant |
| `alice-training-service` | alice-training:3004 | 60s | Training jobs, loss, GPU utilization |
| `alice-integrations-service` | alice-integrations:3005 | 30s | KuCoin, Stripe, Wise, circuit breakers |
| `alice-gpu-manager-service` | alice-gpu-manager:3010 | 15s | GPU Manager, VRAM, filas, circuit breakers |
| `gpu-llm` | gpu-llm:8000 | 30s | Serviço GPU LLM (vLLM OpenAI API - texto) |
| `gpu-embeddings` | gpu-embeddings:8000 | 30s | Serviço GPU de embeddings (FastAPI) |
| `caddy` | alice-caddy:2019 | 15s | API Gateway, SSL, HTTP/3 |
| `qdrant` | alice-qdrant:6333 | 10s | Vetorial texto (metrics com API key) |
| `vector` | alice-vector:9598 | 30s | Métricas internas do Vector (prometheus_exporter) |
| `jaeger` | jaeger:8888 | 15s | Distributed tracing |
| `observability-health` | health-checker:3007 | 30s | Stack health checks |
| `node-exporter` | alice-node-exporter:9100 | 15s | Host metrics (CPU, RAM, Disk, Network) |
| `cadvisor` | cadvisor:8080 | 15s | Container metrics |

> Nota: Langfuse não expõe endpoint Prometheus nativo. Para métricas Langfuse, usar adapter dedicado ou queries via API pública autenticada.

---

## 📊 MÉTRICAS ALICE (Nomenclatura Prometheus)

### HTTP Metrics

- `alice_http_requests_total{job, handler, method, status}` - Total de requisições HTTP
- `alice_http_request_duration_seconds_bucket{job, handler, method}` - Latência HTTP (histogram)
- `alice_http_requests_in_flight{job}` - Requisições em andamento
- `alice_http_errors_total{job, handler, method}` - Total de erros HTTP

### LLM Metrics

- `alice_llm_inference_duration_seconds_bucket{job}` - Latência de inferência LLM (histogram)
- `alice_llm_ttft_seconds_bucket{job}` - Time to First Token (TTFT) (histogram)
- `alice_llm_requests_total{status}` - Total de requisições LLM (success|error|fallback)
- `alice_llm_tokens_generated_total{job}` - Total de tokens gerados
- `alice_llm_tokens_prompt_total{job}` - Total de tokens de prompt
- `alice_llm_active_sessions{job}` - Sessões simultâneas de chat
- `alice_llm_fallbacks_total{job}` - Total de fallbacks (erros)

### Response Cache Metrics (Greetings Gate)

- `alice_response_cache_hits_total{tenant_id}` - Cache hits (evitou LLM)
- `alice_response_cache_misses_total{tenant_id}` - Cache misses (chamou LLM)
- `alice_response_cache_greetings_detected_total{tenant_id}` - Saudações detectadas
- `alice_response_cache_check_duration_seconds_bucket{tenant_id}` - Latência cache check
- `alice_response_cache_hit_rate` - Taxa de hit atual (0-1)

### RAG Metrics

- `alice_rag_documents_indexed{tenant_id}` - Documentos indexados
- `alice_rag_chunks_total{tenant_id}` - Total de chunks
- `alice_rag_search_duration_seconds_bucket{tenant_id}` - Latência busca vetorial
- `alice_rag_embedding_duration_seconds_bucket{model}` - Latência embeddings (modelo-agnóstico)
- `alice_rag_relevance_score{tenant_id}` - Score médio de relevância (0-1) por tenant
- `alice_rag_cache_hits_total{endpoint}` - Cache hits (search/context)
- `alice_rag_cache_misses_total{endpoint}` - Cache misses (search/context)
- `alice_rag_queries_total{tenant_id,result}` - Total de queries (success|error)

### Circuit Breaker Metrics

- `alice_circuit_breaker_state{name}` - Estado (0=closed, 1=open, 0.5=half-open)
- `alice_circuit_breaker_failures_total{name}` - Total de falhas
- `alice_circuit_breaker_successes_total{name}` - Total de sucessos
- `alice_circuit_breaker_timeouts_total{name}` - Total de timeouts
- `alice_circuit_breaker_rejects_total{name}` - Total de rejeições

### RBAC Metrics

- `alice_rbac_cache_hits_total{tenant_id}` - Cache hits de permissões
- `alice_rbac_cache_misses_total{tenant_id}` - Cache misses de permissões
- `alice_rbac_cache_invalidations_total{reason}` - Invalidações de cache
- `alice_rbac_check_duration_seconds_bucket{permission}` - Latência verificação permissão
- `alice_rbac_cache_hit_rate` - Taxa de hit atual (0-1)

### Trading Metrics (KuCoin)

- `alice_trading_pnl_realized_usd` - P&L realizado (USD)
- `alice_trading_pnl_unrealized_usd` - P&L não realizado (USD)
- `alice_trading_orders_active` - Ordens ativas
- `alice_trading_rsi{symbol}` - RSI (Relative Strength Index)
- `alice_trading_bollinger_{upper|middle|lower}{symbol}` - Bollinger Bands
- `alice_trading_price_usd{symbol}` - Preço atual

### GPU Manager Metrics

- `alice_gpu_vram_total_bytes{gpu_id}` - VRAM total disponível (bytes)
- `alice_gpu_vram_used_bytes{gpu_id}` - VRAM usada total (bytes) - fonte: nvidia-smi quando disponível
- `alice_gpu_vram_reserved_bytes{gpu_id, service}` - VRAM reservada estimada por capacidade (bytes)
- `alice_gpu_manager_queue_depth{queue}` - Depth de filas (llm, embeddings, asr)
- `alice_gpu_manager_queue_wait_duration_seconds_bucket{queue}` - Tempo na fila

---

## 🚨 ALERTAS GRAFANA

### Alertas Ativos (Grafana Unified Alerting)

**Arquivo:** `infra/observability/grafana/provisioning/alerting/alert_rules.yml`

#### LLM Alerts

1. **LLM High Error Rate** - Taxa de erros > 10% por 5min
2. **LLM High Latency** - P95 > 5s por 5min
3. **LLM Circuit Breaker Open** - Circuit breaker OPEN > 5min

#### Infrastructure Alerts

1. **High CPU Usage** - CPU > 90% por 5min
2. **High Memory Usage** - RAM > 90% por 5min
3. **High Disk Usage** - Disk > 85% por 10min
4. **Container Down** - Container DOWN > 2min

#### Database Alerts

1. **PostgreSQL Down** - PostgreSQL DOWN > 1min
2. **High DB Connections** - Connections > 80% pool por 5min

#### Trading Alerts

1. **KuCoin Circuit Breaker Open** - Circuit breaker OPEN > 5min
2. **KuCoin High Latency (P95)** - P95 > 1s por 5min
3. **KuCoin High Error Rate** - taxa de erro > 10% por 5min

#### GPU Alerts

1. **GPU VRAM High** - VRAM > 90% por 5min (crítico - OOM kill)
2. **GPU Queue Deep** - Fila > 10 por 2min

---

## 📝 TROUBLESHOOTING

### Dashboard mostra "No data"

**Possíveis causas:**

1. **Prometheus target DOWN:**
   - Verificar: `http://localhost:9090/targets`
   - Solução: Verificar se serviço está UP e expondo `/metrics`

2. **Métrica não existe:**
   - Verificar: `http://localhost:9090/graph` (query manual)
   - Solução: Verificar se código está incrementando métrica

3. **Labels inconsistentes:**
   - Exemplo: Dashboard usa `tenant_id` mas código usa `tenantId`
   - Solução: Padronizar labels (usar `tenant_id` em TODOS os lugares)

4. **Scrape interval muito longo:**
   - Dashboard mostra dados de 5min mas scrape é 60s
   - Solução: Ajustar `scrape_interval` em `prometheus.yml`

---

### Painel RBAC mostra 0%

**Diagnóstico:**

```promql
# Verificar se métricas existem
alice_rbac_cache_hits_total
alice_rbac_cache_misses_total

# Verificar labels
alice_rbac_cache_hits_total{tenant_id="..."}
```

**Solução:**

- Verificar se `initRbacPrometheusMetrics()` foi chamado no serviço
- Verificar se código está incrementando métricas corretamente

---

### Logs vazios no Loki

**Diagnóstico:**

```bash
# Verificar Promtail
docker logs promtail

# Verificar Loki
docker logs loki
```

**Solução:**

- Verificar `promtail-config.yml` tem job para Alice services
- Verificar logs estão em JSON (Pino logger)

---

## 🔗 REFERÊNCIAS

### Documentação Oficial

- [Grafana dashboards best practices](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/)
- [Prometheus naming conventions](https://prometheus.io/docs/practices/naming/)
- [Grafana alerting](https://grafana.com/docs/grafana/latest/alerting/)
- [SRE Golden Signals](https://sre.google/sre-book/monitoring-distributed-systems/)

### Alice Platform

- `CLAUDE.md` - 18 Regras Fundamentais
- `docs/ARQUITETURA.md` - Arquitetura Gate 2 (LLM separado + Vision via OpenAI)
- `docs/ARQUITETURA-GPU-MANAGER.md` - GPU Manager Service
- Auditoria 13/01/2026 consolidada neste documento

---

**Última atualização:** 16 de Janeiro de 2026  
**Autor:** Fillipe Guerra
