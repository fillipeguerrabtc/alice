# Sistema de Aprendizado da Alice

**Autor:** Fillipe Guerra  
**Versão:** 6.0 - Qwen3-8B + Orquestração GPU preemptiva + hardening final  
**Data:** 11 de Março de 2026

> **ATUALIZAÇÃO 11/03/2026 (canônica):**
> - Serving: `Qwen/Qwen3-8B-AWQ`
> - Training base: `Qwen/Qwen3-8B`
> - Embeddings: `Qwen/Qwen3-Embedding-0.6B`
> - Runtime GPU mutuamente exclusivo (serving vs training) com preempção automática
> - Reasoning mode auditável (`auto|thinking|non_thinking`) em chat e sinais IA de trading

> **ATUALIZAÇÃO 06/03/2026:** Webhooks do WhatsApp/Twilio foram modularizados para `apps/integrations-service/src/routes/twilio-webhook-routes.ts` e os helpers de canal para `apps/integrations-service/src/twilio-channel-service.ts`, mantendo `apps/integrations-service/src/index.ts` como composition root.

> **ATUALIZAÇÃO 11/02/2026:** Configurações do Sistema editáveis via UI (DOCUMENT_MAX_CHUNKS, TRAINING_DOC_MAX_SAMPLES, TRAINING_CONVERSATION_MAX_MESSAGES, CONVERSATION_SLICE_SIZE, MIN_ONDEMAND_DATASET_SIZE, maxSeqLen). Valores em PostgreSQL têm precedência sobre env; alterações aplicadas imediatamente.

> **ATUALIZAÇÃO 05/01/2026:** Arquitetura refatorada para 5 stacks independentes com deploy/rollback modular. Sistema de aprendizado integrado ao stack ALICE, com GPU containers gerenciados pelo GPU Manager Service.

> Atualização 26/12/2025: Padronização de line endings com `.gitattributes` e `.editorconfig` (LF padrão; CRLF apenas para scripts Windows) para eliminar diffs ruidosos e manter consistência enterprise.

## Visão Geral

A Alice Enterprise Platform possui um sistema de aprendizado contínuo e agressivo que permite que o modelo evolua constantemente com base nas interações e dados fornecidos.

## Operação: Rollout e Rollback

### Rollout canário

1. Habilitar release para tenant piloto com baixa criticidade.
2. Validar preempção automática de treino on-demand e agendado.
3. Validar restore automático pós-treino e notices de runtime no chat.
4. Expandir rollout em lotes após 24h sem incidentes.

### Rollback passo a passo

1. Pausar novos jobs de treino.
2. Forçar restauração de serving no orquestrador (`restore-serving`).
3. Reverter stack para release anterior validada.
4. Reconciliar estados duráveis (`gpu_runtime_state`/`gpu_runtime_events`) e reabrir execução gradualmente.

### Riscos remanescentes

- Registros históricos com modelo Qwen2.5 permanecem no banco por compatibilidade.
- Partes históricas deste documento citam arquitetura anterior e devem ser lidas como contexto legado.

---

## ARQUITETURA ENTERPRISE + TRADING (17/12/2025)

### Mudança Crítica

A partir de 16/01/2026, a Alice utiliza **Gate 2 (LLM local + Vision OpenAI)** via Hetzner GPU GEX44 para processamento de IA — **serviços de inferência rodam simultaneamente** (budgets em 20GB VRAM):

| Componente | Modelo | Dimensões/VRAM | Infraestrutura |
|------------|--------|----------------|----------------|
| **LLM (texto)** | **Qwen2.5 7B Instruct (AWQ)** | ~6GB (budget) | GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB) |
| **Vision (análise)** | **OpenAI gpt-4.1** | N/A | OpenAI API |
| **Embeddings de Texto** | Qwen3-Embedding-0.6B INT8 | **1024 dim** (~3GB budget) → Qdrant | GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB) |
| **Imagem (descrição)** | OpenAI Vision (gpt-4.1) | Texto (sem embeddings de imagem) | OpenAI API |
| **Transcrição de Áudio** | OpenAI ASR (gpt-4o-transcribe) | N/A | OpenAI API |
| **Fine-tuning** | QLoRA (gpu-trainer) | dedicado (profile/on-demand) | GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB) |
| **Trading BTC** | KuCoin Futures API | - | Hetzner (integrations-service) |

