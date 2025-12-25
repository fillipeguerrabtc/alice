# Análise: RTX 4090 24GB VRAM - Suficiência para Alice Enterprise Platform

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025  
**Versão:** 1.0.0

---

## ✅ CONCLUSÃO EXECUTIVA

**SIM, 24GB de VRAM (RTX 4090) é SUFICIENTE** para todos os serviços da Alice Enterprise Platform, incluindo:
- ✅ **Mixtral 8x7B** (LLM para chat e trading)
- ✅ **Trading BTC Futures** (usa Mixtral)
- ✅ **Atendimento WhatsApp** (usa Mixtral)
- ✅ **Embeddings** (Qwen3 + OpenCLIP)
- ✅ **FLUX.1 Schnell** (geração de imagens)
- ✅ **ASR Canary-1B** (transcrição de áudio)

**Justificativa:** Os serviços **NÃO rodam simultaneamente** na mesma GPU. A estratégia "Warm on Demand" mantém apenas 1 serviço ativo por vez, e todos os serviços cabem individualmente em 24GB.

---

## 📊 ANÁLISE DETALHADA POR SERVIÇO

### 1. Mixtral 8x7B vLLM (LLM Principal)

| Aspecto | Valor |
|---------|-------|
| **Modelo** | TheBloke/Mixtral-8x7B-Instruct-v0.1-AWQ |
| **Quantização** | AWQ 4-bit |
| **GPU Memory Utilization** | 90% (configurado) |
| **Max Model Length** | 32,768 tokens |
| **VRAM Estimado** | **~18-20GB** |
| **Status** | ✅ **CABE PERFEITAMENTE** |

**Detalhes:**
- Mixtral 8x7B quantizado AWQ 4-bit reduz memória em ~75%
- vLLM otimiza uso de memória com PagedAttention
- 90% de 24GB = 21.6GB disponível (modelo usa ~18-20GB)
- **Margem de segurança**: ~2-4GB livres

**Uso:**
- Chat da Alice (conversas em tempo real)
- Trading BTC Futures (análise técnica + validação LLM)
- Atendimento WhatsApp (respostas automáticas)

---

### 2. Qwen3-Embedding-8B + OpenCLIP ViT-H/14 (Embeddings)

| Aspecto | Valor |
|---------|-------|
| **Modelo Texto** | Qwen3-Embedding-8B (4096 dim) |
| **Modelo Imagem** | OpenCLIP ViT-H/14 (1024 dim) |
| **VRAM Qwen3** | ~16GB |
| **VRAM OpenCLIP** | ~2GB |
| **VRAM Total** | **~18GB** |
| **Status** | ✅ **CABE PERFEITAMENTE** |

**Detalhes:**
- Ambos modelos carregados simultaneamente no mesmo container
- Qwen3-Embedding-8B: 8B parâmetros, modelo grande
- OpenCLIP ViT-H/14: modelo médio
- **Margem de segurança**: ~6GB livres

**Uso:**
- Embeddings de texto para RAG e Trading
- Embeddings de imagem para busca visual
- Processamento multimodal (texto + imagem)

---

### 3. FLUX.1 Schnell (Geração de Imagens)

| Aspecto | Valor |
|---------|-------|
| **Modelo** | black-forest-labs/FLUX.1-schnell |
| **Inference Steps** | 4 (configurado) |
| **VRAM Estimado** | **~12-16GB** |
| **Status** | ✅ **CABE PERFEITAMENTE** |

**Detalhes:**
- FLUX.1 Schnell é versão otimizada (4 steps vs 50+ do FLUX.1 full)
- Modelo menor que FLUX.1 completo
- **Margem de segurança**: ~8-12GB livres

**Uso:**
- Geração de imagens sob demanda
- Não é serviço crítico (pode ser desligado se necessário)

---

### 4. Canary-1B ASR (Transcrição de Áudio)

| Aspecto | Valor |
|---------|-------|
| **Modelo** | nvidia/canary-1b |
| **Parâmetros** | 1B (muito pequeno) |
| **VRAM Estimado** | **~2-4GB** |
| **Status** | ✅ **CABE COM FOLGA** |

**Detalhes:**
- Modelo muito pequeno (1B parâmetros)
- Menor consumo de VRAM de todos os serviços
- **Margem de segurança**: ~20GB livres

