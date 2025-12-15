# Sistema de Aprendizado da Alice

**Autor:** Fillipe Guerra  
**Versão:** 2.0 - ARQUITETURA 100% GPU  
**Data:** 15 de Dezembro de 2025

## Visão Geral

A Alice Enterprise Platform possui um sistema de aprendizado contínuo e agressivo que permite que o modelo evolua constantemente com base nas interações e dados fornecidos.

---

## ARQUITETURA 100% GPU (15/12/2025)

### Mudança Crítica

A partir de 15/12/2025, a Alice utiliza **arquitetura 100% GPU via Salad Cloud** para todos os processamentos de embeddings e transcrições:

| Componente | Modelo | Dimensões | Infraestrutura |
|------------|--------|-----------|----------------|
| **Embeddings de Texto** | BGE-M3 | 1024 dim | GPU Salad Cloud |
| **Embeddings de Imagem** | OpenCLIP ViT-H/14 | 1024 dim | GPU Salad Cloud |
| **Transcrição de Áudio** | Whisper large-v3 | - | GPU Salad Cloud |
| **LLM Inference** | Llama 4 Maverick 400B | - | GPU Salad Cloud |
| **Geração de Imagens** | FLUX.1 Schnell | - | GPU Salad Cloud |
| **Fine-tuning** | LoRA Progressive | - | GPU Salad Cloud |

### Estratégia "Warm on Demand"

Para otimizar custos e latência:

| Cenário | Latência | Motivo |
|---------|----------|--------|
| **Primeira requisição** | 5-30 segundos | GPU cold start no Salad Cloud |
| **Requisições subsequentes** | ~1 segundo | GPU permanece "quente" |
| **Após 30 min inatividade** | 5-30 segundos | GPU é desligada, cold start novamente |

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
| **Imagens Upload** | Automático | OpenCLIP embeddings (1024 dim) para RAG multimodal |

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
| **Imagens** | Automático | OpenCLIP embeddings (1024 dim) |
| **Áudios** | Automático | Whisper transcrição + BGE-M3 embeddings |
| **Vídeos** | Automático | Frames + transcrição |

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
- Embeddings são gerados via GPU Salad Cloud (BGE-M3, 1024 dim)
- Chunks ficam disponíveis IMEDIATAMENTE para busca semântica

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
│           PROCESSAMENTO MULTIMODAL (GPU Salad Cloud)        │
│  • Texto: BGE-M3 (1024 dim)                                 │
│  • Imagem: OpenCLIP ViT-H/14 (1024 dim)                     │
│  • Áudio: Whisper large-v3 + BGE-M3                         │
│  • Vídeo: Frames OpenCLIP + Transcrição BGE-M3              │
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
│  • Inicia job no Salad Cloud                                │
│  • GPU: RTX 3090/4090/A100                                  │
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

O processamento de áudio utiliza **GPU obrigatória** via Salad Cloud:

| Aspecto | GPU Salad Cloud |
|---------|-----------------|
| **Modelo Transcrição** | Whisper large-v3 |
| **Velocidade** | 7-9x realtime |
| **Modelo Embeddings** | BGE-M3 (1024 dim) |
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
│  • Whisper large-v3                                         │
│  • 7-9x realtime                                            │
│  • CUDA accelerated                                         │
│  • SALAD_WHISPER_URL é OBRIGATÓRIO em produção             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              GERAÇÃO DE EMBEDDING (GPU)                    │
│  • BGE-M3 (1024 dim)                                       │
│  • EMBEDDINGS_GPU_URL é OBRIGATÓRIO em produção            │
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
| `SALAD_WHISPER_URL` | URL do serviço whisper-gpu no Salad | **OBRIGATÓRIO** |
| `EMBEDDINGS_GPU_URL` | URL do serviço embeddings-gpu no Salad | **OBRIGATÓRIO** |

---

