# Guia de Treinamento de Agentes da Alice (Negócios)

**Autor:** Fillipe Guerra  
**Data:** 03 de Fevereiro de 2026  
**Versão:** 1.0.0 - Guia didático para usuários de negócio

---

## Objetivo deste guia

Este guia explica, de forma simples, **como treinar os Agentes da Alice** usando:
- **Documentos e livros** (RAG);
- **Conversas no chat** (dados de qualidade);
- **Operações e sinais de trading** (experiência prática).

Ele foi escrito para **usuários de negócio**, sem exigir conhecimento técnico.  
Quando precisar de detalhes técnicos (API, cron, infraestrutura), consulte:
- `docs/TRAINING.md`
- `docs/SISTEMA-APRENDIZADO.md`

---

## 1) Conceitos básicos (o que é e para que serve)

### 1.1 Treinamento / Fine-tuning
**O que é:** ensinar o modelo a **responder melhor** em um domínio específico (ex.: trading).  
**Para que serve:** ajustar **estilo**, **tom**, **prioridades** e **raciocínio** com base em dados aprovados.  
**Quando usar:** quando o agente precisa **aprender comportamento**, não só consultar fatos.

**Exemplo:**  
Você quer que o Agente Trading responda sempre com:
1) Resumo da operação;  
2) Plano (entrada, stop, alvo);  
3) Risco e validações.

Treinamento é o caminho para **fixar esse padrão**.

### 1.2 RAG (Base de Conhecimento)
**O que é:** uma “memória consultável” que o agente usa na hora de responder.  
**Para que serve:** manter **fatos atualizados** sem mudar o modelo.  
**Quando usar:** quando o conteúdo muda com frequência (ex.: regras internas, playbooks).

**Exemplo:**  
Você atualiza a política de risco.  
Você sobe o documento no RAG e o agente passa a usar a regra **imediatamente**.

### 1.3 Namespace
**O que é:** “pasta” de conhecimento separada por área (ex.: Trading, Jurídico, Suporte).  
**Para que serve:** evitar mistura de assuntos e reduzir respostas fora de contexto.

**Exemplo:**  
O namespace **Trading** só recebe conteúdo de trading.  
O agente de trading consulta esse namespace.

### 1.4 Dataset de Treinamento
**O que é:** conjunto de exemplos aprovados (conversas, sinais, análises) usados no fine‑tuning.  
**Para que serve:** ensinar o **comportamento ideal** do agente.

### 1.5 Deduplicação Semântica
**O que é:** limpeza automática de conteúdos muito parecidos.  
**Para que serve:** evitar “lixo repetido” no treinamento.

**Exemplo:**  
10 conversas quase iguais → o sistema mantém apenas **as melhores**.

---

## 2) Quando usar RAG ou Treinamento?

| Situação | Use RAG | Use Treinamento |
|---------|---------|----------------|
| Regras e políticas atualizadas | ✅ | ❌ |
| Livros, manuais e playbooks | ✅ | ❌ |
| Estilo e formato de resposta | ❌ | ✅ |
| Tom de voz (mais direto ou mais didático) | ❌ | ✅ |
| Exemplos de decisão (bons e ruins) | ⚠️ (como referência) | ✅ |

**Regra simples:**  
**RAG = fatos** | **Treinamento = comportamento**

---

## 3) Passo a passo — Inserir documentos no RAG (namespace Trading)

### 3.1 Defina o objetivo do conteúdo
Pergunte:  
“Qual decisão de negócio este documento ajuda a tomar?”

**Exemplo:**  
“Este playbook define quando operar scalping em 5m.”

### 3.2 Prepare os documentos (boa qualidade)
Preferências:
- PDF, DOCX, TXT, Markdown, CSV ou JSON.
- Textos claros e estruturados.
- Uma versão “limpa” do documento (sem propaganda ou ruído).

### 3.3 Crie ou selecione o namespace **Trading**
No painel, selecione o namespace **Trading** para o upload.  
(Esse namespace separa o conhecimento de outras áreas.)

### 3.4 Faça o upload
- Envie o documento para o RAG com o namespace **Trading**.
- O sistema divide em “trechos” e gera embeddings.
- O conteúdo fica **disponível imediatamente** para consulta.

### 3.5 Valide na prática
- Faça uma pergunta real no chat/trading.
- Verifique se a resposta cita o conteúdo correto.

**Exemplo de pergunta:**
“Qual é o limite de risco diário para scalping?”

---

## 4) Passo a passo — Treinar com conversas de chat

### 4.1 Use conversas reais e de alta qualidade
- Perguntas claras.
- Respostas completas, com contexto e justificativa.

**Exemplo de boa conversa:**
Usuário: “Quero operar BTC em 5m. Qual estratégia?”  
Agente: “Sugiro scalping com confirmação de RSI + volume. Entrada em X, stop em Y.”

