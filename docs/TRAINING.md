# Sistema de Treinamento - Alice Enterprise Platform

**Autor:** Fillipe Guerra  
**Data:** 11 de Fevereiro de 2026  
**Versão:** 4.4.0 - Gate 2 + Configurações editáveis via UI

---

## Configurações do Sistema (editáveis via UI)

A página **Configurações do Sistema** (menu lateral) permite alterar limites de treinamento em tempo real, sem reiniciar serviços. Valores gravados no PostgreSQL têm precedência sobre variáveis de ambiente. Chaves disponíveis:

| Chave | Descrição | Default |
|-------|-----------|---------|
| `DOCUMENT_MAX_CHUNKS` | Máximo de chunks por documento (RAG) | 50 |
| `TRAINING_DOC_MAX_SAMPLES` | Máximo de chunks selecionados por documento para treino | 50 |
| `TRAINING_CONVERSATION_MAX_MESSAGES` | Máximo de mensagens por conversa na coleta | 50 |
| `CONVERSATION_SLICE_SIZE` | Tamanho da janela para fatiamento de conversas longas | 10 |
| `MIN_ONDEMAND_DATASET_SIZE` | Mínimo de exemplos para treino on-demand | 10 |
| `maxSeqLen` | Comprimento máximo de sequência no treino LoRA | 2048 |

Alterações são aplicadas imediatamente (cache invalidado no save). Ver `docs/TREINAMENTO-LIMITES-E-BOAS-PRATICAS.md` para detalhes técnicos.

---

## Visão Geral

O sistema de treinamento da Alice permite fine-tuning incremental do **LLM (texto)** usando **QLoRA (4-bit)**. No **Gate 2**, o LLM de produção é o **Qwen2.5 7B Instruct (AWQ)** e o treinamento deve usar o **mesmo modelo base do LLM** para evitar divergência entre inference e fine-tuning. O sistema suporta treinamento agendado (semanal) e on-demand via dashboard admin.

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

Todas as fontes abaixo entram na **coleta e contagem** usada para avaliar qualidade e para o treino on-demand (Progressive LoRA), quando aplicável:

| Fonte | Tabela | Descrição | Inclusão |
|-------|--------|-----------|----------|
| **Chat aprovado** | `training_data` | Conversas e mensagens aprovadas (rating >= 4, status approved). Podem ter `namespace_id` e `inferred_namespace_id`. | Sempre na coleta. Filtradas por namespace quando `namespaceId` é informado. |
| **Trading aprovado** | `trading_dataset` | Pares prompt/response de sinais e ordens aprovados para treino. `source_metadata` pode conter `namespaceId`. | Incluídos na **contagem** (e no treino quando `includeTradingDataset=true`). Filtrados por `source_metadata->>'namespaceId'` quando `namespaceId` é informado. |
| **Imagens geradas** | `generated_images` | Imagens aprovadas para treino (`approvedForTraining=true`, `usedInFineTuning=false`). | Incluídas quando `includeImages=true` no run. |

- **Coleta** (`collectTrainingData`): retorna `approvedDataCount` (training_data), `tradingDatasetApprovedCount` (trading_dataset) e `approvedImagesCount`.
- **Avaliação** (`evaluateDataQuality`): usa `approvedDataCount + tradingDatasetApprovedCount` para o mínimo de dados; considera `namespaceId` opcional para filtrar por namespace.
- **Treino on-demand** (`startProgressiveLoRA`): filtra `training_data` por namespace (ou tenant-wide); opcionalmente inclui `trading_dataset` na contagem e no treino.

---

## LoRA por Namespace

A partir de 11/02/2026, o sistema suporta **adapters LoRA por namespace** além do adapter tenant-wide. A partir da **unificação enterprise (migration 0060)**, existe **uma única tabela** e **uma única lógica** de resolução.

- **Tabela única:** `lora_jobs` (fonte de verdade para adapter ativo por escopo). Coluna `source`: `explicit_job` (criado via API/UI, ex.: Pipeline Trading) ou `scheduled_run` (agendado/on-demand).
- **Escopo:** `scope_type` (namespace | agent), `scope_namespace_id`, `scope_agent_id`; `is_active_by_scope = true` indica o adapter ativo para aquele escopo.
- **Treino on-demand:** O body de `POST /api/training/run/start` aceita `namespaceId` opcional. Quando informado, apenas dados do namespace (e, se `includeTradingDataset`, trading_dataset do namespace) entram no treino; o resultado é registrado em `lora_jobs` com `source = 'scheduled_run'` quando aplicável.
- **Resolução do adapter ativo:** `GET /api/training/lora/active` aceita `tenantId`, `namespaceId` e `agentId`. O backend consulta **somente** a tabela `lora_jobs` (registro com `is_active_by_scope = true` para o escopo). Não há fallback para outras tabelas.
- **Runs agendados e on-demand:** Usam **somente** `lora_jobs` com `source = 'scheduled_run'`. O scheduler chama `startProgressiveLoRA` → cria registro em `lora_jobs` → executa `processLoraJob(loraJobId)`; ao concluir, marca `training_data`/`trading_dataset` como usados e ativa o adapter automaticamente. A tabela `auto_learning_schedule` armazena `lora_job_id` (e opcionalmente `model_version_id` legado). `model_versions` não é mais usado para determinar qual adapter está ativo.
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
   - Filtros por status e namespace

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
