# Limites de Treinamento, Hardware e Boas Práticas (2025–2026)

**Autor:** Fillipe Guerra  
**Data:** 11 de Fevereiro de 2026  
**Objetivo:** Referência enterprise para preservar dados de conversas longas e documentos/livros grandes, limites atuais, documentação oficial e coleta inteligente.

---

## 1. Limites atuais na plataforma Alice

**Configurações editáveis via UI:** As chaves abaixo marcadas com ⚙️ podem ser alteradas na página **Configurações do Sistema** (menu lateral). Valores gravados no PostgreSQL têm precedência sobre variáveis de ambiente. Alterações são aplicadas imediatamente (cache invalidado no save).

| Variável / Constante | Onde | Default | Descrição |
|----------------------|------|--------|-----------|
| `TRAINING_CONVERSATION_MAX_MESSAGES` ⚙️ | chat-service | **50** | Máximo de mensagens por conversa enviada ao training (coleta manual e batch). |
| `CONVERSATION_SLICE_SIZE` ⚙️ | chat-service | **10** | Tamanho da janela para fatiamento de conversas longas (janelas disjuntas). |
| `TRAINING_DOC_MAX_SAMPLES` ⚙️ | rag-service | **50** | Máximo de chunks de documento selecionados por documento para treino (após `selectTrainingChunks`). |
| `TRAINING_DOC_MIN_CHARS` | rag-service | **180** | Mínimo de caracteres por chunk para ser elegível a treino. |
| `DOCUMENT_CHUNK_SIZE` | document-processor | **8000** | Tamanho em caracteres de cada chunk para embedding e RAG. |
| `DOCUMENT_MAX_CHUNKS` ⚙️ | document-processor | **50** | Máximo de chunks gerados por documento (configurável via UI ou env). |
| `MAX_TEXT_LENGTH` | document-processor | **100000** | Texto extraído truncado além de 100k caracteres. |
| `MAX_DOCUMENT_SIZE_MB` | document-processor | **50** | Tamanho máximo do arquivo em MB. |
| `MIN_ONDEMAND_DATASET_SIZE` ⚙️ | training-service / lora-job-manager | **10** | Mínimo de exemplos para treino on-demand (configurável via UI ou env). |
| `MIN_CHAT_DATASET_SIZE` | lora-job-manager | **50** | Mínimo de exemplos para runs agendados (training_data + opcional trading). |
| `MIN_DATASET_SIZE` | lora-job-manager | **100** | Mínimo de exemplos para job LoRA (trading_dataset). |
| `maxSeqLen` ⚙️ | lora-job-manager / training-service | **2048** | Comprimento máximo de sequência no treino LoRA (256–32768). |
| `batchSize` (LoRA) | lora-job-manager | **4** | Batch size padrão no treino. |

**Limites para mídia (imagens/áudio) — Plano RAG Multimodal (11/02/2026):**

| Variável | Onde | Default | Descrição |
|----------|------|---------|-----------|
| Mínimo conteúdo para treino | rag-service | **50** chars | Imagens: `visionDescription` (OpenAI Vision); Áudio: `transcription` (ASR). Conteúdo menor é rejeitado. |
| Namespace | rag-service | Obrigatório | Mídia sem namespace não pode ser promovida para treinamento. |
| Tipos suportados | mediaUploads | image, audio | Apenas imagens e áudios processados podem ir para `training_data`. |

**Comportamento resumido:**

- **Documentos/livros:** Um documento é fatiado em até **50** chunks (configurável via `DOCUMENT_MAX_CHUNKS`) de ~8k caracteres; na promoção para treino, até **50** chunks são escolhidos por relevância/diversidade (âncoras início/fim + score). Modo livro (frontend) permite até 100. Cada chunk vira **um** `training_data`. Livro grande → vários datasets (até 50 ou 100 em modo livro).
- **Conversas:** Uma conversa com até **CONVERSATION_SLICE_SIZE** (10) mensagens vira **um** `training_data`. Conversas longas são **fatiadas em janelas disjuntas** de 10 mensagens; cada janela vira um `training_data` com `sourceMetadata.conversationWindow`. Na coleta manual, até **50** mensagens por conversa; o fatiamento é aplicado automaticamente.
- **Mídia (imagens/áudio):** Cada item de mídia processada vira **um** `training_data`. Requer namespace e conteúdo mínimo 50 caracteres (descrição ou transcrição). Fonte `rag_media` com `sourceMetadata.mediaUploadId`.

---

## 2. Hardware e documentação oficial (2025–2026)

### 2.1 GPU e VRAM (Hetzner GEX44 – 20GB)

