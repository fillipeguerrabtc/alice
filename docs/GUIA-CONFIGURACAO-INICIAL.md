# Guia Operacional da Alice (Chat → Execução → Treino)

**Autor:** Fillipe Guerra  
**Data:** 23 de Janeiro de 2026  
**Versão:** 1.0.0  

---

## Objetivo

Este manual é focado em **operações pedidas no chat** e em **como usar agentes** para executar tarefas com qualidade e gerar dados de treino. Inclui apenas o essencial de configuração para operar:
- Configuração mínima (Core, Agentic, Namespaces e Agentes).
- Playbooks de operação no chat por domínio (Trading, Financeiro/ERPNext, Atendimento, Jurídico, Fiscal, Compliance).
- Ciclo **chat → aprovação → treino**.

> **Importante:** Este guia é prático e didático. Para aprofundamento técnico, consulte os SSOTs: `docs/SISTEMA-APRENDIZADO.md`, `docs/TRAINING.md`, `docs/ARQUITETURA.md`, `docs/SECRETS.md` e `docs/PERMISSIONS.md`.

---

## 1) Pré‑requisitos obrigatórios

1. **Secrets configuradas**  
   - Siga `docs/SECRETS.md` (SSOT).
   - Sem secrets, várias integrações não funcionarão (OpenAI, KuCoin, ERPNext, Gmail, etc.).

2. **Contas administrativas (3 sistemas independentes)**  
   - **Alice/Auth:** `ADMIN_USER` + `ADMIN_PWD`
   - **Grafana:** `GRAFANA_ADMIN_USER` + `GRAFANA_ADMIN_PASSWORD`
   - **ERPNext:** usuário fixo `Administrator` + `ERPNEXT_ADMIN_PASSWORD`

3. **GPU obrigatória em produção**  
   - LLM e embeddings rodam no GPU Manager (Gate 2).
   - Sem GPU não há fallback (Regra 6).

---

## 2) Fluxo operacional rápido

1. Configurar **Core Prompt** e regras (Admin).
2. Criar **Namespaces** por domínio e **Agentes** associados.
3. Habilitar **Modo Agentic** necessário (Trading/ERP/Payments).
4. Executar **operações no chat** com agentes por domínio.
5. Aprovar dados de treino e rodar **treino on-demand**.

---

## 3) Configuração mínima para operar no chat

### 3.1 Core Prompt (Admin)
- Página: `/alice-config`
- Permissão: `admin:alice_core:write` (admin/super_admin).
- Preencha: **System Prompt Core**, políticas e regras de governança.

### 3.2 Modo Agentic (habilitar capacidades)
- Página: `/agentic-config`
- Ative apenas o que será usado no chat: `tradingEnabled`, `erpReadEnabled`, `erpWriteEnabled`, `paymentsEnabled`, `financialApprovalRequired`.

> Sem Core Prompt e Agentic corretamente configurados, as operações no chat ficam inconsistentes.

---

## 4) Namespaces (organização do conhecimento)

Crie **1 namespace por domínio** que será operado no chat.
- Página: `/namespaces`
- Exemplo: `Trading`, `Financeiro`, `Atendimento`, `Jurídico`, `Fiscal`, `Compliance`.
- Regra: **todo agente deve apontar para um namespace**.

---

## 5) Agentes IA (identidade, prompt e modelo)

Crie **um agente por domínio** com prompt claro e limites definidos.
- Página: `/agents`
- Obrigatório: `namespaceId`, **System Prompt**, **capacidades**.
- Recomendado: `temperature` moderada e `maxTokens` coerente com o domínio.

---

## 6) Relação Namespace ↔ Agente ↔ RAG ↔ Treino

Resumo operacional:
- **Namespace** isola conhecimento e treino por domínio.
- **Agente** executa tarefas no chat usando esse contexto.
- **Treino** vem das conversas aprovadas e feedback.

---

## 7) RAG (Documentos, Imagens e Áudio)

Use RAG apenas se o agente precisar de **documentos internos** para responder no chat.
- Upload rápido: `/documents` (texto) e `/training` (multimodal).
- O agente consulta esses documentos durante a operação no chat.

---

## 8) Coleta de dados do Chat → Aprendizado

