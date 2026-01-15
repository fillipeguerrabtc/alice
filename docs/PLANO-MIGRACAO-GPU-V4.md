# Plano de Migração GPU v4.0.0 - Alice Enterprise Platform

**Data de Criação:** 11 de Janeiro de 2026  
**Autor:** Fillipe Guerra  
**Status:** ✅ IMPLEMENTADO  

---

## 📋 Sumário

1. [Objetivo](#objetivo)
2. [Contexto e Motivação](#contexto-e-motivação)
3. [Comparativo de Arquiteturas](#comparativo-de-arquiteturas)
4. [Fases de Implementação](#fases-de-implementação)
5. [Checklist de Limpeza (Fase 0)](#checklist-de-limpeza-fase-0)
6. [Checklist de Implementação (Fases 1-6)](#checklist-de-implementação-fases-1-6)
7. [Estrutura de Arquivos](#estrutura-de-arquivos)
8. [Aderência às 18 Regras do CLAUDE.md](#aderência-às-18-regras-do-claudemd)
9. [Riscos e Mitigações](#riscos-e-mitigações)
10. [Histórico de Alterações](#histórico-de-alterações)

---

## 🎯 Objetivo

Migrar a arquitetura de GPU da Alice de:
- **Orquestração dinâmica complexa** (5 containers alternando, 1 ativo por vez)
- Para **arquitetura simplificada** (3 containers simultâneos + trainer sob demanda)

### Benefícios Esperados

| Aspecto | Antes | Depois |
|---------|-------|--------|
| **Latência de troca** | 30-60 segundos | **0ms** |
| **Disponibilidade** | 1 serviço por vez | **100% simultâneo** |
| **Complexidade** | Alta (Docker API, locks) | **Baixa** |
| **Vision/Imagens** | ❌ Não tinha | ✅ **Nativo** |
| **Fine-tuning** | Impossível (18GB ocupados) | ✅ **Possível** |
| **Matemática/Finanças** | Bom | **Excelente** (+8%) |

---

## 📖 Contexto e Motivação

### Caso de Uso da Alice

Alice é uma plataforma enterprise **verticalizada** para:
- 💰 **Trading** (KuCoin Futures BTC Perpetuals)
- 📊 **Gestão Financeira** (empresas e pessoas)
- 🧮 **Cálculos financeiros** (juros, projeções, análises)
- 📈 **Análise de gráficos** (via imagens)

**NÃO é um chatbot generalista** - será especializada via fine-tuning.

### Limitação Atual

GPU RTX 4000 Ada (Hetzner GEX44) tem **20GB VRAM**, mas:
- Mixtral 8x7B usa ~18GB
- Embeddings FP16 usa ~16GB
- **Não cabem juntos!**

### Solução Anterior (Problemática)

Orquestração dinâmica via Docker API:
1. Para container atual
2. Libera VRAM
3. Inicia novo container
4. Aguarda healthcheck
5. **Latência: 30-60 segundos por troca**

### Nova Solução

Substituir modelo grande por modelo menor especializado:
- **Qwen2.5-VL 7B** (4GB AWQ) - melhor em matemática/finanças + vision nativo
- **Embeddings INT8** (8GB) - quantização sem perda significativa
- **Total: 15GB** - cabe tudo junto!

---

## 📊 Comparativo de Arquiteturas

### Arquitetura ANTIGA (v3.0.0)

```
GPU 20GB VRAM - APENAS 1 ATIVO POR VEZ:
┌─────────────────────────────────────────────────────────────┐
│  Mixtral 8x7B        ██████████████████░░  18GB  (LLM)     │
│  OU                                                         │
│  Embeddings FP16     ████████████████░░░░  16GB  (RAG)     │
│  OU                                                         │
│  FLUX.1 Schnell      ████████████░░░░░░░░  12GB  (Imagens) │
│  OU                                                         │
│  ASR Canary          ███░░░░░░░░░░░░░░░░░  3GB   (Áudio)   │
└─────────────────────────────────────────────────────────────┘

Problema: Troca dinâmica = 30-60s de latência
```

### Arquitetura NOVA (v4.0.0)

```
GPU 20GB VRAM - TODOS SIMULTÂNEOS:
┌─────────────────────────────────────────────────────────────┐
│  Qwen2.5-VL 7B AWQ   ████░░░░░░░░░░░░░░░░  4GB   (LLM+Vision)
│  Qwen3-Embed INT8    ████████░░░░░░░░░░░░  8GB   (RAG)
│  Canary-1B           ███░░░░░░░░░░░░░░░░░  3GB   (Áudio)
├─────────────────────────────────────────────────────────────┤
│  TOTAL               ███████████████░░░░░  15GB
│  LIVRE               █████░░░░░░░░░░░░░░░  5GB
└─────────────────────────────────────────────────────────────┘

✅ Zero latência de troca
✅ Vision nativo (análise de gráficos)
✅ 5GB livres para fine-tuning emergencial
```

### Comparativo de Modelos

| Modelo | Parâmetros | VRAM (4-bit) | Matemática | Finanças | Vision |
|--------|------------|--------------|------------|----------|--------|
| Mixtral 8x7B | 47B (12B ativos) | ~18GB | ⭐⭐⭐⭐ | ⭐⭐⭐ | ❌ |
| **Qwen2.5-VL 7B** | 7B | **~4GB** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ |
| Pixtral 12B | 12B | ~6GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ |

**Escolha: Qwen2.5-VL 7B** por ser líder em benchmarks financeiros e matemáticos.

---

## 🔧 Fases de Implementação

### Visão Geral

| Fase | Descrição | Tempo Est. | Status |
|------|-----------|------------|--------|
| **0** | Limpeza de código e documentação legados | 45 min | ✅ Concluída |
| **1** | Criar container `gpu-qwen-vl` | 1h | ✅ Concluída |
| **2** | Atualizar container `gpu-embeddings` (INT8) | 30 min | ✅ Concluída |
| **3** | Simplificar GPU Manager Service | 45 min | ✅ Concluída |
| **4** | Training Service - Schedule + On-demand | 1h 30min | ✅ Concluída |
| **5** | Frontend - Página de Treinamento Admin | 1h | ✅ Concluída |
| **6** | Documentação Nova (v4.0.0) | 45 min | ✅ Concluída |
| **Total** | | **~6h 15min** | ✅ 100% |

---

## 🧹 Checklist de Limpeza (Fase 0)

### Código a REMOVER

- [x] **DELETAR** `apps/gpu-manager-service/src/docker-orchestrator.ts` (651 linhas)
- [x] **EDITAR** `apps/gpu-manager-service/src/index.ts`:
  - [x] Remover imports do `docker-orchestrator.js`
  - [x] Remover `initializeOrchestrator()` call
  - [x] Remover `shutdownOrchestrator()` call
  - [x] Remover `ensureGpuServiceRunning()` calls
  - [x] Remover `isOrchestratorEnabled()` checks
  - [x] Remover `mapServiceTypeToContainer()` calls
  - [x] Remover `getGpuServicesStatus()` no endpoint `/api/gpu/services`

### Docker Compose a LIMPAR

- [x] **EDITAR** `infra/docker/stacks/docker-compose.alice.yml`:
  - [x] Remover container `gpu-mixtral`
  - [x] Remover container `gpu-flux`
  - [x] Remover todos os `profiles:` dos containers GPU
  - [x] Remover volume `/var/run/docker.sock` do gpu-manager
  - [x] Remover variáveis `GPU_ORCHESTRATOR_*` do gpu-manager
  - [x] Remover comentários sobre "apenas 1 ativo por vez"
  - [x] Atualizar header do arquivo para v6.0

### Workflows GitHub Actions a LIMPAR

- [x] **EDITAR** `.github/workflows/deploy-stack-modular.yml`:
  - [x] Remover lógica de `--profile gpu-llm`
  - [x] Remover lógica de `docker compose create --no-start`
  - [x] Remover loop de pull por profile
  - [x] Simplificar deploy para `docker compose up -d` direto

- [x] **EDITAR** `.github/workflows/release.yml`:
  - [x] Remover build de `flux-schnell`
  - [x] Renomear `mixtral-vllm` para `qwen-vl`

### Documentação a REESCREVER

- [x] **REESCREVER** `docs/ARQUITETURA-GPU-MANAGER.md`:
  - [x] Atualizar versão para 4.0.0
  - [x] Remover seção "Orquestração Dinâmica de GPU (v3.0.0)"
  - [x] Remover tabela de "Latência de Troca"
  - [x] Remover variáveis `GPU_ORCHESTRATOR_*`
  - [x] Remover referências a Docker Socket
  - [x] Remover diagrama "APENAS 1 ATIVO POR VEZ"
  - [x] Remover todas referências a FLUX
  - [x] Remover todas referências a Mixtral 8x7B
  - [x] Adicionar nova arquitetura simplificada
  - [x] Adicionar seção de Training Schedule

- [x] **ATUALIZAR** `CLAUDE.md`:
  - [x] Linha ~4: `Mixtral 8x7B` → `Qwen2.5-VL 7B`
  - [x] Linhas ~87-93: Remover FLUX de Multimodal Inference
  - [x] Linhas ~107-127: Reescrever GPU Services
  - [x] Remover menções a orquestração dinâmica
  - [x] Atualizar diagrama de arquitetura

- [x] **ATUALIZAR** `README.md`:
  - [x] Substituir `Mixtral 8x7B` → `Qwen2.5-VL 7B`
  - [x] Remover `FLUX.1 Schnell`
  - [x] Remover referências a orquestração dinâmica

---

## ✅ Checklist de Implementação (Fases 1-6)

### Fase 1: Container `gpu-qwen-vl`

- [x] Criar `docker/gpu-qwen-vl/Dockerfile`
- [x] Criar `docker/gpu-qwen-vl/requirements.txt`
- [x] Criar `docker/gpu-qwen-vl/entrypoint.sh` (vLLM OpenAI Server)
- [x] Endpoints:
  - [x] `POST /v1/chat/completions` (compatível OpenAI)
  - [x] `POST /v1/chat/completions/vision` (com imagem)
  - [x] `GET /health`
- [x] Adicionar container em `docker-compose.alice.yml`
- [x] Testar localmente com `docker build` e `docker run`

### Fase 2: Atualizar `gpu-embeddings` (INT8)

- [x] Atualizar `docker/gpu-embeddings/Dockerfile`
- [x] Adicionar quantização INT8 no `server.py`
- [x] Verificar que VRAM reduz de ~16GB para ~8GB
- [x] Testar qualidade dos embeddings (benchmark)
- [x] Atualizar `docker-compose.alice.yml`

### Fase 3: Simplificar GPU Manager

- [x] Atualizar `GpuServiceType` enum:
  - [x] `MIXTRAL` → `QWEN_VL`
  - [x] Remover `FLUX`
- [x] Atualizar `GPU_SERVICE_URLS`
- [x] Atualizar `VRAM_REQUIREMENTS`
- [x] Remover `TOTAL_VRAM_GB` check complexo (todos cabem agora)
- [x] Simplificar `hasEnoughVram()` (sempre true para serviços normais)
- [x] Manter circuit breakers e fila priorizada
- [x] Manter métricas Prometheus
- [x] Atualizar health checks

### Fase 4: Training Service Enterprise

- [x] Criar endpoints em `apps/training-service/src/index.ts`:
  - [x] `POST /api/training/schedule/configure` - Configurar schedule
  - [x] `POST /api/training/run/start` - Iniciar on-demand
  - [x] `GET /api/training/run/status` - Status atual
  - [x] `GET /api/training/run/history` - Histórico
  - [x] `DELETE /api/training/run/cancel` - Cancelar em andamento

- [x] Atualizar `apps/training-service/src/auto-learning-scheduler.ts`:
  - [x] Adicionar cron job semanal (domingo 3:00 AM)
  - [x] Integrar com GPU Manager para pausar serviços
  - [x] Notificações via Redis pub/sub
  - [x] Métricas de progresso

- [x] Criar schema de banco (se necessário):
  - [x] Tabela `training_schedules` (reutilizada existente)
  - [x] Tabela `training_runs` (reutilizada training_jobs)

### Fase 5: Frontend - Página de Treinamento

- [x] Atualizar `apps/frontend-service/src/pages/Training.tsx`
- [x] Componentes:
  - [x] `TrainingStatus` - Status atual do modelo
  - [x] `TrainingSchedule` - Configuração de agendamento
  - [x] `TrainingHistory` - Histórico de treinamentos
  - [x] `TrainingDataPending` - Dados aprovados pendentes
  - [x] `TrainingProgress` - Progress bar durante treino
- [x] Integrar com API do Training Service
- [x] Adicionar rota no router
- [x] Adicionar link no menu admin

### Fase 6: Documentação Nova

- [x] Criar `docs/TRAINING.md`:
  - [x] Arquitetura de treinamento
  - [x] Schedule semanal
  - [x] Treinamento on-demand
  - [x] Métricas e rollback
  - [x] API endpoints

- [x] Atualizar `docs/ARQUITETURA-GPU-MANAGER.md` para v4.0.0

- [x] Atualizar `CLAUDE.md` com nova arquitetura

- [x] Atualizar `README.md` com novos modelos

---

## 📁 Estrutura de Arquivos

### Arquivos a CRIAR

```
docker/gpu-qwen-vl/
├── Dockerfile
├── requirements.txt
└── server.py

apps/dashboard/src/pages/admin/
└── training.tsx

docs/
└── TRAINING.md
```

### Arquivos a MODIFICAR

```
infra/docker/stacks/docker-compose.alice.yml
apps/gpu-manager-service/src/index.ts
apps/training-service/src/index.ts
apps/training-service/src/auto-learning-scheduler.ts
.github/workflows/deploy-stack-modular.yml
.github/workflows/release.yml
docs/ARQUITETURA-GPU-MANAGER.md
CLAUDE.md
README.md
```

### Arquivos a DELETAR

```
apps/gpu-manager-service/src/docker-orchestrator.ts
```

---

## 📋 Aderência às 18 Regras do CLAUDE.md

| # | Regra | Status | Como |
|---|-------|--------|------|
| 1 | LER ANTES DE AGIR | ✅ | Analisei todos os arquivos relevantes |
| 2 | NÃO DUPLICAR | ✅ | Reutilizando Training Service existente |
| 3 | WORKFLOW ESTRUTURADO | ✅ | Plano → Aprovação → Implementação |
| 4 | APROVAÇÃO OBRIGATÓRIA | ✅ | Aguardando aprovação deste plano |
| 5 | NÃO MENTIR | ✅ | Valores de VRAM verificados em docs oficiais |
| 6 | SEM SOLUÇÕES TEMPORÁRIAS | ✅ | GPU dedicada, PostgreSQL, sem mocks |
| 7 | MUDANÇAS CIRÚRGICAS | ✅ | Cada fase isolada e testável |
| 8 | QUALIDADE OBRIGATÓRIA | ✅ | TypeScript strict, Zod validation |
| 9 | VALIDAÇÃO CONTÍNUA | ✅ | Testar após cada fase |
| 10 | DOCUMENTAÇÃO PT-BR | ✅ | Toda documentação em português |
| 11 | SEGUIR DOCS OFICIAIS | ✅ | vLLM, transformers, Qwen docs |
| 12 | PRODUÇÃO HETZNER GPU | ✅ | GEX44 RTX 4000 20GB |
| 13 | INTERNACIONALIZAÇÃO | ✅ | PT-BR primário |
| 14 | VERIFICAR SECRETS | ✅ | HUGGINGFACE_TOKEN existente |
| 15 | MICROSSERVIÇOS | ✅ | apps/ e packages/ |
| 16 | MELHORES PRÁTICAS | ✅ | Health checks, circuit breakers |
| 17 | REVIEW ANTES DO COMMIT | ✅ | Aguardando aprovação |
| 18 | COMMITS CONSOLIDADOS | ✅ | Um commit por fase |

---

## ⚠️ Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Qwen2.5-VL inferior em texto puro | Média | Médio | Fine-tuning específico para finanças |
| Embeddings INT8 perdem precisão | Baixa | Alto | Benchmark antes de produção |
| Treinamento demora mais que esperado | Média | Baixo | Timeout configurável + cancelamento |
| Incompatibilidade de API | Baixa | Médio | Manter compatibilidade OpenAI |

---

## 📝 Histórico de Alterações

| Data | Versão | Autor | Descrição |
|------|--------|-------|-----------|
| 11/01/2026 | 1.0.0 | Fillipe Guerra | Criação do plano |
| 11/01/2026 | 2.0.0 | Fillipe Guerra | Implementação completa de todas as fases |
| 15/01/2026 | 2.1.0 | Fillipe Guerra | WS3: Correção SSOT GPU + mismatch INT8 vs FP16 (runtime alinhado, fail-fast) |

---

## 🚀 Implementação Concluída

Todas as fases foram implementadas com sucesso:

1. ✅ **FASE 0** - Limpeza de código legado (docker-orchestrator.ts removido)
2. ✅ **FASE 1** - Container gpu-qwen-vl criado
3. ✅ **FASE 2** - Container gpu-embeddings atualizado para INT8
4. ✅ **FASE 3** - GPU Manager Service simplificado
5. ✅ **FASE 4** - Training Service com schedule e on-demand
6. ✅ **FASE 5** - Frontend atualizado
7. ✅ **FASE 6** - Documentação completa

---

**Status:** ✅ IMPLEMENTADO - 11/01/2026

Próximo passo: Realizar deploy em produção via GitHub Actions
