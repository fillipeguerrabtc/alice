# Sistema de Aprendizado da Alice

**Autor:** Fillipe Guerra  
**Versão:** 3.9 - Otimização CI Performance Enterprise  
**Data:** 27 de Dezembro de 2025

> Atualização 21/12/2025: Ajuste no CI para evitar duplicação de execuções (push apenas em `main` + PR) e correção de tipos do frontend (SignalApprovalPanel/TechnicalAnalysisPanel) garantindo sucesso do Release.

> Atualização 26/12/2025: Padronização de line endings com `.gitattributes` e `.editorconfig` (LF padrão; CRLF apenas para scripts Windows) para eliminar diffs ruidosos e manter consistência enterprise.

## Visão Geral

A Alice Enterprise Platform possui um sistema de aprendizado contínuo e agressivo que permite que o modelo evolua constantemente com base nas interações e dados fornecidos.

---

## ARQUITETURA ENTERPRISE + TRADING (17/12/2025)

### Mudança Crítica

A partir de 25/12/2025, a Alice utiliza **arquitetura 100% GPU local via Hetzner GPU GEX44** para processamento de IA:

| Componente | Modelo | Dimensões | Infraestrutura |
|------------|--------|-----------|----------------|
| **Embeddings de Texto** | Qwen3-Embedding-8B | **4096 dim** → Qdrant | GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB) |
| **Embeddings de Imagem** | OpenCLIP ViT-H/14 | 1024 dim → pgvector | GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB) |
| **Transcrição de Áudio** | Canary-1B (NeMo) | - | GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB) |
| **LLM Inference** | **Mixtral 8x7B (vLLM AWQ)** | - | GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB) |
| **Geração de Imagens** | FLUX.1 Schnell | - | GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB) |
| **Fine-tuning** | LoRA Progressive (gpu-trainer) | - | GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB) |
| **Trading BTC** | KuCoin Futures API | - | Hetzner (integrations-service) |

### GPU Dedicada 24/7 (Hetzner GEX44)

Com servidor GPU dedicado, os modelos estão sempre carregados em memória:

| Cenário | Latência | Motivo |
|---------|----------|--------|
| **Qualquer requisição** | ~0.5-1 segundo | Modelos sempre carregados na VRAM (containers Docker 24/7) |

> **Arquitetura Enterprise (26/12/2025):** Todos os serviços GPU rodam localmente no servidor Hetzner GPU GEX44 com containers Docker 24/7. Não há cold start - GPU está sempre disponível. GPU Manager Service gerencia requisições com fila priorizada, monitoramento VRAM e circuit breakers. A estratégia "Warm on Demand" foi removida pois não se aplica a servidor dedicado. Ver [docs/ARQUITETURA-GPU-MANAGER.md](ARQUITETURA-GPU-MANAGER.md) para guia completo.

**Componentes:**
- **Redis Queue:** Processamento assíncrono de embeddings
- **Embedding Worker:** Worker dedicado para processar fila
- **WebSocket:** Notificações em tempo real (`/ws/embeddings`)
- **REST Endpoints:** `/api/rag/embeddings/queue/*`

---

## Fontes de Dados para Aprendizado

### 1. Chat (Automático) ✅

| Tipo | Processamento | Critério de Aprovação |
|------|---------------|----------------------|
| **Conversas Texto** | Automático | Rating >= 4 estrelas pelo usuário |
| **Imagens Geradas** | Semi-automático | Aprovação manual no dashboard |
| **Imagens Upload** | Automático | OpenCLIP ViT-H/14 embeddings (1024 dim) para RAG multimodal |

**Como funciona:**
- Cada mensagem no chat é avaliada pelo usuário (1-5 estrelas)
- Mensagens com rating >= 4 são candidatas a treinamento
- Admin pode aprovar/reprovar no dashboard (`/training`)
- Dados aprovados entram no próximo ciclo de fine-tuning