### Operações no chat (modo ideal de uso de agentes)
Para obter melhores resultados e gerar dados de treino úteis, use o chat com estrutura clara.

**Estrutura recomendada da solicitação**
1. **Agente alvo** (ex.: "Use o agente Trading").
2. **Objetivo claro** (ex.: "avaliar entrada e sugerir SL/TP").
3. **Contexto e dados** (ex.: símbolo, timeframe, limites, política).
4. **Restrições e aprovações** (ex.: "somente com aprovação explícita").
5. **Saída esperada** (ex.: "resumo + proposta + pedido de confirmação").

**Exemplo (Trading)**
> Use o agente Trading. Avalie XBTUSDTM no timeframe 5m com risco max 2% e sem auto execução.  
> Quero: contexto rápido, sinal (LONG/SHORT/NEUTRAL), entrada/SL/TP e confirmação explícita.

**Exemplo (Financeiro/ERPNext)**
> Use o agente Financeiro. Preciso criar invoice para cliente ACME LTDA com 1 item SERVICO-001 (R$ 1.500) e vencimento 15/02.  
> Responda com os dados necessários e peça confirmação antes de criar.

**Exemplo (Atendimento)**
> Use o agente Atendimento. Responda ao cliente sobre prazo de entrega e política de reembolso com tom empático.  
> Se faltar informação, liste perguntas objetivas.

### Como funciona
1. O usuário avalia a resposta (1–5 estrelas).
2. **Rating >= 4** torna a conversa candidata a treinamento.
3. Admin aprova/reprova em `/training`.
4. Dados aprovados entram no próximo ciclo de fine‑tuning.

### Curadoria manual (recomendado)
No chat, use **“Enviar p/ Treino”** para enviar conversa ao namespace correto.

### Boas práticas para treinar agentes via chat
- Prefira pedidos completos e objetivos (dados, limites, política).
- Evite mensagens vagas; isso reduz qualidade do dataset.
- Sempre registre a **confirmação explícita** em operações sensíveis.
- Use o **mesmo agente** por domínio para manter consistência do treino.

---

## 9) Datasets e treinamento (QLoRA)

Página: `/training`

### Operação mínima
1. Filtre por **namespace** e **aprove dados**.
2. Use **Aprovação em lote** para acelerar.
3. Dispare **Treinamento on-demand** quando houver volume.

> O auto‑learning roda por padrão (incremental semanal / completo quinzenal).

---

## 10) Especialização para Trading (KuCoin)

Foco em **pedidos no chat** + **confirmação explícita**.

### Playbook no chat
1. **Peça análise objetiva** (contexto + sinal).
2. **Exija confirmação** antes de qualquer execução.
3. **Registre SL/TP** e limites de risco na conversa.

### Exemplo de pedido (Trading)
> Use o agente Trading. Quero sinal para XBTUSDTM (5m), risco máx 2% e sem execução automática.  
> Entregue contexto, sinal, entrada/SL/TP e peça minha confirmação.

### Treino a partir do chat
- Marque a conversa com **“Enviar p/ Treino”**.
- Aprove no `/training` e rode **Treinamento Trading** quando atingir volume mínimo.

---

## 11) Especialização para Finanças/ERPNext

Foco em **tarefas financeiras pedidas no chat** com confirmação.

### Playbook no chat
1. Solicite **dados mínimos** (cliente, item, valores, vencimento).
2. Explique o que será criado no ERPNext.
3. **Peça confirmação explícita** antes de criar.

### Exemplo de pedido (Financeiro/ERPNext)
> Use o agente Financeiro. Preciso criar invoice para ACME LTDA com 1 item SERVICO-001 (R$ 1.500) e vencimento 15/02.  
> Liste dados faltantes e peça confirmação antes de criar.

### Treino a partir do chat
- Envie conversas aprovadas para o treino.
- Execute treinamento on-demand quando houver volume suficiente.

---

## 12) Permissões e RBAC essenciais

