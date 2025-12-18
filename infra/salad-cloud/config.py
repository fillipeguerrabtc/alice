"""
Alice Enterprise Platform - Salad Cloud Configuration
=====================================================

Configuracoes enterprise para os 4 Container Groups de GPU.
Usa RTX 4090 (24GB VRAM) para todos os servicos.

ARQUITETURA ENTERPRISE (17/12/2025):
- Mixtral 8x7B vLLM: LLM principal (AWQ quantizado)
- ASR Canary-1B: Transcricao de audio
- FLUX.1 Schnell: Geracao de imagens
- Embeddings GPU: Qwen3-Embedding-8B + OpenCLIP

Autor: Fillipe Guerra
Data: 17 de Dezembro de 2025
"""

import os
from dataclasses import dataclass
from typing import Optional

# =============================================================================
# CONSTANTES
# =============================================================================

# GPU Class ID para RTX 4090 (24GB VRAM)
# Fonte: https://docs.salad.com/products/sce/gpu-classes
RTX_4090_GPU_CLASS = "9998fe42-04a5-4807-b3a5-849943f16c38"

# Health probe defaults
DEFAULT_STARTUP_PROBE_INITIAL_DELAY = 120  # 2 minutos para cold start GPU
DEFAULT_LIVENESS_PROBE_PERIOD = 30
DEFAULT_LIVENESS_PROBE_TIMEOUT = 10

# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class ContainerGroupConfig:
    """Configuracao de um Container Group no Salad Cloud."""
    
    name: str
    display_name: str
    image: str
    port: int
    cpu: int
    memory: int  # GB
    gpu_class: str
    replicas: int
    env_vars: dict
    startup_probe_path: str = "/health"
    liveness_probe_path: str = "/health"
    startup_initial_delay: int = DEFAULT_STARTUP_PROBE_INITIAL_DELAY
    liveness_period: int = DEFAULT_LIVENESS_PROBE_PERIOD
    liveness_timeout: int = DEFAULT_LIVENESS_PROBE_TIMEOUT
    command: Optional[list] = None


# =============================================================================
# CONFIGURACOES DOS CONTAINER GROUPS
# =============================================================================

def get_container_groups(
    image_tag: str,
    ghcr_username: str,
    ghcr_token: str,
    huggingface_token: str,
) -> list[ContainerGroupConfig]:
    """
    Retorna configuracoes dos 4 Container Groups de GPU.
    
    Args:
        image_tag: Tag das imagens Docker (SHA do commit)
        ghcr_username: Username para autenticacao GHCR
        ghcr_token: Token PAT para autenticacao GHCR
        huggingface_token: Token para download de modelos HuggingFace
    
    Returns:
        Lista de configuracoes de Container Groups
    """
    
    # Prefixo das imagens no GHCR
    image_prefix = f"ghcr.io/{ghcr_username}/alice"
    
    return [
        # =====================================================================
        # Mixtral 8x7B vLLM - LLM Principal
        # =====================================================================
        ContainerGroupConfig(
            name="alice-mixtral-vllm",
            display_name="Alice Mixtral 8x7B vLLM",
            image=f"{image_prefix}-mixtral-vllm:{image_tag}",
            port=8000,
            cpu=4,
            memory=16,
            gpu_class=RTX_4090_GPU_CLASS,
            replicas=1,
            env_vars={
                "MODEL_NAME": "TheBloke/Mixtral-8x7B-Instruct-v0.1-AWQ",
                "QUANTIZATION": "awq",
                "MAX_MODEL_LEN": "32768",
                "GPU_MEMORY_UTILIZATION": "0.95",
                "TENSOR_PARALLEL_SIZE": "1",
                "HOST": "0.0.0.0",
                "PORT": "8000",
                "HUGGINGFACE_TOKEN": huggingface_token,
            },
            startup_initial_delay=180,  # 3 minutos para carregar modelo grande
        ),
        
        # =====================================================================
        # ASR Canary-1B - Transcricao de Audio
        # =====================================================================
        ContainerGroupConfig(
            name="alice-asr-canary",
            display_name="Alice ASR Canary-1B",
            image=f"{image_prefix}-asr-canary:{image_tag}",
            port=8000,
            cpu=2,
            memory=8,
            gpu_class=RTX_4090_GPU_CLASS,
            replicas=1,
            env_vars={
                "MODEL_NAME": "nvidia/canary-1b",
                "HOST": "0.0.0.0",
                "PORT": "8000",
                "HUGGINGFACE_TOKEN": huggingface_token,
            },
            startup_initial_delay=120,
        ),
        
        # =====================================================================
        # FLUX.1 Schnell - Geracao de Imagens
        # =====================================================================
        ContainerGroupConfig(
            name="alice-flux-schnell",
            display_name="Alice FLUX.1 Schnell",
            image=f"{image_prefix}-flux-schnell:{image_tag}",
            port=8000,
            cpu=2,
            memory=16,
            gpu_class=RTX_4090_GPU_CLASS,
            replicas=1,
            env_vars={
                "MODEL_NAME": "black-forest-labs/FLUX.1-schnell",
                "HOST": "0.0.0.0",
                "PORT": "8000",
                "HUGGINGFACE_TOKEN": huggingface_token,
            },
            startup_initial_delay=120,
        ),
        
        # =====================================================================
        # Embeddings GPU - Qwen3-Embedding-8B + OpenCLIP
        # =====================================================================
        ContainerGroupConfig(
            name="alice-embeddings-gpu",
            display_name="Alice Embeddings GPU",
            image=f"{image_prefix}-embeddings-gpu:{image_tag}",
            port=8000,
            cpu=4,
            memory=16,
            gpu_class=RTX_4090_GPU_CLASS,
            replicas=1,
            env_vars={
                "TEXT_MODEL": "Qwen/Qwen3-Embedding-8B",
                "IMAGE_MODEL": "laion/CLIP-ViT-H-14-laion2B-s32B-b79K",
                "TEXT_EMBEDDING_DIM": "4096",
                "IMAGE_EMBEDDING_DIM": "1024",
                "HOST": "0.0.0.0",
                "PORT": "8000",
                "HUGGINGFACE_TOKEN": huggingface_token,
            },
            startup_initial_delay=150,  # 2.5 minutos para carregar 2 modelos
        ),
    ]


# =============================================================================
# GHCR AUTHENTICATION
# =============================================================================

def get_ghcr_auth_config(username: str, token: str) -> dict:
    """
    Retorna configuracao de autenticacao para GHCR.
    
    Fonte: https://docs.salad.com/products/sce/registries/github-container-registry
    
    Args:
        username: GitHub username ou organization
        token: GitHub PAT com scope read:packages
    
    Returns:
        Dict com configuracao de autenticacao
    """
    return {
        "basic_authentication": {
            "username": username,
            "password": token,
        }
    }
