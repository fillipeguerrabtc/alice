# CLIP Inference Service - Alice Enterprise Platform
# Container para embeddings multimodais (texto + imagem) via CLIP ViT-L/14
# Deploy: Salad Cloud (GPU RTX 3090/4090)
# Licença: MIT (uso comercial permitido)
#
# Documentação em PT-BR (Regra 10 replit.md)

FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

LABEL maintainer="Alice Enterprise Platform"
LABEL description="CLIP ViT-L/14 inference server para embeddings multimodais"
LABEL version="1.0.0"

# Variáveis de ambiente
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV MODEL_NAME="ViT-L/14"
ENV PORT=8080

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Criar diretório da aplicação
WORKDIR /app

# Instalar dependências Python
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copiar código da aplicação
COPY server.py .

# Baixar modelo CLIP durante build (evita cold start)
RUN python3 -c "import clip; clip.load('ViT-L/14', device='cpu')"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Expor porta
EXPOSE ${PORT}

# Executar servidor
CMD ["python3", "server.py"]
