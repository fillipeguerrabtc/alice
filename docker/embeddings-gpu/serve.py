"""
Embeddings GPU Inference Server - Alice Enterprise Platform

Servidor de embeddings multimodal via GPU (Salad Cloud).

Modelos:
- Texto: BGE-M3 (1024 dim, multilíngue, 100+ idiomas)
- Imagem: OpenCLIP ViT-H/14 (1024 dim)

Endpoints:
- POST /embed/text - Embedding de texto (JSON)
- POST /embed/image - Embedding de imagem (base64)
- POST /embed/batch - Batch de embeddings (texto ou imagem)
- GET /health - Health check básico
- GET /ready - Readiness probe (modelos carregados)
- GET /live - Liveness probe
- GET /metrics - Métricas Prometheus

ARQUITETURA 100% GPU (Opção B - Alta Qualidade)
- BGE-M3: 1024 dim, multilíngue (100+ idiomas incluindo PT-BR)
- OpenCLIP ViT-H/14: 1024 dim, alta qualidade para imagens

Autor: Fillipe Guerra
Data: 15 de Dezembro de 2025
Documentação em PT-BR (Regra 10 CLAUDE.md)
"""

import os
import io
import time
import base64
import logging
import asyncio
from typing import Optional, List
from contextlib import asynccontextmanager

import torch
import numpy as np
from PIL import Image
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
import pybreaker

# ============================================================================
# CONFIGURAÇÃO DE LOGGING
# ============================================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("embeddings-gpu")

# ============================================================================
# CONFIGURAÇÃO
# ============================================================================
PORT = int(os.getenv("PORT", 8080))
TEXT_MODEL_NAME = os.getenv("TEXT_MODEL", "BAAI/bge-m3")
IMAGE_MODEL_NAME = os.getenv("IMAGE_MODEL", "ViT-H-14")
IMAGE_PRETRAINED = os.getenv("IMAGE_PRETRAINED", "laion2b_s32b_b79k")

# Dimensão dos embeddings (1024 para ambos BGE-M3 e OpenCLIP ViT-H/14)
EMBEDDING_DIM = 1024

# Limites
MAX_TEXT_LENGTH = 8192  # BGE-M3 suporta até 8192 tokens
MAX_IMAGE_SIZE_MB = 20
MAX_BATCH_SIZE = 32

# Rate limiting
RATE_LIMIT = "60/minute"

# ============================================================================
# MÉTRICAS PROMETHEUS
# ============================================================================
REQUESTS_TOTAL = Counter(
    'embeddings_requests_total',
    'Total de requisições de embeddings',
    ['endpoint', 'status']
)
EMBEDDING_DURATION = Histogram(
    'embeddings_duration_seconds',
    'Duração da geração de embeddings',
    ['model_type'],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
)
MODEL_LOADED = Gauge(
    'embeddings_model_loaded',
    'Indica se o modelo está carregado',
    ['model_name']
)
GPU_MEMORY_USED = Gauge(
    'embeddings_gpu_memory_bytes',
    'Memória GPU utilizada em bytes'
)

# ============================================================================
# RATE LIMITER
# ============================================================================
limiter = Limiter(key_func=get_remote_address)

# ============================================================================
# CIRCUIT BREAKER
# ============================================================================
text_breaker = pybreaker.CircuitBreaker(
    fail_max=5,
    reset_timeout=30,
    name="text-embedding-breaker"
)
image_breaker = pybreaker.CircuitBreaker(
    fail_max=5,
    reset_timeout=30,
    name="image-embedding-breaker"
)

# ============================================================================
# MODELOS GLOBAIS
# ============================================================================
text_model = None
image_model = None
image_preprocess = None
tokenizer = None
device = None

