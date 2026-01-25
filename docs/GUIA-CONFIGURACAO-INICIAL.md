# Guia Operacional da Alice (Chat → Execução → Treino)

**Autor:** Fillipe Guerra  
**Data:** 25 de Janeiro de 2026  
**Versão:** 1.3.0  

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

## 3) Configuração mínima para operar no chat (passo a passo)

### 3.1 Core Prompt (Admin) — Configuração da Alice
- Página: `/alice-config`
- Permissão: `admin:alice_core:write` (admin/super_admin).
- Objetivo: definir **a identidade global da Alice**, regras de governança, segurança e limites.

**Passo a passo**
1. Acesse `/alice-config`.
2. Preencha **Creator Name** e **Creator Rule** (autoridade e regra máxima).
3. Preencha as políticas: **Ethics**, **Moral**, **Legal**, **Safety Guardrails**, **NSFW**.
4. Defina o **System Prompt Core** (o “cérebro global”).
5. Salve e valide com um teste simples no chat.

**O que cada campo faz**
- **Creator Name**: referência institucional do sistema (ex.: CTO/Compliance Lead).
- **Creator Rule**: regra suprema que a Alice nunca pode violar.
- **Ethics/Moral/Legal**: limites explícitos de conduta e conformidade.
- **Safety Guardrails**: regras para evitar ações perigosas ou não auditadas.
- **NSFW Policy**: política de conteúdo sensível.
- **System Prompt Core**: o prompt global que orienta **todas** as respostas.

**Exemplo de System Prompt Core (resumo)**
```
Você é Alice, assistente enterprise focada em finanças, trading e gestão.
Regras: nunca executar ações críticas sem confirmação; priorizar precisão, compliance e rastreabilidade.
Sempre responder em PT-BR, com linguagem profissional e objetiva.
Se faltar dado, pedir explicitamente.
```

**Dicas**
- Mantenha o Core **curto e direto**. Detalhes específicos devem ir para os agentes.
- Regras críticas devem estar no **Core** e também nos **Agent Prompts**.

### 3.2 Modo Agentic (habilitar capacidades)
- Página: `/agentic-config`
- Objetivo: ligar/desligar **capabilities reais** do sistema (Web, ERP, Payments, Stack Ops, Trading).

**Passo a passo**
1. Acesse `/agentic-config`.
2. Ative somente o que será usado no chat.
3. Revise as seções de detectores (keywords/patterns) por domínio.
4. Salve e valide com um comando simples no chat.

**O que cada toggle faz**
- **webEnabled**: permite busca web (SearXNG) no fluxo agentic.
- **erpReadEnabled**: leitura no ERPNext (consultas e listagens).
- **erpWriteEnabled**: escrita no ERPNext (criar/alterar registros).
- **tradingEnabled**: habilita comandos reais de trading (KuCoin).
- **paymentsEnabled**: habilita pagamentos via Wise/Stripe.
- **stackOpsEnabled**: permite ações operacionais (deploy/rollback via GitHub Actions).
- **financialApprovalRequired**: força aprovação explícita em ações financeiras.

**Dicas**
- Em produção, **ative somente o necessário** (menor superfície de risco).
- `financialApprovalRequired` deve ficar **ativo** para compliance.

**Detectores (keywords e patterns)**
- Cada seção (`web`, `erp`, `payments`, `stackOps`, `trading`, `agenticTask`) possui **keywords** e **patterns**.
- **Keywords**: termos simples (ex.: “fatura”, “invoice”, “pagamento”).
- **Patterns**: regex para identificar pedidos específicos (ex.: `\bcriar\s+invoice\b`).

**Exemplo de configuração (keywords)**
- `erp.baseKeywords`: `cliente`, `item`, `invoice`, `fatura`
- `payments.wiseKeywords`: `wise`, `transferência internacional`
- `stackOps.deployKeywords`: `deploy`, `release`, `versão`

> Sem Core Prompt e Agentic corretamente configurados, as operações no chat ficam inconsistentes.

---

## 4) Namespaces (organização do conhecimento)