- **Inferência Qwen2.5 7B:** FP16 ~15–17 GB; em 20GB é confortável.
- **Fine-tuning completo (full):** FP16 ~92 GB → **inviável** em uma GPU 20GB.
- **QLoRA / LoRA (4-bit / adapters):** QLoRA 7B reportado **~11,5 GB** mínimo; 20GB permite fine-tuning parameter-efficient (LoRA/QLoRA) no próprio servidor.
- **Fonte:** Qwen 2.5 requirements, Novita VRAM tips, torchtune/MLflow QLoRA tutorials.

**Conclusão:** O hardware atual **suporta** aumentar quantidade e tamanho dos dados de treino desde que o **treino continue sendo LoRA/QLoRA** (já é o caso). O gargalo não é VRAM para o tamanho do dataset em si, e sim batch size e `max_seq_length` durante o treino (ver TRL abaixo).

### 2.2 TRL / Hugging Face (SFT Trainer, 2025)

- **Formato:** SFT suporta *language modeling* e *prompt-completion*, em formato padrão ou **conversacional** (messages); o trainer aplica o chat template automaticamente.
- **Truncation:** O truncation reduz memória; `max_length` muito pequeno descarta tokens, muito grande aumenta risco de OOM e padding. TRL trunca por padrão; default típico é `min(tokenizer.model_max_length, 1024)` (ex.: `max_seq_length=512` em exemplos).
- **Packing:** `packing=True` concatena/divide sequências para preencher o comprimento alvo, reduz padding e preserva mais tokens. Exige FlashAttention (ou variante). Pode causar “batch contamination” se não usado com cuidado; recomendado combinar com FlashAttention 2/3.
- **PEFT/LoRA:** Integração nativa; learning rate mais alto (~1e-4) para adapters. PEFT + quantização 4/8-bit reduz ainda mais memória.
- **Gradient checkpointing:** Ligado por padrão nos trainers TRL para reduzir uso de memória.
- **Fonte:** [TRL SFT Trainer](https://huggingface.co/docs/trl/main/en/sft_trainer), [Reducing Memory Usage](https://huggingface.co/docs/trl/main/en/reducing_memory_usage).

### 2.3 Long context e chunking (2024–2025)

- **ChunkFlow (2025):** Reorganiza dataset em chunks de tamanho uniforme (consolida curtos, divide longos); agendamento por chunk reduz pico de memória.
- **SeCO / SpaCO (ACL 2025):** Otimização por chunk com backprop localizado; permite escalar 1K→16K em uma RTX 3090 com LoRA 8B.
- **ProLong / boas práticas:** Misturar dados longos (código, livros) com dados de contexto curto de alta qualidade; treinar com comprimento de sequência além do de avaliação; SFT com dados curtos pode ainda dar boa performance em contexto longo.
- **Fonte:** arXiv 2503.02356 (Chunk Flow), ACL 2025 findings (chunk-wise optimization), ProLong/OpenReview.

### 2.4 Qwen (documentação oficial)

- Qwen3/Qwen2.5: suporte a chat template, `enable_thinking`, `max_new_tokens` até 16k/32k conforme modelo. Para **treino**, a documentação aponta para Axolotl, LLaMA-Factory, MS-SWIFT, Unsloth, verl.
- **Fonte:** [Qwen Quickstart](https://qwen.readthedocs.io/en/latest/getting_started/quickstart.html), [Training](https://qwen.readthedocs.io/en/latest/training/axolotl.html) (Axolotl, etc.).

---

## 3. Podemos aumentar os limites?

**Sim**, dentro do seguinte quadro:

1. **Treino continua LoRA/QLoRA** → 20GB é suficiente para o pipeline atual.
2. **Aumentar número de exemplos (mais chunks, mais conversas)** é seguro: o job já usa `batchSize=4`, gradient checkpointing e preparação em JSONL; mais linhas no dataset aumentam tempo de treino, não necessariamente pico de VRAM.
3. **Aumentar “tamanho” por exemplo** (mais mensagens por conversa, ou mais tokens por chunk) impacta **max_seq_length** no treino: no TRL, `max_length` grande aumenta memória por batch. Solução recomendada pela documentação: **chunking** (dividir conversas longas em várias sequências) + **packing** (quando disponível) em vez de subir `max_length` sem limite.

Recomendações práticas:

- **Documentos:** Aumentar `TRAINING_DOC_MAX_SAMPLES` (ex.: 20 → 40 ou 50) e, se necessário, `maxChunks` (ex.: 50 → 100) via env ou constante, para livros grandes cobrirem mais trecho. Manter `DOCUMENT_CHUNK_SIZE` em 8k está alinhado com contexto típico de 4k–8k tokens.
- **Conversas:** Aumentar `TRAINING_CONVERSATION_MAX_MESSAGES` (ex.: 20 → 50) para coleta manual/batch; para conversas **muito** longas, a prática 2025 é **fatiar em várias amostras** (janelas de N turnos ou por tópico) em vez de uma única sequência gigante, para não estourar `max_seq_length` no SFT.

---

## 4. Coleta inteligente e datasets enterprise (visão geral)

Objetivo: **coleta inteligente de todas as fontes** (chat, documentos, bulk, trading) e **geração de datasets inteligente** de forma enterprise e completa.

### 4.1 Fontes atuais

| Fonte | Onde | Como vira training_data |
|-------|------|---------------------------|
| Chat (manual/batch) | chat-service | 1 conversa → 1 registro, até N mensagens |
| Chat (auto) | chat-service | 1 par user/assistant → 1 registro |
| Documentos RAG | rag-service | 1 doc → até M chunks selecionados → M registros |
| **Mídia (imagens/áudio)** | rag-service | 1 mídia processada → visionDescription/transcription → 1 registro (source `rag_media`) |
| Bulk import (Training) | training-service | 1 item do arquivo → 1 registro |
| Trading (sinais/post-mortem) | integrations-service | 1 sinal/post-mortem aprovado → trading_dataset → usado em jobs LoRA |

### 4.2 Melhorias enterprise sugeridas (sem mocks, Regra 6)

1. **Conversas longas**
   - **Opção A:** Aumentar `TRAINING_CONVERSATION_MAX_MESSAGES` (ex.: 50) e deixar o training-service/TRL truncar por `max_seq_length` (comportamento padrão).
   - **Opção B (mais alinhado à documentação 2025):** No chat-service, ao montar o payload de coleta, **fatiar** conversas com mais de K mensagens em **várias amostras** (janelas deslizantes ou por blocos de N turnos), cada uma enviada como um `training_data` distinto, com `sourceMetadata.conversationWindow` (ex.: `{ startIndex, endIndex }`). Assim preserva-se mais conteúdo sem uma única sequência gigante.

2. **Documentos/livros grandes**
   - Tornar **maxChunks** configurável por env (ex.: `DOCUMENT_MAX_CHUNKS`, default 50) no document-processor.
   - Aumentar **TRAINING_DOC_MAX_SAMPLES** por env (ex.: 40 ou 50) para livros.
   - Manter `selectTrainingChunks` (relevância + âncoras início/fim + diversidade) como lógica de seleção inteligente; opcionalmente expor `selection` (minChars, maxSamples) no endpoint de “enviar para treino” para o frontend poder escolher “modo livro” (mais amostras).

3. **Unificação e rastreabilidade**
   - Todas as fontes já usam `source` / `sourceType` / `sourceId` e opcionalmente `sourceMetadata`; manter e estender para qualquer nova fonte (ex.: `conversationWindow`).
   - Evitar duplicidade: chat já usa `sentToTrainingAt`; documentos/trading com `sourceId` permitem deduplicação no training-service.

4. **Training-service**
   - Aceitar `max_seq_length` (ou equivalente) na preparação do JSONL (ou no gpu-trainer) conforme TRL (truncation/packing). Assim os limites de “quantidade” (mais exemplos, mais chunks) ficam na coleta; o “tamanho por exemplo” fica limitado no treino de forma controlada.

5. **Frontend / UX**
   - Na página Training: opção “Enviar conversa longa” que explique que será fatiada em várias amostras (se implementar Opção B).
   - Na promoção de documento: opção “Modo livro” (mais amostras por doc) ligada a `maxSamples` maior.

---

## 5. Referências

- TRL SFT Trainer: https://huggingface.co/docs/trl/main/en/sft_trainer  
- TRL Reducing Memory Usage (truncation, packing, PEFT): https://huggingface.co/docs/trl/main/en/reducing_memory_usage  
- Qwen Quickstart / Training: https://qwen.readthedocs.io/en/latest/  
- Qwen2.5 7B VRAM (inferência / full ft / QLoRA): Medium/Novita, Qwen requirements  
- Long-context chunk-wise training: ChunkFlow (arXiv 2503.02356), SeCO/SpaCO (ACL 2025), ProLong (OpenReview)  
- CLAUDE.md: Regras 1, 6, 10, 11 (ler antes de agir, enterprise, documentação PT-BR, documentação oficial)

---

*Este documento consolida limites atuais do código, documentação oficial 2025–2026 e recomendações para coleta inteligente e geração de datasets de forma enterprise.*
