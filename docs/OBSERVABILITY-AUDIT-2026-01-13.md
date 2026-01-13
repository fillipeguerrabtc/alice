# Auditoria Completa - Observabilidade Alice Platform
**Data:** 13 de Janeiro de 2026  
**Autor:** Fillipe Guerra  
**Versão:** 1.0.0

---

## 📋 SUMÁRIO EXECUTIVO

Esta auditoria identifica **problemas críticos** na observabilidade da plataforma Alice:

1. ❌ **Prometheus NÃO coleta métricas de 5 serviços críticos** (GPU Manager, GPU Services, Frontend)
2. ❌ **Dashboards Grafana com referências OBSOLETAS** (Mixtral 8x7B removido → Qwen2.5-VL 7B)
3. ❌ **NENHUM dashboard para Trading** (KuCoin, ordens, posições)
4. ❌ **NENHUM dashboard para ERPNext** (workers, jobs, sync)
5. ❌ **Dashboard LLM incompleto** (faltam métricas de streaming, TTFT, Chat service)
6. ❌ **Painéis com "No data"** (RBAC 0%, logs vazios)

**IMPACTO BUSINESS:**
- **IMPOSSÍVEL** monitorar GPU (20GB VRAM, $1,100/mês Hetzner)
- **IMPOSSÍVEL** debugar problemas de Trading (BTC Futures em produção)
- **ZERO visibilidade** de performance LLM (Qwen2.5-VL)
- **Dashboards enganosos** confundem usuário sobre estado real do sistema

---

## 🎯 ESCOPO DA AUDITORIA

### Arquitetura Alice Platform (v4.0.0)

**51 Containers em 5 Stacks:**
- **INFRA** (11): PostgreSQL, PgBouncer, Redis, Qdrant, Caddy, MinIO, SearXNG, Tor, Node Exporter, cAdvisor, PgBackRest
- **ALICE** (8 + 4 GPU): Frontend, Auth, Chat, RAG, Training, Integrations, Observability, GPU Manager + Qwen-VL, Embeddings, ASR, Trainer
- **OBSERVABILITY** (13): Prometheus, Grafana, Loki, Promtail, Jaeger, Langfuse (Web + Worker + DB), ClickHouse, Vector, OTel Collector, Health Checker
- **ERPNEXT** (15): MariaDB, Redis Cache/Queue, Backend, NGINX, WebSocket, Scheduler, 9 Workers
- **BACKUP** (1): pgBackRest

**Tecnologias Auditadas:**
- Prometheus 3.8.1 (métricas)
- Grafana OSS 12.3.1 (dashboards)
- Loki 3.6.3 (logs)
- Jaeger 2.13.0 (traces)
- Langfuse 3.89 (LLM observability)

---

## 🔍 AUDITORIA - PORTAS E MÉTRICAS

### ✅ Serviços COM Prometheus Target Configurado

| Serviço | Porta | Job Name | Scrape Interval | Status |
|---------|-------|----------|-----------------|--------|
| **auth-service** | 3001 | `alice-auth-service` | 30s | ✅ OK |
| **chat-service** | 3002 | `alice-chat-service` | 15s | ✅ OK |
| **rag-service** | 3003 | `alice-rag-service` | 30s | ✅ OK |
| **training-service** | 3004 | `alice-training-service` | 60s | ✅ OK |
| **integrations-service** | 3005 | `alice-integrations-service` | 30s | ✅ OK |
| **observability-service** | 3007 | `observability-health` | 30s | ✅ OK |
| **Caddy** | 2019 | `caddy` | 15s | ✅ OK |
| **Jaeger** | 8888 | `jaeger` | 15s | ✅ OK |
| **Node Exporter** | 9100 | `node-exporter` | 15s | ✅ OK |
| **cAdvisor** | 8080 | `cadvisor` | 15s | ✅ OK |
| **OTel Collector** | 8888 | `otel-collector` | 15s | ✅ OK |

---

### ❌ Serviços CRÍTICOS SEM Target Prometheus

