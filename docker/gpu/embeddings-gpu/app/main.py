"""
Alice Enterprise Platform - Embeddings GPU Service (Arquitetura Unificada)
==========================================================================
Serviço de embeddings enterprise:
- Texto (Trading/RAG): Qwen3-Embedding-8B → 4096 dimensões (Qdrant)
- Imagem: OpenCLIP ViT-H/14 → 1024 dimensões (pgvector)

Qwen3-Embedding-8B: 8B parâmetros, Apache 2.0, máxima qualidade
OpenCLIP ViT-H/14: 1024 dim nativos, MIT license

Autor: Fillipe Guerra
Data: 17 de Dezembro de 2025
"""

import os
import io
import logging
import time
from typing import List, Optional, Union

import torch
import numpy as np
from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response
from PIL import Image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# MÉTRICAS PROMETHEUS
# =============================================================================

EMBEDDING_COUNTER = Counter(
    "embeddings_generated_total",
    "Total de embeddings gerados",
    ["type", "status"]  # type: text, image
)
EMBEDDING_DURATION = Histogram(
    "embedding_generation_duration_seconds",
    "Tempo de geração de embeddings",
    ["type"],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]
)
GPU_MEMORY_USED = Gauge(
    "gpu_memory_used_bytes",
    "Memória GPU utilizada"
)
LAST_REQUEST_TIME = Gauge(
    "embeddings_last_request_timestamp",
    "Timestamp do último request (para monitoramento)"
)

# =============================================================================
# CONFIGURAÇÃO
# =============================================================================

