# Arquitetura GPU Manager Service

**Autor:** Fillipe Guerra  
**Data:** 16 de Janeiro de 2026  
**Versão:** 4.2.0 - Gate 2: LLM Qwen2.5 7B + Vision via OpenAI

> **OTIMIZAÇÃO CRÍTICA v4.0.4 (12/01/2026):** Migração de **TODAS AS 3 IMAGENS** GPU de `pytorch-devel` para `pytorch-runtime`:
> - **embeddings-gpu**: 17.6GB → ~11GB (-6GB, -35%)
> - **asr-canary**: 17GB → ~11GB (-6GB, -35%)
> - **lora-trainer**: 17GB → ~11GB (-6GB, -35%)
> 
> **Economia Total:** 18GB (-35%), 30 fewer layers (90→60), deploy **50x mais rápido** (~20-25min vs ~40min).
> **Causa Raiz:** CUDA dev tools (gcc, nvcc, headers) são desnecessários para inferência/training.

> **NOTA (Histórico v4.0.x):** Ajustes finos de VRAM em vLLM foram feitos após análise de erro "No available memory for cache blocks".
> No **Gate 2**, a plataforma usa **LLM (texto)**, **Embeddings** e **ASR** locais, com **budgets conservadores** para coexistência em 20GB. **Vision** e **geração de imagens** são via OpenAI.

> **ATUALIZAÇÃO v4.0.1 (12/01/2026):** Correções para vLLM v0.12.0: `--limit-mm-per-prompt` (formato JSON), `--dtype float16` (obrigatório para AWQ).

> **ATUALIZAÇÃO v4.0.0 (11/01/2026):** Arquitetura simplificada com serviços GPU simultâneos (histórico). O **SSOT atual** é o **Gate 2**.

---

## Visão Geral

O **GPU Manager Service** é um serviço centralizado que gerencia todas as requisições para serviços GPU na Alice Enterprise Platform. Ele implementa:

- **Arquitetura Simplificada**: Serviços GPU rodam simultaneamente (com budgets de VRAM)
- **Gate 2**: Separação explícita de **LLM (texto)** + Embeddings + ASR (tipos capability-based)
- **Fila Priorizada**: Chat > Trading > Embeddings > ASR > Training
- **Monitoramento de VRAM**: Tempo real via nvidia-smi
- **Circuit Breakers**: Proteção centralizada por serviço
- **Métricas Enterprise**: Prometheus (latência, fila, VRAM, erros)

---

## Arquitetura Gate 2 (atual)

### Distribuição de VRAM (20GB Total - budgets)

Budgets conservadores para coexistência (fonte de verdade em runtime: `nvidia-smi` + métricas do GPU Manager):

```
GPU 20GB VRAM - Serviços sempre ativos (Gate 2):
┌─────────────────────────────────────────────────────────────┐
│  LLM (texto)        ~6GB  (gpu-llm)                          │
│  Embeddings         ~3GB  (gpu-embeddings)                   │
│  ASR                ~3GB  (gpu-asr)                          │
├─────────────────────────────────────────────────────────────┤
│  TOTAL (budget)     ~12GB + margem de segurança              │
└─────────────────────────────────────────────────────────────┘
```

### Serviços GPU Sempre Ativos

| Serviço | Modelo | VRAM Real | Configuração | Função | Imagem Base | Imagem Size |
|---------|--------|-----------|--------------|--------|-------------|-------------|
| **gpu-llm** | Qwen2.5 7B Instruct (AWQ) | ~5-6GB (budget) | `gpu-memory-utilization=0.40`, `max-model-len=8192`, `dtype=float16` | **LLM texto** (chat, trading) | vllm/vllm-openai | ~8GB |
| **gpu-embeddings** | Qwen3-Embedding-0.6B INT8 | ~2-3GB (budget) | `quantization=int8` | Embeddings para RAG | **pytorch-runtime** | **~11GB (-35% ✅)** |
| **gpu-asr** | Canary-1B | ~3GB (budget) | NeMo | Transcrição de áudio | **pytorch-runtime** | **~11GB (-35% ✅)** |

### Configuração vLLM 0.12.0 (Gate 2)