| Serviço | Porta | Expõe /metrics? | Impacto | Prioridade |
|---------|-------|-----------------|---------|------------|
| **gpu-manager-service** | 3010 | ✅ SIM (`createAlicePrometheus`) | **CRÍTICO** - Zero visibilidade de GPU (VRAM, filas, erros) | 🔴 P0 |
| **gpu-qwen-vl** | 8000 | ❓ Verificar (FastAPI) | **ALTO** - LLM principal (Qwen2.5-VL 7B AWQ) | 🔴 P0 |
| **gpu-embeddings** | 8001 | ❓ Verificar (FastAPI) | **ALTO** - RAG (Qwen3-Embedding-8B + CLIP) | 🔴 P0 |
| **gpu-asr** | 8002 | ❓ Verificar (FastAPI) | **MÉDIO** - Transcrição de áudio | 🟡 P1 |
| **gpu-trainer** | 8003 | ❓ Verificar (FastAPI) | **BAIXO** - Sob demanda (profile) | 🟢 P2 |
| **alice-frontend** | 8080 | ❌ NÃO (NGINX) | **BAIXO** - Já monitorado via Caddy | 🟢 P3 |

**NOTA CRÍTICA:** GPU Manager Service é o **gargalo** de toda arquitetura GPU v4.0.0. Sem métricas, impossível debugar:
- ❌ Filas de requisições (Redis sorted sets)
- ❌ VRAM usage per service
- ❌ Circuit breaker states
- ❌ Timeout/retry rates
- ❌ Latência end-to-end

---

## 📊 AUDITORIA - DASHBOARDS GRAFANA

### ❌ Problema 1: Referências OBSOLETAS ao Mixtral 8x7B

**Dashboard:** `llm-metrics.json`

**Linhas problemáticas:**
```json
"description": "Métricas LLM Enterprise - Mixtral 8x7B via GPU Manager Service",
"content": "# Alice LLM Metrics - Enterprise Dashboard\n**Mixtral 8x7B (MoE ~12B ativos)**",
"legendFormat": "Mixtral 8x7B"
```

**Problema:**
- Mixtral 8x7B foi **REMOVIDO** em 25/12/2025 (v4.0.0)
- LLM atual: **Qwen2.5-VL 7B AWQ** (multimodal - texto + visão)
- Dashboard está **ENGANOSO** para usuários

**Impacto:**
- ❌ Usuários pensam que Alice usa Mixtral (não usa)
- ❌ Queries Prometheus podem estar erradas (métricas mudaram?)

---

### ❌ Problema 2: Dashboard de HOME com Links Obsoletos

**Dashboard:** `alice-portal-home.json`

```json
"content": "### Links Rápidos\n\n| Ferramenta | Descrição |\n|------------|-----------|\n| [Traces (Jaeger)](/explore?orgId=1&left=%7B%22datasource%22:%22Jaeger%22%7D) | Distributed tracing para debug de latência |\n| [LLM Metrics](/d/llm-metrics/llm-metrics) | Métricas detalhadas do Mixtral 8x7B |\n..."
```

**Problema:**
- Link diz "Métricas detalhadas do Mixtral 8x7B" mas dashboard é de Qwen2.5-VL

---

### ❌ Problema 3: FALTA Dashboard de Trading (KuCoin)

**ZERO painéis para:**
- ✅ Circuit breaker KuCoin (`kucoin_futures` - instrumentado no código)
- ✅ Ordens ativas (via `kucoinClient.ts`)
- ✅ Posições abertas (BTC perpetuals)
- ✅ P&L realizado/não realizado
- ✅ Sinais de trading (RSI, Bollinger, EMA)
- ✅ Taxas de funding (perpetuals)
- ✅ Latência de WebSocket vs REST API

**Evidência no código:**
- `apps/integrations-service/src/kucoinClient.ts` tem circuit breaker instrumentado
- `apps/integrations-service/src/tradingBroadcast.ts` envia eventos via Redis Pub/Sub
- `apps/integrations-service/src/kucoinService.ts` tem 30+ funções de trading

**Impacto Business:**
- **IMPOSSÍVEL** monitorar trades em produção
- **ZERO visibilidade** de P&L (lucros/perdas)
- **Risco financeiro** sem alerta de circuit breaker OPEN

---

### ❌ Problema 4: FALTA Dashboard de Chat/LLM Completo

**Dashboard atual:** `llm-metrics.json` tem apenas:
- Taxa de erros
- Tokens gerados/hora
- Latência P95
- Circuit breaker state