**Integração Implementada (chat-service/index.ts linha 3905):**
```typescript
// Quando usuário avalia mensagem com rating >= 4
const trainingResponse = await fetch(`${TRAINING_SERVICE_URL}/api/training/data`, {
  method: 'POST',
  body: JSON.stringify({
    source: 'chat',
    messages: [...],
    rating: finalRating,
  }),
});
```

### 2. WhatsApp (Automático) ✅

| Tipo | Processamento | Critério de Aprovação |
|------|---------------|----------------------|
| **Texto** | Automático | Rating inferido (5 = sem escalação, 1 = escalou) |
| **Imagens** | Automático | OpenCLIP ViT-H/14 embeddings (1024 dim → pgvector) |
| **Áudios** | Automático | Canary-1B transcrição + Qwen3-Embedding-8B embeddings (4096 dim → Qdrant) |

**Integração Implementada (integrations-service/index.ts linha 2369):**
```typescript
// Após cada interação WhatsApp bem-sucedida
const rating = chatResult.escalated ? 1 : 5; // Inferir rating baseado em escalação
const trainingResponse = await fetch(`${TRAINING_SERVICE_URL}/api/training/data`, {
  method: 'POST',
  body: JSON.stringify({
    source: 'whatsapp',
    messages: [userMessage, assistantResponse],
    rating: rating,
  }),
});
```

### 3. Upload de Documentos (RAG) ✅

| Formato Suportado | Processamento |
|-------------------|---------------|
| PDF | Extração de texto + chunking |
| DOCX | Extração de texto + chunking |
| TXT | Chunking direto |
| Markdown | Chunking direto |
| CSV/JSON | Estruturado para RAG |

**Como funciona:**
- Documentos são uploadeados via `/api/rag/documents`
- Texto é dividido em chunks (1000 chars, 200 overlap)
- Embeddings são gerados via GPU Manager Service (Qwen3-Embedding-8B, 4096 dim - Hetzner GEX44)
- Chunks ficam disponíveis IMEDIATAMENTE para busca semântica no Qdrant

### 4. Dashboard Admin (Manual) ✅

**Funcionalidades:**
- Visualizar todos os dados pendentes de aprovação
- Aprovar/Reprovar dados de treinamento em lote
- Visualizar galeria de imagens geradas
- Aprovar imagens para treinamento
- Marcar dados como "alta qualidade"
- **Bulk Import:** Interface visual para importação em massa de dados de treinamento (JSON/JSONL)

**Acesso:**
- Rota: `/training`
- Requer role: `admin` ou `super_admin`

### 5. API de Bulk Import (Programático) ✅

**Endpoint:** `POST /api/training/bulk-import`

```json
{
  "source": "external_dataset",
  "data": [
    {
      "messages": [
        {"role": "user", "content": "Como funciona X?"},
        {"role": "assistant", "content": "X funciona da seguinte forma..."}
      ],
      "rating": 5
    }
  ]
}
```

---

## Fluxo de Aprendizado Completo

```
┌─────────────────────────────────────────────────────────────┐
│                    COLETA (Tempo Real)                      │
│  Chat → WhatsApp → Documentos → Dashboard → API             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│      PROCESSAMENTO MULTIMODAL (GPU Manager Service)       │
│  • Texto: Qwen3-Embedding-8B (4096 dim) → Qdrant            │
│  • Imagem: OpenCLIP ViT-H/14 (1024 dim) → pgvector          │
│  • Áudio: Canary-1B + Qwen3 (4096 dim) → Qdrant             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                AVALIAÇÃO DE QUALIDADE                       │
│  • Rating >= 4 estrelas (chat)                              │
│  • Sem escalação (WhatsApp)                                 │
│  • Aprovação manual (opcional)                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                 DEDUPLICAÇÃO (SemHash)                      │
│  • Hash semântico de cada entrada                           │
│  • Similaridade > 95% = duplicata                           │
│  • Mantém apenas dados únicos                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              PROGRESSIVE LoRA (A cada 4 dias)               │
│  • Coleta dados aprovados                                   │
│  • Gera dataset JSONL                                       │
│  • Inicia job em slices via GPU Manager (prioridade 3)      │
│  • GPU: RTX 4000 Ada 20GB (gpu-trainer container)           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   VALIDAÇÃO                                 │
│  • Compara métricas com baseline                            │
│  • Accuracy, F1 Score, Perplexity                           │
│  • Threshold de melhoria: > 0%                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
            ┌───────────────────────────────┐
            │     Melhorou?                 │
            └───────────────────────────────┘
                    │               │
                   SIM             NÃO
                    ↓               ↓
        ┌───────────────┐   ┌───────────────┐
        │    DEPLOY     │   │   ROLLBACK    │
        │ (Nova versão) │   │ (Automático)  │
        └───────────────┘   └───────────────┘
```

