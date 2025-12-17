"""
Trading Embeddings GPU - Qwen3-Embedding-8B (8192 dimensões)

Serviço FastAPI para geração de embeddings de alta qualidade para Trading.
Modelo: Qwen/Qwen3-Embedding-8B
Dimensões: 8192 (máxima qualidade semântica)
Storage: Qdrant (suporta até 32.768 dim com índice HNSW)

Autor: Fillipe Guerra
Data: 17 de Dezembro de 2025
"""

import os
import time as time_module
import logging
from typing import List, Optional
from contextlib import asynccontextmanager

import torch
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response

# ============================================================================
# CONFIGURAÇÃO
# ============================================================================

MODEL_NAME = os.environ.get("MODEL_NAME", "Qwen/Qwen3-Embedding-8B")
EMBEDDING_DIM = int(os.environ.get("EMBEDDING_DIM", "8192"))
MAX_LENGTH = int(os.environ.get("MAX_LENGTH", "8192"))
DEVICE = os.environ.get("DEVICE", "cuda")
KEEP_WARM_MINUTES = int(os.environ.get("KEEP_WARM_MINUTES", "30"))

# ============================================================================
# LOGGING
# ============================================================================

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("trading-embeddings-gpu")

# ============================================================================
# MÉTRICAS PROMETHEUS (Estratégia Warm on Demand)
# ============================================================================

REQUESTS_TOTAL = Counter(
    "trading_embeddings_requests_total",
    "Total de requisições de embeddings de trading",
    ["endpoint", "status"]
)

EMBEDDING_LATENCY = Histogram(
    "trading_embedding_latency_seconds",
    "Latência de geração de embeddings de trading",
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0]
)

BATCH_SIZE = Histogram(
    "trading_embedding_batch_size",
    "Tamanho dos batches de embeddings",
    buckets=[1, 5, 10, 25, 50, 100]
)

# Métricas para estratégia "Warm on Demand"
LAST_REQUEST_TIME = Gauge(
    "trading_embeddings_last_request_timestamp",
    "Timestamp da última requisição (para keep-warm)"
)

GPU_MEMORY_USED = Gauge(
    "trading_embeddings_gpu_memory_bytes",
    "Memória GPU usada pelo modelo"
)

# ============================================================================
# MODELOS PYDANTIC
# ============================================================================

class EmbeddingRequest(BaseModel):
    """Requisição de embeddings"""
    texts: List[str] = Field(..., min_length=1, max_length=100, description="Lista de textos para embedding")
    instruction: Optional[str] = Field(None, description="Instrução para o modelo (prefix)")
    normalize: bool = Field(True, description="Normalizar vetores (L2)")

class EmbeddingResponse(BaseModel):
    """Resposta com embeddings"""
    embeddings: List[List[float]]
    model: str
    dimension: int
    count: int
    latency_ms: float

class HealthResponse(BaseModel):
    """Resposta de health check"""
    status: str
    model: str
    dimension: int
    device: str
    gpu_memory_mb: Optional[float] = None

# ============================================================================
# MODELO
# ============================================================================

model = None
tokenizer = None

def load_model():
    """Carrega o modelo Qwen3-Embedding-8B"""
    global model, tokenizer
    
    logger.info(f"Carregando modelo {MODEL_NAME} em {DEVICE}...")
    
    from transformers import AutoModel, AutoTokenizer
    
    # Carregar tokenizer
    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_NAME,
        trust_remote_code=True,
    )
    
    # Carregar modelo
    model = AutoModel.from_pretrained(
        MODEL_NAME,
        trust_remote_code=True,
        torch_dtype=torch.float16,  # Half precision para economizar VRAM
        device_map="auto",
    )
    
    model.eval()
    
    # Atualizar métricas de GPU
    if torch.cuda.is_available():
        memory_bytes = torch.cuda.memory_allocated()
        GPU_MEMORY_USED.set(memory_bytes)
        logger.info(f"Modelo carregado. GPU memory: {memory_bytes / 1e9:.2f} GB")
    
    logger.info(f"Modelo {MODEL_NAME} carregado com sucesso!")