Crie **1 namespace por domínio** que será operado no chat.
- Página: `/namespaces`
- Exemplo: `Trading`, `Financeiro`, `Atendimento`, `Jurídico`, `Fiscal`, `Compliance`.
- Regra: **todo agente deve apontar para um namespace**.

**Passo a passo**
1. Acesse `/namespaces`.
2. Clique em **Novo Namespace**.
3. Defina: `nome`, `slug`, `descrição` e `cor`.
4. Salve e valide no card (contagem de agentes/documentos).

**Dicas**
- `slug` deve ser curto e sem espaços (ex.: `financeiro`).
- Use cores distintas para facilitar o uso operacional.

---

## 5) Agentes IA (identidade, prompt e modelo)

Crie **um agente por domínio** com prompt claro e limites definidos.
- Página: `/agents`
- Obrigatório: `namespaceId`, **System Prompt**, **capacidades**.
- Recomendado: `temperature` moderada e `maxTokens` coerente com o domínio.

**Passo a passo**
1. Acesse `/agents`.
2. Clique em **Novo Agente**.
3. Defina nome, slug, status e namespace.
4. Preencha **System Prompt do agente**.
5. Ajuste **modelo**, **temperature** e **maxTokens**.
6. Defina **capacidades** (ex.: `trading`, `rag`, `payments`).
7. Salve e valide com um pedido simples no chat.

**Diferença entre System Prompt Core e Agent Prompt**
- **Core Prompt**: regras globais da Alice (sempre ativo).
- **Agent Prompt**: regras específicas do domínio (reforça limites e estilo).

**Dicas de configuração**
- `temperature` baixa (0.2–0.5) para tarefas críticas.
- `maxTokens` menor para respostas objetivas e auditáveis.
- Agente financeiro deve ser **conservador e verificável**.

**Exemplo de Agent Prompt (Financeiro)**
```
Você é um agente financeiro enterprise integrado ao ERPNext.
Regras: não criar nem pagar sem aprovação explícita. Nunca inventar números.
Se faltar dado, pergunte de forma objetiva.
Formato: (1) entendimento (2) dados necessários (3) ação sugerida (4) confirmação.
```

**Exemplo de Agent Prompt (Trading)**
```
Você é um agente de trading especializado em KuCoin Futures.
Regras: nunca executar ordens sem confirmação; sempre respeitar risk config.
Formato: contexto → sinal → entrada/SL/TP → confirmação explícita.
```

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

**Dicas**
- Mantenha documentos por domínio/namespace.
- Evite PDFs gigantes sem necessidade (aumenta ruído).

---

## 8) Como os agentes funcionam no chat (roteamento, canais e handover)

### 8.1 Roteamento automático por domínio
- Ao iniciar uma **nova conversa**, a Alice analisa o pedido e seleciona o **agente do domínio**.
- Essa decisão usa **texto do pedido**, **namespace** e **detectores do Modo Agentic**.
- A conversa fica associada a **um único agente** até o fim.

**Dica para usuários leigos**
- Se existir seletor de agente, use-o antes de enviar a mensagem.
- Se não existir, escreva claramente o domínio: “Use o agente Financeiro”.

### 8.2 O que acontece se o pedido não for do domínio do agente?
- A Alice **não troca de agente automaticamente dentro da mesma conversa**.
- Se o assunto mudar de domínio, o recomendado é:
  1. **Encerrar a conversa atual**.
  2. **Abrir nova conversa** e selecionar o agente correto.

**Exemplo de resposta correta do agente**
> “Esse assunto não é do meu domínio. Para prosseguir, abra uma nova conversa e selecione o agente Jurídico/Compliance.”

### 8.3 Handover (escalação para humano)
- Para casos sensíveis ou quando o usuário pede atendimento humano, a conversa pode entrar em **modo humano**.
- Nesse modo, a Alice **pausa a automação** e um operador assume.

### 8.4 WhatsApp (Twilio) — como o canal funciona
- O WhatsApp usa o **Twilio** como provedor oficial.
- Mensagens recebidas entram pelo webhook:
  - `POST /api/integrations/twilio/webhook/whatsapp`
