# 🎯 PLANO ENTERPRISE COMPLETO E FINAL
## Alice - IA Autônoma Multimodal Universal

**Autor:** Fillipe Guerra  
**Data:** 09 de Dezembro de 2025  
**Versão:** 3.2 (Final)

---

## 📊 RESUMO EXECUTIVO

| O que Alice vai fazer | Status Atual | Status Final |
|----------------------|--------------|--------------|
| **Entender** texto, áudio, imagem, vídeo, documento | ✅ Pronto | ✅ Pronto |
| **Aprender** de chats, WhatsApp, vendas, web, uploads | ❌ Parcial | ✅ Completo |
| **Buscar** na web quando não souber | ❌ Não existe | ✅ Completo |
| **Gerar** texto, imagem | ✅ Pronto | ✅ Pronto |
| **Gerar** áudio (voz clonada) | ❌ Não existe | ✅ Completo |
| **Gerar** vídeo curto (talking head) | ❌ Não existe | ✅ Completo |
| **Gerar** vídeo longo (concatenação) | ❌ Não existe | ✅ Completo |

---

## 🏗️ ARQUITETURA GERAL

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           ALICE ENTERPRISE PLATFORM                           │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                        FONTES DE APRENDIZADO                            │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │ │
│  │  │ Upload  │ │  Chats  │ │WhatsApp │ │ Vendas  │ │   Web   │           │ │
│  │  │ Manual  │ │Internos │ │(Twilio) │ │(Stripe) │ │(SearXNG)│           │ │
│  │  │PRIORIDADE│ │   (2)   │ │   (3)   │ │   (4)   │ │(crawl)  │           │ │
│  │  │   (1)   │ │         │ │         │ │         │ │         │           │ │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘           │ │
│  │       │           │           │           │           │                 │ │
│  │       └───────────┴───────────┴───────────┴───────────┘                 │ │
│  │                               │                                          │ │
│  │                               ▼                                          │ │
│  │       ┌─────────────────────────────────────────────┐                   │ │
│  │       │         LEARNING ORCHESTRATOR               │                   │ │
│  │       │   (Fila com prioridade + processamento)     │                   │ │
│  │       └─────────────────────────────────────────────┘                   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                          │
│  ┌────────────────────────────────┼────────────────────────────────────────┐ │
│  │                    PROCESSADORES MULTIMODAIS                            │ │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                 │ │
│  │  │ Text │ │Image │ │Audio │ │Video │ │ Doc  │ │ Web  │                 │ │
│  │  │Embed │ │CLIP  │ │Whisper│ │FFmpeg│ │Parse │ │Crawl │                 │ │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘                 │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                          │
│  ┌────────────────────────────────┼────────────────────────────────────────┐ │
│  │                         BASE DE CONHECIMENTO                            │ │
│  │              PostgreSQL + pgvector (embeddings)                         │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                   │                                          │
│  ┌────────────────────────────────┼────────────────────────────────────────┐ │
│  │                         GERADORES DE CONTEÚDO                           │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │ │
│  │  │   LLM    │ │  Imagem  │ │   TTS    │ │  Vídeo   │ │  Vídeo   │      │ │
│  │  │Maverick 4│ │ FLUX.1   │ │ XTTS v2  │ │SadTalker │ │  Longo   │      │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘      │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 📋 FASES DE IMPLEMENTAÇÃO

---

### 🧠 FASE 1: Sistema de Aprendizado Contínuo
**Duração: 5-6 dias**

#### 1.1 Learning Orchestrator (Novo serviço)
Gerencia TODAS as fontes de aprendizado com **fila priorizada**:

| Prioridade | Fonte | Tempo de Processamento |
|------------|-------|------------------------|
| **1 (Máxima)** | Upload Manual (Admin) | Imediato |
| **2 (Alta)** | Chats Internos | < 30 segundos |
| **3 (Média)** | WhatsApp | < 1 minuto |
| **4 (Normal)** | Vendas/Eventos | < 5 minutos |
| **5 (Baixa)** | Web Crawling | Background |

**Novo arquivo:** `apps/rag-service/src/learning-orchestrator.ts`

```typescript
// Estrutura da fila
interface LearningTask {
  id: string;
  priority: 1 | 2 | 3 | 4 | 5;
  source: 'manual' | 'chat' | 'whatsapp' | 'sales' | 'web';
  content: Buffer | string | URL;
  contentType: string;
  tenantId: string;
  createdAt: Date;
}
```

#### 1.2 Aprendizado de Chats Internos
| Item | Detalhe |
|------|---------|
| **Trigger** | Conversa encerrada + rating ≥ 4 |
| **Dados** | Mensagens + respostas + contexto |
| **Destino** | `trainingData` (auto-approve se qualidade alta) |