> **NOTA Gate 2:** FLUX.1 Schnell REMOVIDO — Alice **analisa e gera** imagens via OpenAI (gpt-4.1 / gpt-image-1).

### GPU Dedicada 24/7 (Hetzner GEX44) - Gate 2

Com servidor GPU dedicado, os serviços de inferência rodam simultaneamente (budgets em 20GB VRAM):

| Cenário | Latência | Motivo |
|---------|----------|--------|
| **Chat, RAG (+ Vision/ASR OpenAI)** | ~0.5-1 segundo | **ZERO troca de containers** - todos sempre carregados na VRAM |
| **Fine-tuning QLoRA** | Ativação via profile | Apenas training usa troca (semanal ou on-demand) |

> **Gate 2:** Serviços GPU de inferência rodam localmente no servidor Hetzner GPU GEX44 com containers Docker 24/7. GPU Manager Service gerencia requisições com fila priorizada, monitoramento VRAM e circuit breakers. Fine-tuning QLoRA é ativado on-demand via Docker Compose profile. Ver [docs/ARQUITETURA-GPU-MANAGER.md](ARQUITETURA-GPU-MANAGER.md) para guia completo.

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
| **Análise de Imagens** | Automático | OpenAI Vision analisa, dados vão para RAG multimodal |
| **Imagens Upload** | Automático | OpenAI Vision (descrição textual, sem embeddings de imagem) |

> **NOTA Gate 2:** Geração de imagens via OpenAI (gpt-image-1). Análise via OpenAI Vision (gpt-4.1).

**Como funciona:**
- Cada mensagem no chat é avaliada pelo usuário (1-5 estrelas)
- Mensagens com rating >= 4 são candidatas a treinamento
- Admin pode aprovar/reprovar no dashboard (`/training`)
- **Conversas longas** (mais de `CONVERSATION_SLICE_SIZE` mensagens, default 10) são fatiadas em **janelas disjuntas** (sem overlap); cada janela vira um `training_data` distinto com `sourceMetadata.conversationWindow: { startIndex, endIndex }`
- **Resolver escopo**: quando não há namespace inferido, o scope-resolver retorna `suggestedNewNamespace` (ex.: `{ name: 'trading-geral', theme: 'Trading e análise de mercado' }`); o frontend oferece opção "Criar namespace sugerido"
- Dados aprovados entram no próximo ciclo de fine-tuning

**Fluxo Chat → Training (coleta manual "Enviar p/ Treino"):**

```
1. Usuário clica "Enviar p/ Treino" no Chat
   ↓
2. chat-service: POST /api/chat/conversations/:id/training/collect
   - Ordena mensagens por posição
   - sliceConversationIntoWindows(messages, CONVERSATION_SLICE_SIZE)
   - Se windows.length > 1 → incrementa alice_training_conversation_windows_created_total
   ↓
3. Para cada janela: POST /api/training/data (training-service)
   - sourceMetadata.conversationWindow: { startIndex, endIndex }
   - scope-resolver: resolveScope(tenantId, conversationId, messagesText, ...)
   ↓
4. Se !namespaceId: needsHumanReview=true, suggestedNewNamespace preenchido
   - Dados aparecem pendentes na página Training
   - Admin resolve escopo (criar namespace sugerido ou associar existente)
   ↓
5. Aprovação → training_data com status approved → próximo ciclo LoRA
```