---

## Schedule de Aprendizado (Híbrido: Cron + Threshold)

| Operação | Frequência | Horário | Mínimo de Dados | Qualidade Mínima |
|----------|------------|---------|-----------------|------------------|
| RAG Update | Tempo real | - | 1 documento | - |
| Auto-indexação | Diário | 3:00 AM | - | - |
| Fine-tuning LoRA | **4 dias** | 2:00 AM | **50 entradas** | **50% rating >= 4** |
| Fine-tuning Completo | **Quinzenal** | 1:00 AM | **200 entradas** | **50% rating >= 4** |

**Lógica de Decisão:**
```typescript
// auto-learning-scheduler.ts
if (evaluation.recommendation === 'proceed' && job.tenantId) {
  // Só executa se:
  // 1. Atingiu threshold mínimo de dados
  // 2. Qualidade >= 50% (rating >= 4)
  await startProgressiveLoRA(job.tenantId, { includeImages: true });
}
```

---

## Processamento de Áudio - ARQUITETURA 100% GPU

### Visão Geral

O processamento de áudio utiliza **GPU obrigatória** via GPU Manager Service:

| Aspecto | GPU Manager Service (Hetzner GEX44) |
|---------|-----------------|
| **Modelo Transcrição** | Canary-Qwen-2.5B (NeMo) |
| **Velocidade** | 7-9x realtime |
| **Modelo Embeddings** | Qwen3-Embedding-8B (4096 dim) |
| **Fallback CPU** | **NÃO EXISTE** (Regra 6) |

### Fluxo de Transcrição

```
┌─────────────────────────────────────────────────────────────┐
│                   UPLOAD DE ÁUDIO                          │
│  • Validação de formato (MP3, WAV, OGG, WEBM, etc.)        │
│  • Extração de metadata (duração, bitrate, channels)       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│          TRANSCRIÇÃO GPU (OBRIGATÓRIA)                     │
│  • Canary-Qwen-2.5B (NeMo)                                  │
│  • 7-9x realtime                                            │
│  • CUDA accelerated RTX 4000 Ada 20GB                       │
│  • GPU Manager Service gerencia requisições ASR             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              GERAÇÃO DE EMBEDDING (GPU)                    │
│  • Qwen3-Embedding-8B (4096 dim) → Qdrant                  │
│  • GPU Manager Service gerencia embeddings localmente     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                 ARMAZENAMENTO                              │
│  • Transcrição + embedding no PostgreSQL                   │
│  • Arquivo original em /opt/alice/uploads                  │
└─────────────────────────────────────────────────────────────┘
```

### Configuração

