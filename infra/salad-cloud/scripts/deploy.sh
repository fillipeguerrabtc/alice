#!/bin/bash
# ============================================================================
# Alice Enterprise Platform - Salad Cloud Deploy Script
# ============================================================================
# Script alternativo usando Salad Cloud API diretamente (sem Terraform)
# Útil para CI/CD ou deploys rápidos.
#
# Uso: ./deploy.sh [environment] [service]
#   environment: production, staging
#   service: mixtral, asr, flux, embeddings, all
#
# Autor: Fillipe Guerra
# Data: 16 de Dezembro de 2025
# ============================================================================

set -euo pipefail

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuração
ENVIRONMENT="${1:-production}"
SERVICE="${2:-all}"
API_BASE="https://api.salad.com/api/public"

# Variáveis de ambiente necessárias
: "${SALAD_API_KEY:?SALAD_API_KEY não definida}"
: "${SALAD_ORGANIZATION_ID:?SALAD_ORGANIZATION_ID não definida}"
: "${SALAD_PROJECT_ID:?SALAD_PROJECT_ID não definida}"
: "${HUGGINGFACE_TOKEN:?HUGGINGFACE_TOKEN não definida}"

echo -e "${GREEN}=== Alice Salad Cloud Deploy ===${NC}"
echo -e "Environment: ${YELLOW}${ENVIRONMENT}${NC}"
echo -e "Service: ${YELLOW}${SERVICE}${NC}"
echo ""

# Função para criar/atualizar container group
deploy_service() {
    local name=$1
    local config_file=$2
    
    echo -e "${YELLOW}Deploying ${name}...${NC}"
    
    # Verificar se container group existe
    response=$(curl -s -w "%{http_code}" -o /tmp/cg_response.json \
        -H "Salad-Api-Key: ${SALAD_API_KEY}" \
        "${API_BASE}/organizations/${SALAD_ORGANIZATION_ID}/projects/${SALAD_PROJECT_ID}/containers/${name}")
    
    http_code="${response: -3}"
    
    if [ "$http_code" == "200" ]; then
        echo -e "${GREEN}Container group ${name} exists, updating...${NC}"
        method="PUT"
    else
        echo -e "${GREEN}Creating new container group ${name}...${NC}"
        method="POST"
    fi
    
    # Enviar configuração
    # Bug fix: Sintaxe bash corrigida (${} é para expansão, não condicional)
    local url_suffix=""
    if [ "$method" == "PUT" ]; then
        url_suffix="/${name}"
    fi
    
    curl -s -X ${method} \
        -H "Salad-Api-Key: ${SALAD_API_KEY}" \
        -H "Content-Type: application/json" \
        -d @"${config_file}" \
        "${API_BASE}/organizations/${SALAD_ORGANIZATION_ID}/projects/${SALAD_PROJECT_ID}/containers${url_suffix}"
    
    echo -e "${GREEN}✓ ${name} deployed${NC}"
}

# Gerar configuração JSON para Mixtral
generate_mixtral_config() {
    cat > /tmp/mixtral_config.json << EOF
{
    "name": "alice-mixtral-8x7b-${ENVIRONMENT}",
    "display_name": "Alice Mixtral 8x7B LLM",
    "container": {
        "image": "${MIXTRAL_IMAGE:-ghcr.io/alice-platform/mixtral-vllm:latest}",
        "resources": {
            "cpu": 4,
            "memory": 16384,
            "gpu_classes": ["rtx4090-24gb"]
        },
        "environment_variables": {
            "MODEL_NAME": "TheBloke/Mixtral-8x7B-Instruct-v0.1-AWQ",
            "QUANTIZATION": "awq",
            "MAX_MODEL_LEN": "32768",
            "GPU_MEMORY_UTILIZATION": "0.95",
            "HUGGING_FACE_HUB_TOKEN": "${HUGGINGFACE_TOKEN}",
            "PORT": "8000",
            "HOST": "0.0.0.0"
        },
        "command": ["python", "-m", "vllm.entrypoints.openai.api_server", "--model", "TheBloke/Mixtral-8x7B-Instruct-v0.1-AWQ", "--quantization", "awq", "--port", "8000"]
    },
    "networking": {
        "protocol": "http",
        "port": 8000,
        "auth": true
    },
    "replicas": 1,
    "liveness_probe": {
        "http": {"path": "/health", "port": 8000},
        "initial_delay_seconds": 120,
        "period_seconds": 30
    }
}
EOF
}