### 4.2 Avalie a conversa
- Dê nota **4 ou 5 estrelas** para respostas boas.
- Evite aprovar respostas genéricas.

### 4.3 Envie para Treinamento
- Use o botão **“Enviar para Treino”** (quando disponível).
- Ou aprove no painel de Treinamento.

### 4.4 Aprovação final
- No painel `/training`, aprove apenas o que for **excelente**.
- Reprove respostas vagas, erradas ou inseguras.

---

## 5) Passo a passo — Treinar com operações e sinais de trading

### 5.1 Gere sinais com contexto completo
- Timeframe, marketType e motivo da operação.
- Indique **por que** o sinal foi dado.

### 5.2 Acompanhe o resultado
- O sinal foi bom?  
- O stop estava correto?  
- O risco foi respeitado?

### 5.3 Classifique e aprove
- **Aprovado**: sinal correto, bem explicado, risco controlado.
- **Rejeitado**: sinal ruim, sem fundamento ou sem controle de risco.

### 5.4 Use a aprovação para dataset
- Sinais aprovados viram exemplos para fine‑tuning.

---

## 6) Como funciona a geração de datasets (visão simples)

1. **Coleta de dados** (chat, sinais, análises)  
2. **Curadoria** (aprovado/reprovado)  
3. **Deduplicação semântica** (remove repetição)  
4. **Geração de dataset JSONL**  
5. **Treinamento QLoRA**  
6. **Validação** (melhorou ou piorou?)  
7. **Deploy** (se melhorou) ou rollback (se piorou)

**Resultado:**  
O agente aprende **o comportamento aprovado** pela equipe.

---

## 7) Deduplicação semântica (por que isso importa)

O sistema calcula um “hash semântico” para cada exemplo.  
- Se 2 exemplos são **95% parecidos**, só o melhor fica.

**Benefício:** evita “lixo repetido” e melhora a qualidade.

**Como ajudar o sistema:**
- Evite copiar a mesma resposta.
- Crie exemplos **variados**, com casos reais.

---

## 8) O que inserir no RAG (bons exemplos)

✅ **Playbooks de Trading**  
- Estratégias por timeframe (1m, 5m, 15m).  

✅ **Políticas de risco e compliance**  
- Limites de exposição, stop obrigatório, regras de alavancagem.

✅ **Glossário interno**  
- Termos que o time usa (ex.: “região de liquidez”, “pivô diário”).

✅ **Relatórios e análises oficiais**  
- Relatórios auditados, pesquisas internas e documentos técnicos.

✅ **Checklist operacional**  
- “Antes de abrir posição, valide A, B, C”.

---

## 9) O que evitar no treinamento (importante!)

❌ **Dados pessoais ou sensíveis**  
Ex.: CPFs, chaves privadas, informações de clientes.

❌ **Conteúdo sem fonte ou rumor**  
Ex.: “vi no Twitter que o BTC vai subir”.

❌ **Documentos desatualizados**  
Se uma regra mudou, o antigo deve ser removido ou substituído.

❌ **Mensagens curtas e vagas**  
Ex.: “acho que vai subir”.

❌ **Dump de logs crus**  
Sem contexto, isso vira ruído.

---

## 10) Boas práticas específicas para o Agente Trading

- Sempre indicar **timeframe** e **mercado** (spot/futures/margin).
- Registrar **motivos objetivos** (indicadores, price action).
- Incluir **risco** (stop, take profit, risco diário).
- Evitar “certezas absolutas” (usar linguagem de probabilidade).

**Exemplo aprovado:**
“Entrada em 5m com RSI sobrevendido, stop em 2%.  
Risco calculado para 1% do capital.”

---

## 11) Checklist rápido (para usuários de negócio)

Antes de enviar qualquer conteúdo:
- O conteúdo é **claro e objetivo**?
- Está **atualizado**?
- Ajuda a tomar **decisões reais**?
- Está **sem dados sensíveis**?
- Representa o **padrão ideal** do agente?

Se sim, ele pode entrar no RAG ou no Treinamento.

---

## 12) Resumo final (bem direto)

- **RAG** = base de conhecimento (fatos atualizados).  
- **Treinamento** = comportamento do agente (estilo, decisão, padrão).  
- **Namespace Trading** = conhecimento isolado só de trading.  
- **Deduplicação semântica** = mantém só o que importa.

Se você seguir este guia, o Agente Trading evolui de forma **segura, limpa e escalável**.

---

## Próximos passos recomendados

1. Criar uma “pasta” de documentos Trading (playbooks, políticas e checklist).
2. Subir tudo no RAG usando o namespace **Trading**.
3. Gerar sinais com justificativa e aprovar apenas os melhores.
4. Rodar o treinamento incremental quando houver dados suficientes.

Se precisar de apoio técnico, use como referência:
- `docs/TRAINING.md`
- `docs/SISTEMA-APRENDIZADO.md`