def load_models():
    """Carrega os modelos BGE-M3 e OpenCLIP ViT-H/14 na GPU."""
    global text_model, image_model, image_preprocess, tokenizer, device
    
    # Detectar dispositivo
    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"Dispositivo detectado: {device}")
    
    if device == "cuda":
        logger.info(f"GPU: {torch.cuda.get_device_name(0)}")
        logger.info(f"VRAM Total: {torch.cuda.get_device_properties(0).total_memory / 1e9:.2f} GB")
    
    # Carregar BGE-M3 para texto
    logger.info(f"Carregando modelo de texto: {TEXT_MODEL_NAME}...")
    start_time = time.time()
    
    try:
        from FlagEmbedding import BGEM3FlagModel
        text_model = BGEM3FlagModel(
            TEXT_MODEL_NAME,
            use_fp16=True,  # FP16 para economia de VRAM
            device=device
        )
        text_load_time = time.time() - start_time
        logger.info(f"BGE-M3 carregado em {text_load_time:.2f}s")
        MODEL_LOADED.labels(model_name="bge-m3").set(1)
    except Exception as e:
        logger.error(f"Erro ao carregar BGE-M3: {e}")
        MODEL_LOADED.labels(model_name="bge-m3").set(0)
        raise
    
    # Carregar OpenCLIP ViT-H/14 para imagem
    logger.info(f"Carregando modelo de imagem: {IMAGE_MODEL_NAME}...")
    start_time = time.time()
    
    try:
        import open_clip
        image_model, _, image_preprocess = open_clip.create_model_and_transforms(
            IMAGE_MODEL_NAME,
            pretrained=IMAGE_PRETRAINED,
            device=device
        )
        image_model.eval()  # Modo avaliação
        tokenizer = open_clip.get_tokenizer(IMAGE_MODEL_NAME)
        
        image_load_time = time.time() - start_time
        logger.info(f"OpenCLIP ViT-H/14 carregado em {image_load_time:.2f}s")
        MODEL_LOADED.labels(model_name="openclip-vit-h-14").set(1)
    except Exception as e:
        logger.error(f"Erro ao carregar OpenCLIP: {e}")
        MODEL_LOADED.labels(model_name="openclip-vit-h-14").set(0)
        raise
    
    # Atualizar métricas de GPU
    if device == "cuda":
        GPU_MEMORY_USED.set(torch.cuda.memory_allocated())
    
    logger.info("Todos os modelos carregados com sucesso!")
    logger.info(f"Dimensão dos embeddings: {EMBEDDING_DIM}")

# ============================================================================
# LIFESPAN (startup/shutdown)
# ============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Gerencia ciclo de vida da aplicação."""
    # Startup
    logger.info("Iniciando Embeddings GPU Server...")
    try:
        load_models()
    except Exception as e:
        logger.error(f"Falha ao carregar modelos: {e}")
        # Não levanta exceção para permitir health checks
    
    yield
    
    # Shutdown
    logger.info("Encerrando Embeddings GPU Server...")
    if device == "cuda":
        torch.cuda.empty_cache()

