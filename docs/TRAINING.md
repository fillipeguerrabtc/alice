# Sistema de Treinamento - Alice Enterprise Platform

**Autor:** Fillipe Guerra  
**Data:** 16 de Janeiro de 2026  
**Versão:** 4.2.0 - Gate 2 (LLM local + Vision OpenAI)

---

## Visão Geral

O sistema de treinamento da Alice permite fine-tuning incremental do **LLM (texto)** usando **QLoRA (4-bit)**. No **Gate 2**, o LLM de produção é o **Qwen2.5 7B Instruct (AWQ)** e o treinamento deve usar o **mesmo modelo base do LLM** para evitar divergência entre inference e fine-tuning. O sistema suporta treinamento agendado (semanal) e on-demand via dashboard admin.

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
