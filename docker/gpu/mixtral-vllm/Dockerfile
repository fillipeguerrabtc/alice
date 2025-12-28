# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - Mixtral 8x7B vLLM
# =============================================================================
# Dockerfile para LLM inference com vLLM em GPU RTX 4000 SFF Ada (20GB)
# Modelo: Mixtral 8x7B Instruct (quantizado AWQ 4-bit)
# 
# ARQUITETURA ENTERPRISE NGC (27/12/2025):
# - Base: nvcr.io/nvidia/vllm:25.12 (container oficial NVIDIA - PRIVADO)
# - vLLM: 0.11.1 pré-instalado e otimizado pela NVIDIA
# - CUDA: 13.1.0.36 com kernels otimizados
# - PyTorch: 2.10.0a0 (versão interna NVIDIA)
# - FlashAttention: 2.7.4.post1 (pré-otimizado)
# - FlashInfer: 0.5.2 (aceleração de inferência)
# 
# REQUER: NGC_API_KEY para pull da imagem (container privado)
# Performance: +10-15% vs imagens públicas
# 
# Ref: https://docs.nvidia.com/deeplearning/frameworks/vllm-release-notes/rel-25-12.html
# 
# Autor: Fillipe Guerra
# Data: 27 de Dezembro de 2025
# =============================================================================

# ENTERPRISE 27/12/2025: Container oficial NVIDIA NGC vLLM (Best Practice 2025)
# - vLLM, PyTorch, CUDA, FlashAttention pré-instalados e otimizados
# - Kernels CUDA compilados e otimizados pela NVIDIA
# - Performance superior (+10-15%) vs instalação manual
# REQUER: NGC_API_KEY no GitHub Secrets
FROM nvcr.io/nvidia/vllm:25.12

LABEL maintainer="Fillipe Guerra"
LABEL description="Mixtral 8x7B vLLM inference server (NVIDIA NGC)"
LABEL version="4.0.0"

ENV PIP_ROOT_USER_ACTION=ignore

# SECURITY HARDENING: Criar usuário não-root (Best Practice 2025)
# Consistente com outros serviços GPU
# Ref: CLAUDE.md "51 containers = 100% com security_opt: no-new-privileges"
RUN useradd -m -u 1000 vllm

WORKDIR /app

# Dependências adicionais para API e métricas (vLLM já está instalado)
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install \
    prometheus-client==0.21.1

# Copiar scripts customizados
COPY healthcheck.py /app/healthcheck.py
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Configurar permissões e mudar para usuário não-root
RUN chown -R vllm:vllm /app
USER vllm

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
