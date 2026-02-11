# Plano Enterprise – Implementação TREINAMENTO-LIMITES-E-BOAS-PRATICAS

**Autor:** Fillipe Guerra  
**Data:** 11 de Fevereiro de 2026  
**Base:** `docs/TREINAMENTO-LIMITES-E-BOAS-PRATICAS.md`  
**Objetivo:** Implementar TODAS as recomendações, correções, requisitos e melhorias enterprise. Plano 100% completo.

---

## Decisões técnicas (fechadas)

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Janelas de conversa | **Disjuntas** (sem overlap) | Melhores práticas TRL/SFT 2025: evita overfitting, menor dataset, mais previsível |
| Aprovação de datasets | **Reusar fluxo existente** | `needsHumanReview` + "Resolver escopo" já implementados; evitar duplicidade |
| Mínimo on-demand | **Configurável** (ex.: 10) + opção "forçar 1" com aviso | LoRA funciona com poucos dados; aviso explícito para responsabilidade do usuário |
| Arquitetura embeddings | **Texto local** (Qwen3-Embedding GPU); ASR/Vision via OpenAI | Aproveitar 20GB VRAM para texto; externos para multimodal |

---

## Visão geral – 11 Fases

| Fase | Nome | Prioridade | Dependências |
|------|------|------------|--------------|
| 1 | Limites configuráveis (maxChunks, TRAINING_DOC, TRAINING_CONV) | Alta | - |
| 2 | Bug fix learning-worker endpoint `/embed` → `/embed/text` | Crítica | - |
| 3 | Validação embeddings (learning-worker, embeddings-gpu NaN/Inf) | Alta | 2 |
| 4 | Fatiamento conversas longas (janelas disjuntas) | Alta | 1 |
| 5 | Namespace inteligente (agente + semântico + sugestão novo) | Alta | - |
| 6 | Seleção de mensagens no Chat + API messageIds/entireConversation | Alta | 4 |
| 7 | max_seq_length no pipeline de treino | Média | - |
| 8 | Mínimo on-demand configurável + aviso "forçar 1" | Média | - |
| 9 | Frontend: Modo livro + Enviar conversa longa | Média | 1, 4, 6 |
| 10 | promoteDocumentToTrainingSchema + env vars | Alta | 1 |
| 11 | Documentação e integração final | Média | Todas |

---

## Ordem de implementação sugerida

```
Fase 1 (Limites) → Fase 2 (Bug fix embeddings) → Fase 3 (Validação embeddings)
    ↓
Fase 10 (Schema + env) → Fase 4 (Fatiamento) → Fase 5 (Namespace) → Fase 6 (Seleção Chat)
    ↓
Fase 7 (max_seq_length) → Fase 8 (Mínimo on-demand) → Fase 9 (Frontend) → Fase 11 (Docs)
```

---

## Fase 1 – Limites configuráveis

### 1.1 DOCUMENT_MAX_CHUNKS

**Arquivos:** `document-processor.ts`, `docker-compose.alice.yml`, docs

**Mudanças:**
- `DOCUMENT_MAX_CHUNKS = parseEnvInt(process.env.DOCUMENT_MAX_CHUNKS, 50, 'DOCUMENT_MAX_CHUNKS')`
- `processDocument()`: `maxChunks ?? DOCUMENT_MAX_CHUNKS` (options prevalecem sobre env)
- docker-compose: `DOCUMENT_MAX_CHUNKS: ${DOCUMENT_MAX_CHUNKS:-50}`

### 1.2 TRAINING_DOC_MAX_SAMPLES

**Arquivos:** `rag-service/index.ts`, `docker-compose.alice.yml`

**Mudanças:**
- Default 20 → 50 em `parseEnvInt(process.env.TRAINING_DOC_MAX_SAMPLES, 50, ...)`
- docker-compose: `TRAINING_DOC_MAX_SAMPLES: ${TRAINING_DOC_MAX_SAMPLES:-50}`

### 1.3 TRAINING_CONVERSATION_MAX_MESSAGES

**Arquivos:** `chat-service/index.ts`, `docker-compose.alice.yml`

**Mudanças:**
- Default 20 → 50 em `parseEnvInt(process.env.TRAINING_CONVERSATION_MAX_MESSAGES, 50, ...)`

---

## Fase 2 – Bug fix learning-worker (CRÍTICO)

### 2.1 Correção endpoint embeddings

