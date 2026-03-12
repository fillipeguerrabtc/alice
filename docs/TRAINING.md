# Sistema de Treinamento - Alice Enterprise Platform

**Autor:** Fillipe Guerra  
**Data:** 11 de Março de 2026  
**Versão:** 5.0.0 - Qwen3-8B + Orquestração Preemptiva + Hardening Final

---

## Configurações do Sistema (editáveis via UI)

A página **Configurações do Sistema** (menu lateral) permite alterar limites de treinamento em tempo real, sem reiniciar serviços. Valores gravados no PostgreSQL têm precedência sobre variáveis de ambiente. Chaves disponíveis:

| Chave | Descrição | Default | Onde se aplica |
|-------|-----------|---------|----------------|
| `DOCUMENT_MAX_CHUNKS` | Máximo de chunks por documento (RAG) | 50 | document-processor (RAG) |
| `TRAINING_DOC_MAX_SAMPLES` | Máximo de chunks selecionados por documento para treino (selectTrainingChunks) | 50 | rag-service |
| `TRAINING_CONVERSATION_MAX_MESSAGES` | Máximo de mensagens por conversa na coleta | 50 | chat-service |
| `CONVERSATION_SLICE_SIZE` | Tamanho da janela para fatiamento de conversas longas (janelas disjuntas) | 10 | chat-service |
| `MIN_ONDEMAND_DATASET_SIZE` | Mínimo de exemplos para treino on-demand | 10 | training-service |
| `maxSeqLen` | Comprimento máximo de sequência no treino LoRA | 2048 | lora-job-manager |

**Precedência:** PostgreSQL (Configurações do Sistema) > variáveis de ambiente > default. Alterações via UI são aplicadas imediatamente (cache invalidado no save).

### Variáveis de ambiente (fallback)

Quando não há valor em Configurações do Sistema, os serviços usam variáveis de ambiente:

```env
# Documentos (document-processor, RAG)
DOCUMENT_MAX_CHUNKS=50

# Treino - Documentos (rag-service)
TRAINING_DOC_MAX_SAMPLES=50

# Treino - Conversas (chat-service)
TRAINING_CONVERSATION_MAX_MESSAGES=50
CONVERSATION_SLICE_SIZE=10

# Treino - On-demand (training-service)
MIN_ONDEMAND_DATASET_SIZE=10
```

Ver `docs/TREINAMENTO-LIMITES-E-BOAS-PRATICAS.md` para detalhes técnicos e `docs/DEPLOYMENT.md` para deploy.

---

## Visão Geral

O sistema de treinamento da Alice permite fine-tuning incremental do **LLM (texto)** usando **QLoRA (4-bit)**. No estado atual, o serving usa **Qwen3-8B-AWQ** e o treinamento usa **Qwen3-8B** como base, com compatibilidade de leitura para registros legados Qwen2.5. O sistema suporta treinamento agendado e on-demand via dashboard admin.

## SSOT Atual de Modelos e Hyperparams (11/03/2026)

### Modelos

- Serving: `Qwen/Qwen3-8B-AWQ`
- Training base: `Qwen/Qwen3-8B`
- Embeddings: `Qwen/Qwen3-Embedding-0.6B`

### Hyperparams suportados pelo trainer

- `epochs`
- `learningRate`
- `batchSize`
- `maxSeqLen`
- `gradientAccumulationSteps`
- `warmupSteps`
- `loraRank`
- `loraAlpha`
- `loraDropout` (`<= 0.5`)
- `lrSchedulerType` (`constant`, `constant_with_warmup`, `linear`, `cosine`, `cosine_with_restarts`, `polynomial`, `inverse_sqrt`, `reduce_lr_on_plateau`)
- `maxGradNorm` (`> 0` e `<= 100`)
- `targetModules` (array não-vazio)

### Compatibilidade legada

- Payloads antigos sem `lrSchedulerType`, `maxGradNorm` e `targetModules` continuam válidos.
- Defaults de compatibilidade são preenchidos automaticamente sem quebrar jobs legados.

## Notas Operacionais (Rollout/Rollback)

### Rollout canário

1. Validar treino on-demand com preempção automática em tenant piloto.
2. Validar treino agendado com restore automático ao concluir.
3. Confirmar auditoria (`requestedReasoningMode`, `resolvedReasoningMode`, `reasonResolution`) em requests LLM relacionados.
4. Expandir rollout por lotes após estabilidade de métricas e logs estruturados.

