# Alice Enterprise Platform - Salad Cloud Infrastructure

> **Autor:** Fillipe Guerra  
> **Data:** 17 de Dezembro de 2025  
> **Versão:** 1.1.0

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
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Embeddings GPU (Dual-Dimension)                ││
│  │  gte-Qwen2-7B-instruct (3584 dim) + OpenCLIP (1024 dim)    ││
│  │  RTX 4090 (24GB VRAM)                                       ││
│  └─────────────────────────────────────────────────────────────┘│
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
| **ASR Canary** | RTX 4090 | 24GB | Canary-Qwen-2.5B | Transcrição de áudio |
| **FLUX.1 Schnell** | RTX 4090 | 24GB | FLUX.1 Schnell | Geração de imagens |
| **Embeddings GPU** | RTX 4090 | 24GB | gte-Qwen2 + OpenCLIP | Embeddings dual-dimension |

## Arquitetura de Embeddings (Dual-Dimension)

| Modalidade | Modelo | Dimensões | Tipo pgvector | Uso |
|------------|--------|-----------|---------------|-----|
| **Texto (Trading/RAG)** | gte-Qwen2-7B-instruct | 3584 | `halfvec` | Dimensão nativa do modelo |
| **Imagem** | OpenCLIP ViT-H/14 | 1024 | `vector` | Dimensão nativa |

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

## Próximos Passos

1. [ ] Integrar com GitHub Actions para deploy automático
2. [ ] Configurar alertas de custo no Salad Cloud
3. [ ] Implementar autoscaling baseado em métricas
4. [ ] Adicionar backup de state Terraform em S3
