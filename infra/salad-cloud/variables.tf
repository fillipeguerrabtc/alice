/**
 * Alice Enterprise Platform - Salad Cloud Variables
 * 
 * Variáveis de configuração para Terraform Salad Cloud.
 * 
 * Autor: Fillipe Guerra
 * Data: 16 de Dezembro de 2025
 */

# ============================================================================
# SALAD CLOUD CREDENTIALS
# ============================================================================

variable "salad_api_key" {
  description = "API Key do Salad Cloud (obter em portal.salad.com)"
  type        = string
  sensitive   = true
}

variable "salad_organization_id" {
  description = "ID da organização no Salad Cloud"
  type        = string
}

variable "salad_project_id" {
  description = "ID do projeto no Salad Cloud"
  type        = string
}

# ============================================================================
# ENVIRONMENT
# ============================================================================

variable "environment" {
  description = "Ambiente de deploy (production, staging)"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging"], var.environment)
    error_message = "Environment deve ser 'production' ou 'staging'."
  }
}

# ============================================================================
# HUGGINGFACE
# ============================================================================

variable "huggingface_token" {
  description = "Token do HuggingFace para download de modelos"
  type        = string
  sensitive   = true
}

# ============================================================================
# CONTAINER IMAGES
# ============================================================================

variable "mixtral_image" {
  description = "Imagem Docker para Mixtral 8x7B vLLM"
  type        = string
  default     = "ghcr.io/alice-platform/mixtral-vllm:latest"
}

variable "asr_image" {
  description = "Imagem Docker para ASR Canary-Qwen"
  type        = string
  default     = "ghcr.io/alice-platform/asr-canary:latest"
}

variable "flux_image" {
  description = "Imagem Docker para FLUX.1 Schnell"
  type        = string
  default     = "ghcr.io/alice-platform/flux-schnell:latest"
}

variable "embeddings_image" {
  description = "Imagem Docker para Embeddings GPU (Qwen3 + OpenCLIP)"
  type        = string
  default     = "ghcr.io/alice-platform/embeddings-gpu:latest"
}

# ============================================================================
# NETWORKING
# ============================================================================

variable "enable_public_access" {
  description = "Habilitar acesso público aos endpoints (requer auth)"
  type        = bool
  default     = true
}

# ============================================================================
# SCALING
# ============================================================================

variable "min_replicas" {
  description = "Número mínimo de réplicas por container group"
  type        = number
  default     = 1
}

variable "max_replicas" {
  description = "Número máximo de réplicas por container group"
  type        = number
  default     = 3
}

# ============================================================================
# KEEP-WARM STRATEGY
# ============================================================================

variable "keep_warm_minutes" {
  description = "Minutos para manter GPU ativa após último request"
  type        = number
  default     = 30
}
