# Alice Enterprise Platform - Salad Cloud Infrastructure

> **Autor:** Fillipe Guerra  
> **Data:** 17 de Dezembro de 2025  
> **Versão:** 3.0.0 (Python SDK - Pipeline Unificada)

## Visão Geral

Este diretório contém os scripts Python para deploy de Container Groups no Salad Cloud. Os serviços de GPU são deployados automaticamente como parte da pipeline CI/CD unificada (`deploy-production.yml`).

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                        Salad Cloud (GPU)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  Mixtral 8x7B   │  │  ASR Canary     │  │  FLUX.1 Schnell │ │
│  │  (vLLM AWQ)     │  │  (NeMo 1B)      │  │  (Image Gen)    │ │
│  │  RTX 4090 24GB  │  │  RTX 4090 24GB  │  │  RTX 4090 24GB  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │             Embeddings GPU (Enterprise)                    │ │
│  │  Qwen3-Embedding-8B (4096 dim) → Qdrant                   │ │
│  │  OpenCLIP ViT-H/14 (1024 dim) → pgvector                  │ │
│  │  RTX 4090 (24GB VRAM)                                     │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Hetzner Cloud (Core)                        │
│  PostgreSQL, Redis, Qdrant, Traefik, Microsserviços Alice      │
└─────────────────────────────────────────────────────────────────┘
```

## Container Groups

| Serviço | GPU | VRAM | Modelo | Propósito |
|---------|-----|------|--------|-----------|
| **Mixtral 8x7B** | RTX 4090 | 24GB | TheBloke/Mixtral-8x7B-Instruct-v0.1-AWQ | LLM para chat e trading |
| **ASR Canary** | RTX 4090 | 24GB | nvidia/canary-1b | Transcrição de áudio |
| **FLUX.1 Schnell** | RTX 4090 | 24GB | black-forest-labs/FLUX.1-schnell | Geração de imagens |
| **Embeddings GPU** | RTX 4090 | 24GB | Qwen3-Embedding-8B + OpenCLIP | Embeddings texto/imagem |

## Arquivos

```
infra/salad-cloud/
├── config.py      # Configurações dos Container Groups
├── deploy.py      # Script principal de deploy (Python SDK)
├── .gitignore     # Ignora secrets e arquivos temporários
└── README.md      # Esta documentação
```

## Deploy

### Automático (Recomendado)

O deploy é feito automaticamente pela pipeline CI/CD:

```
ci.yml → release.yml → deploy-production.yml
                              ↓
                       deploy-salad-gpu job
```

### Manual (Debug)

```bash
# Configurar variáveis
export SALAD_API_KEY="your-api-key"
export SALAD_ORG="your-organization-id"
export SALAD_PROJECT="your-project-id"
export IMAGE_TAG="sha-abc1234"
export GHCR_TOKEN="ghp_your_token"
export HUGGINGFACE_TOKEN="hf_your_token"

# Executar deploy
python deploy.py
```

## Secrets Necessários (GitHub)

| Secret | Descrição |
|--------|-----------|
| `SALAD_API_KEY` | API Key do Salad Cloud |
| `SALAD_ORGANIZATION_ID` | ID da organização |
| `SALAD_PROJECT_ID` | ID do projeto |
| `HUGGINGFACE_TOKEN` | Token HuggingFace (read) |
| `GH_PAT` | GitHub PAT para autenticação GHCR |

## Arquitetura de Embeddings

| Modalidade | Modelo | Dimensões | Storage | Licença |
|------------|--------|-----------|---------|---------|
| **Texto** | Qwen3-Embedding-8B | 4096 | Qdrant | Apache 2.0 |
| **Imagem** | OpenCLIP ViT-H/14 | 1024 | pgvector | MIT |

## Keep-Warm Strategy

A estratégia "Warm on Demand" mantém as GPUs ativas por 30 minutos após o último request:

1. **Redis Queue**: Embeddings são processados via fila
2. **Heartbeat**: Ping periódico enquanto houver uso
3. **Auto-shutdown**: GPU desliga após 30 min sem uso
4. **Cold start**: ~2-3 min no próximo request após shutdown

## Custos Estimados

| Serviço | GPU | Custo/hora (USD) |
|---------|-----|------------------|
| Mixtral 8x7B | RTX 4090 | ~$0.16 |
| ASR Canary | RTX 4090 | ~$0.16 |
| FLUX.1 Schnell | RTX 4090 | ~$0.16 |
| Embeddings | RTX 4090 | ~$0.16 |

**Com Keep-Warm (uso real):** ~$100-200/mês (depende do uso)

## Troubleshooting

### Container não inicia

1. Verificar logs no portal Salad Cloud
2. Verificar se HuggingFace token é válido
3. Verificar se GPU class está disponível

### Timeout em health check

1. Startup probe tem `initial_delay_seconds` de 120-180s
2. Modelos grandes (Mixtral) precisam de mais tempo
3. Verificar se há VRAM suficiente (24GB)

### Erro de autenticação GHCR

1. Verificar se GH_PAT tem scope `read:packages`
2. Verificar se imagens foram pushed corretamente

---

*Documentação em Português Brasileiro*  
*Total de Containers: 43 (7 infra + 7 Alice + 15 ERPNext + 13 observability + 1 backup)*