**FALTAM métricas críticas:**
- ❌ **Time To First Token (TTFT)** - métrica SLA de streaming
- ❌ **Throughput (tokens/segundo)** - vLLM AWQ performance
- ❌ **Queue depth** no GPU Manager (filas Redis)
- ❌ **Response Cache hit rate** (Greetings Gate - implementado 17/12/2025)
- ❌ **WebSocket connections** simultâneas
- ❌ **Mensagens com imagem vs texto** (Qwen2.5-VL é multimodal)

**Evidência no código:**
- `packages/shared-utils/src/prometheus.ts` define `responseCache` metrics (hitsTotal, missesTotal, greetingsDetected)
- `apps/chat-service/src/index.ts` incrementa `metrics.responseCache.*`

---

### ❌ Problema 5: FALTA Dashboard de ERPNext

**ZERO painéis para:**
- ✅ Workers (3x default, 3x short, 3x long)
- ✅ Job queue (Frappe RQ)
- ✅ Sync status (Wise transactions, Stripe webhooks)
- ✅ MariaDB connections
- ✅ Redis queue depth

**Impacto:**
- ❌ Impossível debugar "ERPNext lento"
- ❌ Zero visibilidade de workers travados

---

### ❌ Problema 6: Painéis com "No data"

**Screenshots do usuário mostram:**
- RBAC Cache Hit Rate: **0%** (mas código incrementa métricas!)
- Application Logs: **No data** (Loki não está coletando?)

**Hipóteses:**
1. **Métricas RBAC:** Labels inconsistentes? (tenant_id vs tenantId?)
2. **Loki logs:** Promtail não configurado para Alice services?

---

## 🏗️ ARQUITETURA ATUAL vs DASHBOARDS

### GPU Manager Service (Porta 3010)

**Código:**
```typescript
// apps/gpu-manager-service/src/index.ts
const prometheus = createAlicePrometheus({ serviceName: 'gpu-manager' });
```

**Métricas exportadas:**
- `alice_http_*` (HTTP requests, latência, erros)
- `alice_circuit_breaker_*` (LLM, embeddings, ASR)
- `alice_llm_*` (inference duration, tokens, active sessions)
- `alice_rag_*` (embedding duration, queries total)

**Prometheus Target:**
- ❌ **NÃO EXISTE** em `prometheus.yml`

**Dashboard:**
- ❌ **NÃO EXISTE** (métricas GPU Manager misturadas com chat-service)

---

### Arquitetura GPU v4.0.0

**ANTES (v3.x - até 24/12/2025):**
- Mixtral 8x7B (12B params ativos) via vLLM
- FLUX.1-Schnell (geração de imagens) - **REMOVIDO**
- GPU Manager com "model swapping" (latência de troca 30-90s)

**AGORA (v4.0.0 - desde 25/12/2025):**
- **Qwen2.5-VL 7B AWQ** (multimodal - texto + visão)
- **Qwen3-Embedding-8B INT8** (RAG - 4096 dim)
- **OpenCLIP ViT-H/14** (image embeddings - 1024 dim)
- **Canary-1B** (ASR - transcrição de áudio)
- **Trainer QLoRA** (sob demanda - profile)
- **GPU Manager** sem swapping - todos serviços simultâneos (15GB de 20GB VRAM)

**Dashboards desatualizados:**
- ✅ `llm-metrics.json` → Referências a "Mixtral 8x7B"
- ✅ `alice-portal-home.json` → Links obsoletos

---

## 🎯 MELHORES PRÁTICAS 2026 (Grafana + Prometheus)

### 1. **Dashboard Organization** (Grafana Best Practices 2026)

**Recomendação oficial:**
> "Create separate dashboards for different personas (SRE, Dev, Business)"

**Alice NÃO segue:**
- ❌ Dashboard único "LLM Metrics" mistura métricas de Chat + GPU Manager + RAG
- ❌ ZERO separação por persona (SRE vs Dev vs Business)

**O QUE FAZER:**
1. **Dashboard SRE:** Infra (CPU, RAM, Disk, Network) - Node Exporter + cAdvisor
2. **Dashboard LLM/Chat:** Qwen2.5-VL (TTFT, throughput, tokens, erros)
3. **Dashboard RAG:** Embeddings (Qwen3 + CLIP), Qdrant, pgvector, cache
4. **Dashboard Trading:** KuCoin (ordens, posições, P&L, sinais, circuit breaker)
5. **Dashboard GPU:** VRAM, utilização, filas, circuit breakers, swap
6. **Dashboard ERPNext:** Workers, jobs, sync status
7. **Dashboard Business:** P&L, usuários ativos, conversas, tokens consumidos