- O sistema:
  1. Cria (ou reutiliza) o usuário pelo telefone.
  2. Cria (ou reutiliza) a conversa.
  3. Envia a mensagem ao chat‑service com `channel: 'whatsapp'`.
  4. Retorna a resposta ao cliente via Twilio.

**Pré‑requisitos WhatsApp**
- Secrets obrigatórios: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`.
- Webhook do Twilio apontando para a URL acima.

---

## 9) Coleta de dados do Chat → Aprendizado

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

## 10) Datasets e treinamento (QLoRA) — Página Training

Página: `/training`

### Operação mínima
1. Filtre por **namespace** e **aprove dados**.
2. Use **Aprovação em lote** para acelerar.
3. Dispare **Treinamento on-demand** quando houver volume.

> O auto‑learning roda por padrão (incremental semanal / completo quinzenal).

**O que cada área faz**
- **Training Data**: lista conversas e aprovações pendentes.
- **Filtros por Namespace**: separa por domínio.
- **Aprovação em lote**: acelera a curadoria.
- **Run Training**: dispara fine‑tuning on‑demand.

**Dicas**
- Não treine com poucos exemplos; prefira volume consistente.
- Treinos por domínio produzem modelos mais estáveis.

**Exemplo de prompt de treino (descrição)**
```
Treino incremental após conversas de ERPNext com aprovação explícita.
Objetivo: reduzir perguntas repetidas e melhorar checklist de dados.
```

---

## 11) Especialização para Trading (KuCoin)

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

## 12) Especialização para Finanças/ERPNext

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

## 13) Permissões e RBAC essenciais

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

## 14) Observabilidade e validação

Validação mínima pós-operação:
- **Grafana** (Trading/GPU/ERPNext) e `/health`.
- Logs no Grafana/Loki quando algo não responde.

---

## 15) Troubleshooting rápido

- **Agente não responde**: verifique GPU Manager e containers GPU.
- **Treino não inicia**: valide se há dados aprovados.
- **ERPNext falha**: valide ERPNEXT_URL e permissões agentic.

---

## 16) Próximos passos recomendados

1. Começar com **1 agente por domínio** (Trading, Financeiro, Atendimento).
2. Operar no chat com pedidos estruturados e confirmação explícita.
3. Aprovar dados e rodar o primeiro **treino on-demand**.

---

## 17) Templates de prompts por domínio (exemplos reais)

> **Uso recomendado:** cole no campo **System Prompt** do agente (aba Prompt em `/agents`).  
> Ajuste linguagem, limites e regras conforme o seu compliance.

### 17.1 Atendimento (Customer Support)
**Namespace:** `atendimento`  
**Agente:** `Atendimento`  
**Modo Agentic recomendado:** `webEnabled` (consultas públicas)  
**Temperatura:** 0.4 | **maxTokens:** 900

**Prompt (copiar e colar)**
```
Você é um agente de Atendimento enterprise.
Objetivo: responder clientes com clareza, empatia e precisão.
Regras: não inventar políticas; se faltar dado, fazer perguntas objetivas.
Se o tema for financeiro/jurídico/trading, instruir a abrir conversa com o agente correto.
Formato: resposta direta + próximos passos + pergunta final (se necessário).
```

**Exemplo de pedido**
> “Preciso do status do meu pedido #1234 e prazo de entrega.”

---

### 17.2 Trading (KuCoin Futures)
**Namespace:** `trading`  
**Agente:** `Trading`  
**Modo Agentic recomendado:** `tradingEnabled`, `webEnabled`  
**Temperatura:** 0.3 | **maxTokens:** 1200

**Prompt (copiar e colar)**
```
Você é um agente especialista em BTC Futures (KuCoin).
Regras: nunca executar ordens sem confirmação explícita.
Sempre respeitar risk config do tenant. Nada de promessas de lucro.
Formato: contexto curto → sinal (LONG/SHORT/NEUTRAL) → entrada/SL/TP → confirmação.
```

**Exemplo de pedido**
> “Analise XBTUSDTM 5m e sugira entrada/SL/TP com risco 2%.”

---

### 17.3 Contabilidade
**Namespace:** `contabilidade`  
**Agente:** `Contabilidade`  
**Modo Agentic recomendado:** `erpReadEnabled`, `erpWriteEnabled`  
**Temperatura:** 0.2 | **maxTokens:** 900

**Prompt (copiar e colar)**
```
Você é um agente de Contabilidade.
Regras: não inventar números; pedir fonte/registro sempre.
Antes de criar/alterar registros, pedir confirmação explícita.
Formato: entendimento → dados necessários → ação sugerida → confirmação.
```

**Exemplo de pedido**
> “Quero lançar uma fatura para ACME LTDA com vencimento 15/02.”

---

### 17.4 Financeiro
**Namespace:** `financeiro`  
**Agente:** `Financeiro`  
**Modo Agentic recomendado:** `erpReadEnabled`, `erpWriteEnabled`, `paymentsEnabled`  
**Temperatura:** 0.3 | **maxTokens:** 1000

**Prompt (copiar e colar)**
```
Você é um agente Financeiro integrado ao ERPNext.
Regras: nunca efetuar pagamentos sem aprovação explícita.
Sempre listar dados mínimos e explicar o que será criado.
Formato: entendimento → dados necessários → ação sugerida → confirmação.
```

**Exemplo de pedido**
> “Preciso pagar fornecedor X via Wise. Qual valor e dados faltam?”

---

### 17.5 Jurídico/Compliance
**Namespace:** `juridico-compliance`  
**Agente:** `Jurídico e Compliance`  
**Modo Agentic recomendado:** `webEnabled` (consulta de legislação pública)  
**Temperatura:** 0.2 | **maxTokens:** 1100

**Prompt (copiar e colar)**
```
Você é um agente Jurídico/Compliance.
Regras: nunca emitir parecer definitivo; sempre recomendar validação humana.
Não inventar leis, cláusulas ou números. Indicar limites e incertezas.
Formato: entendimento → riscos → documentos necessários → recomendação de validação.
```

**Exemplo de pedido**
> “Temos cláusula de multa em contrato; quais riscos devemos revisar?”

---

### 17.6 Secretaria(o)
**Namespace:** `secretaria`  
**Agente:** `Secretaria`  
**Modo Agentic recomendado:** `webEnabled` (agenda, informações públicas)  
**Temperatura:** 0.5 | **maxTokens:** 800

**Prompt (copiar e colar)**
```
Você é um agente de Secretaria(o) corporativo.
Regras: organizar tarefas, resumir, lembrar prazos e pedir dados faltantes.
Não assumir informações não confirmadas.
Formato: checklist do que precisa + próximos passos + confirmação.
```

**Exemplo de pedido**
> “Organize as tarefas da reunião de amanhã e liste pendências.”

---

### 17.7 Backoffice
**Namespace:** `backoffice`  
**Agente:** `Backoffice`  
**Modo Agentic recomendado:** `erpReadEnabled`, `erpWriteEnabled`, `webEnabled`  
**Temperatura:** 0.3 | **maxTokens:** 1000

**Prompt (copiar e colar)**
```
Você é um agente de Backoffice.
Regras: padronizar processos internos e evitar ações críticas sem aprovação.
Sempre registrar o que será alterado no ERPNext antes de executar.
Formato: entendimento → dados necessários → ação sugerida → confirmação.
```

**Exemplo de pedido**
> “Preciso padronizar cadastro de clientes e revisar dados incompletos.”

---

## 18) Configuração completa por pilar (end‑to‑end)

> Objetivo: deixar **cada pilar 100% pronto** para operação e treinamento.  
> Use estes exemplos como “copiar e colar”.

### 18.1 Atendimento (Customer Support)
**Alice Core (trecho recomendado)**
```
Priorize atendimento empático, respostas claras e confirmação de dados sensíveis.
Nunca invente políticas; quando houver dúvida, peça mais informações.
```

**Namespace**
- Nome: `Atendimento`
- Slug: `atendimento`
- Descrição: `Suporte ao cliente, prazos, reembolsos e informações gerais`
- Cor: `#10B981`