| Módulo | Permissões chave | Uso |
|-------|------------------|-----|
| **Core Alice** | `admin:alice_core:write` | Editar prompt global e políticas |
| **Namespaces** | `chat:namespaces:read/write/delete` | CRUD de namespaces |
| **Agents** | `chat:agents:read/write/delete` | CRUD de agentes |
| **RAG** | `rag:documents:read/write` | Documentos e reindexação |
| **Training** | `training:training_data:*` | Aprovação e gestão de dados |
| **Fine-tuning** | `training:fine_tuning_jobs:*` | Criar/cancelar jobs |
| **Trading** | `integrations:trading:read/write/manage` | Operações KuCoin |
| **ERPNext** | `integrations:erpnext:read/write` | CRM/ERP |

> Admins e super_admins recebem permissões completas automaticamente.

---

## 13) Observabilidade e validação

Validação mínima pós-operação:
- **Grafana** (Trading/GPU/ERPNext) e `/health`.
- Logs no Grafana/Loki quando algo não responde.

---

## 14) Troubleshooting rápido

- **Agente não responde**: verifique GPU Manager e containers GPU.
- **Treino não inicia**: valide se há dados aprovados.
- **ERPNext falha**: valide ERPNEXT_URL e permissões agentic.

---

## 15) Próximos passos recomendados

1. Começar com **1 agente por domínio** (Trading, Financeiro, Atendimento).
2. Operar no chat com pedidos estruturados e confirmação explícita.
3. Aprovar dados e rodar o primeiro **treino on-demand**.

---

## 16) Templates de prompts por domínio (exemplos reais)

> **Uso recomendado:** cole no campo **System Prompt** do agente (aba Prompt em `/agents`).  
> Ajuste linguagem, limites e regras conforme o seu compliance.

### 16.1 Trading (KuCoin Futures)
```
Você é um agente especialista em BTC Futures (KuCoin Perpetuals).
Objetivo: gerar análises objetivas, sinais claros e ordens somente com autorização explícita.

Regras obrigatórias:
- Nunca execute ordens sem confirmação do usuário.
- Sempre respeite limites de risco do tenant (risk config).
- Se houver conflito ou incerteza, peça confirmação.
- Use linguagem objetiva, sem promessas de lucro.
- Priorize precisão e gestão de risco.

Formato de resposta:
1) Contexto de mercado (curto)
2) Sinal (LONG/SHORT/NEUTRAL) + justificativa
3) Parâmetros sugeridos (entrada/SL/TP) com cautela
4) Pergunta de confirmação antes de qualquer execução
```

### 16.2 Financeiro / ERPNext
```
Você é um agente financeiro e contábil integrado ao ERPNext.
Objetivo: apoiar lançamentos, conciliações e pagamentos com aprovação explícita.

Regras obrigatórias:
- Nunca aprovar pagamentos sem confirmação humana.
- Não inventar números: sempre pedir a fonte/registro.
- Seguir regras fiscais e políticas internas do tenant.
- Registrar claramente o que será criado/alterado no ERP.

Formato de resposta:
1) Entendimento da solicitação
2) Dados necessários (lista objetiva)
3) Ação sugerida (ex.: criar invoice, payment entry)
4) Solicitar aprovação explícita
```

### 16.3 Atendimento/Customer Support
```
Você é um agente de atendimento enterprise.
Objetivo: resolver dúvidas com precisão e escalar quando necessário.

Regras obrigatórias:
- Se não souber, diga que irá consultar.
- Nunca inventar políticas.
- Use linguagem empática e direta.
- Em casos críticos, escalar imediatamente.
```

### 16.4 Jurídico
```
Você é um agente jurídico enterprise.
Objetivo: apoiar análises legais e revisão de riscos, sem substituir parecer jurídico humano.

Regras obrigatórias:
- Não emitir parecer definitivo; sempre recomendar validação humana.
- Não inventar leis, números ou cláusulas.
- Indicar claramente limites e incertezas.
- Solicitar documentos oficiais quando necessário.

Formato de resposta:
1) Entendimento do caso
2) Riscos e pontos críticos
3) Dados/documentos necessários
4) Recomendação de validação humana
```

### 16.5 Fiscal
```
Você é um agente fiscal e tributário.
Objetivo: orientar rotinas fiscais com base em documentos oficiais.

Regras obrigatórias:
- Não inventar alíquotas ou obrigações.
- Solicitar UF/município e regime tributário.
- Sempre referenciar a fonte (quando disponível).
- Se houver dúvida, indicar consulta ao contador.

Formato de resposta:
1) Dados fiscais necessários
2) Orientação preliminar
3) Pontos de atenção e compliance
4) Solicitar validação do responsável fiscal
```

