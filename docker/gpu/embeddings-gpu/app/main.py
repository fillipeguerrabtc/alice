"""
Alice Enterprise Platform - Embeddings GPU Service (Arquitetura Unificada)
==========================================================================
Serviço de embeddings enterprise:
- Texto (Trading/RAG): Qwen3-Embedding-8B → 4096 dimensões (Qdrant)
- Imagem: OpenCLIP ViT-H/14 → 1024 dimensões (pgvector)

Qwen3-Embedding-8B: 8B parâmetros, Apache 2.0, máxima qualidade
OpenCLIP ViT-H/14: 1024 dim nativos, MIT license

ARQUITETURA v4.0.0 (11/01/2026):
- Suporte a quantização INT8 para reduzir VRAM de ~16GB para ~8GB
- Permite rodar simultaneamente com outros serviços GPU
- Configurável via variável QUANTIZATION=int8

Autor: Fillipe Guerra
Data: 11 de Janeiro de 2026
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
# ARQUITETURA v4.0.0: Suporte a quantização para reduzir VRAM
# NOTA ENTERPRISE (WS3): QUANTIZATION=int8 no compose DEVE refletir o runtime.
# É proibido "silenciosamente" cair para FP16 quando INT8 foi configurado.
QUANTIZATION = os.environ.get("QUANTIZATION", "auto").strip().lower()  # auto, int8, fp16, fp32
if QUANTIZATION not in {"auto", "int8", "fp16", "fp32"}:
    raise RuntimeError(
        f"QUANTIZATION inválido: {QUANTIZATION}. Valores aceitos: auto|int8|fp16|fp32"
    )

# =============================================================================
# FASTAPI APP
# =============================================================================

app = FastAPI(
    title="Alice Embeddings GPU (Enterprise v4.0.0)",
    description=f"""
Serviço de embeddings enterprise:
- **Texto (Trading/RAG)**: {TEXT_MODEL_NAME} → {TEXT_EMBEDDING_DIM} dim (Qdrant)
- **Imagem**: {IMAGE_MODEL_NAME} → {IMAGE_EMBEDDING_DIM} dim (pgvector)
- **Quantização**: {QUANTIZATION} (INT8 reduz VRAM significativamente)

Qwen3-Embedding-8B: 8B params, máxima qualidade para trading/RAG.
    """,
    version="4.0.0"
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
    logger.info("Alice Embeddings GPU - Arquitetura v4.0.0")
    logger.info("=" * 60)
    logger.info(f"Dispositivo: {DEVICE}")
    logger.info(f"Quantização: {QUANTIZATION}")
    logger.info(f"Texto: {TEXT_MODEL_NAME} ({TEXT_EMBEDDING_DIM} dim)")
    logger.info(f"Imagem: {IMAGE_MODEL_NAME} ({IMAGE_EMBEDDING_DIM} dim)")
    logger.info("=" * 60)
    
    # Carregar modelo de texto (Qwen3-Embedding)
    try:
        logger.info(f"Carregando modelo de texto: {TEXT_MODEL_NAME}")
        
        from sentence_transformers import SentenceTransformer

        # =========================================================================
        # WS3 — Mismatch INT8 vs FP16: implementar quantização REAL (sem fallback)
        # =========================================================================
        model_kwargs = {}
        if DEVICE == "cuda":
            if QUANTIZATION == "auto":
                # Preferir INT8 em GPU para reduzir VRAM. Se houver incompatibilidade,
                # é melhor falhar no startup (fail-fast) do que rodar em modo errado.
                quant = "int8"
            else:
                quant = QUANTIZATION
        else:
            # CPU é permitido apenas para desenvolvimento/diagnóstico local.
            quant = "fp32" if QUANTIZATION in {"auto", "fp32"} else QUANTIZATION

        if quant == "int8":
            # BitsAndBytesConfig (transformers) - requer bitsandbytes instalado e GPU CUDA.
            try:
                from transformers import BitsAndBytesConfig
            except Exception as import_error:
                raise RuntimeError(
                    "QUANTIZATION=int8 requer transformers com BitsAndBytesConfig disponível."
                ) from import_error

            model_kwargs["quantization_config"] = BitsAndBytesConfig(load_in_8bit=True)
            # device_map auto é seguro para single-GPU e evita hardcode de índice
            model_kwargs["device_map"] = "auto"
            logger.info("Quantização ativa: INT8 (bitsandbytes)")
        elif quant == "fp16":
            model_kwargs["torch_dtype"] = torch.float16
            logger.info("Quantização ativa: FP16 (half precision)")
        elif quant == "fp32":
            model_kwargs["torch_dtype"] = torch.float32
            logger.info("Quantização ativa: FP32")
        else:
            raise RuntimeError(f"Modo de quantização não suportado após resolução: {quant}")

        # SentenceTransformer v5+ suporta model_kwargs para repassar ao AutoModel.
        # IMPORTANTE: quando usamos device_map, não devemos forçar `device`,
        # pois isso conflita com o roteamento interno e pode causar mismatch de device.
        st_kwargs = {
            "trust_remote_code": True,  # CRÍTICO: Qwen3-Embedding-8B requer código customizado
            "model_kwargs": model_kwargs,
        }
        if "device_map" not in model_kwargs:
            st_kwargs["device"] = DEVICE

        text_model = SentenceTransformer(TEXT_MODEL_NAME, **st_kwargs)
        
        # Verificar dimensão (fail-fast se divergente)
        test_emb = text_model.encode(["test"])
        actual_dim = len(test_emb[0])
        logger.info(f"✅ Modelo de texto carregado: {actual_dim} dimensões")
        
        if actual_dim != TEXT_EMBEDDING_DIM:
            raise RuntimeError(
                f"Dimensão diferente do esperado: {actual_dim} vs {TEXT_EMBEDDING_DIM}"
            )
        
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
        "architecture": "v4.0.0-simplified",
        "quantization": QUANTIZATION,
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