**Integração Implementada (chat-service/index.ts):**
```typescript
// Coleta manual: sliceConversationIntoWindows + POST /api/training/data por janela
const windows = sliceConversationIntoWindows(ordered, limits.sliceSize);
for (const { slice, startIndex, endIndex } of windows) {
  await fetch(`${TRAINING_SERVICE_URL}/api/training/data`, {
    method: 'POST',
    body: JSON.stringify({
      source: 'chat',
      messages: slice,
      sourceMetadata: { conversationWindow: { startIndex, endIndex } },
      ...
    }),
  });
}
```

### 2. WhatsApp (Automático) ✅

| Tipo | Processamento | Critério de Aprovação |
|------|---------------|----------------------|
| **Texto** | Automático | Rating inferido (5 = sem escalação, 1 = escalou) |
| **Imagens** | Automático | OpenAI Vision (descrição textual, sem embeddings de imagem) |
| **Áudios** | Automático | OpenAI ASR (gpt-4o-transcribe) + Qwen3-Embedding-0.6B embeddings (1024 dim → Qdrant) |

**Integração Implementada (integrations-service - fluxo WhatsApp/Twilio):**
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
- Embeddings são gerados via GPU Manager Service (Qwen3-Embedding-0.6B, 1024 dim - Hetzner GEX44)
- Chunks ficam disponíveis IMEDIATAMENTE para busca semântica no Qdrant

### 4. Dashboard Admin (Manual) ✅

**Funcionalidades:**
- Visualizar todos os dados pendentes de aprovação
- Aprovar/Reprovar dados de treinamento em lote
- Visualizar mídias multimodais enviadas (imagens/áudios/documentos) e status de processamento
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

### 6. Mídia Multimodal (RAG + Treinamento) ✅ (11/02/2026)

Imagens e áudio são processados e alimentam tanto o RAG quanto o treinamento.

**Mídia → RAG:**
- Imagens: OpenAI Vision gera descrição textual → embedding (Qwen3-Embedding-0.6B) → Qdrant `type: media_image`
- Áudio: ASR (OpenAI gpt-4o-transcribe ou Canary) gera transcrição → embedding → Qdrant `type: media_audio`
- Busca RAG unificada retorna `document_chunk`, `media_image` e `media_audio` na mesma consulta vetorial
- Namespace obrigatório para isolamento por domínio

**Mídia → Treinamento:**
- POST `/api/media/uploads/:id/send-to-training` (namespaceId obrigatório)
- Usa `visionDescription` (imagens) ou `transcription` (áudio) como texto para `training_data`
- `source: 'rag_media'` com `sourceMetadata.mediaUploadId`
- `approvedForTraining: true` em `mediaUploads` após envio
- Botão "Enviar para treinamento" na página Documentos RAG (aba Mídia) e na aba Multimodal (Training)

**Página Documentos RAG:** Abas Documentos e Mídia em visão unificada. Filtros por namespace e tipo (imagem/áudio).

---

## Fluxo de Aprendizado Completo

