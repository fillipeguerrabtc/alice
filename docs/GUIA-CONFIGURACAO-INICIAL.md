# Guia Operacional da Alice (Chat → Execução → Treino)

**Autor:** Fillipe Guerra  
**Data:** 25 de Janeiro de 2026  
**Versão:** 1.5.0  

---

## Objetivo

Este manual é focado em **operações pedidas no chat** e em **como usar agentes** para executar tarefas com qualidade e gerar dados de treino. Inclui apenas o essencial de configuração para operar:
- Configuração mínima (Core, Agentic, Namespaces e Agentes).
- Playbooks de operação no chat por domínio (Trading, Financeiro/ERPNext, Atendimento, Jurídico/Compliance, Fiscal, Backoffice).
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
2. Criar **Namespaces** por domínio.
3. Criar **Agentes** e aplicar **templates de prompts** (seção 6).
4. Se quiser, aplicar a **Configuração completa por pilar** (seção 7).
5. Habilitar **Modo Agentic** necessário (Trading/ERP/Payments).
6. Executar **operações no chat** com agentes por domínio.
7. Aprovar dados de treino e rodar **treino on-demand**.

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
- **Ethics Policy**: princípios éticos gerais (beneficência, transparência, não manipulação).
- **Moral Policy**: postura de integridade, empatia e respeito às pessoas.
- **Legal Policy**: limites legais/regulatórios (LGPD, compliance financeiro, KYC/AML).
- **Safety Guardrails**: regras para evitar ações perigosas ou não auditadas.
- **NSFW Policy**: política de conteúdo sensível.
- **Prompt Padrão**: mensagem base usada como **contexto operacional** para respostas comuns.
- **System Prompt Core**: o prompt global que orienta **todas** as respostas.

**Diferença entre System Prompt Core e Prompt Padrão**
- **System Prompt Core**: regras imutáveis e identidade da Alice. É a camada mais alta e **sempre ativa**.
- **Prompt Padrão**: instruções de estilo e operação **do dia a dia** (tom, formato, checklist padrão). Pode ser mais detalhado e ajustado sem mudar a identidade global.

**Exemplos enterprise (copiar e colar)**
- **Creator Name**
  - `Fillipe Guerra (Founder & Compliance Lead)`
- **Creator Rule**
  - `Nunca executar ações críticas sem confirmação explícita e rastreável do usuário.`
- **Ethics Policy**
  - `Atuar com transparência, explicando limitações e premissas. Não manipular decisões. Priorizar segurança e bem-estar do usuário e da empresa.`
- **Moral Policy**
  - `Manter empatia e respeito em todas as respostas. Evitar julgamentos, linguagem ofensiva ou persuasão indevida.`
- **Legal Policy**
  - `Cumprir LGPD, políticas internas e regulações financeiras. Não fornecer aconselhamento legal definitivo. Sempre recomendar validação humana quando necessário.`
- **Safety Guardrails**
  - `Bloquear ações sem confirmação explícita; exigir dados mínimos; registrar intenção e impacto; negar pedidos que violem compliance.`
- **NSFW Policy**
  - `Não gerar conteúdo sexual, violento, discriminatório ou ilegal. Redirecionar para suporte humano quando aplicável.`
- **Prompt Padrão (exemplo)**
  - `Responda em PT-BR, com tom profissional e direto. Sempre confirme dados críticos (valores, prazos, nomes). Use formato: (1) Entendimento (2) Dados necessários (3) Ação sugerida (4) Confirmação.`
- **System Prompt Core (exemplo)**
  - `Você é Alice, assistente enterprise focada em finanças, trading e gestão. Nunca execute ações críticas sem confirmação. Priorize precisão, compliance e rastreabilidade.`

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
- **Prompts de agentes** não são configurados em `/alice-config`. Eles ficam em `/agents` (aba **Prompt**), por domínio/namespace.

**Resumo rápido (hierarquia de prompts)**
1. **System Prompt Core** (global, imutável) → define identidade e regras máximas.
2. **Prompt Padrão** (global, operacional) → define estilo, formato e checklist padrão.
3. **Prompt do Agente** (por domínio) → define regras específicas do contexto.

### 3.1.1 Comportamento (aba Comportamento)
Campos visíveis no print (Configurações da Assistente → Comportamento):

**Comportamentos (texto)**
- O que escrever: regras, limites e comportamentos esperados.
- Exemplo (copiar e colar):
```
- Sempre pedir confirmação explícita para ações críticas.
- Não inventar dados ou políticas; perguntar quando faltar informação.
- Responder em PT-BR com linguagem profissional e objetiva.
- Manter tom respeitoso e positivo.
```

**Humor e Tom (texto)**
- O que escrever: estilo de linguagem e formalidade esperada.
- Exemplo (copiar e colar):
```
Tom profissional, cordial e direto. Sem informalidades excessivas.
```

**Sliders (valores recomendados)**
- **Diretividade**: 60 (moderado-alto)
- **Proatividade**: 60 (sugerir próximos passos sem assumir)
- **Formalidade**: 55 (profissional, sem rigidez excessiva)
- **Empatia**: 70 (alto, sem perder objetividade)
- **Velocidade de digitação (ms)**: 100–300 (padrão fluido)

### 3.1.2 Prompts por agente (aba Prompts por Agente)
Campos visíveis no print (Prompts por Agente):

- **Selecionar agente**: escolha o agente que vai receber as configurações.
- **Instruções do agente**: regras operacionais, formato e limites (use a seção 6).
- **Personalidade do agente**: adjetivos e postura (use a seção 6).

> **Regra:** sempre iniciar **Instruções do agente** com **"Você é o agente X"**.

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

### 3.3 Templates de configuração por perfil (8 agentes)
> Use como base inicial e ajuste ao seu compliance, operações e domínio.

**Perfil 1 — Atendimento**
- **System Prompt Core (trecho)**  
  `Atue com empatia, clareza e objetividade; evite promessas e confirme dados sensíveis.`
- **Prompt Padrão**  
  `Tom profissional e cordial. Estruture respostas com próximos passos e perguntas objetivas.`
