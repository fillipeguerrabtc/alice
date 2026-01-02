# Arquitetura GPU Manager Service

**Autor:** Fillipe Guerra  
**Data:** 02 de Janeiro de 2026  
**Versão:** 1.5.0 - Migração Caddy Gateway

---

## Visão Geral

O **GPU Manager Service** é um serviço centralizado que gerencia todas as requisições para serviços GPU na Alice Enterprise Platform. Ele implementa fila priorizada, monitoramento de VRAM, circuit breakers e métricas enterprise para garantir uso eficiente e confiável da GPU RTX 4000 SFF Ada 20GB.

---

## Problema Resolvido

### Antes (Sem GPU Manager)

- ❌ Serviços chamavam GPUs diretamente (sem coordenação)
- ❌ Risco de OOM quando múltiplos serviços competiam por VRAM
- ❌ Sem priorização (chat e embeddings tinham mesma prioridade)
- ❌ Sem monitoramento de VRAM em tempo real
- ❌ Sem retry logic centralizado
- ❌ Circuit breakers por serviço (não centralizado)

### Depois (Com GPU Manager)

- ✅ Fila centralizada com priorização (chat > trading > embeddings > outros)
- ✅ Monitoramento de VRAM em tempo real (nvidia-smi)
- ✅ Prevenção de OOM (verifica VRAM antes de processar)
- ✅ Retry logic com backoff exponencial
- ✅ Circuit breakers centralizados por serviço GPU
- ✅ Métricas Prometheus (latência, fila, VRAM, erros)
- ✅ Graceful shutdown

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                    Serviços Alice                            │
│  (chat, rag, training, integrations)                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              GPU Manager Service (Porta 3010)                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Fila Redis Priorizada                               │   │
│  │  - Chat: Priority 10 (CRITICAL)                      │   │
│  │  - Trading: Priority 8 (HIGH)                        │   │
│  │  - Embeddings: Priority 5 (MEDIUM)                   │   │
│  │  - FLUX/ASR: Priority 2 (LOW)                        │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Worker de Fila                                       │   │
│  │  - Processa fila a cada 100ms                        │   │
│  │  - Verifica VRAM antes de processar                  │   │
│  │  - Marca serviços como ativos/inativos               │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Monitoramento VRAM (nvidia-smi)                     │   │
│  │  - Total: 20GB (RTX 4000 SFF Ada)                    │   │
│  │  - Usado: tempo real                                 │   │
│  │  - Serviços ativos: tracking                         │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Serviços GPU (localhost)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Mixtral  │  │Embeddings│  │  FLUX    │  │   ASR    │   │
│  │ :8000    │  │  :8001   │  │  :8002   │  │  :8003   │   │
│  │ ~18GB    │  │  ~16GB   │  │  ~12GB   │  │  ~3GB    │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Componentes

### 1. Fila Redis Priorizada

**Estrutura:**
- Chave: `alice:gpu:queue:{serviceType}`
- Tipo: Sorted Set (ZSET)
- Score: Prioridade (maior = mais prioritário)
- Value: Request ID

**Prioridades:**
- `CRITICAL (10)`: Chat em tempo real
- `HIGH (8)`: Trading (time-sensitive)
- `MEDIUM (5)`: Embeddings (RAG)
- `LOW (2)`: Geração de imagens, ASR

### 2. Worker de Fila

**Funcionamento:**
1. Poll a cada 100ms
2. Para cada tipo de serviço, obtém requisição com maior prioridade
3. Verifica VRAM disponível
4. Se VRAM suficiente, processa requisição
5. Se VRAM insuficiente, reenfileira com prioridade reduzida
6. Marca serviço como ativo durante processamento
7. Armazena resultado no Redis (para polling)

### 3. Monitoramento de VRAM

**Fonte:** `nvidia-smi --query-gpu=memory.total,memory.used,memory.free`

**CORREÇÃO 28/12/2025 - Graceful Degradation:**
- Containers Distroless **não têm shell** (`/bin/sh`) para `exec()`
- GPU Manager detecta automaticamente se `nvidia-smi` está disponível
- Se indisponível, usa **estimativa baseada em serviços ativos** via Redis
- Lock global Redis garante execução serial (evita OOM mesmo sem monitoramento real)
- Log de aviso apenas na primeira tentativa (sem spam)

**Métricas:**
- Total VRAM (GB)
- VRAM Usado (GB) - real via nvidia-smi ou estimado via Redis
- VRAM Livre (GB)
- Utilização (%)
- Serviços Ativos

