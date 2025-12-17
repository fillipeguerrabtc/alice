# Alice Enterprise Platform - Salad Cloud Infrastructure

> **Autor:** Fillipe Guerra  
> **Data:** 17 de Dezembro de 2025  
> **Versão:** 2.0.0 (Integração completa com GitHub Actions)

## Visão Geral

Este diretório contém a infraestrutura como código (IaC) para os Container Groups do Salad Cloud, que hospedam os serviços de GPU da plataforma Alice.

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                        Salad Cloud (GPU)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  Mixtral 8x7B   │  │  ASR Canary     │  │  FLUX.1 Schnell │ │
│  │  (vLLM)         │  │  (Qwen-2.5B)    │  │  (Image Gen)    │ │
│  │  RTX 4090       │  │  RTX 4090       │  │  RTX 4090       │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────────┐│
│  │             Embeddings GPU (Enterprise)                      ││
│  │  Qwen3-Embedding-8B (4096 dim) → Qdrant                      ││
│  │  OpenCLIP ViT-H/14 (1024 dim) → pgvector                     ││
│  │  RTX 4090 (24GB VRAM)                                        ││
│  └───────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Hetzner Cloud (Core)                        │
│  PostgreSQL, Redis, Traefik, Microsserviços Alice              │
└─────────────────────────────────────────────────────────────────┘
```

## Container Groups

| Serviço | GPU | VRAM | Modelo | Propósito |
|---------|-----|------|--------|-----------|
| **Mixtral 8x7B** | RTX 4090 | 24GB | vLLM quantizado 4-bit | LLM para chat e trading |
| **ASR Canary** | RTX 4090 | 24GB | Canary-1B (NeMo) | Transcrição de áudio |
| **FLUX.1 Schnell** | RTX 4090 | 24GB | FLUX.1 Schnell | Geração de imagens |
| **Embeddings GPU** | RTX 4090 | 24GB | Qwen3-Embedding-8B + OpenCLIP | Embeddings texto (4096 → Qdrant) + imagem (1024 → pgvector) |

## Arquitetura de Embeddings (Enterprise)

| Modalidade | Modelo | Dimensões | Storage | Licença |
|------------|--------|-----------|---------|---------|
| **Texto (Trading/RAG)** | Qwen3-Embedding-8B | 4096 | **Qdrant** | Apache 2.0 |
| **Imagem** | OpenCLIP ViT-H/14 | 1024 | PostgreSQL `vector` | MIT |

> **Por que Qdrant para Texto:**
> - pgvector HNSW suporta máx 4000 dim para halfvec
> - Qdrant suporta HNSW com 4096+ dimensões
> - Qwen3-Embedding-8B (8B params, 4096 dim) oferece máxima qualidade

## Pré-requisitos

1. **Terraform** >= 1.0.0
2. **Conta Salad Cloud** com API Key
3. **HuggingFace Token** para download de modelos
4. **GitHub Container Registry** acesso para push de imagens

## Configuração

### 1. Copiar arquivo de variáveis

```bash
cp terraform.tfvars.example terraform.tfvars
```

### 2. Preencher variáveis

```hcl
# terraform.tfvars
salad_api_key         = "YOUR_SALAD_API_KEY"
salad_organization_id = "your-org-id"
salad_project_id      = "alice-platform"
huggingface_token     = "hf_YOUR_TOKEN"
environment           = "production"
```

### 3. Inicializar Terraform

```bash
terraform init
```

### 4. Validar configuração

```bash
terraform validate
terraform plan
```

### 5. Aplicar infraestrutura

```bash
terraform apply
```

## Deploy via Script (Alternativa)

Para deploys rápidos sem Terraform:

```bash
# Configurar variáveis de ambiente
export SALAD_API_KEY="your-api-key"
export SALAD_ORGANIZATION_ID="your-org-id"
export SALAD_PROJECT_ID="alice-platform"
export HUGGINGFACE_TOKEN="hf_your_token"

# Deploy de todos os serviços
./scripts/deploy.sh production all

# Deploy de serviço específico
./scripts/deploy.sh production mixtral
./scripts/deploy.sh production embeddings
```

## Outputs

Após `terraform apply`, os seguintes outputs estarão disponíveis:

```bash
# Ver todos os outputs
terraform output