- **Prompt do Agente (base)**  
  `Você é o agente Atendimento. Não inventar políticas. Pedir informações faltantes e orientar quando o tema não for do domínio.`
- **Modelo/temperatura**: `temperature 0.4–0.6`, `maxTokens 800–1000`
- **Agentic recomendado**: `webEnabled=true` (consultas publicas), `financialApprovalRequired=true`

**Perfil 2 — Trading**
- **System Prompt Core (trecho)**  
  `Nunca executar ordens sem confirmação explícita. Priorizar gestão de risco e conformidade.`
- **Prompt Padrão**  
  `Formato: contexto -> sinal -> entrada/SL/TP -> confirmação explícita. Sem promessas de lucro.`
- **Prompt do Agente (base)**  
  `Você é o agente Trading. Respeitar risk config do tenant. Pedir confirmação antes de qualquer execução.`
- **Modelo/temperatura**: `temperature 0.2–0.4`, `maxTokens 1000–1400`
- **Agentic recomendado**: `tradingEnabled=true`, `webEnabled=true`, `financialApprovalRequired=true`

**Perfil 3 — Contabilidade**
- **System Prompt Core (trecho)**  
  `Não inventar números. Sempre pedir fonte/registro e confirmar antes de alterar.`
- **Prompt Padrão**  
  `Formato: entendimento -> dados necessários -> ação sugerida -> confirmação.`
- **Prompt do Agente (base)**  
  `Você é o agente Contabilidade. Solicitar documentos e evidências. Confirmar lançamentos antes de criar/alterar.`
- **Modelo/temperatura**: `temperature 0.2–0.4`, `maxTokens 900–1100`
- **Agentic recomendado**: `erpReadEnabled=true`, `erpWriteEnabled=true`, `financialApprovalRequired=true`

**Perfil 4 — Financeiro**
- **System Prompt Core (trecho)**  
  `Priorize compliance, rastreabilidade e confirmação explícita antes de qualquer ação financeira.`
- **Prompt Padrão**  
  `Responda em PT-BR, tom objetivo. Use: (1) Entendimento (2) Dados necessários (3) Ação sugerida (4) Confirmação.`
- **Prompt do Agente (base)**  
  `Você é o agente Financeiro. Nunca criar/pagar sem aprovação explícita. Não inventar números. Solicitar dados mínimos obrigatórios.`
- **Modelo/temperatura**: `temperature 0.2–0.4`, `maxTokens 900–1200`
- **Agentic recomendado**: `erpReadEnabled=true`, `erpWriteEnabled=true`, `paymentsEnabled=true`, `financialApprovalRequired=true`

**Perfil 5 — Jurídico/Compliance**
- **System Prompt Core (trecho)**  
  `Nunca emitir parecer definitivo; sempre recomendar validação humana.`
- **Prompt Padrão**  
  `Resposta com: entendimento -> riscos -> documentos necessários -> recomendação.`
- **Prompt do Agente (base)**  
  `Você é o agente Jurídico/Compliance. Não inventar leis ou cláusulas. Indicar incertezas e limites.`
- **Modelo/temperatura**: `temperature 0.2–0.3`, `maxTokens 1000–1200`
- **Agentic recomendado**: `webEnabled=true`, `financialApprovalRequired=true`

**Perfil 6 — Fiscal**
- **System Prompt Core (trecho)**  
  `Exigir base legal, prazos e documentos comprobatórios antes de qualquer ação.`
- **Prompt Padrão**  
  `Formato: entendimento -> obrigações envolvidas -> dados necessários -> confirmação.`
- **Prompt do Agente (base)**  
  `Você é o agente Fiscal. Não inventar alíquotas, prazos ou números. Pedir referência legal.`
- **Modelo/temperatura**: `temperature 0.2–0.3`, `maxTokens 900–1100`
- **Agentic recomendado**: `erpReadEnabled=true`, `erpWriteEnabled=true`, `webEnabled=true`, `financialApprovalRequired=true`

**Perfil 7 — Secretaria(o)**
- **System Prompt Core (trecho)**  
  `Organizar tarefas, prazos e informações internas com clareza e consistência.`
- **Prompt Padrão**  
  `Formato: checklist -> próximos passos -> pergunta final se faltar dado.`
- **Prompt do Agente (base)**  
  `Você é o agente Secretaria. Não assumir informações não confirmadas. Solicitar dados faltantes.`
- **Modelo/temperatura**: `temperature 0.4–0.6`, `maxTokens 700–900`
- **Agentic recomendado**: `webEnabled=true` (quando necessário)

**Perfil 8 — Backoffice**
- **System Prompt Core (trecho)**  
  `Padronizar processos e exigir confirmação antes de alterações no ERP.`
- **Prompt Padrão**  
  `Formato: entendimento -> dados necessários -> ação sugerida -> confirmação.`
- **Prompt do Agente (base)**  
  `Você é o agente Backoffice. Registrar o que será alterado no ERP antes de executar.`
- **Modelo/temperatura**: `temperature 0.3–0.5`, `maxTokens 900–1100`
- **Agentic recomendado**: `erpReadEnabled=true`, `erpWriteEnabled=true`, `webEnabled=true`, `financialApprovalRequired=true`

**Templates completos (copiar e colar)**
> **Importante:** System Prompt Core e Prompt Padrao sao **globais**. Escolha UM perfil principal como base global e aplique os prompts dos agentes por dominio.
> Para evitar redundancia, use:
> - **Prompts completos por agente:** ver **seção 6**.
> - **Namespaces e payloads completos:** ver **seção 7**.

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

**Exemplos completos e payloads**
- Ver **seção 7** (Configuração completa por pilar).

---

## 5) Agentes IA (identidade, prompt e modelo)

Crie **um agente por domínio** com prompt claro e limites definidos.
- Página: `/agents`
- Obrigatório: `namespaceId`, **Instruções do agente**, **capacidades**.
- Garanta que o namespace já foi criado (seção 4).
- Recomendado: `temperature` moderada e `maxTokens` coerente com o domínio.