## Processamento de Imagens - ARQUITETURA 100% GPU

### Modelos

| Tipo | Modelo | Dimensões | Uso |
|------|--------|-----------|-----|
| **Imagem → Embedding** | OpenCLIP ViT-H/14 | 1024 dim | Busca por imagem |
| **Texto → Embedding (para buscar imagem)** | OpenCLIP Text Encoder | 1024 dim | Busca texto→imagem |
| **Texto genérico** | BGE-M3 | 1024 dim | Documentos, chat |

### Endpoints GPU

| Endpoint | Modelo | Uso |
|----------|--------|-----|
| `/embed/text` | BGE-M3 | Texto de documentos, transcrições |
| `/embed/image` | OpenCLIP ViT-H/14 | Embeddings de imagens |
| `/embed/text-for-image` | OpenCLIP Text Encoder | Busca texto→imagem |
| `/embed/batch` | Ambos | Processamento em lote |

---

## Versionamento de Modelos

Cada ciclo de fine-tuning cria uma nova versão:

| Campo | Descrição |
|-------|-----------|
| `version` | Número incremental (1, 2, 3...) |
| `baseModel` | Llama 4 Maverick |
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
- Fine-tuning acontece no Salad Cloud (self-hosted)
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
| Warm on Demand | ✅ Implementada | - |
| Coleta Chat → Training | ✅ Implementada | - |
| Coleta WhatsApp → Training | ✅ Implementada | - |
| Dashboard Admin | ⚠️ Parcial | Alta |
| Documentação | ✅ Atualizada | - |

---

## ✅ IMPLEMENTADO CORRETAMENTE

### 1. Arquitetura 100% GPU
- ✅ Embeddings de texto (BGE-M3, 1024 dim) via GPU Salad
- ✅ Embeddings de imagem (OpenCLIP ViT-H/14, 1024 dim) via GPU Salad
- ✅ Transcrição de áudio (Whisper large-v3) via GPU Salad
- ✅ Schema PostgreSQL atualizado para `vector(1024)`
- ✅ Validação de dimensão em `validateEmbeddingDimension`
- ✅ Sem fallback CPU (Regra 6)

### 2. Estratégia "Warm on Demand"
- ✅ Redis Queue para processamento assíncrono (`embedding-queue.ts`)
- ✅ Worker dedicado (`embedding-worker.ts`)
- ✅ WebSocket para notificações (`embedding-websocket.ts`)
- ✅ Keep-warm por 30 minutos após último uso
- ✅ Endpoints REST: `/api/rag/embeddings/queue/*`

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

## ⚠️ GAPS IDENTIFICADOS

### GAP 1: Dashboard Multimodal Unificado
**Prioridade:** Alta  
**Descrição:** Não existe página dedicada para upload de imagens/áudios/vídeos para treinamento

**Status Atual:**
- ✅ Existe: `/training` com tabs "Dados de Treinamento", "Jobs", "Import em Massa"
- ❌ Falta: Upload direto de imagens para treinamento
- ❌ Falta: Upload direto de áudios para treinamento  
- ❌ Falta: Upload direto de vídeos para treinamento

**Solução Proposta:**
```
/training → Nova tab "Upload Multimodal"
├── Drag & drop para imagens (JPEG, PNG, WebP, GIF)
├── Drag & drop para áudios (MP3, WAV, OGG, WEBM)
├── Drag & drop para vídeos (MP4, WebM, MOV)
├── Preview do conteúdo
├── Auto-processamento via GPU
└── Botão aprovar para treinamento
```

### GAP 2: Endpoint RAG Documents no Dashboard
**Prioridade:** Média  
**Descrição:** O endpoint `/api/rag/documents` existe mas não tem UI dedicada no dashboard

**Status Atual:**
- ✅ Existe: Endpoint REST `/api/rag/documents`
- ❌ Falta: Página `/documents` no dashboard
- ❌ Falta: Interface para upload de PDF/DOCX/TXT

