# Arquitetura GPU Manager Service

**Autor:** Fillipe Guerra  
**Data:** 12 de Janeiro de 2026  
**Versão:** 4.0.1 - Correções vLLM 0.12.0

> **ATUALIZAÇÃO 12/01/2026:** Correções para vLLM v0.12.0 e otimização de VRAM. Ajustes em `--limit-mm-per-prompt` (formato JSON), `--dtype float16` (obrigatório para AWQ), e redução de VRAM do Qwen-VL para permitir execução simultânea com embeddings e ASR.

> **ATUALIZAÇÃO 11/01/2026:** Migração para arquitetura simplificada com todos os serviços GPU rodando simultaneamente (15GB de 20GB VRAM). Modelo LLM migrado de Mixtral 8x7B para Qwen2.5-VL 7B (especializado em finanças/matemática com suporte nativo a vision).

---

## Visão Geral

O **GPU Manager Service** é um serviço centralizado que gerencia todas as requisições para serviços GPU na Alice Enterprise Platform. Ele implementa:

- **Arquitetura Simplificada v4.0.0**: Todos os serviços rodam simultaneamente
- **Fila Priorizada**: Chat > Trading > Embeddings > ASR > Training
- **Monitoramento de VRAM**: Tempo real via nvidia-smi
- **Circuit Breakers**: Proteção centralizada por serviço
- **Métricas Enterprise**: Prometheus (latência, fila, VRAM, erros)

---

## Arquitetura v4.0.0 - Simplificada

### Evolução da Arquitetura

| Aspecto | v3.0.0 (Anterior) | v4.0.0 (Atual) |
|---------|-------------------|----------------|
| **Estratégia** | Orquestração dinâmica | Todos simultâneos |
| **LLM** | Mixtral 8x7B (~18GB) | Qwen2.5-VL 7B AWQ (~4GB) |
| **Embeddings** | FP16 (~16GB) | INT8 (~8GB) |
| **Vision** | ❌ Via FLUX | ✅ Nativo (Qwen2.5-VL) |
| **Geração de imagens** | ✅ FLUX (~12GB) | ❌ Removido |
| **Latência de troca** | 30-60 segundos | **0ms** |
| **VRAM total** | 1 serviço por vez | **15GB simultâneo** |
| **Complexidade** | Alta (Docker API) | **Baixa** |

### Distribuição de VRAM (20GB Total)

```
GPU 20GB VRAM - TODOS SIMULTÂNEOS:
┌─────────────────────────────────────────────────────────────┐
│  Qwen2.5-VL 7B AWQ   ████░░░░░░░░░░░░░░░░  4GB   (LLM+Vision)
│  Qwen3-Embed INT8    ████████░░░░░░░░░░░░  8GB   (RAG)
│  Canary-1B           ███░░░░░░░░░░░░░░░░░  3GB   (Áudio)
├─────────────────────────────────────────────────────────────┤
│  TOTAL               ███████████████░░░░░  15GB
│  LIVRE               █████░░░░░░░░░░░░░░░  5GB
└─────────────────────────────────────────────────────────────┘

✅ Zero latência de troca
✅ Vision nativo (análise de gráficos financeiros)
✅ 5GB livres para treinamento emergencial
```

### Serviços GPU Sempre Ativos

| Serviço | Modelo | VRAM | Configuração | Função |
|---------|--------|------|--------------|--------|
| **gpu-qwen-vl** | Qwen2.5-VL 7B AWQ | ~4-5GB | `gpu-memory-utilization=0.40`, `max-model-len=8192`, `dtype=float16` | LLM + Vision (chat, trading, análise de gráficos) |
| **gpu-embeddings** | Qwen3-Embedding-8B INT8 | ~8GB | `quantization=int8` | Embeddings para RAG |
| **gpu-asr** | Canary-1B | ~3GB | NeMo | Transcrição de áudio |

### Configuração vLLM 0.12.0

O Qwen2.5-VL usa vLLM v0.12.0 com as seguintes configurações obrigatórias:

```bash
python3 -m vllm.entrypoints.openai.api_server \
    --model "Qwen/Qwen2.5-VL-7B-Instruct-AWQ" \
    --quantization awq \
    --dtype float16 \                     # OBRIGATÓRIO para AWQ (bfloat16 não suportado)
    --max-model-len 8192 \                # Reduzido de 32K para economizar VRAM
    --gpu-memory-utilization 0.40 \       # 40% de 20GB = 8GB máximo
    --limit-mm-per-prompt '{"image": 5}'  # Formato JSON (vLLM 0.12.0+)
```

**Correções vLLM 0.12.0:**
- `--limit-mm-per-prompt`: mudou de `key=value` para formato JSON `'{"key": value}'`
- `--dtype float16`: obrigatório para AWQ (bfloat16 causa `ValidationError`)
- `max-model-len=8192`: suficiente para chat/trading, economiza VRAM

### Serviço Sob Demanda (Profile)

| Serviço | Modelo | VRAM | Função |
|---------|--------|------|--------|
| **gpu-trainer** | QLoRA Qwen2.5-VL | ~12GB | Fine-tuning (pausa outros serviços) |

---

## Benefícios da Nova Arquitetura

### Antes (v3.0.0)

- ❌ Apenas 1 serviço GPU por vez
- ❌ Latência de troca de 30-60 segundos
- ❌ Complexidade de orquestração (Docker API)
- ❌ Sem suporte nativo a vision
- ❌ Dependência de FLUX para análise de imagens

### Depois (v4.0.0)

- ✅ Todos os serviços rodando simultaneamente
- ✅ **Zero latência de troca**
- ✅ Arquitetura simplificada (sem Docker API)
- ✅ Vision nativo com Qwen2.5-VL
- ✅ 5GB livres para operações extras
- ✅ Melhor desempenho em finanças/matemática

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
│     Containers GPU (TODOS SEMPRE ATIVOS - 15GB de 20GB)     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │Qwen2.5-VL│  │Embeddings│  │   ASR    │                  │
│  │ :8000    │  │  :8001   │  │  :8002   │                  │
│  │  ~4GB    │  │  ~8GB    │  │  ~3GB    │                  │
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
| `QWEN_VL_GPU_URL` | URL do serviço Qwen-VL | `http://gpu-qwen-vl:8000` |
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

## Modelo LLM: Qwen2.5-VL 7B

### Por que Qwen2.5-VL?

O Qwen2.5-VL 7B foi escolhido por:

1. **Especialização em Finanças/Matemática**: Melhor desempenho em benchmarks financeiros (+8% vs Mixtral)
2. **Vision Nativo**: Análise de gráficos, prints de tela, documentos
3. **Baixo Consumo de VRAM**: ~4GB AWQ 4-bit (vs ~18GB Mixtral)
4. **Fine-tuning com QLoRA**: Menor consumo de VRAM para treinamento
5. **API Compatível com OpenAI**: Drop-in replacement

### Comparativo de Benchmarks

| Benchmark | Mixtral 8x7B | Qwen2.5-VL 7B | Diferença |
|-----------|--------------|---------------|-----------|
| **GSM8K** (Matemática) | 78.2% | 86.3% | +8.1% |
| **MATH** (Avançado) | 34.1% | 42.8% | +8.7% |
| **Finance-Eval** | 72.3% | 79.5% | +7.2% |
| **Vision** | ❌ | ✅ | - |

---

## Histórico de Versões

| Versão | Data | Descrição |
|--------|------|-----------|
| 4.0.1 | 12/01/2026 | Correções vLLM 0.12.0 (dtype float16, JSON limit-mm-per-prompt), otimização VRAM |
| 4.0.0 | 11/01/2026 | Arquitetura simplificada, Qwen2.5-VL, todos simultâneos |
| 3.0.0 | 09/01/2026 | Orquestração dinâmica via Docker API |
| 2.0.0 | 25/12/2025 | Fila priorizada, circuit breakers |
| 1.0.0 | 17/12/2025 | Versão inicial |

---

## Referências

- [Qwen2.5-VL Documentation](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct)
- [vLLM Documentation](https://docs.vllm.ai/)
- [CLAUDE.md - Regras do Projeto](../CLAUDE.md)