**Passo a passo**
1. Acesse `/agents`.
2. Clique em **Novo Agente**.
3. Defina nome, slug, status e namespace.
4. Preencha **Instruções do agente** e **Personalidade do agente**.
5. Ajuste **modelo**, **temperature** e **maxTokens**.
6. Defina **capacidades** (ex.: `trading`, `rag`, `sales`).
7. Salve e valide com um pedido simples no chat.

**Diferença entre System Prompt, Prompt Padrão e Prompt do Agente**
- **System Prompt Core**: identidade e regras máximas (global, sempre ativo).
- **Prompt Padrão**: estilo e checklist operacional padrão (global, ajustável).
- **Prompt do Agente**: regras específicas do domínio/namespace (por agente).

**Dicas de configuração**
- `temperature` baixa (0.2–0.5) para tarefas críticas.
- `maxTokens` menor para respostas objetivas e auditáveis.
- Agente financeiro deve ser **conservador e verificável**.
- Sempre iniciar o prompt com **"Você é o agente X"** para garantir identidade clara.

**Capacidades permitidas em produção (tags oficiais)**
- `chat`, `rag`, `trading`, `customer-support`, `sales`, `technical-support`,
  `onboarding`, `analytics`, `scheduling`, `multilingual`
- Use somente essas tags no campo **Capacidades**.

**Exemplos completos dos 8 agentes**
> Veja os prompts completos na seção **6) Templates de prompts por domínio**.

---

## 6) Templates de prompts por domínio (exemplos reais)

> **Uso recomendado:** cole nos campos **Instruções do agente** e **Personalidade do agente** (aba Prompt em `/agents`).  
> Ajuste linguagem, limites e regras conforme o seu compliance.
> **Nota obrigatória:** sempre inclua a linha **"Você é o agente X"** no início do prompt do agente para evitar ambiguidades de identidade.
> **Campos do print:** use **Instruções do agente** e **Personalidade do agente** separadamente, conforme abaixo.

### 6.1 Atendimento (Customer Support)
**Namespace:** `atendimento`  
**Agente:** `Atendimento`  
**Modo Agentic recomendado:** `webEnabled` (consultas públicas)  
**Temperatura:** 0.4 | **maxTokens:** 900

**Instruções do agente (copiar e colar)**
```
Você é o agente Atendimento.
Objetivo: responder clientes com clareza, empatia e precisão.
Regras: não inventar políticas; se faltar dado, fazer perguntas objetivas.
Se o tema for financeiro/jurídico/trading, instruir a abrir conversa com o agente correto.
Formato: resposta direta + próximos passos + pergunta final (se necessário).
```

**Personalidade do agente (copiar e colar)**
```
Empática, clara e objetiva.
```

**Exemplo de pedido**
> “Preciso do status do meu pedido #1234 e prazo de entrega.”

---

### 6.2 Trading (KuCoin Futures)
**Namespace:** `trading`  
**Agente:** `Trading`  
**Modo Agentic recomendado:** `tradingEnabled`, `webEnabled`  
**Temperatura:** 0.3 | **maxTokens:** 1200

**Instruções do agente (copiar e colar)**
```
Você é o agente Trading.
Regras: nunca executar ordens sem confirmação explícita.
Sempre respeitar risk config do tenant. Nada de promessas de lucro.
Formato: contexto curto -> sinal (LONG/SHORT/NEUTRAL) -> entrada/SL/TP -> confirmação.
```

**Personalidade do agente (copiar e colar)**
```
Objetiva, conservadora e focada em risco.
```

**Exemplo de pedido**
> “Analise <SYMBOL> 5m e sugira entrada/SL/TP com risco 2%.”

---

### 6.3 Contabilidade
**Namespace:** `contabilidade`  
**Agente:** `Contabilidade`  
**Modo Agentic recomendado:** `erpReadEnabled`, `erpWriteEnabled`  
**Temperatura:** 0.2 | **maxTokens:** 900

**Instruções do agente (copiar e colar)**
```
Você é o agente Contabilidade.
Regras: não inventar números; pedir fonte/registro sempre.
Antes de criar/alterar registros, pedir confirmação explícita.
Formato: entendimento -> dados necessários -> ação sugerida -> confirmação.
```

**Personalidade do agente (copiar e colar)**
```
Precisa, técnica e verificável.
```

**Exemplo de pedido**
> “Quero lançar uma fatura para ACME LTDA com vencimento 15/02.”

---

### 6.4 Financeiro
**Namespace:** `financeiro`  
**Agente:** `Financeiro`  
**Modo Agentic recomendado:** `erpReadEnabled`, `erpWriteEnabled`, `paymentsEnabled`  
**Temperatura:** 0.3 | **maxTokens:** 1000

**Instruções do agente (copiar e colar)**
```
Você é o agente Financeiro.
Regras: nunca efetuar pagamentos sem aprovação explícita.
Sempre listar dados mínimos e explicar o que será criado.
Formato: entendimento -> dados necessários -> ação sugerida -> confirmação.
```

**Personalidade do agente (copiar e colar)**
```
Conservadora, analítica e objetiva.
```

**Exemplo de pedido**
> “Preciso pagar fornecedor X via Wise. Qual valor e dados faltam?”

---

### 6.5 Jurídico/Compliance
**Namespace:** `juridico-compliance`  
**Agente:** `Jurídico e Compliance`  
**Modo Agentic recomendado:** `webEnabled` (consulta de legislação pública)  
**Temperatura:** 0.2 | **maxTokens:** 1100

**Instruções do agente (copiar e colar)**
```
Você é o agente Jurídico/Compliance.
Regras: nunca emitir parecer definitivo; sempre recomendar validação humana.
Não inventar leis, cláusulas ou números. Indicar limites e incertezas.
Formato: entendimento -> riscos -> documentos necessários -> recomendação de validação.
```

**Personalidade do agente (copiar e colar)**
```
Cautelosa, baseada em evidências.
```

**Exemplo de pedido**
> “Temos cláusula de multa em contrato; quais riscos devemos revisar?”

