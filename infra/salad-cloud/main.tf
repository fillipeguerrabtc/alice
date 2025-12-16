/**
 * Alice Enterprise Platform - Salad Cloud Infrastructure as Code
 * 
 * Terraform configuration para Container Groups GPU no Salad Cloud:
 * - Mixtral 8x7B (vLLM) - LLM principal para chat e trading
 * - ASR Canary-Qwen-2.5B - Transcrição de áudio
 * - FLUX.1 Schnell - Geração de imagens
 * - Embeddings Dual-Dimension - Qwen3 (texto 4096) + OpenCLIP (imagem 1024)
 * 
 * Autor: Fillipe Guerra
 * Data: 16 de Dezembro de 2025
 * Documentação em PT-BR (Regra 10 CLAUDE.md)
 */

terraform {
  required_version = ">= 1.0.0"

  required_providers {
    saladcloud = {
      source  = "saladtechnologies/saladcloud"
      version = ">= 0.9.0"
    }
  }

  # Backend para state remoto (opcional - pode usar local para início)
  # backend "s3" {
  #   bucket = "alice-terraform-state"
  #   key    = "salad-cloud/terraform.tfstate"
  #   region = "eu-central-1"
  # }
}

# ============================================================================
# PROVIDER CONFIGURATION
# ============================================================================

provider "saladcloud" {
  api_key = var.salad_api_key
}

# ============================================================================
# DATA SOURCES
# ============================================================================

# Buscar GPU classes disponíveis
data "saladcloud_gpu_classes" "available" {}

# ============================================================================
# LOCALS
# ============================================================================

locals {
  # Tags comuns para todos os recursos
  common_labels = {
    project     = "alice"
    environment = var.environment
    managed_by  = "terraform"
    created_at  = timestamp()
  }

  # GPU class para RTX 4090 (24GB VRAM)
  # Verificar ID correto via API: GET /organizations/{org}/gpu-classes
  rtx_4090_gpu_class = "rtx4090-24gb"

  # Configuração de réplicas por ambiente
  replicas = {
    production = {
      mixtral    = 1  # vLLM serve múltiplas requests concorrentes
      asr        = 1  # ASR pode escalar sob demanda
      flux       = 1  # Image gen sob demanda
      embeddings = 1  # Embeddings GPU
    }
    staging = {
      mixtral    = 1
      asr        = 1
      flux       = 1
      embeddings = 1
    }
  }
}

# ============================================================================
# CONTAINER GROUP: MIXTRAL 8x7B (vLLM)
# ============================================================================

resource "saladcloud_container_group" "mixtral_llm" {
  name             = "alice-mixtral-8x7b-${var.environment}"
  organization_id  = var.salad_organization_id
  project_id       = var.salad_project_id
  display_name     = "Alice Mixtral 8x7B LLM (${var.environment})"

  container {
    image = var.mixtral_image

    resources {
      cpu    = 4
      memory = 16384  # 16GB RAM
      gpu_classes = [local.rtx_4090_gpu_class]
    }

    environment_variables = {
      # vLLM Configuration
      MODEL_NAME              = "mistralai/Mixtral-8x7B-Instruct-v0.1"
      QUANTIZATION            = "awq"  # 4-bit quantization
      MAX_MODEL_LEN           = "32768"
      GPU_MEMORY_UTILIZATION  = "0.95"
      TENSOR_PARALLEL_SIZE    = "1"
      
      # API Configuration
      PORT                    = "8000"
      HOST                    = "0.0.0.0"
      
      # HuggingFace Token (para download do modelo)
      HUGGING_FACE_HUB_TOKEN  = var.huggingface_token
      
      # Observability
      ENABLE_METRICS          = "true"
      LOG_LEVEL               = "INFO"
    }

    # Comando para iniciar vLLM
    command = [
      "python", "-m", "vllm.entrypoints.openai.api_server",
      "--model", "mistralai/Mixtral-8x7B-Instruct-v0.1",
      "--quantization", "awq",
      "--max-model-len", "32768",
      "--gpu-memory-utilization", "0.95",
      "--host", "0.0.0.0",
      "--port", "8000"
    ]
  }

  # Networking
  networking {
    protocol = "http"
    port     = 8000
    auth     = true  # Requer autenticação
  }

  # Autoscaling
  replicas = local.replicas[var.environment].mixtral

  # Probes
  liveness_probe {
    http {
      path = "/health"
      port = 8000
    }
    initial_delay_seconds = 120  # Modelo demora a carregar
    period_seconds        = 30
    timeout_seconds       = 10
    failure_threshold     = 3
  }

  readiness_probe {
    http {
      path = "/health"
      port = 8000
    }
    initial_delay_seconds = 120
    period_seconds        = 10
    timeout_seconds       = 5
    failure_threshold     = 3
  }

  # Keep-warm strategy
  startup_probe {
    http {
      path = "/health"
      port = 8000
    }
    initial_delay_seconds = 60
    period_seconds        = 10
    timeout_seconds       = 5
    failure_threshold     = 30  # 5 minutos para inicialização
  }

  labels = merge(local.common_labels, {
    service = "mixtral-llm"
    gpu     = "rtx4090"
  })
}

# ============================================================================
# CONTAINER GROUP: ASR CANARY-QWEN-2.5B
# ============================================================================

