# Whisper GPU Service - Alice Enterprise Platform
# Container para transcrição de áudio via faster-whisper em GPU (Salad Cloud)
# Deploy: Salad Cloud (GPU RTX 3060/4090/5090)
# Licença: MIT (uso comercial permitido)
#
# Documentação em PT-BR (Regra 10 CLAUDE.md)
# SEGURANÇA: Non-root container (Docker 2025 Best Practices)
#
# ARQUITETURA HÍBRIDA (Opção B - Híbrido Inteligente):
# - Transcrição de áudio: GPU via Salad Cloud (este container)
# - Embeddings de texto/imagem: CPU via Hetzner (clip-inference-service)
#
# ATUALIZAÇÃO DEZEMBRO 2025:
# - CUDA 12.6.3 com cuDNN (tag confirmada no Docker Hub)
# - Ubuntu 24.04 LTS (suporte até 2029 - Best Practices 2025)
# - faster-whisper large-v3 (máxima qualidade em GPU)
#
# Autor: Fillipe Guerra
# Data: 15 de Dezembro de 2025

FROM nvidia/cuda:12.6.3-cudnn-devel-ubuntu24.04

LABEL maintainer="Alice Enterprise Platform"
LABEL description="Whisper GPU inference server para transcrição de áudio (Salad Cloud)"
LABEL version="1.0.0"

# Variáveis de ambiente
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV WHISPER_MODEL_SIZE="large-v3"
ENV PORT=8080
ENV HOME=/app

# Instalar dependências do sistema
# Docker 2025 Best Practices: Separar instalação de deps do sistema em layer dedicada
# python3-venv necessário para criar virtual environment (PEP 668 - Ubuntu 24.04)
# ffmpeg necessário para processamento de áudio
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    python3-venv \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# SEGURANÇA: Criar usuário non-root (Docker 2025 + OWASP Container Security)
RUN groupadd --gid 1001 whisperservice \
    && useradd --uid 1001 --gid 1001 --shell /bin/bash --create-home whisperservice

# Criar diretório da aplicação com permissões corretas
WORKDIR /app
RUN chown -R whisperservice:whisperservice /app

# Instalar dependências Python usando virtual environment
# PEP 668 (Ubuntu 24.04): Usar venv para evitar "externally-managed-environment"
# Best Practice 2025: venv é mais seguro que --break-system-packages
COPY requirements.txt .
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip setuptools wheel \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt \
    && chown -R whisperservice:whisperservice /opt/venv

# Configurar PATH para usar Python do venv em todas as etapas seguintes
ENV PATH="/opt/venv/bin:$PATH"

# Criar diretório cache com permissões corretas para modelos
RUN mkdir -p /app/.cache && chown -R whisperservice:whisperservice /app/.cache
ENV HF_HOME=/app/.cache
ENV XDG_CACHE_HOME=/app/.cache

# Pré-baixar modelo Whisper large-v3 durante build (evita cold start)
# large-v3 oferece máxima qualidade (~3GB modelo)
RUN python3 -c "from faster_whisper import WhisperModel; print('Downloading Whisper large-v3...'); WhisperModel('large-v3', device='cpu', compute_type='int8'); print('Model downloaded successfully')" \
    && chown -R whisperservice:whisperservice /app/.cache

# Copiar código da aplicação
COPY --chown=whisperservice:whisperservice serve.py .

# SEGURANÇA: Mudar para usuário non-root
USER whisperservice

# Health check - usa /ready para verificar dependências (Regra 16 - Kubernetes Best Practices 2025)
# HEALTHCHECK suporta substituição de variáveis ENV
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
    CMD curl -f http://localhost:${PORT}/ready || exit 1

# Expor porta
EXPOSE 8080

# Executar servidor usando Python do venv
CMD ["/opt/venv/bin/python3", "serve.py"]