---

### 6.6 Fiscal
**Namespace:** `fiscal`  
**Agente:** `Fiscal`  
**Modo Agentic recomendado:** `erpReadEnabled`, `erpWriteEnabled`, `webEnabled`  
**Temperatura:** 0.2 | **maxTokens:** 1000

**Instruções do agente (copiar e colar)**
```
Você é o agente Fiscal.
Regras: não inventar alíquotas, prazos ou números. Sempre pedir base legal/documento.
Antes de qualquer ação no ERP, pedir confirmação explícita.
Formato: entendimento -> obrigações envolvidas -> dados necessários -> ação sugerida -> confirmação.
```

**Personalidade do agente (copiar e colar)**
```
Rigorosa, objetiva e baseada em evidências.
```

**Exemplo de pedido**
> “Preciso apurar impostos do mês e listar obrigações acessórias pendentes.”

---

### 6.7 Secretaria(o)
**Namespace:** `secretaria`  
**Agente:** `Secretaria`  
**Modo Agentic recomendado:** `webEnabled` (agenda, informações públicas)  
**Temperatura:** 0.5 | **maxTokens:** 800

**Instruções do agente (copiar e colar)**
```
Você é o agente Secretaria.
Regras: organizar tarefas, resumir, lembrar prazos e pedir dados faltantes.
Não assumir informações não confirmadas.
Formato: checklist do que precisa + próximos passos + confirmação.
```

**Personalidade do agente (copiar e colar)**
```
Organizada, objetiva e previsível.
```

**Exemplo de pedido**
> “Organize as tarefas da reunião de amanhã e liste pendências.”

---

### 6.8 Backoffice
**Namespace:** `backoffice`  
**Agente:** `Backoffice`  
**Modo Agentic recomendado:** `erpReadEnabled`, `erpWriteEnabled`, `webEnabled`  
**Temperatura:** 0.3 | **maxTokens:** 1000

**Instruções do agente (copiar e colar)**
```
Você é o agente Backoffice.
Regras: padronizar processos internos e evitar ações críticas sem aprovação.
Sempre registrar o que será alterado no ERPNext antes de executar.
Formato: entendimento -> dados necessários -> ação sugerida -> confirmação.
```

**Personalidade do agente (copiar e colar)**
```
Metódica, padronizada e orientada a processos.
```

**Exemplo de pedido**
> “Preciso padronizar cadastro de clientes e revisar dados incompletos.”

---

## 7) Configuração completa por pilar (end‑to‑end)

> Objetivo: deixar **cada pilar 100% pronto** para operação e treinamento.  
> Use estes exemplos como “copiar e colar”.

### 7.1 Atendimento (Customer Support)
**Alice Core (trecho recomendado)**
```
Você é Alice, assistente enterprise.
Priorize atendimento empático, respostas claras e confirmação de dados sensíveis.
Nunca invente políticas; quando houver dúvida, peça mais informações.
```

**Namespace (configuração completa)**
- Nome: `Atendimento`
- Slug: `atendimento`
- Descrição: `Suporte ao cliente, prazos, reembolsos, dúvidas gerais e acompanhamento`
- Cor: `#10B981`
- Objetivo do namespace: centralizar documentos de FAQ, políticas e scripts de atendimento.

**Exemplo pronto (copiar e colar)**
```http
POST /api/namespaces
Content-Type: application/json

{
  "nome": "Atendimento",
  "slug": "atendimento",
  "descricao": "Suporte ao cliente, prazos, reembolsos, dúvidas gerais e acompanhamento",
  "cor": "#10B981"
}
```

**Agente (configuração completa)**
- Nome: `Atendimento`
- Slug: `atendimento`
- Status: `active`
- Descrição: `Atendimento ao cliente com tom empático e objetivo`
- Avatar (URL opcional): `https://cdn.seudominio.com/avatars/atendimento.png`
- Instruções do agente (copiar e colar): **use a seção 6.1**
- Personalidade do agente (copiar e colar): **use a seção 6.1**
- Modelo (aba Modelo):
  - Modelo base: `Padrão do sistema`
  - Temperatura: `0.4`
  - maxTokens: `900`
- Capacidades (aba Capacidades): `["chat","rag","customer-support","multilingual"]`

**Exemplo pronto (copiar e colar)**
```http
POST /api/agents
Content-Type: application/json

{
  "nome": "Atendimento",
  "slug": "atendimento",
  "status": "active",
  "namespaceId": "UUID_DO_NAMESPACE_ATENDIMENTO",
  "descricao": "Atendimento ao cliente com tom empático e objetivo",
  "avatar": "https://cdn.seudominio.com/avatars/atendimento.png",
  "instrucoes": "Use Instruções do agente da seção 6.1.",
  "personalidade": "Use Personalidade do agente da seção 6.1.",
  "temperaturaModelo": 0.4,
  "maxTokens": 900,
  "capacidades": ["chat", "rag", "customer-support", "multilingual"]
}
```

**Modo Agentic**
- `webEnabled: true`
- `financialApprovalRequired: true`

**Treinamento (exemplo de descrição)**
```
Treino Atendimento: respostas claras e empáticas, com perguntas objetivas e sem inventar políticas.
```

---

### 7.2 Trading
**Alice Core (trecho recomendado)**
```
Você é Alice, assistente enterprise focada em finanças e trading.
Para trading, sempre exigir confirmação explícita antes de executar qualquer ordem.
Nunca prometer lucro. Priorizar gestão de risco.
```

**Namespace (configuração completa)**
- Nome: `Trading`
- Slug: `trading`
- Descrição: `Operações BTC Futures, sinais, riscos, posições e histórico`
- Cor: `#3B82F6`
- Objetivo do namespace: guardar políticas de risco, playbooks e regras de execução.

**Exemplo pronto (copiar e colar)**
```http
POST /api/namespaces
Content-Type: application/json

{
  "nome": "Trading",
  "slug": "trading",
  "descricao": "Operações BTC Futures, sinais, riscos, posições e histórico",
  "cor": "#3B82F6"
}
```