# Ver endpoints específicos
terraform output mixtral_endpoint
terraform output embeddings_endpoint
terraform output all_endpoints
```

## Variáveis de Ambiente para Hetzner

Copie os outputs para o arquivo `.env.prod` no servidor Hetzner:

```bash
terraform output environment_variables
```

## Keep-Warm Strategy

A estratégia "Warm on Demand" mantém as GPUs ativas por 30 minutos após o último request:

1. **Redis Queue**: Embeddings são processados via fila
2. **Heartbeat**: Ping periódico enquanto houver uso
3. **Auto-shutdown**: GPU desliga após 30 min sem uso
4. **Cold start**: ~2-5 min no próximo request após shutdown

## Custos Estimados

| Serviço | GPU | Custo/hora (USD) | Custo/mês (24x7) |
|---------|-----|------------------|------------------|
| Mixtral 8x7B | RTX 4090 | ~$0.25 | ~$180 |
| ASR Canary | RTX 4090 | ~$0.25 | ~$180 |
| FLUX.1 Schnell | RTX 4090 | ~$0.25 | ~$180 |
| Embeddings | RTX 4090 | ~$0.25 | ~$180 |

**Total estimado (24x7):** ~$720/mês  
**Com Keep-Warm (uso real):** ~$150-300/mês (depende do uso)

## Troubleshooting

### Container não inicia

1. Verificar logs no portal Salad Cloud
2. Verificar se HuggingFace token é válido
3. Verificar se GPU class está disponível

### Timeout em health check

1. Aumentar `initial_delay_seconds` (modelos grandes demoram a carregar)
2. Verificar se há VRAM suficiente

### Erro de autenticação

1. Verificar API Key do Salad Cloud
2. Verificar se organization/project IDs estão corretos

## Arquivos

```
infra/salad-cloud/
├── main.tf              # Recursos principais (Container Groups)
├── variables.tf         # Variáveis de configuração
├── outputs.tf           # Outputs para CI/CD
├── terraform.tfvars.example  # Exemplo de configuração
├── scripts/
│   └── deploy.sh        # Script de deploy alternativo (API)
└── README.md            # Esta documentação
```

## Segurança

- **NUNCA** commite `terraform.tfvars` com secrets reais
- Use variáveis de ambiente ou secrets manager em CI/CD
- Todos os endpoints requerem autenticação (`auth: true`)
- HuggingFace token com escopo mínimo (read-only)

## Pipeline GitHub Actions (100% Automatizado)

O workflow `.github/workflows/deploy-salad-gpu.yml` automatiza:

1. **Build de imagens GPU** (GHCR)
2. **Terraform Plan/Apply** (Container Groups)
3. **Captura de endpoints** (outputs)
4. **Atualização de `.env.prod`** no Hetzner via SSH

### Secrets Necessários no GitHub

| Secret | Descrição |
|--------|-----------|
| `SALAD_API_KEY` | API Key do Salad Cloud |
| `SALAD_ORGANIZATION_ID` | ID da organização |
| `SALAD_PROJECT_ID` | ID do projeto |
| `HUGGINGFACE_TOKEN` | Token HuggingFace (read) |
| `HETZNER_SSH_PRIVATE_KEY` | Chave SSH para deploy |
| `HETZNER_VM_HOST` | IP do servidor Hetzner |

### Endpoints Gerados (salvos em GitHub Secrets)

| Secret | Descrição |
|--------|-----------|
| `SALAD_MIXTRAL_URL` | vLLM Mixtral 8x7B (`/v1/chat/completions`) |
| `SALAD_FLUX_URL` | FLUX.1 Schnell (`/generate`) |
| `SALAD_ASR_URL` | Canary ASR (`/transcribe`) |
| `EMBEDDINGS_GPU_URL` | Embeddings (`/embed/text`, `/embed/image`) |

## Próximos Passos

1. [x] ~~Integrar com GitHub Actions para deploy automático~~ ✅ Implementado
2. [ ] Configurar alertas de custo no Salad Cloud
3. [ ] Implementar autoscaling baseado em métricas
4. [ ] Adicionar backup de state Terraform remoto (S3/Terraform Cloud)