**Solução Proposta:**
```
/documents → Nova página
├── Upload de documentos (PDF, DOCX, TXT, MD)
├── Lista de documentos indexados
├── Status de processamento
├── Busca semântica nos documentos
└── Remoção de documentos
```

### GAP 3: Coleta de Mídia WhatsApp para RAG
**Prioridade:** Média  
**Descrição:** WhatsApp coleta dados para training, mas mídia (imagens/áudios) pode não estar sendo indexada no RAG

**Status Atual:**
- ✅ Texto: Coletado para training
- ⚠️ Imagens: Verificar se embeddings são gerados e salvos no RAG
- ⚠️ Áudios: Verificar se transcrição + embeddings são salvos no RAG

**Verificação Necessária:**
```typescript
// integrations-service: Verificar se mídia WhatsApp gera embeddings
// 1. Imagem recebida → OpenCLIP embedding → salvar no RAG?
// 2. Áudio recebido → Whisper transcrição → BGE-M3 embedding → salvar no RAG?
```

### GAP 4: Imagens Docker GPU
**Prioridade:** Alta  
**Descrição:** Dockerfiles criados mas não buildados

**Status Atual:**
- ✅ `docker/embeddings-gpu/Dockerfile` criado
- ✅ `docker/embeddings-gpu/serve.py` criado
- ✅ `docker/whisper-gpu/Dockerfile` criado
- ✅ `docker/whisper-gpu/serve.py` criado
- ❌ Imagens ainda não buildadas no GHCR
- ❌ Secrets `EMBEDDINGS_GPU_URL` e `SALAD_WHISPER_URL` não criados

**Ação Necessária:**
1. Rodar workflow `build-media-images` manualmente
2. Pegar digests das imagens
3. Criar secrets no GitHub
4. Deploy em produção

### GAP 5: Arquivo clip-service-url.ts Obsoleto
**Prioridade:** Baixa  
**Descrição:** Arquivo `apps/rag-service/src/clip-service-url.ts` pode ser obsoleto após migração para GPU

**Status Atual:**
- Arquivo existe com definição de `CLIP_SERVICE_URL`
- Não é mais usado após migração para `EMBEDDINGS_GPU_URL`

**Ação Necessária:**
- Verificar se arquivo pode ser deletado
- Remover imports não utilizados

---

## 📊 RESUMO EXECUTIVO

| Item | Status | Ação |
|------|--------|------|
| Bug `requireAuth` vs `requireAuth()` | ✅ Corrigido | Commit pendente |
| Bug ordenação rotas Express | ✅ Corrigido | Commit pendente |
| Bug `generateEmbeddingInternal` | ✅ Corrigido | Commit pendente |
| Arquitetura 100% GPU | ✅ Implementada | - |
| Warm on Demand | ✅ Implementada | - |
| Coleta Chat → Training | ✅ Funcionando | - |
| Coleta WhatsApp → Training | ✅ Funcionando | - |
| Dashboard Upload Multimodal | ❌ GAP #1 | Implementar |
| Página /documents | ❌ GAP #2 | Implementar |
| Mídia WhatsApp → RAG | ⚠️ GAP #3 | Verificar |
| Build Imagens GPU | ❌ GAP #4 | Rodar workflow |
| Limpeza código obsoleto | ⚠️ GAP #5 | Limpar |

---

*Autor: Fillipe Guerra*  
*Documentação em Português Brasileiro (Regra 10 CLAUDE.md)*  
*Versão 2.0 - 15 de Dezembro de 2025*  
*ARQUITETURA 100% GPU: Embeddings (BGE-M3 + OpenCLIP ViT-H/14, 1024 dim) + Transcrição (Whisper large-v3) via GPU Salad Cloud*  
*Estratégia "Warm on Demand": Keep-warm 30 min, Redis Queue, WebSocket notifications*
