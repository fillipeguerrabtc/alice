# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - ASR Canary-1B
# =============================================================================
# Dockerfile para transcrição de áudio com Canary em GPU RTX 4000 SFF Ada (20GB)
# 
# ARQUITETURA ENTERPRISE NGC (28/12/2025):
# - Base: nvcr.io/nvidia/nemo:25.07 (container oficial NVIDIA - PRIVADO)
# - NeMo Framework: 25.07 com suporte completo ASR
# - PyTorch: 2.7+ (versão interna NVIDIA)
# - CUDA: 12.x com kernels otimizados
# - Canary-1B-v2: Suporte multilíngue (25 idiomas, 10x mais rápido)
# 
# REQUER: NGC_API_KEY para pull da imagem (container privado)
# Performance: +10-15% vs imagens públicas
# 
# NOTA: A partir de 25.07, TensorRT-LLM e vLLM não estão pré-instalados
# Ref: https://docs.nvidia.com/nemo-framework/user-guide/25.07/changelog.html
# 
# Autor: Fillipe Guerra
# Data: 28 de Dezembro de 2025
# =============================================================================

# ENTERPRISE 28/12/2025: Container oficial NVIDIA NGC NeMo (Best Practice 2025)
# - NeMo Framework, PyTorch, CUDA pré-instalados e otimizados
# - Canary-1B-v2 pronto para uso (multilíngue, 25 idiomas)
# - Performance superior (+10-15%) vs instalação manual
# REQUER: NGC_API_KEY no GitHub Secrets
FROM nvcr.io/nvidia/nemo:25.07

LABEL maintainer="Fillipe Guerra"
LABEL description="ASR Canary-1B speech-to-text server (NVIDIA NGC)"
LABEL version="3.1.0"

ENV PIP_ROOT_USER_ACTION=ignore

# SECURITY HARDENING: Criar usuário não-root (Best Practice 2025)
# Consistente com outros serviços GPU
# Ref: CLAUDE.md "51 containers = 100% com security_opt: no-new-privileges"
RUN useradd -m -u 1000 asr

WORKDIR /app

# Dependências adicionais para API e métricas (NeMo já está instalado)
# ENTERPRISE 28/12/2025: Versões mais recentes de todas as dependências
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install \
    fastapi==0.127.0 \
    uvicorn==0.40.0 \
    python-multipart==0.0.21 \
    pydub==0.25.1 \
    prometheus-client==0.23.1 \
    pybreaker==1.2.0

# Copiar código da aplicação
COPY app/ /app/
COPY healthcheck.py /app/healthcheck.py

# Configurar permissões e mudar para usuário não-root
RUN chown -R asr:asr /app
USER asr

# Variáveis de ambiente
# ENTERPRISE 27/12/2025: Canary-1B-v2 (multilíngue, 25 idiomas, 10x mais rápido)
ENV MODEL_NAME="nvidia/canary-1b-v2"
ENV DEVICE="cuda"
ENV PORT="8000"
ENV HOST="0.0.0.0"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