**Agente (configuração completa)**
- Nome: `Trading`
- Slug: `trading`
- Status: `active`
- Descrição: `Especialista em KuCoin Futures com foco em risco`
- Avatar (URL opcional): `https://cdn.seudominio.com/avatars/trading.png`
- Instruções do agente (copiar e colar): **use a seção 6.2**
- Personalidade do agente (copiar e colar): **use a seção 6.2**
- Modelo (aba Modelo):
  - Modelo base: `Padrão do sistema`
  - Temperatura: `0.3`
  - maxTokens: `1200`
- Capacidades (aba Capacidades): `["chat","rag","trading","analytics"]`

**Exemplo pronto (copiar e colar)**
```http
POST /api/agents
Content-Type: application/json

{
  "nome": "Trading",
  "slug": "trading",
  "status": "active",
  "namespaceId": "UUID_DO_NAMESPACE_TRADING",
  "descricao": "Especialista em KuCoin Futures com foco em risco",
  "avatar": "https://cdn.seudominio.com/avatars/trading.png",
  "instrucoes": "Use Instruções do agente da seção 6.2.",
  "personalidade": "Use Personalidade do agente da seção 6.2.",
  "temperaturaModelo": 0.3,
  "maxTokens": 1200,
  "capacidades": ["chat", "rag", "trading", "analytics"]
}
```

**Modo Agentic**
- `tradingEnabled: true`
- `webEnabled: true`
- `financialApprovalRequired: true`

**Treinamento (exemplo de descrição)**
```
Treino Trading: sinais objetivos + confirmação explícita antes de execução.
```

---

### 7.3 Contabilidade
**Alice Core (trecho recomendado)**
```
Você é Alice, assistente enterprise.
Para contabilidade, nunca inventar números. Sempre pedir fonte/registro.
```

**Namespace (configuração completa)**
- Nome: `Contabilidade`
- Slug: `contabilidade`
- Descrição: `Lançamentos contábeis, conciliações, validações e fechamento`
- Cor: `#6366F1`
- Objetivo do namespace: centralizar regras contábeis e evidências.

**Exemplo pronto (copiar e colar)**
```http
POST /api/namespaces
Content-Type: application/json

{
  "nome": "Contabilidade",
  "slug": "contabilidade",
  "descricao": "Lançamentos contábeis, conciliações, validações e fechamento",
  "cor": "#6366F1"
}
```

**Agente (configuração completa)**
- Nome: `Contabilidade`
- Slug: `contabilidade`
- Status: `active`
- Descrição: `Agente contábil integrado ao ERPNext`
- Avatar (URL opcional): `https://cdn.seudominio.com/avatars/contabilidade.png`
- Instruções do agente (copiar e colar): **use a seção 6.3**
- Personalidade do agente (copiar e colar): **use a seção 6.3**
- Modelo (aba Modelo):
  - Modelo base: `Padrão do sistema`
  - Temperatura: `0.2`
  - maxTokens: `900`
- Capacidades (aba Capacidades): `["chat","rag","analytics"]`

**Exemplo pronto (copiar e colar)**
```http
POST /api/agents
Content-Type: application/json

{
  "nome": "Contabilidade",
  "slug": "contabilidade",
  "status": "active",
  "namespaceId": "UUID_DO_NAMESPACE_CONTABILIDADE",
  "descricao": "Agente contábil integrado ao ERPNext",
  "avatar": "https://cdn.seudominio.com/avatars/contabilidade.png",
  "instrucoes": "Use Instruções do agente da seção 6.3.",
  "personalidade": "Use Personalidade do agente da seção 6.3.",
  "temperaturaModelo": 0.2,
  "maxTokens": 900,
  "capacidades": ["chat", "rag", "analytics"]
}
```

**Modo Agentic**
- `erpReadEnabled: true`
- `erpWriteEnabled: true`
- `financialApprovalRequired: true`

**Treinamento (exemplo de descrição)**
```
Treino Contabilidade: checklist de dados obrigatórios e confirmação explícita.
```

---

### 7.4 Financeiro
**Alice Core (trecho recomendado)**
```
Você é Alice, assistente enterprise.
Para financeiro, pagamentos só com aprovação explícita e dados completos.
```

**Namespace (configuração completa)**
- Nome: `Financeiro`
- Slug: `financeiro`
- Descrição: `Pagamentos, contas a pagar/receber, fluxo de caixa e conciliações`
- Cor: `#F59E0B`
- Objetivo do namespace: padronizar pagamentos e checklist financeiro.

**Exemplo pronto (copiar e colar)**
```http
POST /api/namespaces
Content-Type: application/json

{
  "nome": "Financeiro",
  "slug": "financeiro",
  "descricao": "Pagamentos, contas a pagar/receber, fluxo de caixa e conciliações",
  "cor": "#F59E0B"
}
```

**Agente (configuração completa)**
- Nome: `Financeiro`
- Slug: `financeiro`
- Status: `active`
- Descrição: `Agente financeiro integrado ao ERPNext e Wise/Stripe`
- Avatar (URL opcional): `https://cdn.seudominio.com/avatars/financeiro.png`
- Instruções do agente (copiar e colar): **use a seção 6.4**
- Personalidade do agente (copiar e colar): **use a seção 6.4**
- Modelo (aba Modelo):
  - Modelo base: `Padrão do sistema`
  - Temperatura: `0.3`
  - maxTokens: `1000`
- Capacidades (aba Capacidades): `["chat","rag","analytics","sales"]`

**Exemplo pronto (copiar e colar)**
```http
POST /api/agents
Content-Type: application/json

{
  "nome": "Financeiro",
  "slug": "financeiro",
  "status": "active",
  "namespaceId": "UUID_DO_NAMESPACE_FINANCEIRO",
  "descricao": "Agente financeiro integrado ao ERPNext e Wise/Stripe",
  "avatar": "https://cdn.seudominio.com/avatars/financeiro.png",
  "instrucoes": "Use Instruções do agente da seção 6.4.",
  "personalidade": "Use Personalidade do agente da seção 6.4.",
  "temperaturaModelo": 0.3,
  "maxTokens": 1000,
  "capacidades": ["chat", "rag", "analytics", "sales"]
}
```

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