#### 1.3 Aprendizado de WhatsApp
| Item | Detalhe |
|------|---------|
| **Trigger** | Mensagem processada pelo webhook |
| **Dados** | Texto + mídia (se houver) |
| **Destino** | RAG + `trainingData` |

#### 1.4 Aprendizado de Vendas
| Item | Detalhe |
|------|---------|
| **Trigger** | Webhook Stripe/ERPNext |
| **Dados** | Produto, valor, contexto da conversa |
| **Destino** | RAG (para contexto de vendas) |

---

### 🔍 FASE 2: Web Search (SearXNG)
**Duração: 2-3 dias**

| Item | Detalhe |
|------|---------|
| **Container** | `searxng/searxng:latest` |
| **Custo** | GRATUITO (self-hosted) |
| **Buscadores** | Google, Bing, DuckDuckGo, etc. |

**docker-compose.prod.yml:**
```yaml
alice-searxng:
  image: searxng/searxng:latest
  restart: unless-stopped
  volumes:
    - searxng-config:/etc/searxng
  environment:
    - SEARXNG_SECRET_KEY=${SEARXNG_SECRET_KEY}
  networks:
    - alice-network
```

**Novo arquivo:** `apps/rag-service/src/web-search.ts`

---

### 🕷️ FASE 3: Web Crawling
**Duração: 3-4 dias**

| Item | Detalhe |
|------|---------|
| **Tecnologia** | Puppeteer (headless Chrome) |
| **Custo** | GRATUITO |
| **Funcionalidade** | Crawling recursivo com limite de profundidade |

**Capacidades:**
- Visitar página principal
- Extrair links internos
- Visitar subpáginas (até N níveis)
- Extrair texto, imagens, PDFs
- Respeitar robots.txt

**Novo arquivo:** `apps/rag-service/src/web-crawler.ts`

---

### 📚 FASE 4: Dashboard Training (Atualização)
**Duração: 4-5 dias**

Adicionar **nova tab "Aprendizado"** na página `Training.tsx`:

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  🧠 Training                                                                   │
├───────────────────────────────────────────────────────────────────────────────┤
│  [Dados de Treinamento]  [Jobs de Fine-tuning]  [📚 Aprendizado]              │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ 🔍 Pesquisar na Web e Aprender                                          │  │
│  │                                                                          │  │
│  │ Tema: [____________________] Profundidade: [▼ Médio] [🔍 Pesquisar]     │  │
│  │                                                                          │  │
│  │ • Superficial: 5 páginas                                                 │  │
│  │ • Médio: 20 páginas                                                      │  │
│  │ • Profundo: 50 páginas                                                   │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ 🔗 Aprender de URL                                                       │  │
│  │                                                                          │  │
│  │ URL: [____________________] Níveis: [▼ 2] [📥 Aprender]                 │  │
│  │                                                                          │  │
│  │ ☑ Incluir imagens  ☑ Incluir PDFs  ☐ Incluir vídeos                     │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ 🎬 Aprender de Vídeo                                                     │  │
│  │                                                                          │  │
│  │ [Arrastar vídeo aqui ou colar link YouTube/Vimeo]                       │  │
│  │                                                                          │  │
│  │ ☑ Transcrever áudio  ☑ Analisar frames  ☑ Gerar resumo                  │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ 🖼️ Aprender de Imagens                                                   │  │
│  │                                                                          │  │
│  │ [Arrastar imagens aqui ou selecionar pasta]                             │  │
│  │                                                                          │  │
│  │ Descrição: [_______________] ☑ Gerar descrição automática               │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ 📄 Aprender de Documentos                                                │  │
│  │                                                                          │  │
│  │ [Arrastar PDFs, DOCX, XLSX ou pastas]                                   │  │
│  │                                                                          │  │
│  │ Tipos: PDF, DOCX, XLSX, TXT, MD, CSV                                    │  │
│  │ ☑ Extrair imagens de PDFs  ☐ Processar gráficos                         │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ 📊 Tarefas de Aprendizado                                   [🔄 Atualizar]│  │
│  ├─────────────────────────────────────────────────────────────────────────┤  │
│  │ ⏳ Web: "inteligência artificial" (15/50 páginas)           45%         │  │
│  │ ✅ PDF: manual-empresa.pdf                                   100%        │  │
│  │ ✅ Vídeo: treinamento-vendas.mp4                             100%        │  │
│  │ 🔄 URL: empresa.com.br (crawling nível 2)                   12%         │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

### 🎤 FASE 5: Text-to-Speech (XTTS v2)
**Duração: 3-4 dias**