**Agente**
- Nome: `Atendimento`
- Slug: `atendimento`
- Descrição: `Atendimento ao cliente com tom empático e objetivo`
- Capacidades: `rag`, `web`
- System Prompt (copiar e colar): **use o prompt do item 17.1**

**Modo Agentic**
- `webEnabled: true`
- `financialApprovalRequired: true`

**Treinamento (exemplo de descrição)**
```
Treino Atendimento: respostas claras e empáticas, com perguntas objetivas e sem inventar políticas.
```

---

### 18.2 Trading
**Alice Core (trecho recomendado)**
```
Para trading, sempre exigir confirmação explícita antes de executar qualquer ordem.
Nunca prometer lucro. Priorizar gestão de risco.
```

**Namespace**
- Nome: `Trading`
- Slug: `trading`
- Descrição: `Operações BTC Futures e sinais com gestão de risco`
- Cor: `#3B82F6`

**Agente**
- Nome: `Trading`
- Slug: `trading`
- Descrição: `Especialista em KuCoin Futures com foco em risco`
- Capacidades: `trading`, `rag`, `web`
- System Prompt (copiar e colar): **use o prompt do item 17.2**

**Modo Agentic**
- `tradingEnabled: true`
- `webEnabled: true`
- `financialApprovalRequired: true`