### 16.6 Compliance
```
Você é um agente de compliance e governança.
Objetivo: garantir conformidade com políticas internas e regulações aplicáveis.

Regras obrigatórias:
- Nunca aprovar exceções sem autorização formal.
- Sempre exigir evidências e registros.
- Classificar risco (baixo/médio/alto) e justificar.
- Recomendar auditoria quando necessário.

Formato de resposta:
1) Enquadramento do caso
2) Risco e impacto
3) Evidências necessárias
4) Próximos passos com aprovação
```

---

## 17) Checklist de secrets por ambiente (resumo)

> **SSOT obrigatório:** a lista exata e atual está em `docs/SECRETS.md`.  
> Este checklist é um **resumo didático** para onboarding rápido.

### 17.1 Desenvolvimento (local)
Obrigatórios para rodar o core:
- `ADMIN_USER`, `ADMIN_PWD`
- `SESSION_SECRET`, `INTERNAL_API_SECRET`
- `POSTGRES_*` (ou `DATABASE_URL` conforme setup local)
- `REDIS_*`

Se usar recursos avançados:
- **RAG/GPU**: `QDRANT_API_KEY`, variáveis do GPU Manager
- **Vision/ASR**: `OPENAI_API_KEY`
- **Email**: `GMAIL_USER`, `GMAIL_APP_PASSWORD`

### 17.2 Produção (Hetzner)
Obrigatórios (core + compliance):
- Admins: `ADMIN_USER`, `ADMIN_PWD`, `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`, `ERPNEXT_ADMIN_PASSWORD`
- Segurança: `SESSION_SECRET`, `INTERNAL_API_SECRET`
- Banco/cache: `POSTGRES_*`, `REDIS_*`
- RAG: `QDRANT_API_KEY`
- Observabilidade: `LANGFUSE_*`, `CLICKHOUSE_*`, `MINIO_ROOT_PASSWORD`
- Email: `GMAIL_USER`, `GMAIL_APP_PASSWORD`

Integrações opcionais (quando habilitadas):
- **KuCoin Trading**: `KUCOIN_*`
- **ERPNext**: `ERPNEXT_URL` + credenciais/SSO
- **Stripe/Wise/Twilio**: respectivos tokens

---

## 18) Apêndice — Payloads API detalhados (exemplos)

### 18.1 Namespaces
```http
POST /api/namespaces
Content-Type: application/json

{
  "nome": "Trading",
  "slug": "trading",
  "descricao": "Operações BTC Futures",
  "cor": "#3B82F6"
}
```

### 18.2 Agentes
```http
POST /api/agents
Content-Type: application/json

{
  "nome": "Trader Alpha",
  "slug": "trader-alpha",
  "status": "active",
  "namespaceId": "uuid",
  "descricao": "Especialista em scalping BTC",
  "instrucoes": "Use o prompt de Trading do guia.",
  "personalidade": "Objetivo e conservador",
  "capacidades": ["trading", "rag"]
}
```

### 18.3 Core Settings
```http
PATCH /api/assistant-settings
Content-Type: application/json

{
  "creatorName": "Fillipe Guerra",
  "creatorRule": "Jamais operar sem aprovação.",
  "ethicsPolicy": "...",
  "moralPolicy": "...",
  "legalPolicy": "...",
  "safetyGuardrails": "...",
  "nsfwPolicy": "...",
  "systemPrompt": "Você é Alice..."
}
```

### 18.4 Coleta de dados de treinamento
```http
POST /api/training/data
Content-Type: application/json

{
  "tenantId": "uuid",
  "namespaceId": "uuid",
  "source": "chat",
  "messages": [
    { "role": "user", "content": "Compre 0.1 BTC a mercado" },
    { "role": "assistant", "content": "Confirma a ordem?" }
  ],
  "rating": 5
}
```

### 18.5 Aprovação em lote
```http
POST /api/training/data/approve-batch
Content-Type: application/json

{
  "ids": ["uuid1", "uuid2", "uuid3"],
  "action": "approve"
}
```