**Verificação:**
- Antes de processar requisição, verifica se há VRAM suficiente
- Requisitos por serviço (ajustados para RTX 4000 Ada 20GB - Hetzner GEX44):
  - Mixtral: 18GB + 2GB margem = 20GB mínimo
  - Embeddings: 16GB + 2GB margem = 18GB mínimo
  - FLUX: 12GB + 2GB margem = 14GB mínimo
  - ASR: 3GB + 2GB margem = 5GB mínimo

### 4. Circuit Breakers

**Por Serviço GPU:**
- `gpu-mixtral`: Circuit breaker para Mixtral
- `gpu-embeddings`: Circuit breaker para Embeddings
- `gpu-flux`: Circuit breaker para FLUX
- `gpu-asr`: Circuit breaker para ASR

**Configuração:**
- Threshold: 5 falhas consecutivas
- Timeout: 60 segundos
- Half-open: Após 30 segundos

### 5. Retry Logic

**Estratégia:**
- Backoff exponencial: `1000ms * 2^retry`
- Máximo: 30 segundos
- Tentativas: 3 (configurável)

**Exemplo:**
- Tentativa 1: Imediata
- Tentativa 2: Após 1s
- Tentativa 3: Após 2s
- Tentativa 4: Após 4s (se maxRetries > 3)

---

## API Endpoints

### `POST /api/gpu/queue`

Enfileira requisição GPU.

**Request:**
```json
{
  "serviceType": "mixtral",
  "priority": 10,
  "endpoint": "/v1/chat/completions",
  "method": "POST",
  "body": { ... },
  "timeout": 60000,
  "maxRetries": 3,
  "metadata": { ... }
}
```

**Response:**
```json
{
  "requestId": "gpu-1234567890-abc123",
  "status": "queued",
  "message": "Requisição enfileirada"
}
```

### `GET /api/gpu/queue/:requestId`

Obtém resultado de requisição.

**Response:**
```json
{
  "success": true,
  "data": { ... },
  "latencyMs": 1234,
  "vramUsedGB": 20
}
```

### `GET /api/gpu/vram`

Status de VRAM em tempo real.

**Response:**
```json
{
  "totalGB": 24,
  "usedGB": 20,
  "freeGB": 4,
  "utilizationPercent": 83,
  "activeServices": ["mixtral"]
}
```

### `GET /api/gpu/queue/status`

Status das filas.

**Response:**
```json
{
  "queues": {
    "mixtral": 5,
    "embeddings": 2,
    "flux": 0,
    "asr": 1
  },
  "activeServices": ["mixtral"]
}
```

---

## Integração com Serviços

### Chat Service

**Integração com GPU Manager Service (Hetzner GEX44):**
```typescript
import { requestGpu, GpuServiceType, GpuRequestPriority } from '@alice/gpu-manager';

const response = await requestGpu({
  serviceType: GpuServiceType.MIXTRAL,
  priority: GpuRequestPriority.CRITICAL,
  endpoint: '/v1/chat/completions',
  method: 'POST',
  body: { ... },
});
```

### RAG Service

**Antes (URL direta - removido):**
```typescript
// Código legado removido - usar GPU Manager Service
const response = await fetch(`${EMBEDDINGS_GPU_URL}/embed/text`, { ... });
```

**Depois:**
```typescript
import { requestGpu, GpuServiceType, GpuRequestPriority } from '@alice/gpu-manager';

const response = await requestGpu({
  serviceType: GpuServiceType.EMBEDDINGS,
  priority: GpuRequestPriority.MEDIUM,
  endpoint: '/embed/text',
  method: 'POST',
  body: { text },
});
```

---

## Métricas Prometheus

### Fila

- `gpu_queue_size{service_type}`: Tamanho da fila por serviço
- `gpu_queue_wait_time_seconds{service_type}`: Tempo de espera na fila

### VRAM

- `gpu_vram_total_bytes`: VRAM total (bytes)
- `gpu_vram_used_bytes`: VRAM usado (bytes)
- `gpu_vram_free_bytes`: VRAM livre (bytes)
- `gpu_vram_utilization_percent`: Utilização (%)

### Requisições

- `gpu_requests_total{service_type,status}`: Total de requisições
- `gpu_request_latency_seconds{service_type}`: Latência de requisições
- `gpu_request_errors_total{service_type,error_type}`: Erros

### Circuit Breakers

- `gpu_circuit_breaker_state{service_type}`: Estado do circuit breaker (0=closed, 1=open, 2=half-open)
- `gpu_circuit_breaker_failures_total{service_type}`: Falhas do circuit breaker

---

## Health Checks

### `/health`

Verifica se serviço está rodando.

**Response:**
```json
{
  "status": "healthy",
  "service": "gpu-manager"
}
```

### `/live`

Liveness probe (processo vivo).