| Item | Detalhe |
|------|---------|
| **Modelo** | XTTS v2 (Coqui) - open source |
| **Custo** | GRATUITO |
| **Onde roda** | Salad Cloud GPU |
| **Funcionalidades** | TTS + Clonagem de voz |

**Capacidades:**
- Converter texto em áudio natural
- Clonar voz a partir de sample de 6 segundos
- Suporte a PT-BR, EN, ES, FR, DE, IT, etc.
- Múltiplas vozes por tenant

**Novo arquivo:** `apps/rag-service/src/tts-service.ts`

**Endpoints:**
- `POST /api/tts/generate` - Gerar áudio de texto
- `POST /api/tts/clone-voice` - Registrar voz para clonagem
- `GET /api/tts/voices` - Listar vozes disponíveis

---

### 👤 FASE 6: Talking Head (SadTalker)
**Duração: 4-5 dias**

| Item | Detalhe |
|------|---------|
| **Modelo** | SadTalker - open source |
| **Custo** | GRATUITO |
| **Onde roda** | Salad Cloud GPU |
| **Entrada** | Foto de rosto + Áudio |
| **Saída** | Vídeo MP4 (até 60s) |

**Capacidades:**
- Animar foto estática com áudio
- Movimentos naturais de cabeça
- Expressões faciais automáticas
- Sincronização labial

**Novo arquivo:** `apps/rag-service/src/talking-head-service.ts`

---

### 👄 FASE 7: Lip Sync (Wav2Lip)
**Duração: 3-4 dias**

| Item | Detalhe |
|------|---------|
| **Modelo** | Wav2Lip - open source |
| **Custo** | GRATUITO |
| **Onde roda** | Salad Cloud GPU |
| **Entrada** | Vídeo existente + Novo áudio |
| **Saída** | Vídeo com lábios sincronizados |

**Novo arquivo:** `apps/rag-service/src/lip-sync-service.ts`

---

### 🎬 FASE 8: Pipeline de Vídeo Longo
**Duração: 4-5 dias**

| Item | Detalhe |
|------|---------|
| **Tecnologia** | FFmpeg + SadTalker + transições |
| **Custo** | GRATUITO |
| **Limite** | Até 60 minutos de vídeo |

**Estratégia de Concatenação:**

```
┌───────────────────────────────────────────────────────────────┐
│                    PIPELINE DE VÍDEO LONGO                    │
├───────────────────────────────────────────────────────────────┤
│                                                                │
│  Script (10 min)                                              │
│       │                                                        │
│       ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ MAVERICK 4: Dividir em 10 segmentos de ~1 min           │  │
│  └─────────────────────────────────────────────────────────┘  │
│       │                                                        │
│       ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Para cada segmento (paralelo):                          │  │
│  │   1. XTTS v2: Texto → Áudio                             │  │
│  │   2. SadTalker: Áudio + Foto → Vídeo 1 min              │  │
│  └─────────────────────────────────────────────────────────┘  │
│       │                                                        │
│       ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ FFmpeg: Concatenar + Transições                         │  │
│  │   - Cross-fade (dissolve) entre segmentos               │  │
│  │   - Normalizar áudio                                    │  │
│  │   - Encoding final H.264/AAC                            │  │
│  └─────────────────────────────────────────────────────────┘  │
│       │                                                        │
│       ▼                                                        │
│  Vídeo Final: 10 minutos em MP4                               │
│                                                                │
└───────────────────────────────────────────────────────────────┘
```

**Tipos de Transição:**
- **Cross-fade** (padrão): Dissolve suave entre cenas
- **Fade to black**: Transição por preto
- **Cut com motion blur**: Corte suave

**Novo arquivo:** `apps/rag-service/src/long-video-pipeline.ts`

---

## 📅 CRONOGRAMA DETALHADO

| Semana | Dias | Fase | Entregável |
|--------|------|------|------------|
| **1** | 1-3 | Fase 1 | Learning Orchestrator + Aprendizado de Chats |
| **1** | 4-5 | Fase 1 | Aprendizado WhatsApp + Vendas |
| **1** | 6-7 | Fase 2 | SearXNG + Web Search |
| **2** | 1-4 | Fase 3 | Web Crawling completo |
| **2** | 5-7 | Fase 4 | Dashboard Training (tab Aprendizado) |
| **3** | 1-4 | Fase 5 | TTS (XTTS v2) + Clonagem de voz |
| **3** | 5-7 | Fase 6 | Talking Head (SadTalker) |
| **4** | 1-3 | Fase 7 | Lip Sync (Wav2Lip) |
| **4** | 4-7 | Fase 8 | Pipeline Vídeo Longo |
| **5** | 1-4 | - | Testes + Refinamentos + Deploy |