### 18.6 Treinamento on‑demand
```http
POST /api/training/run/start
Content-Type: application/json

{
  "tenantId": "uuid",
  "trainingType": "incremental",
  "includeImages": false,
  "priority": "high",
  "description": "Treino após novos dados de trading"
}
```

### 18.7 Treinamento Trading
```http
POST /api/training/jobs/trading
Content-Type: application/json

{
  "namespaceId": "uuid",
  "name": "Trading Fine-Tuning"
}
```

### 18.8 RAG Search (texto)
```http
POST /api/rag/search
Content-Type: application/json

{
  "query": "Qual o limite de alavancagem por política interna?",
  "limit": 10,
  "threshold": 0.7
}
```

### 18.9 Configuração Agentic
```http
PATCH /api/agentic/settings
Content-Type: application/json

{
  "webEnabled": true,
  "erpReadEnabled": true,
  "erpWriteEnabled": true,
  "tradingEnabled": true,
  "paymentsEnabled": true,
  "stackOpsEnabled": false,
  "financialApprovalRequired": true,
  "platformLinks": [
    { "id": "erpnext", "name": "ERPNext", "url": "https://erp.seudominio.com" }
  ]
}
```

### 18.10 Trading — Criar ordem (KuCoin)
```http
POST /api/integrations/trading/orders
Content-Type: application/json

{
  "symbol": "XBTUSDTM",
  "side": "buy",
  "orderType": "limit",
  "size": 1,
  "price": 50000,
  "leverage": 5
}
```

### 18.11 Trading — Criar stop order (TP/SL)
```http
POST /api/integrations/trading/stop-orders
Content-Type: application/json

{
  "symbol": "XBTUSDTM",
  "side": "sell",
  "size": 1,
  "stopLoss": 49500,
  "orderType": "market",
  "stopPriceType": "MP",
  "leverage": 5
}
```

### 18.12 Trading — Sincronizar ordens (KuCoin)
```http
POST /api/integrations/trading/orders/sync
Content-Type: application/json
```

### 18.13 Trading — Cancelar stop order
```http
DELETE /api/integrations/trading/stop-orders/ORDER_ID
Content-Type: application/json
```

### 18.14 Trading — Risk Config (GET/PUT)
```http
GET /api/integrations/trading/risk-config
```

```http
PUT /api/integrations/trading/risk-config
Content-Type: application/json

{
  "maxPositionSize": "2.5",
  "maxDailyLoss": "4.0",
  "maxOrderValue": "2500",
  "maxLeverage": 10,
  "maxOpenPositions": 3,
  "defaultLeverage": 5,
  "defaultStopLoss": "1.8",
  "defaultTakeProfit": "3.5",
  "tradingEnabled": true,
  "autoExecuteSignals": false,
  "minConfidenceToExecute": "0.72"
}
```

### 18.15 ERPNext — Criar cliente
```http
POST /api/integrations/erpnext/customers
Content-Type: application/json

{
  "customerName": "ACME LTDA",
  "customerType": "Company",
  "territory": "Portugal",
  "email": "financeiro@acme.com",
  "phone": "+351900000000",
  "taxId": "PT123456789"
}
```

### 18.16 ERPNext — Criar invoice
```http
POST /api/integrations/erpnext/invoices
Content-Type: application/json

{
  "customer": "ACME LTDA",
  "items": [
    { "itemCode": "SERVICO-001", "qty": 1, "rate": 1500 }
  ],
  "dueDate": "2026-02-15"
}
```

### 18.17 ERPNext — Nota sobre Sales Order e Payment Entry
No `integrations-service`, **não há endpoints públicos** para `sales-order` e `payment-entry`.
Esses registros são criados **internamente** no fluxo ERPNext (Customer → Sales Order → Sales Invoice → Payment Entry)
usando as APIs oficiais do ERPNext:
- `POST /api/resource/Sales%20Order`
- `POST /api/method/erpnext.selling.doctype.sales_order.sales_order.make_sales_invoice`
- `POST /api/method/erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry`
- `POST /api/resource/Payment%20Entry`

---

## Referências

- `docs/SISTEMA-APRENDIZADO.md`
- `docs/TRAINING.md`
- `docs/ARQUITETURA.md`
- `docs/SECRETS.md`
- `docs/PERMISSIONS.md`
- `docs/OBSERVABILITY.md`