| Variável | Descrição | Obrigatoriedade |
|----------|-----------|-----------------|
| `GPU_MANAGER_URL` | URL do GPU Manager Service (default: http://alice-gpu-manager:3010) | ⏳ **Opcional** (tem default) |

---

## Processamento de Imagens - ARQUITETURA 100% GPU

### Modelos

| Tipo | Modelo | Dimensões | Uso |
|------|--------|-----------|-----|
| **Imagem → Embedding** | OpenCLIP ViT-H/14 | 1024 dim (nativo) | Busca por imagem |
| **Texto → Embedding (para buscar imagem)** | OpenCLIP Text Encoder | 1024 dim (pgvector) | Busca texto→imagem |
| **Texto genérico** | Qwen3-Embedding-8B | 4096 dim (Qdrant) | Documentos, chat, trading |

### Endpoints GPU

| Endpoint | Modelo | Uso |
|----------|--------|-----|
| `/embed/text` | Qwen3-Embedding-8B | Texto de documentos, transcrições (4096 dim → Qdrant) |
| `/embed/image` | OpenCLIP ViT-H/14 | Embeddings de imagens (1024 dim → pgvector) |
| `/embed/text-for-image` | OpenCLIP Text Encoder | Busca texto→imagem (1024 dim) |
| `/embed/batch` | Ambos | Processamento em lote |

---

## Versionamento de Modelos

Cada ciclo de fine-tuning cria uma nova versão:

| Campo | Descrição |
|-------|-----------|
| `version` | Número incremental (1, 2, 3...) |
| `baseModel` | Mixtral 8x7B (vLLM AWQ) |
| `loraPath` | Caminho dos pesos LoRA |
| `trainingDataCount` | Quantidade de dados usados |
| `imageDataCount` | Quantidade de imagens usadas |
| `improvementPercent` | Melhoria vs baseline |
| `isActive` | Se é a versão em uso |

### Rollback Automático

Se uma nova versão tiver degradação > 5%:
1. Sistema detecta automaticamente
2. Reverte para versão anterior
3. Marca nova versão como `rolled_back`
4. Notifica administradores

---

## Métricas de Aprendizado

Acessíveis em `/dashboard/analytics`:

| Métrica | Descrição |
|---------|-----------|
| Dados Coletados | Total de entradas pendentes |
| Dados Aprovados | Entradas aprovadas para treino |
| Taxa de Qualidade | % com rating >= 4 |
| Versão Atual | Versão do modelo em uso |
| Última Atualização | Data do último fine-tuning |
| Melhoria Acumulada | % de melhoria total |

---

## Segurança e Privacidade

- Dados NUNCA saem da infraestrutura controlada
- Fine-tuning acontece no Hetzner GPU GEX44 (GPU dedicada 24/7)
- Multi-tenant: dados isolados por tenant_id
- Auditoria completa de todas as operações
- RBAC: apenas admins aprovam dados

---

---

# 📋 PLANO DE GAPS - VERIFICAÇÃO COMPLETA (15/12/2025)

## Status Geral

| Categoria | Status | Prioridade |
|-----------|--------|------------|
| Arquitetura 100% GPU | ✅ Implementada | - |
| GPU Dedicada 24/7 | ✅ Hetzner GEX44 | Sem cold start |
| Coleta Chat → Training | ✅ Implementada | - |
| Coleta WhatsApp → Training | ✅ Implementada | - |
| WhatsApp Mídia → RAG | ✅ Implementada (15/12/2025) | - |
| Dashboard Admin | ✅ Completo (15/12/2025) | - |
| Upload Multimodal UI | ✅ Implementada (15/12/2025) | - |
| Documentação | ✅ Atualizada | - |

---

## ✅ IMPLEMENTADO CORRETAMENTE

### 1. Arquitetura Enterprise 100% GPU
- ✅ Embeddings de texto (Qwen3-Embedding-8B, **4096 dim**) via GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB) → Qdrant
- ✅ Embeddings de imagem (OpenCLIP ViT-H/14, 1024 dim) via GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB) → pgvector
- ✅ Transcrição de áudio (Canary-1B NeMo) via GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB)
- ✅ LLM Trading (Mixtral 8x7B vLLM AWQ) via GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB)
- ✅ Qdrant para texto (4096 dim com HNSW) + pgvector para imagem (1024 dim)
- ✅ Validação de dimensão em `validateEmbeddingDimension`
- ✅ Sem fallback CPU (Regra 6)

