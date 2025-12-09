# Sistema de Aprendizado da Alice

**Autor:** Fillipe Guerra

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
- **Bulk Import:** Interface visual para importação em massa de dados de treinamento (JSON/JSONL)

**Acesso:**
- Rota: `/training`
- Requer role: `admin` ou `super_admin`

**Bulk Import (Nova Funcionalidade - 09/12/2025):**
- Upload de arquivos JSON ou JSONL (até 10MB, máx 1000 entradas)
- Validação automática com Zod schema
- Preview dos dados antes da importação
- Auto-aprovação configurável
- Drag & drop enterprise
- Feedback visual de progresso
- Deduplicação automática via SemHash

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

### 2. Dashboard Admin - Bulk Import (NOVO - 09/12/2025)
- **Rota:** `/training` → Tab "Import em Massa"
- **Funcionalidades:**
  - Upload de arquivos JSON/JSONL via drag & drop
  - Validação automática de formato
  - Preview dos dados antes de importar
  - Auto-aprovação opcional
  - Importação de até 1000 entradas por arquivo
  - Deduplicação automática via SemHash
- **Formatos Aceitos:**
  - **JSON:** `{"data": [{"messages": [...], "rating": 5}, ...]}`
  - **JSONL:** Uma entrada por linha
- **Validações:**
  - Tamanho máximo: 10MB
  - Máximo 1000 entradas por importação
  - Schema Zod enterprise para garantir qualidade
  - Rating entre 1 e 5 (opcional)

### 3. Dashboard Admin - Manual
- Rota: `/training` → Tab "Dados de Treinamento"
- Aprovar/Reprovar dados em lote
- Visualizar galeria de imagens

### 4. API REST

```bash
# Importar dados de treinamento em massa
POST /api/training/bulk-import
Content-Type: application/json
{
  "data": [...],
  "source": "bulk-import",
  "autoApprove": false
}

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

---

## 📝 Atualização 09/12/2025 - Interface Bulk Import Enterprise

### Funcionalidade Implementada

✅ **Interface Visual para Bulk Import de Training Data**

**Localização:** `/training` → Tab "Import em Massa"

**Capacidades:**
- Upload de arquivos JSON/JSONL via drag & drop enterprise
- Validação automática com Zod schema (TypeScript strict)
- Preview dos dados antes da importação (mostra primeiras 5 entradas)
- Auto-aprovação configurável (apenas dados com rating >= 4)
- Source customizável para rastreabilidade
- Progress feedback visual durante importação
- Deduplicação automática via SemHash
- Error handling completo com mensagens descritivas
- Suporte a até 1000 entradas por arquivo (10MB máx)

**Validações Implementadas:**
- ✅ Tamanho de arquivo (máx 10MB)
- ✅ Formato JSON/JSONL válido
- ✅ Estrutura de dados (messages array obrigatório)
- ✅ Limite de 1000 entradas
- ✅ Rating entre 1 e 5 (opcional)
- ✅ Role válido (user, assistant, system)
- ✅ Content não vazio

**UX Enterprise:**
- ✅ Drag & drop zone com feedback visual
- ✅ Preview com scroll area
- ✅ Badges de status
- ✅ Progress bar durante upload
- ✅ Alerts para erros de validação
- ✅ Internacionalização PT-BR e EN

**Componentes Criados:**
- `apps/frontend-service/src/components/ui/alert.tsx` (shadcn/ui)
- Tab "Import em Massa" em `apps/frontend-service/src/pages/Training.tsx`

**Aderência às 17 Regras:**
- ✅ Regra 6: Zero workarounds, API real `/api/training/bulk-import`
- ✅ Regra 8: TypeScript strict, validação Zod, zero `any`
- ✅ Regra 10: Comentários em PT-BR
- ✅ Regra 13: Internacionalização PT-BR primário, EN secundário
- ✅ Regra 16: Best practices UX 2025 (drag & drop, validação client-side)

---

*Autor: Fillipe Guerra*
*Documentação em Português Brasileiro (Regra 10 CLAUDE.md)*
*Versão 1.7 - 09 de Dezembro de 2025*
*Tecnologias: Node.js (versão LTS automática via API + fallback .nvmrc), pnpm (versão automática via package.json), TypeScript 5.9.3*
*Total de Containers: 40 (5 infraestrutura + 8 Alice + 15 ERPNext + 11 observability + 1 backup)*
*Storage: Volume Hetzner 100GB local (/opt/alice/uploads) para RAG multimodal*
*Bulk Import: Interface visual enterprise implementada (09/12/2025)*