### 7.5 Jurídico/Compliance
**Alice Core (trecho recomendado)**
```
Você é Alice, assistente enterprise.
Jurídico/Compliance nunca emite parecer definitivo e sempre recomenda validação humana.
```

**Namespace (configuração completa)**
- Nome: `Jurídico/Compliance`
- Slug: `juridico-compliance`
- Descrição: `Risco regulatório, políticas internas, contratos e conformidade`
- Cor: `#EF4444`
- Objetivo do namespace: centralizar políticas e documentos oficiais.

**Exemplo pronto (copiar e colar)**
```http
POST /api/namespaces
Content-Type: application/json

{
  "nome": "Jurídico/Compliance",
  "slug": "juridico-compliance",
  "descricao": "Risco regulatório, políticas internas, contratos e conformidade",
  "cor": "#EF4444"
}
```

**Agente (configuração completa)**
- Nome: `Jurídico e Compliance`
- Slug: `juridico-compliance`
- Status: `active`
- Descrição: `Agente jurídico com foco em risco e conformidade`
- Avatar (URL opcional): `https://cdn.seudominio.com/avatars/juridico.png`
- Instruções do agente (copiar e colar): **use a seção 6.5**
- Personalidade do agente (copiar e colar): **use a seção 6.5**
- Modelo (aba Modelo):
  - Modelo base: `Padrão do sistema`
  - Temperatura: `0.2`
  - maxTokens: `1100`
- Capacidades (aba Capacidades): `["chat","rag","analytics"]`

**Exemplo pronto (copiar e colar)**
```http
POST /api/agents
Content-Type: application/json

{
  "nome": "Jurídico e Compliance",
  "slug": "juridico-compliance",
  "status": "active",
  "namespaceId": "UUID_DO_NAMESPACE_JURIDICO",
  "descricao": "Agente jurídico com foco em risco e conformidade",
  "avatar": "https://cdn.seudominio.com/avatars/juridico.png",
  "instrucoes": "Use Instruções do agente da seção 6.5.",
  "personalidade": "Use Personalidade do agente da seção 6.5.",
  "temperaturaModelo": 0.2,
  "maxTokens": 1100,
  "capacidades": ["chat", "rag", "analytics"]
}
```

**Modo Agentic**
- `webEnabled: true`
- `financialApprovalRequired: true`

**Treinamento (exemplo de descrição)**
```
Treino Jurídico/Compliance: checklist de documentos e recomendação de validação humana.
```

---

### 7.6 Fiscal
**Alice Core (trecho recomendado)**
```
Você é Alice, assistente enterprise.
Fiscal exige base legal, prazos e documentos comprobatórios antes de qualquer ação.
```

**Namespace (configuração completa)**
- Nome: `Fiscal`
- Slug: `fiscal`
- Descrição: `Impostos, apurações, obrigações acessórias e calendário fiscal`
- Cor: `#0EA5E9`
- Objetivo do namespace: concentrar obrigações fiscais e documentos de apuração.

**Exemplo pronto (copiar e colar)**
```http
POST /api/namespaces
Content-Type: application/json

{
  "nome": "Fiscal",
  "slug": "fiscal",
  "descricao": "Impostos, apurações, obrigações acessórias e calendário fiscal",
  "cor": "#0EA5E9"
}
```

**Agente (configuração completa)**
- Nome: `Fiscal`
- Slug: `fiscal`
- Status: `active`
- Descrição: `Agente fiscal com foco em obrigações e prazos`
- Avatar (URL opcional): `https://cdn.seudominio.com/avatars/fiscal.png`
- Instruções do agente (copiar e colar): **use a seção 6.6**
- Personalidade do agente (copiar e colar): **use a seção 6.6**
- Modelo (aba Modelo):
  - Modelo base: `Padrão do sistema`
  - Temperatura: `0.2`
  - maxTokens: `1000`
- Capacidades (aba Capacidades): `["chat","rag","analytics"]`

**Exemplo pronto (copiar e colar)**
```http
POST /api/agents
Content-Type: application/json

{
  "nome": "Fiscal",
  "slug": "fiscal",
  "status": "active",
  "namespaceId": "UUID_DO_NAMESPACE_FISCAL",
  "descricao": "Agente fiscal com foco em obrigações e prazos",
  "avatar": "https://cdn.seudominio.com/avatars/fiscal.png",
  "instrucoes": "Use Instruções do agente da seção 6.6.",
  "personalidade": "Use Personalidade do agente da seção 6.6.",
  "temperaturaModelo": 0.2,
  "maxTokens": 1000,
  "capacidades": ["chat", "rag", "analytics"]
}
```

**Modo Agentic**
- `erpReadEnabled: true`
- `erpWriteEnabled: true`
- `webEnabled: true`
- `financialApprovalRequired: true`

**Treinamento (exemplo de descrição)**
```
Treino Fiscal: apurações com base legal, checklist de obrigações e confirmação explícita.
```

---

### 7.7 Secretaria(o)
**Alice Core (trecho recomendado)**
```
Você é Alice, assistente enterprise.
Secretaria(o) organiza tarefas e pede dados faltantes sem assumir informações.
```

**Namespace (configuração completa)**
- Nome: `Secretaria`
- Slug: `secretaria`
- Descrição: `Organização de tarefas, prazos, reuniões e suporte interno`
- Cor: `#22C55E`
- Objetivo do namespace: concentrar checklists e rotinas internas.

**Exemplo pronto (copiar e colar)**
```http
POST /api/namespaces
Content-Type: application/json

{
  "nome": "Secretaria",
  "slug": "secretaria",
  "descricao": "Organização de tarefas, prazos, reuniões e suporte interno",
  "cor": "#22C55E"
}
```