resource "saladcloud_container_group" "asr_canary" {
  name             = "alice-asr-canary-${var.environment}"
  organization_id  = var.salad_organization_id
  project_id       = var.salad_project_id
  display_name     = "Alice ASR Canary-Qwen-2.5B (${var.environment})"

  container {
    image = var.asr_image

    resources {
      cpu    = 2
      memory = 8192  # 8GB RAM
      gpu_classes = [local.rtx_4090_gpu_class]
    }

    environment_variables = {
      # Model Configuration
      MODEL_NAME              = "nvidia/canary-1b"  # ou Qwen ASR
      DEVICE                  = "cuda"
      
      # API Configuration
      PORT                    = "8000"
      HOST                    = "0.0.0.0"
      
      # HuggingFace Token
      HUGGING_FACE_HUB_TOKEN  = var.huggingface_token
      
      # Observability
      ENABLE_METRICS          = "true"
      LOG_LEVEL               = "INFO"
    }
  }

  networking {
    protocol = "http"
    port     = 8000
    auth     = true
  }

  replicas = local.replicas[var.environment].asr

  liveness_probe {
    http {
      path = "/health"
      port = 8000
    }
    initial_delay_seconds = 60
    period_seconds        = 30
    timeout_seconds       = 10
    failure_threshold     = 3
  }

  readiness_probe {
    http {
      path = "/ready"
      port = 8000
    }
    initial_delay_seconds = 60
    period_seconds        = 10
    timeout_seconds       = 5
    failure_threshold     = 3
  }

  labels = merge(local.common_labels, {
    service = "asr-canary"
    gpu     = "rtx4090"
  })
}

# ============================================================================
# CONTAINER GROUP: FLUX.1 SCHNELL (Image Generation)
# ============================================================================

resource "saladcloud_container_group" "flux_image" {
  name             = "alice-flux-schnell-${var.environment}"
  organization_id  = var.salad_organization_id
  project_id       = var.salad_project_id
  display_name     = "Alice FLUX.1 Schnell Image Gen (${var.environment})"

  container {
    image = var.flux_image

    resources {
      cpu    = 2
      memory = 16384  # 16GB RAM
      gpu_classes = [local.rtx_4090_gpu_class]
    }

    environment_variables = {
      # Model Configuration
      MODEL_NAME              = "black-forest-labs/FLUX.1-schnell"
      DEVICE                  = "cuda"
      NUM_INFERENCE_STEPS     = "4"  # Schnell é rápido
      
      # API Configuration
      PORT                    = "8000"
      HOST                    = "0.0.0.0"
      
      # HuggingFace Token
      HUGGING_FACE_HUB_TOKEN  = var.huggingface_token
      
      # Observability
      ENABLE_METRICS          = "true"
      LOG_LEVEL               = "INFO"
    }
  }

  networking {
    protocol = "http"
    port     = 8000
    auth     = true
  }

  replicas = local.replicas[var.environment].flux

  liveness_probe {
    http {
      path = "/health"
      port = 8000
    }
    initial_delay_seconds = 90
    period_seconds        = 30
    timeout_seconds       = 10
    failure_threshold     = 3
  }

  readiness_probe {
    http {
      path = "/ready"
      port = 8000
    }
    initial_delay_seconds = 90
    period_seconds        = 10
    timeout_seconds       = 5
    failure_threshold     = 3
  }

  labels = merge(local.common_labels, {
    service = "flux-image"
    gpu     = "rtx4090"
  })
}

# ============================================================================
# CONTAINER GROUP: EMBEDDINGS (Qwen3 + OpenCLIP) - Dual-Dimension
# ============================================================================

resource "saladcloud_container_group" "embeddings_gpu" {
  name             = "alice-embeddings-gpu-${var.environment}"
  organization_id  = var.salad_organization_id
  project_id       = var.salad_project_id
  display_name     = "Alice Embeddings GPU Dual-Dimension (${var.environment})"

  container {
    image = var.embeddings_image

    resources {
      cpu    = 4
      memory = 16384  # 16GB RAM
      gpu_classes = [local.rtx_4090_gpu_class]
    }

    environment_variables = {
      # Text Embeddings (4096 dim) - Trading/RAG
      TEXT_MODEL_NAME         = "Alibaba-NLP/gte-Qwen2-7B-instruct"  # Ou Qwen3-Embedding-8B
      TEXT_EMBEDDING_DIM      = "4096"
      
      # Image Embeddings (1024 dim)
      IMAGE_MODEL_NAME        = "laion/CLIP-ViT-H-14-laion2B-s32B-b79K"
      IMAGE_EMBEDDING_DIM     = "1024"
      
      # Device Configuration
      DEVICE                  = "cuda"
      
      # API Configuration
      PORT                    = "8000"
      HOST                    = "0.0.0.0"
      
      # HuggingFace Token
      HUGGING_FACE_HUB_TOKEN  = var.huggingface_token
      
      # Observability
      ENABLE_METRICS          = "true"
      LOG_LEVEL               = "INFO"
      
      # Keep-warm (30 min)
      KEEP_WARM_MINUTES       = "30"
    }
  }

  networking {
    protocol = "http"
    port     = 8000
    auth     = true
  }

  replicas = local.replicas[var.environment].embeddings

  liveness_probe {
    http {
      path = "/health"
      port = 8000
    }
    initial_delay_seconds = 90
    period_seconds        = 30
    timeout_seconds       = 10
    failure_threshold     = 3
  }

  readiness_probe {
    http {
      path = "/ready"
      port = 8000
    }
    initial_delay_seconds = 90
    period_seconds        = 10
    timeout_seconds       = 5
    failure_threshold     = 3
  }

  labels = merge(local.common_labels, {
    service = "embeddings-gpu"
    gpu     = "rtx4090"
    architecture = "dual-dimension"
  })
}