### 2. GPU Dedicada 24/7 (Hetzner GEX44)
- ✅ Containers Docker rodando 24/7 - sem cold start
- ✅ Redis Queue para processamento assíncrono (`embedding-queue.ts`)
- ✅ Worker dedicado (`embedding-worker.ts`)
- ✅ WebSocket para notificações (`embedding-websocket.ts`)
- ✅ Endpoints REST: `/api/rag/embeddings/queue/*`
- ⚠️ Estratégia "Warm on Demand" removida (26/12/2025) - não se aplica a GPU dedicada

### 3. Coleta de Dados para Treinamento
- ✅ **Chat Web:** `chat-service/index.ts` linha 3905 - POST `/api/training/data`
- ✅ **WhatsApp:** `integrations-service/index.ts` linha 2369 - POST `/api/training/data`
- ✅ Rating inferido automaticamente (sem escalação = 5, com escalação = 1)

### 4. Schedule de Treinamento
- ✅ Fine-tuning LoRA a cada 4 dias (minDataRequired: 50)
- ✅ Fine-tuning Completo quinzenal (minDataRequired: 200)
- ✅ Threshold de qualidade >= 50% rating >= 4
- ✅ Rollback automático se degradação > 5%

### 5. Documentação
- ✅ `CLAUDE.md` atualizado para arquitetura 100% GPU
- ✅ `SISTEMA-APRENDIZADO.md` atualizado (este arquivo)
- ✅ `STATUS-REAL-ATUAL.md` atualizado
- ✅ `DEPLOYMENT.md` atualizado
- ✅ `SECRETS.md` atualizado

---

## ✅ GAPS RESOLVIDOS (15/12/2025)

### GAP 1: Dashboard Multimodal Unificado ✅ RESOLVIDO
**Status:** Implementado em 15/12/2025

**Solução Implementada:**
- Nova tab "Upload Multimodal" em `/training`
- Drag & drop para imagens (JPEG, PNG, WebP, GIF até 10MB)
- Drag & drop para áudios (MP3, WAV, OGG, WEBM até 25MB)
- Fila de upload visual com status em tempo real
- Processamento via GPU (Qwen3-Embedding-8B + OpenCLIP + Canary-1B ASR)
- Internacionalização PT-BR e EN

**Arquivos modificados:**
- `apps/frontend-service/src/pages/Training.tsx` - Novo componente `MultimodalUploadTab`
- `apps/frontend-service/src/locales/pt-BR.json` - Traduções PT-BR
- `apps/frontend-service/src/locales/en.json` - Traduções EN

### GAP 2: Endpoint RAG Documents no Dashboard ✅ JÁ EXISTIA
**Status:** Página `/documents` já existia desde versões anteriores

**Funcionalidades existentes:**
- Upload de documentos (PDF, DOCX, TXT, MD, CSV, JSON)
- Lista de documentos com status de processamento
- Filtros por status (processado/pendente)
- Visualização de conteúdo
- Deleção de documentos
- Grid/List view modes

### GAP 3: Coleta de Mídia WhatsApp para RAG ✅ RESOLVIDO
**Status:** Implementado em 15/12/2025

**Solução Implementada:**
- Nova função `processWhatsAppMediaForRAG()` em `integrations-service`
- Mídia do WhatsApp é baixada do Twilio e enviada para `/api/media/upload/json`
- Imagens: OpenCLIP embeddings (1024 dim)
- Áudios: Canary-1B transcrição + Qwen3-Embedding-8B embeddings (4096 dim → Qdrant)
- Vídeo: **não suportado** (removido). Uploads `video/*` são rejeitados explicitamente.
- Processamento fire-and-forget (não bloqueia resposta ao usuário)
- `RAG_SERVICE_URL` adicionado ao docker-compose para integrations-service

**Arquivos modificados:**
- `apps/integrations-service/src/index.ts` - Nova função e chamada no webhook
- `infra/docker/docker-compose.prod.yml` - RAG_SERVICE_URL e depends_on alice-rag