### Rollback

1. Congelar novos jobs (`run/start` e criação de jobs).
2. Forçar `restore-serving` no orquestrador.
3. Reverter versão de stack para release estável anterior.
4. Verificar jobs em andamento e reconciliar estado durável (`gpu_runtime_state` + `gpu_runtime_events`).

---

## Agentic: Configuração + Governança

- **AgenticConfig** controla detecção, roteamento e permissões.  
- **RAG** guarda playbooks e manuais (fatos operacionais).  
- **Catálogo de ações** centraliza endpoints, risco e exigência de aprovação.  

**Aprovações**:  
- Ações críticas (financeiras/operacionais) exigem aprovação humana.  
- **Senha e biometria** coexistem como opções; biometria é **opcional**.

---

## Arquitetura

```
┌──────────────────────────────────────────────────────────────┐
│                    Training Service                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Auto-Learning Scheduler                                │  │
│  │  - Schedule semanal (domingo 3:00 AM)                   │  │
│  │  - Avaliação de qualidade de dados                      │  │
│  │  - Progressive LoRA                                      │  │
│  │  - Comparação com baseline + rollback                   │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  API Endpoints                                          │  │
│  │  - POST /api/training/schedule/configure                │  │
│  │  - POST /api/training/run/start                         │  │
│  │  - GET /api/training/run/status                         │  │
│  │  - GET /api/training/run/history                        │  │
│  │  - DELETE /api/training/run/cancel                      │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    GPU Trainer Service                        │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  QLoRA Fine-tuning                                      │  │
│  │  - Base: Qwen2.5 7B Instruct (LLM texto)                │  │
│  │  - Método: QLoRA 4-bit                                   │  │
│  │  - VRAM: ~12GB                                           │  │
│  │  - Dataset: JSONL persistido                             │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Schedule de Treinamento

### Configuração Padrão

| Tipo | Frequência | Cron | Dados Mínimos |
|------|------------|------|---------------|
| **Incremental** | Semanal | `0 3 * * 0` (domingo 3:00 AM) | 50 aprovados |
| **Completo** | Quinzenal | `0 1 1,15 * *` (dias 1 e 15) | 200 aprovados |

### Fluxo de Execução

1. **Avaliação de Qualidade**
   - Verificar quantidade de dados aprovados
   - Calcular score de qualidade (rating >= 4)
   - Decidir: `proceed`, `wait`, ou `skip`

2. **Preparação**
   - Pausar serviços GPU principais (liberar VRAM)
   - Iniciar container `gpu-trainer`
   - Preparar dataset JSONL

3. **Treinamento QLoRA**
   - Carregar modelo base
   - Aplicar LoRA adapters
   - Treinar com dados aprovados
   - Salvar checkpoint

4. **Validação**
   - Comparar métricas com baseline
   - Se regressão > 5%: rollback automático
   - Se melhoria: ativar nova versão

5. **Finalização**
   - Parar `gpu-trainer`
   - Reiniciar serviços GPU principais
   - Registrar métricas e histórico

---

## Fontes de Dados do Treino

O pipeline atual usa **`training_data` como fonte canônica** para seleção/versionamento de dataset de LoRA, com segregação por `purpose`:

| Fonte | Tabela | Descrição | Inclusão |
|-------|--------|-----------|----------|
| **Chat aprovado** | `training_data` | Conversas aprovadas com `purpose=behavior_sft`. | Elegível para SFT (split determinístico por hash). |
| **Trading aprovado (temporal)** | `training_data` (`source_type` `trading_*`) | Exemplos aprovados de trading com metadados temporais. | Elegível para SFT com split temporal/purged/walk-forward/híbrido. |
| **Documentos/Mídia RAG** | `training_data` (`source_type` `rag_document`/`rag_media`) | Conteúdo de conhecimento recuperável. | Default `purpose=knowledge_rag` (quarentena), fora do SFT por padrão. |
| **Imagens geradas** | `generated_images` | Imagens aprovadas para treino (`approvedForTraining=true`, `usedInFineTuning=false`). | Contabilizadas quando `includeImages=true` no run. |

### Pipeline canônico de dataset (06/03/2026)

- `planCanonicalDatasetSelection(...)` é a única entrada para seleção de dataset em readiness, criação de job e treino.
- `persistCanonicalDatasetSnapshot(...)` cria snapshot imutável em `training_dataset_versions` com:
  - `split_policy`
  - `manifest` (train/validation/holdout IDs + hashes + source counts)
  - `hash` de dataset
- `lora_jobs.dataset_version_id` é obrigatório no fluxo canônico.
- `processLoraJob(...)` consome somente o manifest persistido (sem reconstrução ad hoc de dataset).

### Lifecycle de dados do treino

- Estados de `training_data.status` usados no fluxo:
  - `approved` -> `reserved` (na criação do job)
  - `reserved` -> `used` (somente após sucesso real do treino)
  - `reserved` -> `approved` (cancelamento/falha)
- A reserva/liberação é idempotente e acoplada ao `jobId` (`used_in_job_id`).

---

## Fluxo de namespace inteligente (scope-resolver)

O **scope-resolver** determina o namespace e agente para cada item de treinamento. Ordem de resolução:

1. **Input direto** — `namespaceId` e `agentId` vindos da requisição
2. **Relacionamento por conversa** — consulta `conversations` para obter `namespaceId`/`agentId`
3. **Relacionamento por source** — documento, sinal, ordem (lookup em tabelas)
4. **Inferência semântica** — `inferDomainFromText()` analisa o texto (termos de trading, etc.) e infere domínio (`trading`, `general`)
5. **Consistência multi-tenant** — valida que namespace/agente pertencem ao tenant
6. **Fallback por sourceType** — ex.: `sourceType` começa com `trading` → domínio `trading`

Quando **não há namespace** após todas as etapas, o scope-resolver retorna **sugestão de novo namespace** (`suggestedNewNamespace`):

| Domínio inferido | Nome sugerido | Tema |
|------------------|---------------|------|
| `trading` | `trading-geral` | Trading e análise de mercado |
| `general` | `geral` | Uso geral e assistente |
| Outro | `conhecimento` | Documentos e conversas |

O frontend (modal "Resolver escopo") exibe a opção **"Criar namespace: {{name}} ({{theme}})"** e, ao confirmar, chama a API de criação e associa ao `training_data`. O fluxo reutiliza `handleResolveScope` e `POST /api/training/data/resolve-scope`.

### Curadoria manual de namespace (UI)

- A aba **Training > Data** possui acao explicita para **Alterar namespace** em datasets pendentes e aprovados.
- O ajuste manual reutiliza o endpoint oficial `PATCH /api/training/data/:id/resolve-scope` (sem endpoint novo e sem workaround).
- Em itens de quarentena (`needsHumanReview=true`), a mesma acao permanece como **Resolver escopo**.
- O motivo continua obrigatorio para preservar trilha de auditoria (`training_scope_overrides`).
- Antes da aprovação, o dialog de review permite override de escopo com **select de namespace** (sem entrada manual de UUID), mantendo agente/domínio opcionais e motivo obrigatório.

**Métrica de observabilidade:** `alice_training_scope_suggested_new_namespace_total{source_type}` — incrementada sempre que `suggestedNewNamespace` é retornado.

---

## Fatiamento de conversas longas (janelas disjuntas)

Conversas com mais de `CONVERSATION_SLICE_SIZE` mensagens são **fatiadas em janelas disjuntas** (TRL/SFT 2025 — evita overfitting, dataset menor e mais previsível).

**Regras:**
- `messages.length <= CONVERSATION_SLICE_SIZE` → 1 `training_data`
- `messages.length > CONVERSATION_SLICE_SIZE` → `ceil(length / SLICE_SIZE)` `training_data` (janelas sem overlap)

Cada janela inclui `sourceMetadata.conversationWindow: { startIndex, endIndex }` para rastreabilidade.

**Endpoints afetados:**
- `POST /api/chat/conversations/:id/training/collect` (single)
- `POST /api/chat/training/collect-batch` (batch)

**Métrica de observabilidade:** `alice_training_conversation_windows_created_total{tenant_id}` — incrementada quando `windows.length > 1`.

---

## LoRA por Namespace

A partir de 11/02/2026, o sistema suporta **adapters LoRA por namespace** além do adapter tenant-wide. A partir da **unificação enterprise (migration 0060)**, existe **uma única tabela** e **uma única lógica** de resolução.

- **Tabela única:** `lora_jobs` (fonte de verdade para adapter ativo por escopo). Coluna `source`: `explicit_job` (criado via API/UI, ex.: Pipeline Trading) ou `scheduled_run` (agendado/on-demand).
- **Escopo:** `scope_type` (namespace | agent), `scope_namespace_id`, `scope_agent_id`; `is_active_by_scope = true` indica o adapter ativo para aquele escopo.
- **Treino on-demand/custom:** `POST /api/training/run/start` cria snapshot imutável (`dataset_version_id`) no nascimento do job, reserva linhas (`reserved`) e só marca `used` após sucesso.
- **Resolução do adapter ativo:** `GET /api/training/lora/active` aceita `tenantId`, `namespaceId` e `agentId`. O backend consulta **somente** a tabela `lora_jobs` (registro com `is_active_by_scope = true` para o escopo). Não há fallback para outras tabelas.
- **Runs agendados e on-demand:** usam `lora_jobs` com `source = 'scheduled_run'`, snapshot imutável na criação e `datasetVersionId` persistido também em `fine_tuning_jobs`/`auto_learning_schedule`.
- **Ativação/promoção:** `promotion_status` inclui `activating`, `failed_activation` e `archived`; o caminho canônico ativo do adapter é persistido em `lora_jobs.active_adapter_path`.
- **Chat, Trading e Integrations:** Em todas as chamadas ao LLM, o contexto (tenantId, namespaceId, agentId) é repassado ao resolver de adapter, garantindo uso do adapter treinado mais recente para aquele escopo.

---

## Fluxo de Inferência (Resolver de Adapter)

1. **Requisição ao LLM** (chat, trading, postmortem, etc.): o serviço monta o contexto (tenantId, namespaceId, agentId) a partir da conversa, agente ou configuração de trading.
2. **Resolução do modelo:** Chama-se o resolver (ex.: `resolveModelWithAdapter(baseModel, context)` no chat-service ou integrations-service), que por sua vez consulta `GET /api/training/lora/active?tenantId=...&namespaceId=...&agentId=...`.
3. **Backend (training-service):** `getActiveAdapter(scope)` consulta **apenas** a tabela `lora_jobs` (registro com `is_active_by_scope = true` para o escopo). Uma única fonte de verdade; sem workarounds.
4. **Retorno:** Nome do modelo (base ou adapter) é usado na requisição ao GPU Manager / vLLM. Assim, **em qualquer uso de LLM** (chat, Trading, postmortem), o adapter treinado mais recente para aquele namespace (e agente, quando aplicável) é usado quando disponível.

---

## API Endpoints

### Configurar Schedule

```http
POST /api/training/schedule/configure
Authorization: Bearer <token>
Content-Type: application/json