**Arquivo:** `apps/rag-service/src/workers/learning-worker.ts`

**Problema:** Chama `EMBEDDINGS_GPU_URL/embed` mas embeddings-gpu expõe apenas `/embed/text`.

**Correção:**
- Alterar `fetch(\`${EMBEDDINGS_GPU_URL}/embed\`, ...)` para `/embed/text`
- Ou usar GPU Manager Service (como embedding-worker) com `endpoint: '/embed/text'` e body `{ texts: [...] }`
- O learning-worker chama o serviço de embeddings diretamente; se usar GPU Manager, migrar para `requestGpu()`

**Opção recomendada:** Corrigir URL para `/embed/text` e body para `{ texts }` (embeddings-gpu aceita esse formato).

### 2.2 Validação de dimensão no learning-worker

**Arquivo:** `learning-worker.ts` – `processEmbeddingGeneration`

**Mudanças:**
- Após obter `result.embeddings`, chamar `validateEmbeddingDimension(result.embeddings[0], EMBEDDING_DIMENSIONS.TEXT, 'TEXT')` antes de retornar
- Fail-fast se dimensão incorreta

---

## Fase 3 – Validação embeddings estendida

### 3.1 embeddings-gpu (Python)

**Arquivo:** `docker/gpu/embeddings-gpu/app/main.py`

**Mudanças:**
- Após `text_model.encode()`: validar `np.isfinite(embeddings).all()` (sem NaN/Inf)
- Validar `len(embeddings[0]) == TEXT_EMBEDDING_DIM` antes de retornar
- Endpoint `/embed/batch`: embeddings-gpu só tem `/embed/text`; embedding-worker usa batch via GPU Manager. Se GPU Manager faz múltiplas chamadas single, não é necessário `/embed/batch`. Documentar.
- Health/ready: incluir `text_dimensions` na resposta para diagnóstico

### 3.2 Consistência SSOT

- `TEXT_EMBEDDING_DIM` em embeddings-gpu (1024) deve bater com `EMBEDDING_DIMENSIONS.TEXT` em `@alice/database`
- Validar em testes ou startup

---

## Fase 4 – Fatiamento de conversas longas (Opção B)

### 4.1 Lógica no chat-service

**Arquivo:** `apps/chat-service/src/index.ts`

**Implementação:**
- `CONVERSATION_SLICE_SIZE = parseEnvInt(process.env.CONVERSATION_SLICE_SIZE, 10, 'CONVERSATION_SLICE_SIZE')`
- Quando `messages.length > CONVERSATION_SLICE_SIZE`: fatiar em janelas **disjuntas** de N turnos
- Cada janela → 1 `training_data` distinto
- `sourceMetadata.conversationWindow: { startIndex, endIndex }` em cada amostra

**Fluxo:**
```
messages.length <= CONVERSATION_SLICE_SIZE → 1 training_data
messages.length > CONVERSATION_SLICE_SIZE  → ceil(length / SLICE_SIZE) training_data (janelas disjuntas)
```

### 4.2 Endpoints afetados

- `POST /api/chat/conversations/:id/training/collect` (single)
- `POST /api/chat/training/collect-batch` (batch)

### 4.3 Rastreabilidade

- Manter `source`, `sourceType`, `sourceId`
- `sourceMetadata.conversationWindow` quando houver fatiamento
- Schema `trainingData` já suporta `sourceMetadata` (jsonb)

---

## Fase 5 – Namespace inteligente (agente + semântico + sugestão novo)

### 5.1 Estender scope-resolver

**Arquivo:** `apps/training-service/src/scope-resolver.ts`

**Mudanças:**
- Namespace vem de: (1) input direto, (2) `agent.namespaceId` da conversa, (3) inferência semântica (`inferDomainFromText`), (4) relação por source
- Quando `!namespaceId` após todas as etapas: **sugerir criação de novo namespace**
  - Retornar `suggestedNewNamespace: { name: string; theme: string }` baseado em `domain` e trechos do `messagesText`
  - Ex.: domain=trading → `{ name: 'trading-geral', theme: 'Trading e análise de mercado' }`

### 5.2 Fluxo no training-service

- Ao receber dados com `needsHumanReview` e sem namespace: incluir `suggestedNewNamespace` na resposta
- Frontend: ao "Resolver escopo", mostrar opção "Criar novo namespace" com nome/tema sugerido
- Reusar fluxo existente: `handleResolveScope` + `POST /api/training/data/resolve-scope`