### GAP 4: Imagens Docker GPU ✅ RESOLVIDO (27/12/2025)
**Status:** Build automático via CI/CD

**Ações realizadas:**
1. Workflow `release.yml` garante automaticamente 5 imagens GPU (mixtral-vllm, embeddings-gpu, flux-schnell, asr-canary, lora-trainer). Quando não há mudanças no contexto do serviço, o pipeline faz **retag no GHCR** (mesmo digest do release anterior) ao invés de rebuild completo.
2. Timeout aumentado de 30min para 90min (imagens GPU são muito pesadas)
3. 4/5 Dockerfiles migrados para imagem base `pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime` (PyTorch pré-instalado = ~12GB economia)
4. BuildKit cache mount adicionado para cache persistente de pip
5. GPU Manager Service gerencia automaticamente todos os serviços GPU (sem secrets externos necessários)

### GAP 5: Arquivo clip-service-url.ts Obsoleto ✅ RESOLVIDO
**Status:** Removido em 15/12/2025

**Ações realizadas:**
- Arquivo `apps/rag-service/src/clip-service-url.ts` deletado
- Import removido de `apps/rag-service/src/index.ts`
- Variável `CLIP_SERVICE_URL` não utilizada removida

---

## 📊 RESUMO EXECUTIVO (15/12/2025)

| Item | Status | Observação |
|------|--------|------------|
| Bug `requireAuth` vs `requireAuth()` | ✅ Corrigido | - |
| Bug ordenação rotas Express | ✅ Corrigido | - |
| Bug `generateEmbeddingInternal` | ✅ Corrigido | - |
| Arquitetura 100% GPU | ✅ Implementada | - |
| GPU Dedicada 24/7 | ✅ Hetzner GEX44 | Sem cold start |
| Coleta Chat → Training | ✅ Funcionando | - |
| Coleta WhatsApp → Training | ✅ Funcionando | - |
| Dashboard Upload Multimodal | ✅ GAP #1 Resolvido | Nova tab em /training |
| Página /documents | ✅ GAP #2 Já existia | UI completa |
| Mídia WhatsApp → RAG | ✅ GAP #3 Resolvido | Indexação automática |
| Build Imagens GPU | ⏳ GAP #4 Pendente | Workflow manual necessário |
| Limpeza código obsoleto | ✅ GAP #5 Resolvido | Arquivo deletado |

---

*Autor: Fillipe Guerra*
*Documentação em Português Brasileiro (Regra 10 CLAUDE.md)*
*Versão 3.9 - 27 de Dezembro de 2025*
*LLM: Mixtral 8x7B (vLLM AWQ) via GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB)*
*ARQUITETURA ENTERPRISE: Texto (Qwen3-Embedding-8B Apache 2.0, 4096 dim → Qdrant) + Imagem (OpenCLIP ViT-H/14 MIT, 1024 dim → pgvector)*
*ASR: Canary-1B via NeMo Toolkit (Apache 2.0)*
*Análise de Licenças (17/12/2025): Qwen3 é ÚNICO modelo top-tier com licença comercial (Apache 2.0). Fin-E5, Linq-Embed-Mistral e NV-Embed-v2 são CC BY-NC (Non-Commercial).*
*Fisher-Yates Shuffle (17/12/2025): Corrigido bug de distribuição enviesada em train/validation split*
*Bug Fix Embeddings (17/12/2025): TODOS embeddings de texto (documentos/áudio) agora vão para Qdrant (4096 dim)*
*Bug Fix SQL IN Clause (19/12/2025): learning-worker.ts corrigido - sql template literal com join() parametrizava string inteira. Usa inArray() do Drizzle (3 ocorrências)*
*Trading: KuCoin Futures BTC Perpetuals + Scalping (1m/3m/5m) + LoRA Fine-tuning*
*GPU Dedicada 24/7 (26/12/2025): Hetzner GEX44 - containers Docker rodando continuamente, sem cold start. Estratégia "Warm on Demand" removida.*
