# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - Qwen2.5-VL 7B (LLM + Vision)
# =============================================================================
# Dockerfile para LLM multimodal inference com vLLM em GPU RTX 4000 SFF Ada (20GB)
# Modelo: Qwen2.5-VL 7B Instruct AWQ (quantizado 4-bit)
# 
# ARQUITETURA v4.0.0 (11/01/2026):
# - Base: vllm/vllm-openai:v0.12.0 (imagem oficial vLLM - PÚBLICA)
# - vLLM: 0.12.0 com suporte a Qwen2.5-VL multimodal
# - CUDA: 12.x com FlashAttention 2 e PagedAttention
# - PyTorch: 2.x otimizado para inferência
# - Suporte a vision (análise de imagens)
# - 100% público, sem autenticação necessária
# 
# VRAM: ~4GB (AWQ 4-bit quantization)
# 
# Ref: https://docs.vllm.ai/models/supported_models.html
# Ref: https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct-AWQ
# 
# Autor: Fillipe Guerra
# Data: 11 de Janeiro de 2026
# =============================================================================

# ENTERPRISE v4.0.0: Container oficial vLLM do Docker Hub (Best Practice 2026)
# - vLLM, PyTorch, CUDA, FlashAttention pré-instalados
# - Suporte a modelos multimodais (Qwen2-VL, Qwen2.5-VL, LLaVA, etc.)
# - Imagem pública oficial mantida pela equipe vLLM
FROM vllm/vllm-openai:v0.12.0

LABEL maintainer="Fillipe Guerra"
LABEL description="Qwen2.5-VL 7B multimodal vLLM inference server"
LABEL version="4.0.0"
LABEL architecture="v4.0.0-simplified"

ENV PIP_ROOT_USER_ACTION=ignore

# NOTA: A imagem vllm/vllm-openai é projetada para rodar como root
# Segurança mantida via: security_opt: no-new-privileges no docker-compose

WORKDIR /app

# Dependências adicionais para processamento de imagens
COPY requirements.txt /app/requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install -r /app/requirements.txt

# Copiar scripts customizados
COPY healthcheck.py /app/healthcheck.py
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Variáveis de configuração do modelo
# Qwen2.5-VL 7B Instruct AWQ - modelo multimodal quantizado
# ARQUITETURA v4.0.0 (12/01/2026):
# - MAX_MODEL_LEN=8192: suficiente para chat/trading, economiza VRAM
# - GPU_MEMORY_UTILIZATION=0.40: permite rodar junto com embeddings+asr
ENV MODEL_NAME="Qwen/Qwen2.5-VL-7B-Instruct-AWQ"
ENV QUANTIZATION="awq"
ENV MAX_MODEL_LEN="8192"
ENV GPU_MEMORY_UTILIZATION="0.40"
ENV TENSOR_PARALLEL_SIZE="1"
ENV PORT="8000"
ENV HOST="0.0.0.0"

# Expor porta
EXPOSE 8000

# Health check - modelo menor, start_period reduzido
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

# Entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