```
┌─────────────────────────────────────────────────────────────┐
│                    COLETA (Tempo Real)                      │
│  Chat → WhatsApp → Documentos → Mídia (RAG) → Dashboard → API│
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│      PROCESSAMENTO MULTIMODAL (GPU Manager Service)       │
│  • Texto: Qwen3-Embedding-0.6B (1024 dim) → Qdrant          │
│  • Imagem: OpenAI Vision (descrição → Qdrant)               │
│  • Áudio: OpenAI ASR + Qwen3 (1024 dim) → Qdrant            │
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

## Ecossistema LLM para Trading (LoRA + RAG + Feedback Loop)

> **NOVO (09/02/2026):** Ciclo fechado de evolução contínua que integra LoRA adapters globais, RAG contextual e feedback automático.

### Visão Geral

O sistema de aprendizado agora forma um **ciclo fechado** onde cada operação de trading (real ou demo) melhora a inteligência futura da Alice:

```
┌─────────────────────────────────────────────────────────────┐
│                  CICLO DE EVOLUÇÃO CONTÍNUA                 │
│                                                              │
│  Geração Sinais IA ──→ Execução ──→ Post-Mortem Automático  │
│       ↑                                        │            │
│       │                                        ↓            │
│  LoRA Adapter (QLoRA)                  Feedback Loop         │
│       ↑                              (indexa no RAG)         │
│       │                                        │            │
│  Training (aprovação)    ←── Dataset ←─────────┘            │
│       ↑                                                      │
│       │                                                      │
│  RAG Contextual (learnings acumulados) ────────────────→     │
└─────────────────────────────────────────────────────────────┘
```

### 1. LoRA Adapters Globais

| Aspecto | Detalhes |
|---------|----------|
| **Escopo** | Global (compartilhado entre todos os tenants) |
| **Modelo base** | Qwen2.5 7B Instruct AWQ |
| **Método** | QLoRA 4-bit |
| **Path produção** | `/opt/alice/data/lora-adapters/trading-global` |
| **Ativação** | Automática após aprovação de job de treinamento |
| **Cache** | Redis `alice:lora:active-adapter` (TTL 60s) |
| **Resolução** | `resolveModelWithAdapter()` em `lora-adapter-resolver.ts` |

**Fluxo de Ativação:**
1. Dataset aprovado no dashboard → job QLoRA criado
2. Training service executa fine-tuning no gpu-trainer
3. Admin aprova o adapter → `activateLoraAdapter()` copia arquivos
4. Campo `isActiveAdapter` marcado no banco → cache Redis atualizado
5. Próximas chamadas LLM (sinais IA, post-mortems) usam adapter automaticamente

### 2. RAG Contextual para Trading

| Tipo de Consulta | Módulo | Contexto Injetado |
|-----------------|--------|-------------------|
| **Sinais IA** | `queryTradingRAGContext()` | Estratégias, regras, learnings de trades anteriores |
| **Post-Mortems** | `queryPostMortemRAGContext()` | Análises anteriores de trades similares (símbolo, estilo) |

- Consulta documentos e learnings do namespace do agente trading
- Contexto injetado no system prompt LLM antes da geração
- Fallback seguro: se RAG indisponível, prossegue sem contexto (sem bloquear)

### 3. Feedback Loop Automático

Quando um post-mortem é completado com sucesso:

1. **Indexação automática**: `indexPostMortemLearnings()` gera documento textual
2. **Conteúdo indexado**: motivadores, lições (repeat/avoid), fatores de sucesso/falha
3. **Destino**: RAG namespace trading do tenant
4. **Idempotência**: título único `[PostMortem] {symbol} {side} {date}`
5. **Disponibilidade**: learnings ficam disponíveis imediatamente para próximas consultas

**Documento gerado (exemplo):**
```
ANÁLISE DE TRADE - BTC-USDT (LONG)
Estilo: scalping | Archetype: momentum | Resultado: +3.1%

MOTIVADORES:
- Breakout com volume crescente (RSI: 71, Volume Spike: 38%)

LIÇÕES - REPETIR:
- Priorizar breakouts com volume acima da média

LIÇÕES - EVITAR:
- Entrar sem confirmação de liquidez
```

### 4. Métricas de Observabilidade

| Métrica | Tipo | Labels | Descrição |
|---------|------|--------|-----------|
| `alice_lora_resolve_total` | Counter | `result` | Resoluções de modelo (adapter/base/error) |
| `alice_lora_resolve_duration_seconds` | Histogram | - | Latência de resolução |
| `alice_lora_cache_total` | Counter | `status` | Cache Redis (hit/miss/error) |
| `alice_trading_rag_query_total` | Counter | `type`, `result` | Consultas RAG |
| `alice_trading_rag_query_duration_seconds` | Histogram | `type` | Latência de consultas RAG |
| `alice_trading_rag_index_total` | Counter | `result` | Indexação de learnings |

Dashboard Grafana: **alice-trading.json** (painéis LoRA + RAG + Feedback)

### 5. Fluxo Completo: Post-Mortem → Dataset → Aprovação → LoRA

O ciclo completo de evolução funciona em 6 etapas:

```
1. Posição Fechada (real ou demo)
   ↓