{
  "tenantId": "uuid",
  "scheduleType": "incremental_fine_tuning",
  "enabled": true,
  "cronPattern": "0 3 * * 0",
  "minDataRequired": 50
}
```

**Resposta:**
```json
{
  "success": true,
  "action": "scheduled",
  "scheduleId": "uuid",
  "scheduledFor": "2026-01-12T03:00:00.000Z",
  "minDataRequired": 50
}
```

### Iniciar Treinamento On-Demand

```http
POST /api/training/run/start
Authorization: Bearer <token>
Content-Type: application/json

{
  "tenantId": "uuid",
  "trainingType": "incremental",
  "includeImages": false,
  "priority": "high",
  "description": "Treinamento após atualização de dados de trading",
  "namespaceId": "uuid-opcional",
  "includeTradingDataset": false
}
```

- **namespaceId** (opcional): quando informado, o treino é **por namespace** (LoRA por namespace): apenas `training_data` e, se `includeTradingDataset` for true, `trading_dataset` desse namespace entram no treino; o adapter gerado é registrado em `lora_jobs` com o escopo correspondente.
- **includeTradingDataset**: inclui exemplos aprovados de `trading_dataset` na coleta/contagem e no treino (quando suportado).

### Iniciar Treinamento Trading (Pipeline Específico)

```http
POST /api/training/jobs/trading
Authorization: Bearer <token>
Content-Type: application/json

