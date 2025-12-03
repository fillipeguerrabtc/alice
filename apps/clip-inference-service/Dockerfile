# CLIP Inference Service - Alice Enterprise Platform
# Container para embeddings multimodais (texto + imagem) via CLIP ViT-L/14
# Deploy: Salad Cloud (GPU RTX 3090/4090)
# Licença: MIT (uso comercial permitido)
#
# Documentação em PT-BR (Regra 10 replit.md)
# SEGURANÇA: Non-root container (Docker 2025 Best Practices)
#
# ATUALIZAÇÃO DEZEMBRO 2025:
# - CUDA 12.6.3 com cuDNN (tag confirmada no Docker Hub)
# - Ubuntu 24.04 LTS (suporte até 2029 - Best Practices 2025)
# - Referência: https://hub.docker.com/r/nvidia/cuda/tags

FROM nvidia/cuda:12.6.3-cudnn-devel-ubuntu24.04

LABEL maintainer="Alice Enterprise Platform"
LABEL description="CLIP ViT-L/14 inference server para embeddings multimodais"
LABEL version="1.0.0"

# Variáveis de ambiente
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV MODEL_NAME="ViT-L/14"
ENV PORT=8080
ENV HOME=/app

# Instalar dependências do sistema (inclui git para pip instalar pacotes git+https)
# Docker 2025 Best Practices: Separar instalação de deps do sistema em layer dedicada
# python3-venv necessário para criar virtual environment (PEP 668 - Ubuntu 24.04)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    python3-venv \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# SEGURANÇA: Criar usuário non-root (Docker 2025 + OWASP Container Security)
RUN groupadd --gid 1001 clipservice \
    && useradd --uid 1001 --gid 1001 --shell /bin/bash --create-home clipservice

# Criar diretório da aplicação com permissões corretas
WORKDIR /app
RUN chown -R clipservice:clipservice /app

# Instalar dependências Python usando virtual environment
# PEP 668 (Ubuntu 24.04): Usar venv para evitar "externally-managed-environment"
# Best Practice 2025: venv é mais seguro que --break-system-packages
COPY apps/clip-inference-service/requirements.txt .
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip setuptools wheel \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt \
    && chown -R clipservice:clipservice /opt/venv

# Configurar PATH para usar Python do venv em todas as etapas seguintes
ENV PATH="/opt/venv/bin:$PATH"

# Baixar modelo CLIP durante build (evita cold start)
# Criar diretório cache com permissões corretas
RUN mkdir -p /app/.cache && chown -R clipservice:clipservice /app/.cache
ENV TORCH_HOME=/app/.cache

# Baixar modelo como root (permissões de cache)
RUN python3 -c "import clip; clip.load('ViT-L/14', device='cpu')" \
    && chown -R clipservice:clipservice /app/.cache

# Copiar código da aplicação
COPY --chown=clipservice:clipservice apps/clip-inference-service/server.py .

# SEGURANÇA: Mudar para usuário non-root
USER clipservice

# Health check - usa /ready para verificar dependências (Regra 16 - Kubernetes Best Practices 2025)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT}/ready || exit 1

# Expor porta
EXPOSE ${PORT}

# Executar servidor usando Python do venv (caminho explícito para segurança)
CMD ["/opt/venv/bin/python3", "server.py"]