**Treinamento (exemplo de descrição)**
```
Treino Trading: sinais objetivos + confirmação explícita antes de execução.
```

---

### 18.3 Contabilidade
**Alice Core (trecho recomendado)**
```
Para contabilidade, nunca inventar números. Sempre pedir fonte/registro.
```

**Namespace**
- Nome: `Contabilidade`
- Slug: `contabilidade`
- Descrição: `Lançamentos contábeis, conciliações e validações`
- Cor: `#6366F1`

**Agente**
- Nome: `Contabilidade`
- Slug: `contabilidade`
- Descrição: `Agente contábil integrado ao ERPNext`
- Capacidades: `erp`, `rag`
- System Prompt (copiar e colar): **use o prompt do item 17.3**

**Modo Agentic**
- `erpReadEnabled: true`
- `erpWriteEnabled: true`
- `financialApprovalRequired: true`

**Treinamento (exemplo de descrição)**
```
Treino Contabilidade: checklist de dados obrigatórios e confirmação explícita.
```

---

### 18.4 Financeiro
**Alice Core (trecho recomendado)**
```
Para financeiro, pagamentos só com aprovação explícita e dados completos.
```

**Namespace**
- Nome: `Financeiro`
- Slug: `financeiro`
- Descrição: `Pagamentos, contas a pagar/receber e rotinas financeiras`
- Cor: `#F59E0B`

**Agente**
- Nome: `Financeiro`
- Slug: `financeiro`
- Descrição: `Agente financeiro integrado ao ERPNext e Wise/Stripe`
- Capacidades: `erp`, `payments`, `rag`
- System Prompt (copiar e colar): **use o prompt do item 17.4**

**Modo Agentic**
- `erpReadEnabled: true`
- `erpWriteEnabled: true`
- `paymentsEnabled: true`
- `financialApprovalRequired: true`

**Treinamento (exemplo de descrição)**
```
Treino Financeiro: dados mínimos para pagamentos e confirmação antes de executar.
```

---

### 18.5 Jurídico/Compliance
**Alice Core (trecho recomendado)**
```
Jurídico/Compliance nunca emite parecer definitivo e sempre recomenda validação humana.
```

**Namespace**
- Nome: `Jurídico/Compliance`
- Slug: `juridico-compliance`
- Descrição: `Análises legais, risco regulatório e compliance`
- Cor: `#EF4444`

**Agente**
- Nome: `Jurídico e Compliance`
- Slug: `juridico-compliance`
- Descrição: `Agente jurídico com foco em risco e conformidade`
- Capacidades: `web`, `rag`
- System Prompt (copiar e colar): **use o prompt do item 17.5**

**Modo Agentic**
- `webEnabled: true`
- `financialApprovalRequired: true`

**Treinamento (exemplo de descrição)**
```
Treino Jurídico/Compliance: checklist de documentos e recomendação de validação humana.
```

---