**Total: 5 semanas**

---

## 💰 CUSTOS

| Item | Custo | Observação |
|------|-------|------------|
| SearXNG | R$ 0 | Self-hosted no Hetzner |
| XTTS v2 | R$ 0 | Open source, Salad Cloud |
| SadTalker | R$ 0 | Open source, Salad Cloud |
| Wav2Lip | R$ 0 | Open source, Salad Cloud |
| FFmpeg | R$ 0 | Já instalado |
| Puppeteer | R$ 0 | Open source |
| Salad Cloud GPU | Já pago | Créditos existentes |
| Hetzner | Já pago | Servidor existente |

**CUSTO ADICIONAL TOTAL: R$ 0,00** 🎉

---

## 📁 NOVOS ARQUIVOS A CRIAR

```
apps/rag-service/src/
├── learning-orchestrator.ts    # Orquestrador de aprendizado
├── web-search.ts               # Integração SearXNG
├── web-crawler.ts              # Crawling recursivo
├── youtube-downloader.ts       # Download vídeos YT
├── tts-service.ts              # Text-to-Speech
├── talking-head-service.ts     # SadTalker
├── lip-sync-service.ts         # Wav2Lip
└── long-video-pipeline.ts      # Concatenação de vídeos

apps/frontend-service/src/pages/Training/
├── components/
│   └── LearningTab.tsx         # Nova tab de aprendizado
└── ...

infra/docker/
└── docker-compose.prod.yml     # +1 container SearXNG
```

---

## ✅ CONFORMIDADE COM AS 17 REGRAS

| Regra | Status | Como |
|-------|--------|------|
| 1 - LER ANTES | ✅ | Analisei código existente |
| 2 - NÃO DUPLICAR | ✅ | Reutilizo processadores existentes |
| 3 - WORKFLOW | ✅ | Diagnóstico → Plano → Aprovação → Implementação |
| 4 - APROVAÇÃO | ✅ | Este plano para sua aprovação |
| 5 - NÃO MENTIR | ✅ | Limites realistas informados |
| 6 - SEM TEMPORÁRIO | ✅ | Tudo persistido em PostgreSQL |
| 7 - CIRÚRGICO | ✅ | Mudanças isoladas por fase |
| 8 - QUALIDADE | ✅ | TypeScript strict, Pino logging |
| 9 - VALIDAÇÃO | ✅ | Testes após cada fase |
| 10 - DOC PT-BR | ✅ | Toda documentação em português |
| 11 - DOCS OFICIAIS | ✅ | Seguindo docs de cada tecnologia |
| 12 - HETZNER | ✅ | Deploy via GitHub Actions |
| 13 - i18n | ✅ | PT-BR primário |
| 14 - SECRETS | ✅ | Chaves Salad Cloud já configuradas |
| 15 - MICROSSERVIÇOS | ✅ | Código em apps/ |
| 16 - BEST PRACTICES | ✅ | Circuit breaker, health checks |
| 17 - REVIEW | ✅ | Aguardar review antes de push |

---

## 🎯 RESULTADO FINAL

Após todas as fases, Alice será capaz de:

| Capacidade | Entrada | Saída |
|------------|---------|-------|
| **Aprender** | Chats internos | Base de conhecimento atualizada |
| **Aprender** | WhatsApp | Base de conhecimento atualizada |
| **Aprender** | Vendas | Contexto de negócios |
| **Aprender** | Pesquisa web | Conhecimento da internet |
| **Aprender** | URLs (crawling) | Conteúdo completo de sites |
| **Aprender** | Vídeos (upload/YT) | Transcrição + análise visual |
| **Aprender** | Imagens | Descrição + embeddings |
| **Aprender** | Documentos | Texto + imagens extraídas |
| **Buscar** | Pergunta | Resultados da web + resumo |
| **Gerar** | Prompt | Texto (Maverick 4) |
| **Gerar** | Prompt | Imagem (FLUX.1) |
| **Gerar** | Texto | Áudio com voz clonada |
| **Gerar** | Texto + Foto | Vídeo curto (até 60s) |
| **Gerar** | Script longo | Vídeo longo (até 60 min) |

---

*Autor: Fillipe Guerra*
*Documento em Português Brasileiro*
*Atualizado: 09 de Dezembro de 2025*
*Total de Containers: 40 (5 infraestrutura + 8 Alice + 15 ERPNext + 11 observability + 1 backup)*
*Storage: Volume Hetzner 100GB local (/opt/alice) para uploads multimodais e backups*
*Redis Alice: Container dedicado para cache distribuído (segregação enterprise)*

*Plano salvo em `docs/PLANO-MULTIMODAL-COMPLETO.md` para referência futura*

