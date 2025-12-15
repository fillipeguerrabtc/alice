# Embeddings GPU Service - Alice Enterprise Platform
# Container para embeddings multimodal via GPU (Salad Cloud)
#
# Modelos:
# - Texto: BGE-M3 (1024 dim, multilíngue, 100+ idiomas)
# - Imagem: OpenCLIP ViT-H/14 (1024 dim)
#
# ARQUITETURA 100% GPU (Opção B - Alta Qualidade)
#
# Autor: Fillipe Guerra
# Data: 15 de Dezembro de 2025

FROM nvidia/cuda:12.6.3-cudnn-devel-ubuntu24.04

LABEL maintainer="Alice Enterprise Platform"
LABEL description="Embeddings GPU inference server (BGE-M3 + OpenCLIP ViT-H/14) para Salad Cloud"
LABEL version="1.0.0"

# Variáveis de ambiente
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PORT=8080
ENV HOME=/app

# Modelos a serem carregados
ENV TEXT_MODEL="BAAI/bge-m3"
ENV IMAGE_MODEL="ViT-H-14"
ENV IMAGE_PRETRAINED="laion2b_s32b_b79k"

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    python3-venv \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# SEGURANÇA: Criar usuário non-root
RUN groupadd --gid 1001 embeddingsservice \
    && useradd --uid 1001 --gid 1001 --shell /bin/bash --create-home embeddingsservice

# Criar diretório da aplicação com permissões corretas
WORKDIR /app
RUN chown -R embeddingsservice:embeddingsservice /app

# Instalar dependências Python
COPY requirements.txt .
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip setuptools wheel \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt \
    && chown -R embeddingsservice:embeddingsservice /opt/venv

# Configurar PATH
ENV PATH="/opt/venv/bin:$PATH"

# Criar diretório cache e pré-baixar modelos
RUN mkdir -p /app/.cache && chown -R embeddingsservice:embeddingsservice /app/.cache
ENV HF_HOME=/app/.cache
ENV XDG_CACHE_HOME=/app/.cache
ENV TRANSFORMERS_CACHE=/app/.cache
ENV TORCH_HOME=/app/.cache

# Pré-download dos modelos durante build (autonomia 100%)
# BGE-M3 para texto (1024 dim)
RUN python3 -c "from FlagEmbedding import BGEM3FlagModel; print('Downloading BGE-M3...'); model = BGEM3FlagModel('BAAI/bge-m3', use_fp16=True); print('BGE-M3 downloaded successfully')" \
    && chown -R embeddingsservice:embeddingsservice /app/.cache

# OpenCLIP ViT-H/14 para imagem (1024 dim)
RUN python3 -c "import open_clip; print('Downloading OpenCLIP ViT-H/14...'); model, _, preprocess = open_clip.create_model_and_transforms('ViT-H-14', pretrained='laion2b_s32b_b79k'); print('OpenCLIP downloaded successfully')" \
    && chown -R embeddingsservice:embeddingsservice /app/.cache

# Copiar código da aplicação
COPY --chown=embeddingsservice:embeddingsservice serve.py .

# Mudar para usuário non-root
USER embeddingsservice

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=5 \
    CMD curl -f http://localhost:${PORT}/ready || exit 1

# Expor porta
EXPOSE 8080

# Executar servidor
CMD ["/opt/venv/bin/python3", "serve.py"]