def unload_model():
    """Descarrega o modelo da memória"""
    global model, tokenizer
    
    if model is not None:
        del model
        model = None
    if tokenizer is not None:
        del tokenizer
        tokenizer = None
    
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        GPU_MEMORY_USED.set(0)
    
    logger.info("Modelo descarregado da memória")

# ============================================================================
# LIFESPAN
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle do FastAPI"""
    # Startup
    load_model()
    LAST_REQUEST_TIME.set(time_module.time())
    yield
    # Shutdown
    unload_model()

# ============================================================================
# APLICAÇÃO FASTAPI
# ============================================================================

app = FastAPI(
    title="Trading Embeddings GPU",
    description="Serviço de embeddings para Trading com Qwen3-Embedding-8B (8192 dim)",
    version="1.0.0",
    lifespan=lifespan,
)

# ============================================================================
# ENDPOINTS
# ============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check do serviço"""
    gpu_memory_mb = None
    if torch.cuda.is_available():
        gpu_memory_mb = torch.cuda.memory_allocated() / 1e6
    
    return HealthResponse(
        status="healthy" if model is not None else "loading",
        model=MODEL_NAME,
        dimension=EMBEDDING_DIM,
        device=DEVICE,
        gpu_memory_mb=gpu_memory_mb,
    )

@app.get("/metrics")
async def metrics():
    """Endpoint de métricas Prometheus"""
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST,
    )

@app.post("/embeddings", response_model=EmbeddingResponse)
async def generate_embeddings(request: EmbeddingRequest):
    """
    Gera embeddings para textos de trading.
    
    O modelo Qwen3-Embedding-8B suporta instruções para direcionar
    o tipo de embedding gerado (query vs document).
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Modelo ainda carregando")
    
    start_time = time_module.time()
    
    try:
        # Atualizar timestamp para keep-warm
        LAST_REQUEST_TIME.set(start_time)
        
        # Preparar textos com instrução (se fornecida)
        texts = request.texts
        if request.instruction:
            texts = [f"{request.instruction}: {t}" for t in texts]
        
        # Tokenizar
        inputs = tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=MAX_LENGTH,
            return_tensors="pt",
        ).to(DEVICE)
        
        # Gerar embeddings
        with torch.no_grad():
            outputs = model(**inputs)
            # Mean pooling sobre tokens
            attention_mask = inputs["attention_mask"]
            embeddings = outputs.last_hidden_state
            mask_expanded = attention_mask.unsqueeze(-1).expand(embeddings.size()).float()
            sum_embeddings = torch.sum(embeddings * mask_expanded, dim=1)
            sum_mask = torch.clamp(mask_expanded.sum(dim=1), min=1e-9)
            pooled = sum_embeddings / sum_mask
            
            # Normalizar se solicitado
            if request.normalize:
                pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
            
            # Converter para lista
            embeddings_list = pooled.cpu().numpy().tolist()
        
        # Métricas
        latency = time_module.time() - start_time
        EMBEDDING_LATENCY.observe(latency)
        BATCH_SIZE.observe(len(texts))
        REQUESTS_TOTAL.labels(endpoint="/embeddings", status="success").inc()
        
        # Atualizar GPU memory
        if torch.cuda.is_available():
            GPU_MEMORY_USED.set(torch.cuda.memory_allocated())
        
        return EmbeddingResponse(
            embeddings=embeddings_list,
            model=MODEL_NAME,
            dimension=EMBEDDING_DIM,
            count=len(embeddings_list),
            latency_ms=latency * 1000,
        )
        
    except Exception as e:
        REQUESTS_TOTAL.labels(endpoint="/embeddings", status="error").inc()
        logger.error(f"Erro ao gerar embeddings: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/info")
async def model_info():
    """Informações sobre o modelo e configuração"""
    return {
        "model": MODEL_NAME,
        "dimension": EMBEDDING_DIM,
        "max_length": MAX_LENGTH,
        "device": DEVICE,
        "keep_warm_minutes": KEEP_WARM_MINUTES,
        "loaded": model is not None,
        "gpu_available": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    }

@app.get("/ready")
async def readiness():
    """Readiness probe para Kubernetes/Docker"""
    if model is None:
        raise HTTPException(status_code=503, detail="Modelo não carregado")
    return {"status": "ready"}

# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