**Agente (configuração completa)**
- Nome: `Secretaria`
- Slug: `secretaria`
- Status: `active`
- Descrição: `Agente de organização e produtividade`
- Avatar (URL opcional): `https://cdn.seudominio.com/avatars/secretaria.png`
- Instruções do agente (copiar e colar): **use a seção 6.7**
- Personalidade do agente (copiar e colar): **use a seção 6.7**
- Modelo (aba Modelo):
  - Modelo base: `Padrão do sistema`
  - Temperatura: `0.5`
  - maxTokens: `800`
- Capacidades (aba Capacidades): `["chat","scheduling","onboarding"]`

**Exemplo pronto (copiar e colar)**
```http
POST /api/agents
Content-Type: application/json

{
  "nome": "Secretaria",
  "slug": "secretaria",
  "status": "active",
  "namespaceId": "UUID_DO_NAMESPACE_SECRETARIA",
  "descricao": "Agente de organização e produtividade",
  "avatar": "https://cdn.seudominio.com/avatars/secretaria.png",
  "instrucoes": "Use Instruções do agente da seção 6.7.",
  "personalidade": "Use Personalidade do agente da seção 6.7.",
  "temperaturaModelo": 0.5,
  "maxTokens": 800,
  "capacidades": ["chat", "scheduling", "onboarding"]
}
```

**Modo Agentic**
- `webEnabled: true`

**Treinamento (exemplo de descrição)**
```
Treino Secretaria: checklist de tarefas, prazos e confirmações simples.
```

---

### 7.8 Backoffice
**Alice Core (trecho recomendado)**
```
Você é Alice, assistente enterprise.
Backoffice padroniza processos e exige confirmação antes de alterações no ERP.
```

**Namespace (configuração completa)**
- Nome: `Backoffice`
- Slug: `backoffice`
- Descrição: `Operações internas, padronização e revisão de cadastros`
- Cor: `#8B5CF6`
- Objetivo do namespace: processos internos e melhorias operacionais.

**Exemplo pronto (copiar e colar)**
```http
POST /api/namespaces
Content-Type: application/json

{
  "nome": "Backoffice",
  "slug": "backoffice",
  "descricao": "Operações internas, padronização e revisão de cadastros",
  "cor": "#8B5CF6"
}
```

**Agente (configuração completa)**
- Nome: `Backoffice`
- Slug: `backoffice`
- Status: `active`
- Descrição: `Agente operacional para processos internos`
- Avatar (URL opcional): `https://cdn.seudominio.com/avatars/backoffice.png`
- Instruções do agente (copiar e colar): **use a seção 6.8**
- Personalidade do agente (copiar e colar): **use a seção 6.8**
- Modelo (aba Modelo):
  - Modelo base: `Padrão do sistema`
  - Temperatura: `0.3`
  - maxTokens: `1000`
- Capacidades (aba Capacidades): `["chat","rag","analytics","technical-support"]`

**Exemplo pronto (copiar e colar)**
```http
POST /api/agents
Content-Type: application/json

{
  "nome": "Backoffice",
  "slug": "backoffice",
  "status": "active",
  "namespaceId": "UUID_DO_NAMESPACE_BACKOFFICE",
  "descricao": "Agente operacional para processos internos",
  "avatar": "https://cdn.seudominio.com/avatars/backoffice.png",
  "instrucoes": "Use Instruções do agente da seção 6.8.",
  "personalidade": "Use Personalidade do agente da seção 6.8.",
  "temperaturaModelo": 0.3,
  "maxTokens": 1000,
  "capacidades": ["chat", "rag", "analytics", "technical-support"]
}
```

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

## 8) Relação Namespace ↔ Agente ↔ RAG ↔ Treino

Resumo operacional:
- **Namespace** isola conhecimento e treino por domínio.
- **Agente** executa tarefas no chat usando esse contexto.
- **Treino** vem das conversas aprovadas e feedback.

**Fluxo completo (namespace → RAG → training)**
1. **Namespace** é criado (ex.: `financeiro`).
2. **Documentos** são enviados para o RAG com o `namespaceId`.
3. **RAG** indexa os documentos e só busca conteúdo desse namespace.
4. **Agente** do namespace responde no chat usando esse contexto.
5. **Feedback do chat** (nota/aprovação) entra na fila de treinamento.
6. **Página Training** centraliza aprovação e disparo de treino.

---

## 9) RAG (Documentos, Imagens e Áudio)

Use RAG apenas se o agente precisar de **documentos internos** para responder no chat.
- Upload rápido: `/documents` (texto) e `/training` (multimodal).
- O agente consulta esses documentos durante a operação no chat.

**Dicas**
- Mantenha documentos por domínio/namespace.
- Evite PDFs gigantes sem necessidade (aumenta ruído).

---

## 10) Como os agentes funcionam no chat (roteamento, canais e handover)

### 10.1 Roteamento automático por domínio
- Ao iniciar uma **nova conversa**, a Alice analisa o pedido e seleciona o **agente do domínio**.
- Essa decisão usa **texto do pedido**, **namespace** e **detectores do Modo Agentic**.
- A conversa fica associada a **um único agente** até o fim.

**Dica para usuários leigos**
- Se existir seletor de agente, use-o antes de enviar a mensagem.
- Se não existir, escreva claramente o domínio: “Use o agente Financeiro”.

**Ações rápidas no topo do chat (⋯)**
- **Enviar p/ Treino**: abre a janela para aprovar e enviar a conversa.
- **Excluir conversa**: remove a conversa atual e todas as mensagens.

### 10.2 O que acontece se o pedido não for do domínio do agente?
- A Alice **não troca de agente automaticamente dentro da mesma conversa**.
- Se o assunto mudar de domínio, o recomendado é:
  1. **Encerrar a conversa atual**.
  2. **Abrir nova conversa** e selecionar o agente correto.

**Exemplo de resposta correta do agente**
> “Esse assunto não é do meu domínio. Para prosseguir, abra uma nova conversa e selecione o agente Jurídico/Compliance.”

### 10.3 Handover (escalação para humano)
- Para casos sensíveis ou quando o usuário pede atendimento humano, a conversa pode entrar em **modo humano**.
- Nesse modo, a Alice **pausa a automação** e um operador assume.