**Uso:**
- Transcrição de áudio (WhatsApp voice messages)
- Processamento de áudio para RAG

---

## 🔄 ESTRATÉGIA DE COMPARTILHAMENTO DE GPU

### Arquitetura Atual: Servidor Único com 1 GPU

```
┌─────────────────────────────────────────────────┐
│         RTX 4090 (24GB VRAM)                     │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ Mixtral  │  │Embeddings│  │  FLUX    │     │
│  │ 8x7B     │  │ Qwen3+   │  │ Schnell  │     │
│  │ ~20GB    │  │ OpenCLIP │  │ ~14GB    │     │
│  │          │  │ ~18GB    │  │          │     │
│  └──────────┘  └──────────┘  └──────────┘     │
│                                                  │
│  ┌──────────┐                                    │
│  │  ASR     │                                    │
│  │ Canary  │                                    │
│  │ ~3GB    │                                    │
│  └──────────┘                                    │
└─────────────────────────────────────────────────┘
```

### ⚠️ PROBLEMA: Todos usam `NVIDIA_VISIBLE_DEVICES=0`

**Configuração atual:**
- Todos os 4 containers apontam para a mesma GPU (`device: 0`)
- **NÃO podem rodar simultaneamente** se todos precisarem de GPU ao mesmo tempo

### ✅ SOLUÇÃO: Estratégia "Warm on Demand"

**Como funciona:**
1. **Serviços são chamados sob demanda** (não rodam 24/7)
2. **Keep-warm de 30 minutos**: Serviço fica ativo por 30 min após último uso
3. **Apenas 1 serviço ativo por vez** na maioria dos casos
4. **vLLM PagedAttention**: Gerencia memória dinamicamente

**Cenários de uso:**

| Cenário | Serviços Ativos | VRAM Total | Status |
|---------|----------------|------------|--------|
| **Chat normal** | Mixtral apenas | ~20GB | ✅ OK |
| **RAG com imagem** | Embeddings apenas | ~18GB | ✅ OK |
| **Geração de imagem** | FLUX apenas | ~14GB | ✅ OK |
| **Transcrição áudio** | ASR apenas | ~3GB | ✅ OK |
| **Chat + Trading simultâneo** | Mixtral (compartilhado) | ~20GB | ✅ OK |
| **RAG + Chat simultâneo** | Embeddings + Mixtral | ❌ 38GB | ⚠️ **PROBLEMA** |

---

## ⚠️ CENÁRIOS PROBLEMÁTICOS (Raros)

### Cenário 1: RAG + Chat Simultâneo

**O que acontece:**
- Usuário faz pergunta no chat (Mixtral: ~20GB)
- Sistema busca no RAG (Embeddings: ~18GB)
- **Total necessário**: ~38GB
- **Disponível**: 24GB
- **Resultado**: ❌ **OOM (Out of Memory)**

**Probabilidade:** ⚠️ **BAIXA** (mas possível)

**Soluções:**
1. **Fila de requisições**: Processar sequencialmente
2. **Desligar Embeddings temporariamente**: Se Mixtral estiver ativo
3. **Otimização**: Carregar apenas modelo necessário (texto OU imagem, não ambos)

### Cenário 2: Trading + Chat + RAG Simultâneo

**O que acontece:**
- Trading faz análise (Mixtral: ~20GB)
- Chat recebe mensagem (Mixtral já ativo: ~20GB)
- RAG busca contexto (Embeddings: ~18GB)
- **Total necessário**: ~38GB
- **Resultado**: ❌ **OOM**

**Probabilidade:** ⚠️ **MUITO BAIXA** (trading é assíncrono)

**Soluções:**
- Trading usa fila Redis (não compete com chat)
- RAG pode aguardar se Mixtral estiver ocupado

---

## ✅ RECOMENDAÇÕES PARA OTIMIZAÇÃO

### 1. Implementar Fila de Requisições GPU

**Estratégia:**
```python
# Pseudocódigo
if gpu_memory_available < required_memory:
    queue_request()
    wait_for_gpu()
else:
    process_immediately()
```

**Benefícios:**
- Evita OOM errors
- Garante que apenas 1 serviço pesado use GPU por vez
- Outros serviços aguardam na fila

