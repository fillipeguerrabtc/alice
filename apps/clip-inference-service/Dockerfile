# CLIP Inference Service - Alice Enterprise Platform
# Container para embeddings multimodais (texto + imagem) via CLIP ViT-L/14
# Deploy: Salad Cloud (GPU RTX 3090/4090)
# Licença: MIT (uso comercial permitido)
#
# Documentação em PT-BR (Regra 10 replit.md)
# SEGURANÇA: Non-root container (Docker 2025 Best Practices)
#
# ATUALIZAÇÃO DEZEMBRO 2025:
# - CUDA 12.8.0 com cuDNN 8 runtime (tag disponivel no Docker Hub)
# - Ubuntu 20.04
# - Referência: https://hub.docker.com/r/nvidia/cuda/tags

FROM nvidia/cuda:12.8.0-cudnn8-runtime-ubuntu20.04

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
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
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

# Instalar dependências Python (como root para cache)
COPY apps/clip-inference-service/requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

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

# Executar servidor
CMD ["python3", "server.py"]
