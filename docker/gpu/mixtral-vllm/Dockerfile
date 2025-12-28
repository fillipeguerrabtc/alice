# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - Mixtral 8x7B vLLM
# =============================================================================
# Dockerfile para LLM inference com vLLM em GPU RTX 4000 SFF Ada (20GB)
# Modelo: Mixtral 8x7B Instruct (quantizado AWQ 4-bit)
# 
# ARQUITETURA DOCKER HUB (28/12/2025):
# - Base: vllm/vllm-openai:v0.12.0 (imagem oficial vLLM - PÚBLICA)
# - vLLM: 0.12.0 com suporte a Mixtral, Llama, Qwen, DeepSeek
# - CUDA: 12.x com FlashAttention 2 e PagedAttention
# - PyTorch: 2.x otimizado para inferência
# - 100% público, sem autenticação necessária
# 
# Ref: https://docs.vllm.ai/deployment/docker.html
# Ref: https://hub.docker.com/r/vllm/vllm-openai
# 
# Autor: Fillipe Guerra
# Data: 28 de Dezembro de 2025
# =============================================================================

# ENTERPRISE 28/12/2025: Container oficial vLLM do Docker Hub (Best Practice 2025)
# - vLLM, PyTorch, CUDA, FlashAttention pré-instalados
# - Imagem pública oficial mantida pela equipe vLLM
# - Sem necessidade de autenticação NGC
# - OpenAI-compatible API server incluído
FROM vllm/vllm-openai:v0.12.0

LABEL maintainer="Fillipe Guerra"
LABEL description="Mixtral 8x7B vLLM inference server (Docker Hub)"
LABEL version="4.0.0"

ENV PIP_ROOT_USER_ACTION=ignore

# NOTA: A imagem vllm/vllm-openai é projetada para rodar como root
# Ela armazena bibliotecas críticas em /root/.config/vllm/ que são necessárias em runtime
# Ref: https://docs.vllm.ai/deployment/docker.html
# Segurança mantida via: security_opt: no-new-privileges no docker-compose

WORKDIR /app

# Dependências adicionais para API e métricas (vLLM já está instalado)
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install \
    prometheus-client==0.23.1

# Copiar scripts customizados
COPY healthcheck.py /app/healthcheck.py
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Variáveis de configuração do modelo
# Bug fix: Usar modelo AWQ pré-quantizado (base model não tem weights AWQ)
ENV MODEL_NAME="TheBloke/Mixtral-8x7B-Instruct-v0.1-AWQ"
ENV QUANTIZATION="awq"
ENV MAX_MODEL_LEN="32768"
ENV GPU_MEMORY_UTILIZATION="0.95"
ENV TENSOR_PARALLEL_SIZE="1"
ENV PORT="8000"
ENV HOST="0.0.0.0"

# Expor porta
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

# Entrypoint
ENTRYPOINT ["/app/entrypoint.sh"]
