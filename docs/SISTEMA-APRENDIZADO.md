# Sistema de Aprendizado da Alice

## Visão Geral

A Alice Enterprise Platform possui um sistema de aprendizado contínuo e agressivo que permite que o modelo evolua constantemente com base nas interações e dados fornecidos.

---

## Fontes de Dados para Aprendizado

### 1. Chat (Automático)

| Tipo | Processamento | Critério de Aprovação |
|------|---------------|----------------------|
| **Conversas Texto** | Automático | Rating >= 4 estrelas pelo usuário |
| **Imagens Geradas** | Semi-automático | Aprovação manual no dashboard |
| **Imagens Upload** | Automático | CLIP embeddings para RAG multimodal |

**Como funciona:**
- Cada mensagem no chat é avaliada pelo usuário (1-5 estrelas)
- Mensagens com rating >= 4 são candidatas a treinamento
- Admin pode aprovar/reprovar no dashboard
- Dados aprovados entram no próximo ciclo de fine-tuning

### 2. Upload de Documentos (RAG)

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
- Embeddings são gerados via Salad Cloud
- Chunks ficam disponíveis IMEDIATAMENTE para busca

### 3. Dashboard Admin (Manual)

**Funcionalidades:**
- Visualizar todos os dados pendentes de aprovação
- Aprovar/Reprovar dados de treinamento em lote
- Visualizar galeria de imagens geradas
- Aprovar imagens para treinamento
- Marcar dados como "alta qualidade"

**Acesso:**
- Rota: `/dashboard/training`
- Requer role: `admin` ou `super_admin`

### 4. API de Bulk Import (Programático)

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

### 5. Webhook de Integração (Externo)

**Endpoint:** `POST /api/training/webhook`

Permite que sistemas externos enviem dados diretamente para treinamento.

---

## Fluxo de Aprendizado

```
┌─────────────────────────────────────────────────────────────┐
│                    COLETA (Tempo Real)                      │
│  Chat → Documentos → Dashboard → API → Webhook              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                AVALIAÇÃO DE QUALIDADE                       │
│  • Rating >= 4 estrelas                                     │
│  • Aprovação manual (opcional)                              │
│  • Verificação de duplicatas                                │
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

## Schedule de Aprendizado

| Operação | Frequência | Horário | Mínimo de Dados |
|----------|------------|---------|-----------------|
| RAG Update | Tempo real | - | 1 documento |
| Auto-indexação | Diário | 3:00 AM | - |
| Fine-tuning LoRA | 4 dias | 2:00 AM | 50 entradas |
| Fine-tuning Completo | Quinzenal | 1:00 AM | 200 entradas |

---

## Imagens e Aprendizado Visual

### Como Funciona

1. **Geração de Imagem (FLUX.1 Schnell)**
   - Usuário pede imagem no chat
   - Alice detecta intenção de gerar imagem
   - FLUX.1 Schnell gera em 1-3 segundos
   - Imagem é exibida no chat

2. **Feedback e Aprovação**
   - Usuário avalia imagem (1-5 estrelas)
   - Admin pode aprovar para treinamento
   - Imagens aprovadas entram no dataset

3. **Progressive LoRA Visual**
   - Imagens aprovadas são usadas para fine-tuning
   - CLIP embeddings para RAG multimodal
   - Busca por similaridade visual

### Upload de Imagens

| Fonte | Processamento |
|-------|---------------|
| Chat | CLIP embedding + armazenamento |
| Dashboard | Upload direto + aprovação |
| API | Bulk import de imagens |

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

## Onde Alimentar o Modelo

### 1. Interface do Chat
- Converse normalmente
- Avalie as respostas (estrelas)
- Faça upload de documentos

### 2. Dashboard Admin
- Rota: `/dashboard/training`
- Aprovar/Reprovar dados em lote
- Importar datasets externos
- Visualizar galeria de imagens

### 3. API REST

```bash
# Importar dados de treinamento
POST /api/training/bulk-import

# Upload de documento para RAG
POST /api/rag/documents

# Aprovar dados para treinamento
PATCH /api/training/data/{id}/approve

# Aprovar imagem para treinamento
PATCH /api/images/{id}/approve
```

### 4. Integrações Externas
- Webhook para sistemas externos
- Sincronização com ERPNext
- Import de bases de conhecimento

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

*Documentação em Português Brasileiro (Regra 10 replit.md)*
*Versão 1.1 - Dezembro 2025*
*Total de Serviços: 26 (4 infraestrutura + 8 Alice + 12 ERPNext + 2 backup/logs)*