---

### 2. **Metric Naming** (Prometheus Best Practices 2026)

**Recomendação oficial:**
> "Use `<namespace>_<subsystem>_<metric>_<unit>` format"

**Alice SEGUE PARCIALMENTE:**
- ✅ `alice_http_requests_total` (OK)
- ✅ `alice_llm_inference_duration_seconds` (OK)
- ❌ `alice_circuit_breaker_state` (falta unit - deveria ser `_info` ou `_state_code`)

---

### 3. **Dashboard Variables** (Grafana Best Practices 2026)

**Recomendação oficial:**
> "Use variables for dynamic filtering (service, tenant, environment)"

**Alice NÃO USA:**
- ❌ ZERO variáveis em dashboards
- ❌ Impossível filtrar por `tenant_id` (multi-tenancy!)
- ❌ Impossível filtrar por serviço (alice-chat vs gpu-manager)

---

### 4. **Annotations** (Grafana Best Practices 2026)

**Recomendação oficial:**
> "Mark deployments and incidents on dashboards"

**Alice NÃO USA:**
- ❌ ZERO annotations configuradas
- ❌ Impossível ver "deploy v3.15.8 causou spike de latência"

---

### 5. **Alert Rules** (Prometheus + Grafana Alerting 2026)

**Alice JÁ TEM:**
- ✅ `llm-alerts.yml` (Prometheus recording rules)
- ✅ `alert_rules.yml` (Grafana Unified Alerting)
- ✅ **BUG FIX 13/01/2026:** Removidos alertas obsoletos de FLUX.1

**FALTAM alertas para:**
- ❌ GPU VRAM > 90% (crítico - OOM kill)
- ❌ KuCoin circuit breaker OPEN > 5min
- ❌ Trading P&L negativo > $100
- ❌ ERPNext workers down > 3
- ❌ Qwen-VL TTFT > 2s (SLA violated)

---

## 📝 PLANO DE AÇÃO ENTERPRISE

### Fase 1: CONSERTAR NO CÓDIGO (Prioridade P0) ⏰ Estimativa: 3-4h

#### 1.1. Adicionar Targets Prometheus (30min)

**Arquivo:** `apps/observability-service/config/prometheus/prometheus.yml`

```yaml
# GPU Manager Service
- job_name: 'alice-gpu-manager-service'
  static_configs:
    - targets: ['host.docker.internal:3010']
  metrics_path: /metrics
  scrape_interval: 15s

# GPU Services (FastAPI /metrics endpoint)
- job_name: 'gpu-qwen-vl'
  static_configs:
    - targets: ['host.docker.internal:8000']
  metrics_path: /metrics
  scrape_interval: 30s

- job_name: 'gpu-embeddings'
  static_configs:
    - targets: ['host.docker.internal:8001']
  metrics_path: /metrics
  scrape_interval: 30s

- job_name: 'gpu-asr'
  static_configs:
    - targets: ['host.docker.internal:8002']
  metrics_path: /metrics
  scrape_interval: 60s

# NOTA: gpu-trainer sob demanda (profile) - não precisa de target contínuo
```

---

#### 1.2. Corrigir Dashboard LLM (30min)

**Arquivo:** `apps/observability-service/config/grafana/dashboards/llm-metrics.json`

**Mudanças:**
1. `Mixtral 8x7B` → `Qwen2.5-VL 7B AWQ`
2. Adicionar painéis:
   - Time To First Token (TTFT)
   - Throughput (tokens/s)
   - Response Cache hit rate (Greetings Gate)
   - Queue depth (GPU Manager)

---

#### 1.3. Criar Dashboard Trading (1h30)

**Arquivo:** `apps/observability-service/config/grafana/dashboards/alice-trading.json`

**Painéis:**
1. **KPIs:** P&L, ordens ativas, posições abertas
2. **Circuit Breaker:** Estado (CLOSED/OPEN/HALF_OPEN)
3. **Latência:** REST API vs WebSocket
4. **Sinais:** RSI, Bollinger Bands, EMA crossover
5. **Funding Rate:** Taxa atual + histórico