{
  "tenantId": "uuid",
  "namespaceId": "uuid",
  "name": "Trading Fine-Tuning",
  "baseModel": "Qwen/Qwen2.5-7B-Instruct-AWQ",
  "hyperparameters": {
    "epochs": 4,
    "learningRate": 0.00008,
    "batchSize": 2
  }
}
```

**Regras do Pipeline Trading:**
- Filtra **apenas dados aprovados** do **namespace Trading**.
- Exige **mínimo de dados** configurável (`TRAINING_TRADING_MIN_DATA`).
- Hiperparâmetros ajustados para precisão em finanças/trading.

**Resposta:**
```json
{
  "job": {
    "id": "uuid",
    "status": "pending",
    "trainingDataCount": 120,
    "name": "Trading Fine-Tuning"
  }
}
```

---

## Gestão de LoRA Adapters (Trading)

> **NOVO (09/02/2026):** Adapters LoRA globais treinados via QLoRA, carregados dinamicamente no vLLM para inferência.

### Visão Geral

Adapters LoRA são especializações do modelo base (Qwen2.5 7B) treinadas com dados de trading aprovados. O escopo é **global** — um único adapter é compartilhado entre todos os tenants, treinado com datasets aprovados de todas as fontes.

### Fluxo de Ativação

```
Job QLoRA concluído
    → Admin aprova no dashboard
    → POST /api/training/lora/activate/:jobId
    → activateLoraAdapter():
        1. Copia arquivos do adapter para /opt/alice/data/lora-adapters/trading-global
        2. Desativa adapter anterior (se existir)
        3. Marca isActiveAdapter=true no banco
        4. Invalida cache Redis (alice:lora:active-adapter)
    → vLLM detecta e carrega adapter dinamicamente
    → Próximas chamadas LLM usam adapter automaticamente