### 5.3 Integração Chat → Training

- Chat "Enviar para Treino" envia conversa com `agentId` e `namespaceId` (conversation/agent)
- Training-service chama `resolveScope` com `conversationId`, `agentId`, `messagesText`
- Se não houver namespace claro: `needsHumanReview=true`, datasets aparecem pendentes na Training
- Usuário confirma ou altera namespace (ou cria novo com sugestão) antes de aprovar

---

## Fase 6 – Seleção de mensagens no Chat

### 6.1 API no chat-service

**Novo schema e comportamento:**

- `POST /api/chat/conversations/:id/training/collect`:
  - **Atual:** `maxMessages` (limite de mensagens recentes)
  - **Novo:** Aceitar `messageIds?: string[]` OU `entireConversation?: boolean`
  - Se `messageIds` fornecido: usar apenas essas mensagens (ordenadas por posição)
  - Se `entireConversation: true` ou nem um nem outro: comportamento atual (recentes até `maxMessages`)

### 6.2 Frontend Chat

**Arquivo:** Página/componente de Chat onde existe "Enviar p/ Treino"

**Mudanças:**
- Modo seleção: usuário seleciona mensagens (checkboxes ou similar)
- Ao clicar "Enviar p/ Treino":
  - Se há mensagens selecionadas → enviar `messageIds`
  - Se não há seleção → enviar `entireConversation: true` ou `maxMessages`
- Reusar traduções existentes: `selection.selectMessages`, `sendSelected`, `descMessages`

### 6.3 Batch collect

- `POST /api/chat/training/collect-batch`: suportar `messageIds` por conversa (estrutura: `{ conversationId, messageIds? }[]`) ou manter atual

---

## Fase 7 – max_seq_length no pipeline de treino

### 7.1 Verificação e exposição

**Arquivos:** `training-service`, `lora-job-manager`, `lora-trainer`

**Mudanças:**
- Verificar se training-service repassa `maxSeqLen` ao gpu-trainer no payload de `train/lora/slice`
- lora-trainer já aceita `maxSeqLen` (default 2048)
- Garantir propagação no schema Zod e no frontend (opcional: exibir/editar na criação de job)
- Default 2048 alinhado à documentação TRL

---

## Fase 8 – Mínimo on-demand configurável

### 8.1 Nova variável e lógica

**Arquivos:** `lora-job-manager.ts`, `training-service/index.ts`, `docker-compose`

**Mudanças:**
- `MIN_ONDEMAND_DATASET_SIZE = parseEnvInt(process.env.MIN_ONDEMAND_DATASET_SIZE, 10, ...)`
- Jobs on-demand: validar `dataset.stats.total >= MIN_ONDEMAND_DATASET_SIZE` antes de rodar
- Opção "Forçar treino com 1 dataset" no frontend: enviar flag `forceMinSize?: boolean`; se true, ignorar mínimo com aviso explícito no UI ("Poucos exemplos podem prejudicar o modelo. Use por sua conta e risco.")

### 8.2 Agendado (inalterado)

- `MIN_CHAT_DATASET_SIZE = 50` para runs agendados
- Se insuficiente: aviso + tentar no próximo agendamento

---

## Fase 9 – Frontend UX

### 9.1 Modo livro (promoção de documento)

**Arquivo:** `Training.tsx` – aba Multimodal Upload / documentos RAG

**Mudanças:**
- Toggle "Modo livro" ao lado de "Enviar para Treinamento"
- Quando ativo: `maxSamples: 50` (ou valor de TRAINING_DOC_MAX_SAMPLES) no body de `POST /api/rag/documents/:id/send-to-training`
- Tooltip: "Para livros grandes, seleciona mais chunks por documento"

### 9.2 Enviar conversa longa

**Contexto:** Coleta manual no Chat ("Enviar p/ Treino")

**Mudanças:**
- Quando conversa tiver mais de `CONVERSATION_SLICE_SIZE` mensagens: avisar "Conversa longa será fatiada em várias amostras para melhor qualidade de treino"
- Opcional: exibir quantas amostras serão geradas antes de enviar

### 9.3 Resolver escopo – sugestão de novo namespace

**Arquivo:** `Training.tsx` – modal `handleResolveScope`

**Mudanças:**
- Se `suggestedNewNamespace` vier na resposta: opção "Criar namespace: {{name}} ({{theme}})"
- Ao confirmar: chamar API de criação de namespace e associar ao training_data