O Qwen2.5 7B usa vLLM v0.12.0 com as seguintes configurações **corrigidas**:

```bash
python3 -m vllm.entrypoints.openai.api_server \
    --model "Qwen/Qwen2.5-7B-Instruct-AWQ" \
    --quantization awq \
    --dtype float16 \                     # OBRIGATÓRIO para AWQ (bfloat16 não suportado)
    --max-model-len 8192 \                # Gate 2: contexto 8k com KV cache calibrado
    --gpu-memory-utilization 0.40         # Gate 2: budget conservador para coexistência em 20GB
```

**Nota (VRAM):** Budgets e `max-model-len` impactam KV cache. Em produção, valide o consumo real via `alice_gpu_*` e `nvidia-smi`.

**Correções v4.0.1 (vLLM):**
- `--limit-mm-per-prompt`: formato JSON obrigatório `'{"key": value}'`
- `--dtype float16`: obrigatório para AWQ (bfloat16 causa `ValidationError`)

### Serviço Sob Demanda (Profile)

| Serviço | Modelo | VRAM | Função | Imagem Base | Imagem Size |
|---------|--------|------|--------|-------------|-------------|
| **gpu-trainer** | QLoRA (modelo base = LLM do stack) | ~12GB | Fine-tuning (pausa outros serviços) | **pytorch-runtime** | **~11GB (-35% ✅)** |

---

## Benefícios da Nova Arquitetura

### Antes (v3.0.0)

- ❌ Apenas 1 serviço GPU por vez
- ❌ Latência de troca de 30-60 segundos
- ❌ Complexidade de orquestração (Docker API)
- ❌ Sem suporte nativo a vision (dependia de soluções externas)
- ❌ Dependência de serviço separado para análise de imagens (legado)

### Depois (Gate 2)

- ✅ Todos os serviços rodando simultaneamente (com budgets conservadores)
- ✅ **Zero latência de troca**
- ✅ Arquitetura simplificada (sem Docker API)
- ✅ Separação explícita: LLM (texto) + Vision via OpenAI
- ✅ Observabilidade model-agnóstica (capability-based)

---

## Diagrama de Arquitetura

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
│  │  - ASR/Training: Priority 2 (LOW)                    │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Circuit Breakers + Métricas Prometheus              │   │
│  │  - Proteção por serviço GPU                          │   │
│  │  - Retry com backoff exponencial                     │   │
│  │  - Métricas de latência, fila, VRAM                  │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│     Containers GPU (TODOS SEMPRE ATIVOS - Gate 2)           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │   LLM    │  │Embeddings│  │   ASR    │                  │
│  │  :8004   │  │  :8001   │  │  :8002   │                  │
│  │  ~6GB    │  │  ~3GB    │  │  ~3GB    │                  │
│  │ SEMPRE   │  │ SEMPRE   │  │ SEMPRE   │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
│                                                             │
│  ┌──────────┐ (profile: gpu-training - sob demanda)        │
│  │ Trainer  │                                              │
│  │  :8003   │                                              │
│  │  ~12GB   │                                              │
│  │ON-DEMAND │                                              │
│  └──────────┘                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Endpoints da API

### Health Checks

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/health` | GET | Health check básico |
| `/live` | GET | Liveness probe (Kubernetes) |
| `/ready` | GET | Readiness probe (verifica Redis e VRAM) |

### Requisições GPU

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/api/gpu/request` | POST | Enfileira requisição GPU |
| `/api/gpu/request/:id/result` | GET | Obtém resultado da requisição |
| `/api/gpu/stream` | POST | Streaming direto (bypass fila) |

### Status e Métricas

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/api/gpu/vram` | GET | Status de VRAM atual |
| `/api/gpu/queue/status` | GET | Status das filas por serviço |
| `/api/gpu/services` | GET | Status dos serviços GPU |
| `/metrics` | GET | Métricas Prometheus |

---

## Configuração

### Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PORT` | Porta do serviço | `3010` |
| `REDIS_URL` | URL do Redis | (obrigatório) |
| `INTERNAL_API_SECRET` | Secret para autenticação interna | (obrigatório) |
| `LLM_GPU_URL` | URL do serviço LLM | `http://gpu-llm:8000` |
| `EMBEDDINGS_GPU_URL` | URL do serviço de embeddings | `http://gpu-embeddings:8000` |
| `ASR_GPU_URL` | URL do serviço ASR | `http://gpu-asr:8000` |
| `TRAINING_GPU_URL` | URL do serviço de training | `http://gpu-trainer:8000` |
| `GPU_SERVICE_TIMEOUT` | Timeout para requisições GPU | `60000` (60s) |