```

### API Endpoints de Adapters

#### Ativar Adapter

```http
POST /api/training/lora/activate/:jobId
Authorization: Bearer <token>
```

**Resposta:**
```json
{
  "success": true,
  "adapter": {
    "jobId": "uuid",
    "adapterName": "trading-global",
    "adapterPath": "/opt/alice/data/lora-adapters/trading-global",
    "activatedAt": "2026-02-09T12:00:00.000Z"
  }
}
```

#### Consultar Adapter Ativo

```http
GET /api/training/lora/active
Authorization: Bearer <token>
```

**Resposta (adapter ativo):**
```json
{
  "active": true,
  "adapter": {
    "jobId": "uuid",
    "name": "Trading Fine-Tuning v3",
    "adapterName": "trading-global",
    "adapterPath": "/opt/alice/data/lora-adapters/trading-global",
    "activatedAt": "2026-02-09T12:00:00.000Z",
    "approvedAt": "2026-02-09T11:55:00.000Z"
  }
}
```

**Resposta (sem adapter):**
```json
{
  "active": false,
  "adapter": null
}
```

#### Desativar Adapter

```http
DELETE /api/training/lora/active
Authorization: Bearer <token>
```

### Resolução de Modelo em Inferência

Quando sinais IA ou post-mortems são gerados, o `lora-adapter-resolver.ts` no integrations-service resolve qual modelo usar:

1. Verifica cache Redis (`alice:lora:active-adapter`, TTL 60s)
2. Se cache miss, consulta training-service via HTTP (`GET /api/training/lora/active`)
3. Se adapter ativo, retorna `trading-global` como nome do modelo
4. Se nenhum adapter ativo, retorna modelo base (`Qwen/Qwen2.5-7B-Instruct-AWQ`)
5. Fallback: qualquer erro na resolução retorna modelo base (sem bloquear)

### Configuração vLLM

| Variável | Valor | Descrição |
|----------|-------|-----------|
| `ENABLE_LORA` | `true` | Habilita carregamento dinâmico de LoRA |
| `MAX_LORA_RANK` | `64` | Rank máximo suportado |
| `MAX_LORAS` | `2` | Máximo de adapters simultâneos |
| `LORA_ADAPTER_DIR` | `/opt/alice/data/lora-adapters` | Diretório de adapters |
| `VLLM_ALLOW_RUNTIME_LORA_UPDATING` | `true` | Permite atualização em runtime |

---

## Dataset Generator (Post-Mortem → Training)

> **NOVO (09/02/2026):** Datasets de treinamento gerados automaticamente a partir de post-mortems completos.

### Fluxo

```
Posição Fechada → Post-Mortem (status: completed)
    → POST /api/integrations/postmortem/send-to-training
    → Cria registro na tabela `trading_dataset`
        - status: 'pending' (aguarda aprovação)
        - sourceType: 'postmortem'
        - prompt: sistema + contexto de mercado + execução + classificação
        - response: ação recomendada + confiança + risco + invalidações
    → Página Training → Tab "Datasets" → Aprovar/Rejeitar
    → Datasets aprovados alimentam próximo job QLoRA