**Response:**
```json
{
  "status": "alive",
  "redis": "healthy"
}
```

### `/ready`

Readiness probe (pronto para receber requisições).

**Response:**
```json
{
  "status": "ready",
  "redis": "healthy",
  "vram": {
    "totalGB": 24,
    "usedGB": 20,
    "freeGB": 4,
    "utilizationPercent": 83,
    "activeServices": ["mixtral"]
  }
}
```

---

## Configuração

### Variáveis de Ambiente

| Variável | Descrição | Padrão | Obrigatório |
|----------|-----------|--------|-------------|
| `PORT` | Porta do serviço | `3010` | Não |
| `REDIS_URL` | URL do Redis | `redis://localhost:6379` | Sim |
| `INTERNAL_API_SECRET` | Secret para autenticação service-to-service | - | **Sim (produção)** |
| `MIXTRAL_GPU_URL` | URL do serviço Mixtral | `http://gpu-mixtral:8000` | Não |
| `EMBEDDINGS_GPU_URL` | URL do serviço Embeddings | `http://gpu-embeddings:8000` | Não |
| `FLUX_GPU_URL` | URL do serviço FLUX | `http://gpu-flux:8000` | Não |
| `ASR_GPU_URL` | URL do serviço ASR | `http://gpu-asr:8000` | Não |
| `GPU_SERVICE_TIMEOUT` | Timeout para requisições GPU (ms) | `60000` | Não |

> **CORREÇÃO 28/12/2025:** `INTERNAL_API_SECRET` é **obrigatório** em produção (Regra 6 - fail-fast). O container crashará imediatamente se não estiver configurado.

---

## Deploy

### Docker Compose

```yaml
gpu-manager:
  image: ghcr.io/fillipeguerrabtc/alice-gpu-manager:latest
  container_name: alice-gpu-manager
  restart: unless-stopped
  environment:
    - PORT=3010
    - REDIS_URL=redis://:password@alice-redis:6379/0
    # CORREÇÃO 28/12/2025: INTERNAL_API_SECRET obrigatório em produção (Regra 6)
    - INTERNAL_API_SECRET=${INTERNAL_API_SECRET:?INTERNAL_API_SECRET é obrigatório}
    - MIXTRAL_GPU_URL=http://gpu-mixtral:8000
    - EMBEDDINGS_GPU_URL=http://gpu-embeddings:8000
    - FLUX_GPU_URL=http://gpu-flux:8000
    - ASR_GPU_URL=http://gpu-asr:8000
  ports:
    - "127.0.0.1:3010:3010"
  networks:
    - alice-network
  depends_on:
    alice-redis:
      condition: service_healthy
  # CORREÇÃO 01/01/2026: Alpine usa "node" no PATH (migrado de Distroless para CVE-2023-45853 fix)
  healthcheck:
    test: ["CMD", "node", "-e", "const r=require('http').get('http://localhost:3010/live',{timeout:5000},(res)=>{res.resume();process.exit(res.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.on('timeout',()=>{r.destroy();process.exit(1)})"]
    interval: 30s
    timeout: 10s
    start_period: 30s
    retries: 3
```

> **NOTA (01/01/2026):** O healthcheck usa Node.js diretamente (`node` no PATH) porque Alpine por padrão **não inclui curl/wget**. O endpoint `/live` verifica se o processo está vivo (liveness probe). Migrado de Distroless para Alpine 3.21 para corrigir CVE-2023-45853.

---

## Troubleshooting

### Fila não processa requisições

**Verificar:**
1. Redis está acessível?
2. Worker está rodando? (logs: "Iniciando worker de fila GPU")
3. VRAM suficiente? (`GET /api/gpu/vram`)

### OOM Errors

**Causa:** Múltiplos serviços tentando usar GPU simultaneamente.

**Solução:**
- Verificar se GPU Manager está ativo
- Verificar priorização (chat deve ter prioridade)
- Verificar VRAM disponível

### Circuit Breaker Aberto

**Causa:** Serviço GPU falhando repetidamente.

**Solução:**
1. Verificar se serviço GPU está rodando
2. Verificar logs do serviço GPU
3. Aguardar 30 segundos (half-open)
4. Verificar health check do serviço GPU

---

## Melhorias Futuras

1. **Múltiplas GPUs**: Suporte para servidores com múltiplas GPUs
2. **Auto-scaling**: Escalar serviços GPU baseado em fila
3. **Load Balancing**: Distribuir requisições entre múltiplas instâncias
4. **Predictive Scaling**: Prever demanda e pré-aquecer GPUs

---

**Autor:** Fillipe Guerra  
**Data:** 28 de Dezembro de 2025