2. Post-Mortem automático (CPU → LLM)
   - Phase 1: classificação determinística (style, archetype, strategy)
   - Phase 2: motivadores + lições via LLM (com LoRA + RAG)
   ↓
3. Feedback Loop → learnings indexados no RAG (automático)
   ↓
4. Dataset Generator → cria registro na tabela `trading_dataset`
   - status: 'pending' (aguarda aprovação)
   - sourceType: 'postmortem' com metadata completa
   ↓
5. Aprovação Manual na Página Training
   - Humano revisa e aprova/rejeita datasets
   - Datasets aprovados alimentam próximo job QLoRA
   ↓
6. Treinamento LoRA + Ativação
   - Job QLoRA treina adapter com datasets aprovados
   - `POST /api/training/lora/activate/:jobId` ativa adapter
   - vLLM carrega dinamicamente sem restart
   - Próximas gerações de sinais e post-mortems usam adapter
```

**Observação:** As etapas 3 e 4 são independentes — o Feedback Loop enriquece o RAG imediatamente, enquanto o Dataset Generator prepara dados para treinamento futuro. Ambos rodam automaticamente após post-mortem completo.

### 6. APIs de Gestão de Adapters

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/api/training/lora/activate/:jobId` | POST | Ativar adapter de um job aprovado |
| `/api/training/lora/active` | GET | Consultar adapter ativo |
| `/api/training/lora/active` | DELETE | Desativar adapter ativo |

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

## Processamento de Áudio - ASR OpenAI

### Visão Geral

O processamento de áudio utiliza **OpenAI ASR** (sem GPU local para transcrição):

| Aspecto | OpenAI ASR |
|---------|-----------------|
| **Modelo Transcrição** | gpt-4o-transcribe |
| **Velocidade** | Dependente de rede (latência variável) |
| **Modelo Embeddings** | Qwen3-Embedding-0.6B (1024 dim) |
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
│          TRANSCRIÇÃO OPENAI (OBRIGATÓRIA)                   │
│  • gpt-4o-transcribe                                        │
│  • Latência depende da rede                                 │
│  • API OpenAI com streaming quando disponível               │
│  • Sem dependência de GPU local para ASR                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              GERAÇÃO DE EMBEDDING (GPU)                    │
│  • Qwen3-Embedding-0.6B (1024 dim) → Qdrant                │
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
| `OPENAI_API_KEY` | Chave da API OpenAI (ASR) | ✅ **Obrigatória** |
| `OPENAI_ASR_MODEL` | Modelo de transcrição | Opcional (`gpt-4o-transcribe`) |
| `OPENAI_ASR_TIMEOUT_MS` | Timeout ASR (ms) | Opcional (default 120000) |
| `OPENAI_ASR_STREAM` | Habilita streaming | Opcional (default true) |

---

## Processamento de Imagens - ARQUITETURA 100% GPU

### Modelos

| Tipo | Modelo | Dimensões | Uso |
|------|--------|-----------|-----|
| **Imagem → Embedding** | OpenAI Vision (descrição) | Texto → Qdrant | Busca por imagem |
| **Texto → Embedding (para buscar imagem)** | Qwen3-Embedding-0.6B | 1024 dim (Qdrant) | Busca texto→imagem |
| **Texto genérico** | Qwen3-Embedding-0.6B | 1024 dim (Qdrant) | Documentos, chat, trading |

### Endpoints GPU

| Endpoint | Modelo | Uso |
|----------|--------|-----|
| `/embed/text` | Qwen3-Embedding-0.6B | Texto de documentos, transcrições (1024 dim → Qdrant) |
| `/embed/batch` | Ambos | Processamento em lote |

---

## Versionamento de Modelos (Gate 2)