TEXT_MODEL_NAME = os.environ.get("TEXT_MODEL_NAME", "Qwen/Qwen3-Embedding-8B")
TEXT_EMBEDDING_DIM = int(os.environ.get("TEXT_EMBEDDING_DIM", "4096"))
IMAGE_MODEL_NAME = os.environ.get("IMAGE_MODEL_NAME", "laion/CLIP-ViT-H-14-laion2B-s32B-b79K")
IMAGE_EMBEDDING_DIM = int(os.environ.get("IMAGE_EMBEDDING_DIM", "1024"))
DEVICE = os.environ.get("DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
# KEEP_WARM_MINUTES removido - GPU dedicada 24/7 (Hetzner GEX44)

# =============================================================================
# FASTAPI APP
# =============================================================================

app = FastAPI(
    title="Alice Embeddings GPU (Enterprise)",
    description=f"""
Serviço de embeddings enterprise:
- **Texto (Trading/RAG)**: {TEXT_MODEL_NAME} → {TEXT_EMBEDDING_DIM} dim (Qdrant)
- **Imagem**: {IMAGE_MODEL_NAME} → {IMAGE_EMBEDDING_DIM} dim (pgvector)

Qwen3-Embedding-8B: 8B params, máxima qualidade para trading/RAG.
    """,
    version="2.0.0"
)

# Modelos (carregados no startup)
text_model = None
text_tokenizer = None
image_model = None
image_preprocess = None


# =============================================================================
# SCHEMAS
# =============================================================================

class TextEmbeddingRequest(BaseModel):
    """Request para embedding de texto."""
    texts: List[str] = Field(..., min_length=1, description="Lista de textos para gerar embeddings (mínimo 1)")
    instruction: Optional[str] = Field(
        "Represent this text for retrieval:",
        description="Instrução para o modelo (Qwen usa instruções)"
    )


class TextEmbeddingResponse(BaseModel):
    """Response com embeddings de texto."""
    embeddings: List[List[float]]
    model: str
    dimensions: int
    count: int
    processing_time_ms: int


class ImageEmbeddingResponse(BaseModel):
    """Response com embedding de imagem."""
    embedding: List[float]
    model: str
    dimensions: int
    processing_time_ms: int


# =============================================================================
# STARTUP - CARREGAR MODELOS
# =============================================================================

@app.on_event("startup")
async def load_models():
    """Carrega os modelos de embedding no startup."""
    global text_model, text_tokenizer, image_model, image_preprocess
    
    logger.info("=" * 60)
    logger.info("Alice Embeddings GPU - Arquitetura Enterprise")
    logger.info("=" * 60)
    logger.info(f"Dispositivo: {DEVICE}")
    logger.info(f"Texto: {TEXT_MODEL_NAME} ({TEXT_EMBEDDING_DIM} dim)")
    logger.info(f"Imagem: {IMAGE_MODEL_NAME} ({IMAGE_EMBEDDING_DIM} dim)")
    logger.info("=" * 60)
    
    # Carregar modelo de texto (Qwen3-Embedding ou GTE)
    try:
        logger.info(f"Carregando modelo de texto: {TEXT_MODEL_NAME}")
        
        from sentence_transformers import SentenceTransformer
        
        text_model = SentenceTransformer(
            TEXT_MODEL_NAME,
            device=DEVICE,
            trust_remote_code=True
        )
        
        # Verificar dimensão
        test_emb = text_model.encode(["test"])
        actual_dim = len(test_emb[0])
        logger.info(f"✅ Modelo de texto carregado: {actual_dim} dimensões")
        
        if actual_dim != TEXT_EMBEDDING_DIM:
            logger.warning(f"⚠️ Dimensão diferente do esperado: {actual_dim} vs {TEXT_EMBEDDING_DIM}")
        
    except Exception as e:
        logger.error(f"Erro ao carregar modelo de texto: {e}")
        raise
    
    # Carregar modelo de imagem (OpenCLIP)
    try:
        logger.info(f"Carregando modelo de imagem: {IMAGE_MODEL_NAME}")
        
        import open_clip
        
        model_name = "ViT-H-14"
        pretrained = "laion2b_s32b_b79k"
        
        image_model, _, image_preprocess = open_clip.create_model_and_transforms(
            model_name,
            pretrained=pretrained,
            device=DEVICE
        )
        image_model.eval()
        
        logger.info(f"✅ Modelo de imagem carregado: {IMAGE_EMBEDDING_DIM} dimensões")
        
    except Exception as e:
        logger.error(f"Erro ao carregar modelo de imagem: {e}")
        raise
    
    # Log GPU memory
    if torch.cuda.is_available():
        memory = torch.cuda.memory_allocated() / 1024**3
        logger.info(f"GPU Memory usado: {memory:.2f} GB")
        GPU_MEMORY_USED.set(torch.cuda.memory_allocated())
    
    logger.info("✅ Todos os modelos carregados com sucesso")


# =============================================================================
# ENDPOINTS
# =============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    LAST_REQUEST_TIME.set(time.time())
    
    gpu_info = {}
    if torch.cuda.is_available():
        gpu_info = {
            "name": torch.cuda.get_device_name(0),
            "memory_allocated_gb": round(torch.cuda.memory_allocated() / 1024**3, 2),
            "memory_total_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 2)
        }
    
    return {
        "status": "healthy",
        "architecture": "unified",
        "text_model": TEXT_MODEL_NAME,
        "text_dimensions": TEXT_EMBEDDING_DIM,
        "text_storage": "qdrant",
        "image_model": IMAGE_MODEL_NAME,
        "image_dimensions": IMAGE_EMBEDDING_DIM,
        "image_storage": "pgvector",
        "device": DEVICE,
        "gpu": gpu_info
    }


@app.get("/ready")
async def ready_check():
    """Readiness check - verifica se modelos estão carregados."""
    if text_model is None or image_model is None:
        raise HTTPException(status_code=503, detail="Modelos não carregados")
    return {"status": "ready"}


@app.post("/embed/text", response_model=TextEmbeddingResponse)
async def embed_text(request: TextEmbeddingRequest):
    """
    Gera embeddings de texto (4096 dimensões - Qwen3-Embedding-8B).
    
    Armazenamento: Qdrant (suporta HNSW com 4096+ dim)
    
    Usado para:
    - Trading BTC Futures
    - RAG documents
    - Busca semântica
    """
    if text_model is None:
        raise HTTPException(status_code=503, detail="Modelo de texto não carregado")
    
    LAST_REQUEST_TIME.set(time.time())
    start_time = time.time()
    
    try:
        # Preparar textos com instrução (Qwen usa instruções)
        if request.instruction:
            texts = [f"{request.instruction} {text}" for text in request.texts]
        else:
            texts = request.texts
        
        # Gerar embeddings
        with torch.inference_mode():
            embeddings = text_model.encode(
                texts,
                convert_to_numpy=True,
                normalize_embeddings=True
            )
        
        processing_time_ms = int((time.time() - start_time) * 1000)
        
        EMBEDDING_COUNTER.labels(type="text", status="success").inc(len(texts))
        EMBEDDING_DURATION.labels(type="text").observe(processing_time_ms / 1000)
        
        logger.info(f"Text embeddings: {len(texts)} textos em {processing_time_ms}ms")
        
        return TextEmbeddingResponse(
            embeddings=embeddings.tolist(),
            model=TEXT_MODEL_NAME,
            dimensions=len(embeddings[0]),
            count=len(texts),
            processing_time_ms=processing_time_ms
        )
        
    except Exception as e:
        EMBEDDING_COUNTER.labels(type="text", status="error").inc()
        logger.error(f"Erro em text embedding: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/embed/image", response_model=ImageEmbeddingResponse)
async def embed_image(file: UploadFile = File(...)):
    """
    Gera embedding de imagem (1024 dimensões).
    
    Usado para:
    - Busca de imagens similares
    - RAG multimodal
    - Geração de imagens (feedback)
    """
    if image_model is None:
        raise HTTPException(status_code=503, detail="Modelo de imagem não carregado")
    
    LAST_REQUEST_TIME.set(time.time())
    start_time = time.time()
    
    try:
        # Ler imagem
        content = await file.read()
        image = Image.open(io.BytesIO(content)).convert("RGB")
        
        # Preprocessar
        image_tensor = image_preprocess(image).unsqueeze(0).to(DEVICE)
        
        # Gerar embedding
        with torch.inference_mode():
            embedding = image_model.encode_image(image_tensor)
            embedding = embedding / embedding.norm(dim=-1, keepdim=True)  # Normalizar
            embedding = embedding.cpu().numpy().flatten()
        
        processing_time_ms = int((time.time() - start_time) * 1000)
        
        EMBEDDING_COUNTER.labels(type="image", status="success").inc()
        EMBEDDING_DURATION.labels(type="image").observe(processing_time_ms / 1000)
        
        logger.info(f"Image embedding: {file.filename} em {processing_time_ms}ms")
        
        return ImageEmbeddingResponse(
            embedding=embedding.tolist(),
            model=IMAGE_MODEL_NAME,
            dimensions=len(embedding),
            processing_time_ms=processing_time_ms
        )
        
    except Exception as e:
        EMBEDDING_COUNTER.labels(type="image", status="error").inc()
        logger.error(f"Erro em image embedding: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/metrics")
async def metrics():
    """Endpoint de métricas Prometheus."""
    # Atualizar GPU memory
    if torch.cuda.is_available():
        GPU_MEMORY_USED.set(torch.cuda.memory_allocated())
    
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/info")
async def model_info():
    """Informações detalhadas sobre os modelos."""
    return {
        "architecture": "unified",
        "decision_date": "2025-12-17",
        "benefit": "Qwen3-Embedding-8B: 8B params, máxima qualidade",
        "models": {
            "text": {
                "name": TEXT_MODEL_NAME,
                "parameters": "8B",
                "dimensions": TEXT_EMBEDDING_DIM,
                "storage": "Qdrant",
                "license": "Apache 2.0",
                "use_case": "Trading BTC, RAG, document search"
            },
            "image": {
                "name": IMAGE_MODEL_NAME,
                "dimensions": IMAGE_EMBEDDING_DIM,
                "storage": "PostgreSQL pgvector",
                "pgvector_type": "vector(1024)",
                "license": "MIT",
                "use_case": "Image similarity, multimodal RAG"
            }
        },
        "storage_mapping": {
            "qdrant_4096": [
                "text_embeddings collection",
                "Trading signals",
                "RAG documents",
                "Market data"
            ],
            "pgvector_1024": [
                "generatedImages.clipEmbedding",
                "mediaUploads.clipEmbedding"
            ]
        }
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