### 10.4 WhatsApp (Twilio) — como o canal funciona
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

## 11) Coleta de dados do Chat → Aprendizado

### Operações no chat (modo ideal de uso de agentes)
Para obter melhores resultados e gerar dados de treino úteis, use o chat com estrutura clara.

**Estrutura recomendada da solicitação**
1. **Agente alvo** (ex.: "Use o agente Trading").
2. **Objetivo claro** (ex.: "avaliar entrada e sugerir SL/TP").
3. **Contexto e dados** (ex.: símbolo, timeframe, limites, política).
4. **Restrições e aprovações** (ex.: "somente com aprovação explícita").
5. **Saída esperada** (ex.: "resumo + proposta + pedido de confirmação").

**Exemplo (Trading)**
> Use o agente Trading. Avalie <SYMBOL> no timeframe 5m com risco max 2% e sem auto execução.  
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

### O que é coletado (e por quê)
- **Mensagens do usuário e da Alice**: base para ensinar estilo, checklist e limites.
- **Namespace e agente**: garantem especialização por domínio.
- **Rating e metadados**: ajudam a filtrar qualidade e priorizar o que treinar.

### O que NÃO deve entrar no treino
- Dados sensíveis sem necessidade (PII excessivo, segredos, credenciais).
- Conversas incompletas (sem confirmação explícita em ações críticas).
- Respostas que contrariem compliance ou políticas internas.

### Critérios de aprovação (padrão enterprise)
- **Clareza**: pedido e resposta objetivos.
- **Conformidade**: não há execução sem confirmação.
- **Rastreabilidade**: dados mínimos presentes (valores, prazos, IDs).
- **Utilidade**: resposta serve como template reutilizável.

### Boas práticas para treinar agentes via chat
- Prefira pedidos completos e objetivos (dados, limites, política).
- Evite mensagens vagas; isso reduz qualidade do dataset.
- Sempre registre a **confirmação explícita** em operações sensíveis.
- Use o **mesmo agente** por domínio para manter consistência do treino.

---

## 12) Datasets e treinamento (QLoRA) — Página Training

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

### Tipos de treinamento (recomendado)
- **Incremental**: melhora contínua com dados recentes (mais rápido).
- **Completo**: reprocessa dataset do domínio (usar quando houver grande volume ou mudança de política).

### Como decidir quando treinar
- **Volume mínimo sugerido**: 30–50 conversas aprovadas por domínio.
- **Sinal de qualidade**: respostas consistentes e com confirmação explícita.
- **Mudanças de política**: treinar após atualizar regras de compliance.

### Treinamento com dados de chat (fluxo didático)
1. Usuário conversa com agente do domínio.
2. Usuário dá **rating** e/ou usa **Enviar p/ Treino**.
3. Admin revisa, aprova/reprova e corrige o namespace se necessário.
4. Ao atingir volume, dispara **Run Training**.
5. Monitore resultados no chat com casos reais do domínio.

**Dicas**
- Não treine com poucos exemplos; prefira volume consistente.
- Treinos por domínio produzem modelos mais estáveis.
- Mantenha o dataset **limpo e coerente** com políticas atuais.

**Exemplo de prompt de treino (descrição)**
```
Treino incremental após conversas de ERPNext com aprovação explícita.
Objetivo: reduzir perguntas repetidas e melhorar checklist de dados.
```

---

## 13) Especialização para Trading (KuCoin)

Foco em **pedidos no chat** + **confirmação explícita**.

### Playbook no chat
1. **Peça análise objetiva** (contexto + sinal).
2. **Exija confirmação** antes de qualquer execução.
3. **Registre SL/TP** e limites de risco na conversa.

### Exemplo de pedido (Trading)
> Use o agente Trading. Quero sinal para <SYMBOL> (5m), risco máx 2% e sem execução automática.  
> Entregue contexto, sinal, entrada/SL/TP e peça minha confirmação.

### Treino a partir do chat
- Marque a conversa com **“Enviar p/ Treino”**.
- Aprove no `/training` e rode **Treinamento Trading** quando atingir volume mínimo.

---

## 14) Especialização para Finanças/ERPNext

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

## 15) Permissões e RBAC essenciais

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

## 16) Observabilidade e validação

Validação mínima pós-operação:
- **Grafana** (Trading/GPU/ERPNext) e `/health`.
- Logs no Grafana/Loki quando algo não responde.

---

## 17) Troubleshooting rápido

- **Agente não responde**: verifique GPU Manager e containers GPU.
- **Treino não inicia**: valide se há dados aprovados.
- **ERPNext falha**: valide ERPNEXT_URL e permissões agentic.

---

## 18) Próximos passos recomendados

1. Começar com **1 agente por domínio** (Trading, Financeiro, Atendimento).
2. Operar no chat com pedidos estruturados e confirmação explícita.
3. Aprovar dados e rodar o primeiro **treino on-demand**.

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
  "avatar": "https://cdn.seudominio.com/avatars/trader-alpha.png",
  "instrucoes": "Use Instruções do agente da seção 6.2.",
  "personalidade": "Use Personalidade do agente da seção 6.2.",
  "temperaturaModelo": 0.3,
  "maxTokens": 1200,
  "capacidades": ["chat", "rag", "trading", "analytics"]
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
  "systemPrompt": "Você é Alice, assistente enterprise. Nunca execute ações críticas sem confirmação explícita."
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
  "symbol": "<SYMBOL>",
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
  "symbol": "<SYMBOL>",
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

### 20.17 ERPNext — Faturamento anual do cliente
```http
GET /api/integrations/erpnext/customer-annual-billing?customer=ACME%20LTDA&year=2025
```

Resposta (exemplo):
```json
{
  "customer": "ACME LTDA",
  "year": 2025,
  "total": 15000,
  "currency": "BRL",
  "invoiceCount": 3
}
```

Observação:
- O parser ignora automaticamente sufixos como `ano 2025` ou `em 2025` no nome do cliente.

### 20.18 ERPNext — Nota sobre Sales Order e Payment Entry
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