Cada ciclo de fine-tuning QLoRA cria uma nova versão:

| Campo | Descrição |
|-------|-----------|
| `version` | Número incremental (1, 2, 3...) |
| `baseModel` | Qwen2.5 7B Instruct (AWQ) - LLM texto (Gate 2) |
| `loraPath` | Caminho dos pesos QLoRA |
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

## ✅ IMPLEMENTADO CORRETAMENTE (Gate 2)

### 1. Arquitetura Enterprise Gate 2 - GPU simultâneo (20GB VRAM budget)
- ✅ **LLM (texto) dedicado**: Qwen2.5 7B Instruct (AWQ) - Chat/Trading (via GPU Manager)
- ✅ **Vision (OpenAI)**: gpt-4.1 para análise de imagens/gráficos (via OpenAI API)
- ✅ Embeddings de texto (Qwen3-Embedding-0.6B INT8, **1024 dim**, ~3GB) via GPU Manager Service → Qdrant
- ✅ Imagens via OpenAI Vision (descrição textual, sem embeddings de imagem)
- ✅ Transcrição de áudio (OpenAI ASR gpt-4o-transcribe) via OpenAI API
- ✅ Qdrant para texto (1024 dim com HNSW)
- ✅ Validação de dimensão em `validateEmbeddingDimension`
- ✅ Sem fallback CPU (Regra 6)
- ✅ Geração de imagens via OpenAI (gpt-image-1) - sem GPU local

### 2. GPU Dedicada 24/7 - ZERO Latência de Troca (Gate 2)
- ✅ **TODOS containers GPU rodando SIMULTANEAMENTE** - sem troca de containers
- ✅ Fonte de verdade de VRAM: métricas + `nvidia-smi` (budgets conservadores para evitar OOM)
- ✅ Redis Queue para processamento assíncrono (`embedding-queue.ts`)
- ✅ Worker dedicado (`embedding-worker.ts`)
- ✅ WebSocket para notificações (`embedding-websocket.ts`)
- ✅ Endpoints REST: `/api/rag/embeddings/queue/*`
- ✅ Fine-tuning QLoRA via Docker Compose profile (on-demand)

### 3. Coleta de Dados para Treinamento
- ✅ **Chat Web:** `apps/chat-service/src/index.ts` - POST `/api/training/data`
- ✅ **WhatsApp:** `apps/integrations-service/src/routes/twilio-webhook-routes.ts` - POST interno `/api/training/data`
- ✅ Rating inferido automaticamente (sem escalação = 5, com escalação = 1)

### 4. Schedule de Treinamento (Gate 2)
- ✅ Fine-tuning **QLoRA semanal** (Domingos 3h, minDataRequired: 50)
- ✅ Fine-tuning Completo quinzenal (minDataRequired: 200)
- ✅ Threshold de qualidade >= 50% rating >= 4
- ✅ Rollback automático se degradação > 5%
- ✅ Training on-demand via dashboard admin (`/training`)

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
- Processamento via GPU (Qwen3-Embedding-0.6B) + ASR OpenAI
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
- Imagens: OpenAI Vision (descrição textual, sem embeddings de imagem)
- Áudios: OpenAI ASR + Qwen3-Embedding-0.6B embeddings (1024 dim → Qdrant)
- Vídeo: **não suportado** (removido). Uploads `video/*` são rejeitados explicitamente.
- Processamento fire-and-forget (não bloqueia resposta ao usuário)
- `RAG_SERVICE_URL` adicionado ao docker-compose para integrations-service

**Arquivos modificados:**
- `apps/integrations-service/src/routes/twilio-webhook-routes.ts` - fluxo de webhook e coleta de treino
- `apps/integrations-service/src/twilio-channel-service.ts` - assinatura Twilio e envio WhatsApp reutilizável
- `apps/integrations-service/src/index.ts` - registro do módulo no composition root
- `infra/docker/docker-compose.prod.yml` - RAG_SERVICE_URL e depends_on alice-rag