```

### Schema do Dataset

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `prompt` | text | Prompt do sistema + contexto de mercado + execução |
| `response` | text | Resposta esperada (ação, confiança, risco) |
| `conversation` | jsonb | Estrutura completa `[{role, content}]` |
| `context` | jsonb | marketContext + tradeExecution + autoAnnotation |
| `sourceType` | enum | `postmortem`, `signal`, `order`, `manual`, `system` |
| `sourceMetadata` | jsonb | `isDemo`, `fingerprint`, `engineVersions` |
| `qualityScore` | real | Score 0-1 de qualidade do dataset |
| `semhash` | text | Hash semântico para deduplicação |

### Batch Training

Envio em lote via `POST /api/integrations/postmortem/send-to-training/batch`:

```json
{ "postmortemIds": ["uuid1", "uuid2", "uuid3"] }
```

Resposta com status individual por post-mortem (criado, existente, erro).

---

## Coleta de Dados do Chat (com aprovação)

### Coleta automática (Trading)

A coleta automática envia pares **usuário → assistente** para o Training Service como **pendentes** (exigem aprovação).

**Regras:**
- Só coleta quando a conversa está no perfil **Trading** e possui **namespace**.
- Não bloqueia a resposta do chat (envio assíncrono).

**Variáveis de ambiente:**
- `TRAINING_AUTO_COLLECT_CHAT=true` (habilita a coleta automática)
- `TRAINING_CONVERSATION_MAX_MESSAGES=50` (limite para curadoria manual; default 50)
- `CONVERSATION_SLICE_SIZE=10` (janela para fatiamento de conversas longas em amostras disjuntas)
- `DOCUMENT_MAX_CHUNKS=50` (document-processor; máximo de chunks por documento)
- `TRAINING_DOC_MAX_SAMPLES=50` (rag-service; máximo de chunks selecionados por doc para treino)
- `MIN_ONDEMAND_DATASET_SIZE=10` (training-service; mínimo de exemplos para treino on-demand)

### Curadoria manual (Enviar conversa ao namespace)

No chat, use **"Enviar p/ Treino"** para enviar a conversa ao namespace.  
Os dados ficam em **Pendente** no Training até aprovação.

**Resposta:**
```json
{
  "success": true,
  "jobId": "uuid",
  "modelVersionId": "uuid",
  "version": 5,
  "trainingDataUsed": 127,
  "imagesUsed": 0,
  "status": "running"
}
```

### Verificar Status

```http
GET /api/training/run/status?tenantId=uuid
Authorization: Bearer <token>
```

**Resposta (treinamento em andamento):**
```json
{
  "hasRunningTraining": true,
  "status": "running",
  "currentJob": {
    "id": "uuid",
    "jobType": "lora_incremental",
    "totalRecords": 127,
    "processedRecords": 45,
    "progress": 35,
    "elapsedSeconds": 342,
    "estimatedRemainingSeconds": 634,
    "startedAt": "2026-01-11T10:30:00.000Z"
  }
}
```

**Resposta (sem treinamento):**
```json
{
  "hasRunningTraining": false,
  "status": "idle",
  "message": "Nenhum treinamento em andamento"
}
```

### Obter Histórico

```http
GET /api/training/run/history?tenantId=uuid&limit=10
Authorization: Bearer <token>
```

**Resposta:**
```json
{
  "total": 10,
  "history": [
    {
      "id": "uuid",
      "jobType": "lora_incremental",
      "status": "completed",
      "totalRecords": 127,
      "processedRecords": 127,
      "description": "Treinamento semanal automático",
      "startedAt": "2026-01-05T03:00:00.000Z",
      "completedAt": "2026-01-05T03:45:00.000Z",
      "durationSeconds": 2700
    }
  ]
}
```

### Cancelar Treinamento

```http
DELETE /api/training/run/cancel
Authorization: Bearer <token>
Content-Type: application/json

