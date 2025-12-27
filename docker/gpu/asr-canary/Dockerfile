# syntax=docker/dockerfile:1.4
# =============================================================================
# Alice Enterprise Platform - ASR Canary-1B
# =============================================================================
# Dockerfile para transcrição de áudio com Canary em GPU RTX 4000 SFF Ada (20GB)
# 
# BEST PRACTICE 2025: Usar container oficial NVIDIA NGC
# - Container pré-compilado e otimizado pela NVIDIA
# - Inclui NeMo, PyTorch, CUDA com compatibilidade garantida
# - Ref: https://docs.nvidia.com/nemo-framework/user-guide/25.12/installation.html
# 
# Release 25.12 (Dezembro 2025):
# - NeMo Framework: 2.5.3+ (com correção CVE-2025-33212)
# - PyTorch: 2.6.0a0+ (versão interna NVIDIA otimizada)
# - CUDA: 13.x (compatível com driver 580+)
# - Canary-1B-v2: Suporte multilíngue (25 idiomas)
# 
# Autor: Fillipe Guerra
# Data: 27 de Dezembro de 2025
# =============================================================================

# ENTERPRISE 27/12/2025: Container oficial NVIDIA NGC (Best Practice 2025)
# - Todas as dependências pré-compiladas e otimizadas pela NVIDIA
# - Compatibilidade garantida entre NeMo, PyTorch e CUDA
# - Inclui Canary-1B-v2 pré-configurado para ASR/AST multilíngue
FROM nvcr.io/nvidia/nemo:25.12

LABEL maintainer="Fillipe Guerra"
LABEL description="ASR Canary-1B speech-to-text server (NVIDIA NGC)"
LABEL version="2.0.0"

ENV PIP_ROOT_USER_ACTION=ignore

# SECURITY HARDENING: Criar usuário não-root (Best Practice 2025)
# Consistente com outros serviços GPU (embeddings, flux, mixtral, lora-trainer)
# Ref: CLAUDE.md "51 containers = 100% com security_opt: no-new-privileges"
RUN useradd -m -u 1000 asr

WORKDIR /app

# Instalar apenas dependências adicionais para API e métricas
# NeMo, PyTorch, torchaudio já estão instalados no container NVIDIA
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --upgrade pip && \
    pip install \
    fastapi==0.115.6 \
    uvicorn==0.34.0 \
    python-multipart==0.0.20 \
    pydub==0.25.1 \
    prometheus-client==0.21.1 \
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

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD python3 /app/healthcheck.py || exit 1

CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