### GAP 4: Imagens Docker GPU ✅ RESOLVIDO (Gate 2)
**Status:** Build automático via CI/CD - TODOS SIMULTÂNEOS

**Ações realizadas:**
1. Workflow `release.yml` garante automaticamente **3 imagens GPU** (llm-qwen25, embeddings-gpu, qwen-trainer). Quando não há mudanças no contexto do serviço, o pipeline faz **retag no GHCR** (mesmo digest do release anterior) ao invés de rebuild completo.
2. Timeout aumentado de 30min para 90min (imagens GPU são muito pesadas)
3. **ATUALIZAÇÃO Gate 2**:
   - `vllm/vllm-openai:v0.12.0` (llm-qwen25 - Qwen2.5 7B Instruct AWQ - LLM texto)
   - `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime` + bitsandbytes (embeddings-gpu INT8, ~8GB VRAM)
   - `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime` + peft (qwen-trainer QLoRA, on-demand)
   - ✅ **OpenAI Vision/Imagens** - gpt-4.1 (análise) + gpt-image-1 (geração)
   - **NOTA**: NGC_API_KEY REMOVIDO - Personal API Key não funciona para containers públicos (403 Forbidden). Todos usam Docker Hub.
4. BuildKit cache mount adicionado para cache persistente de pip
5. GPU Manager Service gerencia automaticamente todos os serviços GPU (sem secrets externos necessários)
6. **Gate 2:** Containers GPU rodam simultaneamente (budgets em 20GB VRAM) - sem troca de containers. Trainer usa Docker Compose profile `training` (on-demand).

### GAP 5: Arquivo clip-service-url.ts Obsoleto ✅ RESOLVIDO
**Status:** Removido em 15/12/2025

**Ações realizadas:**
- Arquivo `apps/rag-service/src/clip-service-url.ts` deletado
- Import removido de `apps/rag-service/src/index.ts`
- Variável `CLIP_SERVICE_URL` não utilizada removida

---

## 📊 RESUMO EXECUTIVO HISTÓRICO (15/12/2025)

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
| Build Imagens GPU | ✅ GAP #4 Resolvido | Pipeline `release.yml` com build/retag automático |
| Limpeza código obsoleto | ✅ GAP #5 Resolvido | Arquivo deletado |

---

*Autor: Fillipe Guerra*
*Documentação em Português Brasileiro (Regra 10 CLAUDE.md)*
*Versão 5.7 - 06 de Março de 2026 - Gate 2*
*LLM (texto): Qwen2.5 7B Instruct AWQ (vLLM) via GPU Manager Service (Hetzner GEX44 RTX 4000 Ada 20GB)*
*Embeddings texto: Qwen3-Embedding-0.6B INT8 (1024 dim → Qdrant) + Imagem: OpenAI Vision (descrição textual, sem embeddings de imagem)*
*ASR: OpenAI gpt-4o-transcribe via API externa*
*Vision: OpenAI (gpt-4.1) para análise de imagens/gráficos via API externa*
*Geração de Imagens: OpenAI (gpt-image-1)*
*Fisher-Yates Shuffle (17/12/2025): Corrigido bug de distribuição enviesada em train/validation split*
*Bug Fix Embeddings (17/12/2025): Embeddings de texto (documentos/áudio) agora vão para Qdrant (histórico: 4096 dim; Gate 2: 1024 dim)*
*Bug Fix SQL IN Clause (19/12/2025): learning-worker.ts corrigido - sql template literal com join() parametrizava string inteira. Usa inArray() do Drizzle (3 ocorrências)*
*Trading: KuCoin Futures BTC Perpetuals + Scalping (1m/3m/5m) + QLoRA Fine-tuning semanal*
*GPU Gate 2 (16/01/2026): Hetzner GEX44 - serviços GPU simultâneos (budgets em 20GB VRAM). Fine-tuning QLoRA on-demand via profile.*