### 2. Desligar Embeddings se Mixtral Estiver Ativo

**Lógica:**
- Se Mixtral está ativo (chat/trading), desligar Embeddings temporariamente
- Embeddings pode usar CPU fallback (mais lento, mas funciona)
- Ou aguardar Mixtral ficar inativo

### 3. Reduzir GPU Memory Utilization do Mixtral

**Configuração atual:**
```yaml
GPU_MEMORY_UTILIZATION: 0.90  # 90% de 24GB = 21.6GB
```

**Otimização:**
```yaml
GPU_MEMORY_UTILIZATION: 0.75  # 75% de 24GB = 18GB
```

**Trade-off:**
- ✅ Mais memória livre para outros serviços
- ⚠️ Pode reduzir throughput (menos batch size)

### 4. Usar Modelo Menor para Embeddings (Opcional)

**Alternativa:**
- Qwen3-Embedding-2.5B (menor, ~8GB VRAM)
- Perda de qualidade mínima
- Mais memória livre

---

## 📈 CENÁRIOS DE USO REAL

### Cenário A: Atendimento WhatsApp (Normal)

**Fluxo:**
1. Mensagem chega → ASR transcreve (~3GB, 5 segundos)
2. ASR desliga → Mixtral responde (~20GB, 10 segundos)
3. Mixtral desliga → Embeddings indexa (~18GB, 2 segundos)
4. Embeddings desliga

**VRAM máxima:** 20GB (Mixtral)  
**Status:** ✅ **OK**

---

### Cenário B: Trading BTC Futures

**Fluxo:**
1. Trading faz análise técnica (CPU)
2. Mixtral valida decisão (~20GB, 5 segundos)
3. Mixtral desliga

**VRAM máxima:** 20GB (Mixtral)  
**Status:** ✅ **OK**

---

### Cenário C: Chat + RAG Simultâneo (Problema)

**Fluxo:**
1. Usuário pergunta no chat
2. Chat inicia Mixtral (~20GB)
3. RAG busca contexto → Embeddings inicia (~18GB)
4. **Total: 38GB > 24GB** ❌

**Solução:**
- Implementar fila: RAG aguarda Mixtral terminar
- Ou: Desligar Embeddings se Mixtral estiver ativo

---

## 🎯 CONCLUSÃO FINAL

### ✅ 24GB é SUFICIENTE se:

1. **Implementar fila de requisições GPU** (evita conflitos)
2. **Serviços não rodam simultaneamente** (estratégia atual)
3. **Trading é assíncrono** (não compete com chat)
4. **RAG aguarda se Mixtral estiver ativo** (prioridade)

### ⚠️ 24GB pode ser INSUFICIENTE se:

1. **Chat + RAG simultâneo** (sem fila)
2. **Múltiplos usuários simultâneos** (múltiplas instâncias Mixtral)
3. **Trading + Chat + RAG ao mesmo tempo** (cenário raro)

### 🚀 RECOMENDAÇÃO

**SIM, use RTX 4090 24GB**, mas:

1. **Implemente fila de requisições GPU** (prioridade alta)
2. **Monitore uso de VRAM** (Prometheus + Grafana)
3. **Configure alerts** para OOM errors
4. **Teste cenários de pico** antes de produção

**Alternativa (se problemas):**
- **RTX 3090 24GB**: Mesma VRAM, mais barato
- **RTX 6000 Ada 48GB**: Mais VRAM, mais caro (overkill)

---

## 📊 COMPARAÇÃO DE OPÇÕES

| GPU | VRAM | Custo Mensal | Suficiência | Recomendação |
|-----|------|--------------|-------------|--------------|
| **RTX 4090** | 24GB | €200-300 | ✅ Suficiente (com fila) | ✅ **RECOMENDADO** |
| **RTX 3090** | 24GB | €150-250 | ✅ Suficiente (com fila) | ✅ Alternativa |
| **RTX 4000 Ada** | 20GB | €184 | ⚠️ Apertado | ⚠️ Risco |
| **RTX 6000 Ada** | 48GB | €400-500 | ✅ Overkill | ❌ Caro demais |

---

**Autor:** Fillipe Guerra  
**Data:** 25 de Dezembro de 2025

