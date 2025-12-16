/**
 * Alice Enterprise Platform - Salad Cloud Outputs
 * 
 * Outputs do Terraform para uso em CI/CD e outros sistemas.
 * 
 * Autor: Fillipe Guerra
 * Data: 16 de Dezembro de 2025
 */

# ============================================================================
# MIXTRAL LLM
# ============================================================================

output "mixtral_endpoint" {
  description = "URL do endpoint Mixtral 8x7B vLLM"
  value       = saladcloud_container_group.mixtral_llm.networking[0].dns
}

output "mixtral_container_group_id" {
  description = "ID do Container Group Mixtral"
  value       = saladcloud_container_group.mixtral_llm.id
}

# ============================================================================
# ASR CANARY
# ============================================================================

output "asr_endpoint" {
  description = "URL do endpoint ASR Canary-Qwen"
  value       = saladcloud_container_group.asr_canary.networking[0].dns
}

output "asr_container_group_id" {
  description = "ID do Container Group ASR"
  value       = saladcloud_container_group.asr_canary.id
}

# ============================================================================
# FLUX IMAGE GENERATION
# ============================================================================

output "flux_endpoint" {
  description = "URL do endpoint FLUX.1 Schnell"
  value       = saladcloud_container_group.flux_image.networking[0].dns
}

output "flux_container_group_id" {
  description = "ID do Container Group FLUX"
  value       = saladcloud_container_group.flux_image.id
}

# ============================================================================
# EMBEDDINGS GPU
# ============================================================================

output "embeddings_endpoint" {
  description = "URL do endpoint Embeddings GPU (Qwen3 + OpenCLIP)"
  value       = saladcloud_container_group.embeddings_gpu.networking[0].dns
}

output "embeddings_container_group_id" {
  description = "ID do Container Group Embeddings"
  value       = saladcloud_container_group.embeddings_gpu.id
}

# ============================================================================
# SUMMARY
# ============================================================================

output "all_endpoints" {
  description = "Todos os endpoints Salad Cloud para configuração"
  value = {
    mixtral    = saladcloud_container_group.mixtral_llm.networking[0].dns
    asr        = saladcloud_container_group.asr_canary.networking[0].dns
    flux       = saladcloud_container_group.flux_image.networking[0].dns
    embeddings = saladcloud_container_group.embeddings_gpu.networking[0].dns
  }
}

output "environment_variables" {
  description = "Variáveis de ambiente para Hetzner (copiar para .env)"
  value = <<-EOT
    # Salad Cloud Endpoints (gerado por Terraform)
    SALAD_MIXTRAL_URL=${saladcloud_container_group.mixtral_llm.networking[0].dns}
    SALAD_ASR_URL=${saladcloud_container_group.asr_canary.networking[0].dns}
    SALAD_FLUX_URL=${saladcloud_container_group.flux_image.networking[0].dns}
    SALAD_EMBEDDINGS_URL=${saladcloud_container_group.embeddings_gpu.networking[0].dns}
  EOT
}