{
  "trainingRunId": "uuid",
  "reason": "Cancelado para manutenção"
}
```

**Resposta:**
```json
{
  "success": true,
  "trainingRunId": "uuid",
  "previousStatus": "running",
  "newStatus": "cancelled"
}
```

---

## Coleta de Dados

### Fontes de Dados

1. **Chat**: Conversas aprovadas com rating >= 4
2. **Trading**: Sinais e análises aprovadas
3. **Webhook**: Dados externos via API
4. **Bulk Import**: Upload em massa (JSON/JSONL)

### Deduplicação Semântica (SemHash)

O sistema usa deduplicação semântica para evitar dados redundantes:

1. **Hash de Normalização**: SHA256 do texto normalizado
2. **Similaridade Coseno**: Comparação de embeddings
3. **Threshold**: 85% de similaridade

```python
# Exemplo de detecção de duplicata
{
  "isDuplicate": true,
  "duplicateOfId": "original-uuid",
  "similarityScore": 0.92
}
```

---

## QLoRA Fine-tuning

### Configuração

| Parâmetro | Valor | Descrição |
|-----------|-------|-----------|
| **Base Model** | Qwen2.5 7B Instruct (AWQ) | Modelo base do LLM (texto) no Gate 2 |
| **LoRA Rank** | 16 | Rank das matrizes LoRA |
| **LoRA Alpha** | 32 | Fator de escala |
| **Target Modules** | q_proj, k_proj, v_proj | Camadas alvo |
| **Quantization** | 4-bit NF4 | Via bitsandbytes |
| **Learning Rate** | 2e-4 | Taxa de aprendizado |
| **Batch Size** | 4 | Tamanho do batch |
| **Epochs** | 3 | Número de épocas |

### Consumo de VRAM

```
┌────────────────────────────────────────────────────────────┐
│  QLoRA Training - Consumo de VRAM                          │
├────────────────────────────────────────────────────────────┤
│  Base model (4-bit):     ~4GB                              │
│  LoRA adapters:          ~1GB                              │
│  Gradients:              ~3GB                              │
│  Optimizer states:       ~2GB                              │
│  Batch activations:      ~2GB                              │
├────────────────────────────────────────────────────────────┤
│  TOTAL:                  ~12GB                             │
│  GPU disponível:         20GB                              │
│  Margem de segurança:    8GB  ✅                           │
└────────────────────────────────────────────────────────────┘
```

---

## Métricas e Rollback

### Métricas Monitoradas

| Métrica | Descrição | Threshold Rollback |
|---------|-----------|-------------------|
| **Accuracy** | Precisão geral | < -5% |
| **F1 Score** | Média harmônica | < -5% |
| **Perplexity** | Qualidade do modelo | > +10% |
| **Latency** | Tempo de inferência | > +20% |

### Processo de Rollback

```
┌─────────────────────────────────────────────────────────────┐
│  Avaliação Pós-Treinamento                                  │
├─────────────────────────────────────────────────────────────┤
│  1. Calcular métricas da nova versão                        │
│  2. Comparar com baseline (versão anterior)                 │
│  3. Se regressão > threshold:                               │
│     - Desativar nova versão                                 │
│     - Reativar versão anterior                              │
│     - Registrar motivo do rollback                          │
│     - Notificar via Redis pub/sub                           │
│  4. Se melhoria:                                            │
│     - Ativar nova versão                                    │
│     - Atualizar baseline                                    │
│     - Registrar métricas de melhoria                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Dashboard Admin

A página de treinamento no dashboard oferece:

1. **Estatísticas**
   - Dados pendentes, aprovados, rejeitados
   - Jobs em execução, completados, falhos

2. **Gestão de Dados**
   - Aprovar/rejeitar dados individualmente
   - Aprovação em lote
   - Selecionar todos / deselecionar todos os pendentes do filtro atual
   - Filtros por status e namespace
   - Ajuste manual de namespace por dataset pendente

3. **Jobs de Treinamento**
   - Criar novo job
   - Monitorar progresso
   - Cancelar job em andamento

4. **Bulk Import**
   - Upload de JSON/JSONL
   - Validação de schema
   - Preview antes de importar

5. **Upload Multimodal**
   - Imagens (JPEG, PNG, WebP, GIF)
   - Áudio (MP3, WAV, WebM, OGG)
   - Processamento via GPU

---

## Referências

- [ARQUITETURA-GPU-MANAGER.md](./ARQUITETURA-GPU-MANAGER.md)
- [CLAUDE.md - Regras do Projeto](../CLAUDE.md)
- [Qwen2.5 7B Instruct AWQ - Hugging Face](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-AWQ)
- [PEFT/LoRA Documentation](https://huggingface.co/docs/peft)