---

## Fase 10 – Schema e variáveis de ambiente

### 10.1 promoteDocumentToTrainingSchema

**Arquivo:** `rag-service/index.ts`

**Mudanças:**
- `maxSamples: z.number().int().min(3).max(100).optional()` (era 50)
- Permite modo livro com até 100 chunks

### 10.2 Variáveis de ambiente (docker-compose e docs)

```env
# Documentos (document-processor)
DOCUMENT_MAX_CHUNKS=50
DOCUMENT_CHUNK_SIZE=8000
MAX_TEXT_LENGTH=100000
MAX_DOCUMENT_SIZE_MB=50

# Treino - Documentos (rag-service)
TRAINING_DOC_MAX_SAMPLES=50
TRAINING_DOC_MIN_CHARS=180

# Treino - Conversas (chat-service)
TRAINING_CONVERSATION_MAX_MESSAGES=50
CONVERSATION_SLICE_SIZE=10

# Treino - On-demand (lora-job-manager / training-service)
MIN_ONDEMAND_DATASET_SIZE=10
```

---

## Fase 11 – Documentação e integração final

### 11.1 Documentos a atualizar

| Documento | Conteúdo |
|-----------|----------|
| `TREINAMENTO-LIMITES-E-BOAS-PRATICAS.md` | Marcar itens implementados |
| `TRAINING.md` | Novos limites, env vars, fluxo namespace inteligente |
| `DEPLOYMENT.md` / `SECRETS.md` | Novas env vars |
| `SISTEMA-APRENDIZADO.md` | Fluxo Chat → Training, fatiamento, namespace |
| `CLAUDE.md` | Changelog da implementação |

### 11.2 Testes

- Testes unitários para `DOCUMENT_MAX_CHUNKS`, `selectTrainingChunks` com novos defaults
- Testes para fatiamento (janelas disjuntas)
- Testes para scope-resolver com `suggestedNewNamespace`
- Validação de embedding no learning-worker (fail-fast)

---

## Checklist de conclusão (enterprise)

### Limites e config
- [x] DOCUMENT_MAX_CHUNKS implementado e documentado (configurável via UI/DB em Configurações do Sistema)
- [x] TRAINING_DOC_MAX_SAMPLES default 50 (configurável via UI/DB)
- [x] TRAINING_CONVERSATION_MAX_MESSAGES default 50 (configurável via UI/DB)
- [x] CONVERSATION_SLICE_SIZE configurável (via UI/DB)
- [x] MIN_ONDEMAND_DATASET_SIZE configurável (via UI/DB)

### Embeddings
- [ ] learning-worker: endpoint `/embed` → `/embed/text` corrigido
- [ ] learning-worker: validateEmbeddingDimension no resultado
- [ ] embeddings-gpu: validação NaN/Inf e dimensão
- [ ] Consistência SSOT TEXT_EMBEDDING_DIM / EMBEDDING_DIMENSIONS.TEXT

### Conversas e namespace
- [ ] Fatiamento de conversas longas (janelas disjuntas)
- [ ] sourceMetadata.conversationWindow em amostras fatiadas
- [ ] scope-resolver: sugestão de novo namespace quando não houver match
- [ ] Integração Chat → Training com namespace sugerido

### Chat – Seleção de mensagens
- [ ] API aceita messageIds ou entireConversation
- [ ] Frontend Chat: seleção de mensagens + envio

### Treino
- [x] max_seq_length propagado no pipeline (configurável via UI/DB como maxSeqLen)
- [x] Mínimo on-demand configurável (via UI/DB) + opção "forçar 1" com aviso (forceMinSize)

### Frontend
- [ ] Modo livro na promoção de documento
- [ ] Aviso "conversa longa fatiada" quando aplicável
- [ ] Resolver escopo: opção criar namespace com sugestão

### Schema e infra
- [ ] promoteDocumentToTrainingSchema maxSamples 100
- [ ] Todas env vars no docker-compose e documentação

### Documentação
- [x] TREINAMENTO-LIMITES-E-BOAS-PRATICAS.md atualizado (configurações editáveis via UI)
- [ ] TRAINING.md, DEPLOYMENT.md, SISTEMA-APRENDIZADO.md
- [ ] CLAUDE.md changelog

---

*Plano 100% enterprise. Implementar todas as fases conforme dependências e criticidade.*