### 18.6 Secretaria(o)
**Alice Core (trecho recomendado)**
```
Secretaria(o) organiza tarefas e pede dados faltantes sem assumir informações.
```

**Namespace**
- Nome: `Secretaria`
- Slug: `secretaria`
- Descrição: `Organização de tarefas, prazos e suporte interno`
- Cor: `#22C55E`

**Agente**
- Nome: `Secretaria`
- Slug: `secretaria`
- Descrição: `Agente de organização e produtividade`
- Capacidades: `web`, `rag`
- System Prompt (copiar e colar): **use o prompt do item 17.6**

**Modo Agentic**
- `webEnabled: true`

**Treinamento (exemplo de descrição)**
```
Treino Secretaria: checklist de tarefas, prazos e confirmações simples.
```

---

### 18.7 Backoffice
**Alice Core (trecho recomendado)**
```
Backoffice padroniza processos e exige confirmação antes de alterações no ERP.
```

**Namespace**
- Nome: `Backoffice`
- Slug: `backoffice`
- Descrição: `Operações internas, padronizações e revisão de cadastros`
- Cor: `#8B5CF6`

**Agente**
- Nome: `Backoffice`
- Slug: `backoffice`
- Descrição: `Agente operacional para processos internos`
- Capacidades: `erp`, `web`, `rag`
- System Prompt (copiar e colar): **use o prompt do item 17.7**

**Modo Agentic**
- `erpReadEnabled: true`
- `erpWriteEnabled: true`
- `webEnabled: true`
- `financialApprovalRequired: true`

**Treinamento (exemplo de descrição)**
```
Treino Backoffice: padronização de processos e confirmações antes de alterar dados.
```

---

## 19) Checklist de secrets por ambiente (resumo)

> **SSOT obrigatório:** a lista exata e atual está em `docs/SECRETS.md`.  
> Este checklist é um **resumo didático** para onboarding rápido.

### 19.1 Desenvolvimento (local)
Obrigatórios para rodar o core:
- `ADMIN_USER`, `ADMIN_PWD`
- `SESSION_SECRET`, `INTERNAL_API_SECRET`
- `POSTGRES_*` (ou `DATABASE_URL` conforme setup local)
- `REDIS_*`

Se usar recursos avançados:
- **RAG/GPU**: `QDRANT_API_KEY`, variáveis do GPU Manager
- **Vision/ASR**: `OPENAI_API_KEY`
- **Email**: `GMAIL_USER`, `GMAIL_APP_PASSWORD`

### 19.2 Produção (Hetzner)
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

## 20) Apêndice — Payloads API detalhados (exemplos)

### 20.1 Namespaces
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

### 20.2 Agentes
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

### 20.3 Core Settings
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

### 20.4 Coleta de dados de treinamento
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

### 20.5 Aprovação em lote
```http
POST /api/training/data/approve-batch
Content-Type: application/json

{
  "ids": ["uuid1", "uuid2", "uuid3"],
  "action": "approve"
}
```

### 20.6 Treinamento on‑demand
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

### 20.7 Treinamento Trading
```http
POST /api/training/jobs/trading
Content-Type: application/json

{
  "namespaceId": "uuid",
  "name": "Trading Fine-Tuning"
}
```

### 20.8 RAG Search (texto)
```http
POST /api/rag/search
Content-Type: application/json

{
  "query": "Qual o limite de alavancagem por política interna?",
  "limit": 10,
  "threshold": 0.7
}
```

### 20.9 Configuração Agentic
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

### 20.10 Trading — Criar ordem (KuCoin)
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

### 20.11 Trading — Criar stop order (TP/SL)
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

### 20.12 Trading — Sincronizar ordens (KuCoin)
```http
POST /api/integrations/trading/orders/sync
Content-Type: application/json
```

### 20.13 Trading — Cancelar stop order
```http
DELETE /api/integrations/trading/stop-orders/ORDER_ID
Content-Type: application/json
```

### 20.14 Trading — Risk Config (GET/PUT)
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

### 20.15 ERPNext — Criar cliente
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

### 20.16 ERPNext — Criar invoice
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

### 20.17 ERPNext — Nota sobre Sales Order e Payment Entry
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