---

#### 1.4. Criar Dashboard GPU Manager (1h)

**Arquivo:** `apps/observability-service/config/grafana/dashboards/alice-gpu-manager.json`

**Painéis:**
1. **VRAM Usage:** Por serviço (Qwen-VL, Embeddings, ASR)
2. **Queue Depth:** Filas Redis (LLM, embeddings, ASR)
3. **Circuit Breakers:** Estados de todos os breakers
4. **Latência End-to-End:** Request → GPU → Response
5. **Error Rates:** Por tipo de requisição

---

#### 1.5. Criar Dashboard ERPNext (30min)

**Arquivo:** `apps/observability-service/config/grafana/dashboards/alice-erpnext.json`

**Painéis:**
1. **Workers:** Status (default, short, long)
2. **Job Queue:** Depth (pending, processing, failed)
3. **MariaDB:** Connections, slow queries
4. **Redis:** Queue depth, memory usage

---

#### 1.6. Consertar Painéis "No Data" (30min)

**Investigação:**
1. **RBAC 0%:** Verificar labels em `packages/shared-utils/src/rbac/middleware.ts`
   - Código usa `tenant_id` mas Prometheus espera `tenantId`?
2. **Logs vazios:** Verificar Promtail config para Alice services
   - `infra/observability/promtail/config/promtail-config.yml`

---

### Fase 2: MELHORIAS ARQUITETURAIS (Prioridade P1) ⏰ Estimativa: 2-3h

#### 2.1. Dashboard Variables (1h)

**Adicionar variáveis em TODOS os dashboards:**
```json
"templating": {
  "list": [
    {
      "name": "tenant_id",
      "type": "query",
      "datasource": "Prometheus",
      "query": "label_values(alice_http_requests_total, tenant_id)"
    },
    {
      "name": "service",
      "type": "custom",
      "options": ["alice-chat", "alice-rag", "gpu-manager", "integrations"]
    }
  ]
}
```

---

#### 2.2. Annotations (30min)

**Configurar annotations de deploy:**
```json
"annotations": {
  "list": [
    {
      "name": "Deploys",
      "datasource": "Loki",
      "expr": "{job=\"alice-chat-service\"} |= \"Deploy\"",
      "tagKeys": "version",
      "titleFormat": "Deploy {{version}}",
      "textFormat": "{{msg}}"
    }
  ]
}
```

---

#### 2.3. Alert Rules Adicionais (1h)

**Arquivo:** `apps/observability-service/config/prometheus/rules/gpu-alerts.yml`

```yaml
groups:
  - name: gpu_alerts
    interval: 30s
    rules:
      - alert: GPUVRAMHigh
        expr: nvidia_gpu_memory_used_bytes / nvidia_gpu_memory_total_bytes > 0.9
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "GPU VRAM > 90%"
          description: "VRAM usage {{ $value | humanizePercentage }}"

      - alert: GPUManagerQueueDeep
        expr: alice_rag_queries_total - alice_rag_queries_processed_total > 10
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "GPU Manager queue > 10"
```

---

### Fase 3: DOCUMENTAÇÃO (Prioridade P2) ⏰ Estimativa: 1h

#### 3.1. Atualizar `docs/ARQUITETURA.md` (30min)

**Adicionar seção:**
```markdown
## Observability Stack

### Métricas (Prometheus)
- **Targets:** 16 jobs (Alice services + GPU + infra)
- **Scrape interval:** 15-60s (depende do serviço)
- **Retention:** 15 days (Hetzner disk 1.92TB)

### Dashboards (Grafana)
1. **Home:** Portal de navegação
2. **LLM/Chat:** Qwen2.5-VL metrics
3. **Trading:** KuCoin futures
4. **GPU Manager:** VRAM, queues, circuit breakers
5. **RAG:** Embeddings, Qdrant, pgvector
6. **Infrastructure:** Node Exporter + cAdvisor
7. **ERPNext:** Workers, jobs, sync
```

---

#### 3.2. Criar `docs/OBSERVABILITY.md` (30min)

