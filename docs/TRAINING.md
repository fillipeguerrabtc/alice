# Sistema de Treinamento - Alice Enterprise Platform

**Autor:** Fillipe Guerra  
**Data:** 09 de Fevereiro de 2026  
**Versão:** 4.3.0 - Gate 2 + Ecossistema LLM (LoRA + RAG + Feedback Loop)

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
  "description": "Treinamento após atualização de dados de trading"
}
```

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
- `TRAINING_CONVERSATION_MAX_MESSAGES=20` (limite para curadoria manual)

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