# Gerar configuração JSON para ASR
generate_asr_config() {
    cat > /tmp/asr_config.json << EOF
{
    "name": "alice-asr-canary-${ENVIRONMENT}",
    "display_name": "Alice ASR Canary-Qwen",
    "container": {
        "image": "${ASR_IMAGE:-ghcr.io/alice-platform/asr-canary:latest}",
        "resources": {
            "cpu": 2,
            "memory": 8192,
            "gpu_classes": ["rtx4090-24gb"]
        },
        "environment_variables": {
            "MODEL_NAME": "nvidia/canary-1b",
            "DEVICE": "cuda",
            "HUGGING_FACE_HUB_TOKEN": "${HUGGINGFACE_TOKEN}",
            "PORT": "8000"
        }
    },
    "networking": {
        "protocol": "http",
        "port": 8000,
        "auth": true
    },
    "replicas": 1
}
EOF
}

# Gerar configuração JSON para FLUX
generate_flux_config() {
    cat > /tmp/flux_config.json << EOF
{
    "name": "alice-flux-schnell-${ENVIRONMENT}",
    "display_name": "Alice FLUX.1 Schnell",
    "container": {
        "image": "${FLUX_IMAGE:-ghcr.io/alice-platform/flux-schnell:latest}",
        "resources": {
            "cpu": 2,
            "memory": 16384,
            "gpu_classes": ["rtx4090-24gb"]
        },
        "environment_variables": {
            "MODEL_NAME": "black-forest-labs/FLUX.1-schnell",
            "NUM_INFERENCE_STEPS": "4",
            "HUGGING_FACE_HUB_TOKEN": "${HUGGINGFACE_TOKEN}",
            "PORT": "8000"
        }
    },
    "networking": {
        "protocol": "http",
        "port": 8000,
        "auth": true
    },
    "replicas": 1
}
EOF
}

# Gerar configuração JSON para Embeddings
generate_embeddings_config() {
    cat > /tmp/embeddings_config.json << EOF
{
    "name": "alice-embeddings-gpu-${ENVIRONMENT}",
    "display_name": "Alice Embeddings GPU Dual-Dimension",
    "container": {
        "image": "${EMBEDDINGS_IMAGE:-ghcr.io/alice-platform/embeddings-gpu:latest}",
        "resources": {
            "cpu": 4,
            "memory": 16384,
            "gpu_classes": ["rtx4090-24gb"]
        },
        "environment_variables": {
            "TEXT_MODEL_NAME": "Alibaba-NLP/gte-Qwen2-7B-instruct",
            "TEXT_EMBEDDING_DIM": "4096",
            "IMAGE_MODEL_NAME": "laion/CLIP-ViT-H-14-laion2B-s32B-b79K",
            "IMAGE_EMBEDDING_DIM": "1024",
            "DEVICE": "cuda",
            "HUGGING_FACE_HUB_TOKEN": "${HUGGINGFACE_TOKEN}",
            "PORT": "8000",
            "KEEP_WARM_MINUTES": "30"
        }
    },
    "networking": {
        "protocol": "http",
        "port": 8000,
        "auth": true
    },
    "replicas": 1
}
EOF
}

# Deploy baseado no serviço solicitado
case "$SERVICE" in
    mixtral)
        generate_mixtral_config
        deploy_service "alice-mixtral-8x7b-${ENVIRONMENT}" /tmp/mixtral_config.json
        ;;
    asr)
        generate_asr_config
        deploy_service "alice-asr-canary-${ENVIRONMENT}" /tmp/asr_config.json
        ;;
    flux)
        generate_flux_config
        deploy_service "alice-flux-schnell-${ENVIRONMENT}" /tmp/flux_config.json
        ;;
    embeddings)
        generate_embeddings_config
        deploy_service "alice-embeddings-gpu-${ENVIRONMENT}" /tmp/embeddings_config.json
        ;;
    all)
        generate_mixtral_config
        generate_asr_config
        generate_flux_config
        generate_embeddings_config
        
        deploy_service "alice-mixtral-8x7b-${ENVIRONMENT}" /tmp/mixtral_config.json
        deploy_service "alice-asr-canary-${ENVIRONMENT}" /tmp/asr_config.json
        deploy_service "alice-flux-schnell-${ENVIRONMENT}" /tmp/flux_config.json
        deploy_service "alice-embeddings-gpu-${ENVIRONMENT}" /tmp/embeddings_config.json
        ;;
    *)
        echo -e "${RED}Service inválido: ${SERVICE}${NC}"
        echo "Opções: mixtral, asr, flux, embeddings, all"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}=== Deploy concluído ===${NC}"