**Novo arquivo:**
```markdown
# Guia de Observabilidade - Alice Platform

## Dashboards Grafana

### Acesso
- URL: https://observability.yesyoudeserve.duckdns.org
- Auth: SSO via Alice Auth Service (OAuth 2.0)

### Dashboard: LLM/Chat
**Quando usar:** Debug de latência, erros de chat
**Métricas principais:**
- Time To First Token (TTFT)
- Throughput (tokens/s)
- Response Cache hit rate
- Error rate

### Dashboard: Trading
**Quando usar:** Monitorar P&L, ordens, circuit breaker
**Métricas principais:**
- P&L realizado/não realizado
- Ordens ativas
- Circuit breaker state
- Latência API KuCoin
```

---

## 🚀 CRONOGRAMA DE EXECUÇÃO

| Fase | Tarefa | Estimativa | Prioridade | Status |
|------|--------|------------|------------|--------|
| **Fase 1** | **CONSERTAR NO CÓDIGO** | **3-4h** | **P0** | ⏳ TODO |
| 1.1 | Adicionar targets Prometheus (GPU Manager + GPU services) | 30min | 🔴 P0 | ⏳ TODO |
| 1.2 | Corrigir dashboard LLM (Mixtral → Qwen2.5-VL) | 30min | 🔴 P0 | ⏳ TODO |
| 1.3 | Criar dashboard Trading (KuCoin) | 1h30 | 🔴 P0 | ⏳ TODO |
| 1.4 | Criar dashboard GPU Manager | 1h | 🔴 P0 | ⏳ TODO |
| 1.5 | Criar dashboard ERPNext | 30min | 🟡 P1 | ⏳ TODO |
| 1.6 | Consertar painéis "No Data" (RBAC, logs) | 30min | 🟡 P1 | ⏳ TODO |
| **Fase 2** | **MELHORIAS ARQUITETURAIS** | **2-3h** | **P1** | ⏳ TODO |
| 2.1 | Dashboard variables (tenant_id, service) | 1h | 🟡 P1 | ⏳ TODO |
| 2.2 | Annotations (deploys, incidents) | 30min | 🟡 P1 | ⏳ TODO |
| 2.3 | Alert rules adicionais (GPU VRAM, Trading P&L) | 1h | 🟡 P1 | ⏳ TODO |
| **Fase 3** | **DOCUMENTAÇÃO** | **1h** | **P2** | ⏳ TODO |
| 3.1 | Atualizar `docs/ARQUITETURA.md` | 30min | 🟢 P2 | ⏳ TODO |
| 3.2 | Criar `docs/OBSERVABILITY.md` | 30min | 🟢 P2 | ⏳ TODO |

**TOTAL:** 6-8 horas (1 dia de trabalho)

---

## ✅ CHECKLIST DE VALIDAÇÃO

### Antes do Commit
- [ ] `pnpm run typecheck` passa
- [ ] `pnpm run lint` passa
- [ ] Prometheus targets UP (`http://localhost:9090/targets`)
- [ ] Dashboards carregam sem erro 404
- [ ] Painéis mostram dados (não "No data")

### Após Deploy
- [ ] GPU Manager metrics aparecendo (`alice_circuit_breaker_state{name=~".*gpu.*"}`)
- [ ] Dashboard Trading mostra P&L (se houver posições abertas)
- [ ] Dashboard GPU Manager mostra VRAM usage
- [ ] Dashboard ERPNext mostra workers status
- [ ] ZERO referências a "Mixtral 8x7B"
- [ ] ZERO alertas de FLUX.1 (removidos 13/01/2026)

---

## 📚 REFERÊNCIAS

### Documentação Oficial
- [Grafana Best Practices 2026](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/)
- [Prometheus Naming Conventions](https://prometheus.io/docs/practices/naming/)
- [Grafana Alerting 2026](https://grafana.com/docs/grafana/latest/alerting/)
- [vLLM Metrics](https://docs.vllm.ai/en/latest/serving/metrics.html)

### Alice Platform
- `CLAUDE.md` - 18 Regras Fundamentais
- `docs/ARQUITETURA.md` - Arquitetura v4.0.0
- `docs/ARQUITETURA-GPU-MANAGER.md` - GPU Manager Service
- `docs/STATUS-REAL-ATUAL.md` - Estado atual do sistema

---

**FIM DA AUDITORIA**

**Próximos passos:** Executar Fase 1 (consertar no código)