# ============================================================================
# FASTAPI APP
# ============================================================================
app = FastAPI(
    title="Alice Embeddings GPU Service",
    description="Serviço de embeddings multimodal via GPU (BGE-M3 + OpenCLIP ViT-H/14)",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limit error handler
@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    REQUESTS_TOTAL.labels(endpoint=request.url.path, status="rate_limited").inc()
    return PlainTextResponse(
        content="Rate limit exceeded. Tente novamente em alguns segundos.",
        status_code=429
    )

app.state.limiter = limiter

# ============================================================================
# SCHEMAS
# ============================================================================
class TextEmbedRequest(BaseModel):
    """Request para embedding de texto."""
    text: str = Field(..., description="Texto para gerar embedding (máx 8192 tokens)")
    
class TextEmbedResponse(BaseModel):
    """Response com embedding de texto."""
    embedding: List[float] = Field(..., description="Embedding (1024 dim)")
    model: str = Field(..., description="Modelo utilizado")
    dimension: int = Field(..., description="Dimensão do embedding")
    processing_time_ms: float = Field(..., description="Tempo de processamento em ms")

class ImageEmbedRequest(BaseModel):
    """Request para embedding de imagem."""
    image: str = Field(..., description="Imagem em base64 (data:image/...;base64,...)")

class ImageEmbedResponse(BaseModel):
    """Response com embedding de imagem."""
    embedding: List[float] = Field(..., description="Embedding (1024 dim)")
    model: str = Field(..., description="Modelo utilizado")
    dimension: int = Field(..., description="Dimensão do embedding")
    processing_time_ms: float = Field(..., description="Tempo de processamento em ms")

class BatchEmbedRequest(BaseModel):
    """Request para batch de embeddings."""
    texts: Optional[List[str]] = Field(None, description="Lista de textos")
    images: Optional[List[str]] = Field(None, description="Lista de imagens em base64")

class BatchEmbedResponse(BaseModel):
    """Response com batch de embeddings."""
    embeddings: List[List[float]] = Field(..., description="Lista de embeddings")
    model: str = Field(..., description="Modelo utilizado")
    dimension: int = Field(..., description="Dimensão dos embeddings")
    count: int = Field(..., description="Quantidade de embeddings gerados")
    processing_time_ms: float = Field(..., description="Tempo de processamento em ms")

class HealthResponse(BaseModel):
    """Response do health check."""
    status: str
    text_model: str
    image_model: str
    device: str
    text_model_loaded: bool
    image_model_loaded: bool

# ============================================================================
# FUNÇÕES DE EMBEDDING
# ============================================================================
@text_breaker
def generate_text_embedding(text: str) -> List[float]:
    """Gera embedding de texto usando BGE-M3."""
    if text_model is None:
        raise RuntimeError("Modelo de texto não carregado")
    
    # BGE-M3 retorna um dicionário com diferentes tipos de embeddings
    # Usamos dense_vecs para embedding denso de 1024 dim
    result = text_model.encode(
        [text],
        return_dense=True,
        return_sparse=False,
        return_colbert_vecs=False
    )
    
    embedding = result['dense_vecs'][0]
    
    # Garantir que é lista de floats
    if isinstance(embedding, np.ndarray):
        embedding = embedding.tolist()
    
    return embedding

@image_breaker
def generate_image_embedding(image_data: bytes) -> List[float]:
    """Gera embedding de imagem usando OpenCLIP ViT-H/14."""
    if image_model is None or image_preprocess is None:
        raise RuntimeError("Modelo de imagem não carregado")
    
    # Carregar imagem
    image = Image.open(io.BytesIO(image_data)).convert("RGB")
    
    # Preprocessar
    image_tensor = image_preprocess(image).unsqueeze(0).to(device)
    
    # Gerar embedding
    with torch.no_grad():
        embedding = image_model.encode_image(image_tensor)
        embedding = embedding / embedding.norm(dim=-1, keepdim=True)  # Normalizar
        embedding = embedding.squeeze().cpu().numpy()
    
    return embedding.tolist()

# ============================================================================
# ENDPOINTS
# ============================================================================
@app.post("/embed/text", response_model=TextEmbedResponse)
@limiter.limit(RATE_LIMIT)
async def embed_text(request: Request, body: TextEmbedRequest) -> TextEmbedResponse:
    """
    Gera embedding de texto usando BGE-M3 (1024 dim).
    
    Suporta 100+ idiomas incluindo Português Brasileiro.
    Máximo de 8192 tokens por texto.
    """
    start_time = time.time()
    
    if not body.text or len(body.text.strip()) == 0:
        REQUESTS_TOTAL.labels(endpoint="/embed/text", status="error").inc()
        raise HTTPException(status_code=400, detail="Texto vazio não é permitido")
    
    if len(body.text) > MAX_TEXT_LENGTH * 4:  # Aproximação: 4 chars por token
        REQUESTS_TOTAL.labels(endpoint="/embed/text", status="error").inc()
        raise HTTPException(status_code=400, detail=f"Texto muito longo. Máximo: ~{MAX_TEXT_LENGTH} tokens")
    
    try:
        with EMBEDDING_DURATION.labels(model_type="text").time():
            embedding = await asyncio.get_event_loop().run_in_executor(
                None, generate_text_embedding, body.text.strip()
            )
        
        processing_time_ms = (time.time() - start_time) * 1000
        REQUESTS_TOTAL.labels(endpoint="/embed/text", status="success").inc()
        
        return TextEmbedResponse(
            embedding=embedding,
            model="BAAI/bge-m3",
            dimension=len(embedding),
            processing_time_ms=round(processing_time_ms, 2)
        )
    
    except pybreaker.CircuitBreakerError:
        REQUESTS_TOTAL.labels(endpoint="/embed/text", status="circuit_open").inc()
        raise HTTPException(status_code=503, detail="Serviço temporariamente indisponível (circuit breaker aberto)")
    except Exception as e:
        REQUESTS_TOTAL.labels(endpoint="/embed/text", status="error").inc()
        logger.error(f"Erro ao gerar embedding de texto: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/embed/image", response_model=ImageEmbedResponse)
@limiter.limit(RATE_LIMIT)
async def embed_image(request: Request, body: ImageEmbedRequest) -> ImageEmbedResponse:
    """
    Gera embedding de imagem usando OpenCLIP ViT-H/14 (1024 dim).
    
    Aceita imagem em base64 (data:image/...;base64,...).
    Máximo de 20MB por imagem.
    """
    start_time = time.time()
    
    if not body.image:
        REQUESTS_TOTAL.labels(endpoint="/embed/image", status="error").inc()
        raise HTTPException(status_code=400, detail="Imagem não fornecida")
    
    try:
        # Decodificar base64
        if body.image.startswith("data:"):
            # Formato data URI
            header, data = body.image.split(",", 1)
            image_data = base64.b64decode(data)
        else:
            # Base64 puro
            image_data = base64.b64decode(body.image)
        
        # Verificar tamanho
        if len(image_data) > MAX_IMAGE_SIZE_MB * 1024 * 1024:
            REQUESTS_TOTAL.labels(endpoint="/embed/image", status="error").inc()
            raise HTTPException(status_code=400, detail=f"Imagem muito grande. Máximo: {MAX_IMAGE_SIZE_MB}MB")
        
        with EMBEDDING_DURATION.labels(model_type="image").time():
            embedding = await asyncio.get_event_loop().run_in_executor(
                None, generate_image_embedding, image_data
            )
        
        processing_time_ms = (time.time() - start_time) * 1000
        REQUESTS_TOTAL.labels(endpoint="/embed/image", status="success").inc()
        
        return ImageEmbedResponse(
            embedding=embedding,
            model="OpenCLIP-ViT-H-14",
            dimension=len(embedding),
            processing_time_ms=round(processing_time_ms, 2)
        )
    
    except pybreaker.CircuitBreakerError:
        REQUESTS_TOTAL.labels(endpoint="/embed/image", status="circuit_open").inc()
        raise HTTPException(status_code=503, detail="Serviço temporariamente indisponível (circuit breaker aberto)")
    except Exception as e:
        REQUESTS_TOTAL.labels(endpoint="/embed/image", status="error").inc()
        logger.error(f"Erro ao gerar embedding de imagem: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/embed/batch", response_model=BatchEmbedResponse)
@limiter.limit("30/minute")
async def embed_batch(request: Request, body: BatchEmbedRequest) -> BatchEmbedResponse:
    """
    Gera batch de embeddings (texto ou imagem).
    
    Máximo de 32 itens por batch.
    """
    start_time = time.time()
    
    if not body.texts and not body.images:
        raise HTTPException(status_code=400, detail="Nenhum texto ou imagem fornecido")
    
    if body.texts and body.images:
        raise HTTPException(status_code=400, detail="Forneça apenas textos OU imagens, não ambos")
    
    items = body.texts or body.images or []
    if len(items) > MAX_BATCH_SIZE:
        raise HTTPException(status_code=400, detail=f"Máximo de {MAX_BATCH_SIZE} itens por batch")
    
    try:
        embeddings = []
        model_name = ""
        
        if body.texts:
            model_name = "BAAI/bge-m3"
            # BGE-M3 suporta batch nativo
            result = text_model.encode(
                body.texts,
                return_dense=True,
                return_sparse=False,
                return_colbert_vecs=False
            )
            embeddings = [e.tolist() if isinstance(e, np.ndarray) else e for e in result['dense_vecs']]
        
        elif body.images:
            model_name = "OpenCLIP-ViT-H-14"
            for img_b64 in body.images:
                if img_b64.startswith("data:"):
                    _, data = img_b64.split(",", 1)
                    img_data = base64.b64decode(data)
                else:
                    img_data = base64.b64decode(img_b64)
                
                emb = await asyncio.get_event_loop().run_in_executor(
                    None, generate_image_embedding, img_data
                )
                embeddings.append(emb)
        
        processing_time_ms = (time.time() - start_time) * 1000
        REQUESTS_TOTAL.labels(endpoint="/embed/batch", status="success").inc()
        
        return BatchEmbedResponse(
            embeddings=embeddings,
            model=model_name,
            dimension=len(embeddings[0]) if embeddings else 0,
            count=len(embeddings),
            processing_time_ms=round(processing_time_ms, 2)
        )
    
    except Exception as e:
        REQUESTS_TOTAL.labels(endpoint="/embed/batch", status="error").inc()
        logger.error(f"Erro ao gerar batch de embeddings: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check básico do serviço."""
    return HealthResponse(
        status="healthy" if text_model and image_model else "degraded",
        text_model=TEXT_MODEL_NAME,
        image_model=f"{IMAGE_MODEL_NAME}/{IMAGE_PRETRAINED}",
        device=device or "unknown",
        text_model_loaded=text_model is not None,
        image_model_loaded=image_model is not None
    )

@app.get("/ready")
async def readiness_probe():
    """Readiness probe - verifica se modelos estão carregados."""
    if text_model is None or image_model is None:
        raise HTTPException(status_code=503, detail="Modelos não carregados")
    
    return {
        "status": "ready",
        "text_model": TEXT_MODEL_NAME,
        "image_model": IMAGE_MODEL_NAME,
        "dimension": EMBEDDING_DIM,
        "device": device
    }

@app.get("/live")
async def liveness_probe():
    """Liveness probe - verifica se o serviço está vivo."""
    return {"status": "alive"}

@app.get("/metrics")
async def metrics():
    """Métricas Prometheus."""
    # Atualizar métricas de GPU
    if device == "cuda":
        GPU_MEMORY_USED.set(torch.cuda.memory_allocated())
    
    return PlainTextResponse(
        content=generate_latest().decode("utf-8"),
        media_type=CONTENT_TYPE_LATEST
    )

@app.get("/")
async def root():
    """Informações do serviço."""
    return {
        "service": "Alice Embeddings GPU Service",
        "version": "1.0.0",
        "models": {
            "text": TEXT_MODEL_NAME,
            "image": f"{IMAGE_MODEL_NAME}/{IMAGE_PRETRAINED}"
        },
        "dimension": EMBEDDING_DIM,
        "device": device or "loading...",
        "endpoints": [
            "POST /embed/text - Embedding de texto (1024 dim)",
            "POST /embed/image - Embedding de imagem (1024 dim)",
            "POST /embed/batch - Batch de embeddings",
            "GET /health - Health check",
            "GET /ready - Readiness probe",
            "GET /live - Liveness probe",
            "GET /metrics - Métricas Prometheus"
        ]
    }

# ============================================================================
# MAIN
# ============================================================================
if __name__ == "__main__":
    import uvicorn
    
    logger.info(f"Iniciando servidor na porta {PORT}...")
    logger.info(f"Modelo de texto: {TEXT_MODEL_NAME}")
    logger.info(f"Modelo de imagem: {IMAGE_MODEL_NAME}/{IMAGE_PRETRAINED}")
    logger.info(f"Dimensão dos embeddings: {EMBEDDING_DIM}")
    
    uvicorn.run(
        app,
        host="::",
        port=PORT,
        log_level="info",
        timeout_graceful_shutdown=30
    )