---

## Treinamento (Schedule + On-Demand)

### Schedule Semanal

O treinamento automático é agendado para domingo às 3:00 AM:

```
┌───────────────────────────────────────────────────────────┐
│  Domingo 3:00 AM - Treinamento Semanal QLoRA              │
├───────────────────────────────────────────────────────────┤
│  1. Avaliar qualidade dos dados (mín. 50 aprovados)       │
│  2. Pausar serviços GPU principais (liberar VRAM)         │
│  3. Iniciar container gpu-trainer                          │
│  4. Executar QLoRA incremental                             │
│  5. Comparar métricas com baseline                         │
│  6. Se regressão > 5%: rollback automático                │
│  7. Retomar serviços GPU principais                        │
└───────────────────────────────────────────────────────────┘
```

### Treinamento On-Demand

Via Training Service API ou Dashboard Admin:

```bash
# Iniciar treinamento on-demand
POST /api/training/run/start
{
  "tenantId": "uuid",
  "trainingType": "incremental",
  "includeImages": false,
  "priority": "normal"
}

# Verificar status
GET /api/training/run/status?tenantId=uuid

# Cancelar treinamento
DELETE /api/training/run/cancel
{
  "trainingRunId": "uuid",
  "reason": "Cancelado pelo usuário"
}
```

---

## Modelos (Gate 2)

### LLM (texto): Qwen2.5 7B Instruct (AWQ)

- Usado para: chat e trading (texto).
- Requisito: deve ser o mesmo **modelo base** do pipeline de treinamento (QLoRA) para evitar divergência.

### Vision (análise de imagens): OpenAI Responses API (`gpt-4.1`)

- Usado para: análise multimodal de imagens (ex.: screenshots e gráficos).
- Não utiliza GPU local (remove carga e complexidade operacional).

### Geração de imagens: OpenAI Images API (`gpt-image-1`)

- Usado para: geração de imagens a partir de prompt.

---

## Histórico de Versões

| Versão | Data | Descrição |
|--------|------|-----------|
| 4.2.0 | 16/01/2026 | Remoção do VLM local e migração de Vision/Images para OpenAI; LLM Qwen2.5 7B com contexto 8k |
| 4.0.5 | 15/01/2026 | WS3: Corrigir SSOT GPU e garantir QUANTIZATION=int8 refletido no runtime (fail-fast, sem fallback) |
| 4.0.4 | 12/01/2026 | Otimização COMPLETA: embeddings + asr + trainer pytorch-devel → runtime (-18GB total, -35%) |
| 4.0.3 | 12/01/2026 | Otimização imagem embeddings: pytorch-devel → pytorch-runtime (-6GB, -35%) |
| 4.0.2 | 12/01/2026 | Correção VRAM Qwen-VL (ajustes de KV cache e budget) |
| 4.0.1 | 12/01/2026 | Correções vLLM 0.12.0 (dtype float16, JSON limit-mm-per-prompt) |
| 4.0.0 | 11/01/2026 | Arquitetura simplificada, Qwen2.5-VL, todos simultâneos |
| 3.0.0 | 09/01/2026 | Orquestração dinâmica via Docker API |
| 2.0.0 | 25/12/2025 | Fila priorizada, circuit breakers |
| 1.0.0 | 17/12/2025 | Versão inicial |

---

## Referências

- [Qwen2.5 7B Instruct AWQ](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-AWQ)
- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)
- [OpenAI Image Generation](https://platform.openai.com/docs/guides/images/image-generation)
- [vLLM Documentation](https://docs.vllm.ai/)
- [CLAUDE.md - Regras do Projeto](../CLAUDE.md)
