"""
CLIP Inference Server - Alice Enterprise Platform

Servidor de inferência para embeddings multimodais (texto + imagem).
Modelo: CLIP ViT-L/14 (768 dimensões)
Licença: MIT (uso comercial permitido)

Endpoints:
- POST /inference/clip - Gera embedding de texto ou imagem (REQUER AUTH)
- GET /health - Health check (público para docker healthcheck)

Documentação em PT-BR (Regra 10 replit.md)
Segurança Enterprise (Regra 16 replit.md)
"""

import os
import io
import sys
import base64
import logging
import time
import asyncio
from typing import Optional, Union, List

import torch
import clip
from PIL import Image
from fastapi import FastAPI, HTTPException, Header, Depends, Security, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from starlette.status import HTTP_401_UNAUTHORIZED, HTTP_413_REQUEST_ENTITY_TOO_LARGE, HTTP_429_TOO_MANY_REQUESTS, HTTP_504_GATEWAY_TIMEOUT, HTTP_503_SERVICE_UNAVAILABLE
from pydantic import BaseModel, Field
import uvicorn
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import pybreaker
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response

# Configuração de logging estruturado (Regra 8 - Pino equivalent)
IS_PRODUCTION = os.getenv("NODE_ENV", "development") == "production"
logging.basicConfig(
    level=logging.INFO,
    format='{"timestamp": "%(asctime)s", "level": "%(levelname)s", "service": "clip-inference", "message": "%(message)s"}'
)
logger = logging.getLogger(__name__)

# Configuração
MODEL_NAME = os.getenv("MODEL_NAME", "ViT-L/14")
PORT = int(os.getenv("PORT", 8080))
EMBEDDING_DIM = 768  # ViT-L/14 produz embeddings de 768 dimensões

# Segurança: Token de API (Regra 16 - Autenticação obrigatória em produção)
CLIP_API_TOKEN = os.getenv("CLIP_API_TOKEN")
MAX_IMAGE_SIZE_BYTES = int(os.getenv("MAX_IMAGE_SIZE_BYTES", 10 * 1024 * 1024))  # 10MB default
REQUEST_TIMEOUT_SECONDS = int(os.getenv("REQUEST_TIMEOUT_SECONDS", 30))  # 30s default

# SEGURANÇA: CORS origins (OWASP API Security)
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "").split(",") if os.getenv("CORS_ORIGINS") else []
if not CORS_ORIGINS and IS_PRODUCTION:
    logger.warning("CORS_ORIGINS não configurado - usando allowlist padrão de produção")
    CORS_ORIGINS = [
        "https://api.yesyoudeserve.duckdns.org",
        "https://alice.yesyoudeserve.duckdns.org",
    ]

if not CLIP_API_TOKEN and IS_PRODUCTION:
    logger.error("CRITICAL: CLIP_API_TOKEN é OBRIGATÓRIO em produção. Abortando.")
    sys.exit(1)

# SEGURANÇA: Rate limiter (FastAPI 2025 + OWASP API4)
limiter = Limiter(key_func=get_remote_address)

# Header de autenticação
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

def verify_api_key(api_key: str = Security(api_key_header)) -> str:
    """Verifica token de API para endpoints protegidos."""
    # Em desenvolvimento sem token, permitir acesso
    if not CLIP_API_TOKEN and not IS_PRODUCTION:
        return "dev-mode"
    
    if not api_key or api_key != CLIP_API_TOKEN:
        logger.warning(f"Tentativa de acesso não autorizado")
        raise HTTPException(
            status_code=HTTP_401_UNAUTHORIZED,
            detail="Token de API inválido ou ausente. Use header X-API-Key."
        )
    return api_key

# ============================================================================
# PROMETHEUS METRICS (Regra 16 - Enterprise Observability)
# ============================================================================
REQUESTS_TOTAL = Counter(
    'clip_requests_total',
    'Total de requisições de embedding CLIP',
    ['input_type', 'status']
)
REQUEST_LATENCY = Histogram(
    'clip_request_latency_seconds',
    'Latência de requisições CLIP em segundos',
    ['input_type'],
    buckets=[0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
)
CIRCUIT_BREAKER_STATE = Gauge(
    'clip_circuit_breaker_state',
    'Estado do circuit breaker (0=closed, 1=open, 0.5=half-open)'
)
CIRCUIT_BREAKER_FAILURES = Counter(
    'clip_circuit_breaker_failures_total',
    'Total de falhas registradas pelo circuit breaker'
)

# ============================================================================
# CIRCUIT BREAKER PARA INFERÊNCIA CLIP (Regra 16 - Best Practices 2025)
# Protege contra falhas em cascata do modelo Torch/CLIP
# ============================================================================

class ClipBreakerListener(pybreaker.CircuitBreakerListener):
    """Listener para métricas e logging do circuit breaker."""
    
    def state_change(self, cb: pybreaker.CircuitBreaker, old_state: pybreaker.CircuitBreakerState, new_state: pybreaker.CircuitBreakerState) -> None:
        state_value = 0.0  # closed
        if new_state.name == 'open':
            state_value = 1.0
        elif new_state.name == 'half-open':
            state_value = 0.5
        CIRCUIT_BREAKER_STATE.set(state_value)
        logger.warning(f"Circuit breaker CLIP: {old_state.name} -> {new_state.name}")
    
    def failure(self, cb: pybreaker.CircuitBreaker, exc: Exception) -> None:
        CIRCUIT_BREAKER_FAILURES.inc()
        logger.error(f"Circuit breaker registrou falha: {exc}")

# Configuração do circuit breaker (Enterprise-Grade)
# - fail_max: 5 falhas consecutivas abrem o circuito
# - reset_timeout: 30s no estado "open" antes de tentar half-open
# - exclude: HTTPException não conta como falha (são erros de validação/negócio)
clip_breaker = pybreaker.CircuitBreaker(
    fail_max=5,
    reset_timeout=30,
    exclude=[HTTPException],
    listeners=[ClipBreakerListener()],
    name='clip-inference'
)

# Inicializar estado do circuit breaker
CIRCUIT_BREAKER_STATE.set(0)

# Dispositivo (GPU se disponível)
device = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"Dispositivo de inferência: {device}")

# Carregar modelo CLIP
logger.info(f"Carregando modelo CLIP {MODEL_NAME}...")
start_time = time.time()
model, preprocess = clip.load(MODEL_NAME, device=device)
model.eval()  # Modo de inferência
load_time = time.time() - start_time
logger.info(f"Modelo CLIP carregado em {load_time:.2f}s")


# FastAPI app
app = FastAPI(
    title="CLIP Inference Service",
    description="Embeddings multimodais (texto + imagem) via CLIP ViT-L/14",
    version="1.0.0",
)

# SEGURANÇA: Rate limiter exception handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# SEGURANÇA: CORS configurado (não ['*'] em produção) - OWASP API Security
# Em desenvolvimento permite localhost, em produção usa allowlist
dev_origins = ["http://localhost:3000", "http://localhost:5000", "http://127.0.0.1:3000", "http://127.0.0.1:5000"]
allowed_origins = CORS_ORIGINS if IS_PRODUCTION else dev_origins + CORS_ORIGINS

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins else ["*"],  # Fallback para dev sem config
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["X-API-Key", "Content-Type", "Authorization", "Salad-Api-Key", "Salad-Organization"],
)


# Schemas de request/response
class ClipRequest(BaseModel):
    """Request para gerar embedding CLIP"""
    text: Optional[str] = Field(None, description="Texto para embedding (ex: 'gato laranja dormindo')")
    image: Optional[str] = Field(None, description="Imagem em base64 (data:image/...;base64,...) ou URL")
    model: Optional[str] = Field(default="ViT-L/14", description="Modelo CLIP (apenas ViT-L/14 suportado)")


class ClipResponse(BaseModel):
    """Response com embedding CLIP"""
    embedding: List[float] = Field(..., description="Vetor de embedding (768 dimensões)")
    model: str = Field(..., description="Modelo usado")
    input_type: str = Field(..., description="Tipo de input processado: 'text' ou 'image'")
    processing_time_ms: int = Field(..., description="Tempo de processamento em ms")


class HealthResponse(BaseModel):
    """Response do health check"""
    status: str
    model: str
    device: str
    embedding_dim: int


def decode_base64_image(image_data: str) -> Image.Image:
    """
    Decodifica imagem base64 para PIL Image.
    Suporta formato data:image/...;base64,... ou base64 puro.
    """
    # Remover prefixo data:image/...;base64, se presente
    if image_data.startswith("data:"):
        # Formato: data:image/jpeg;base64,/9j/4AAQ...
        header, encoded = image_data.split(",", 1)
    else:
        encoded = image_data
    
    # Decodificar base64
    image_bytes = base64.b64decode(encoded)
    image = Image.open(io.BytesIO(image_bytes))
    
    # Converter para RGB se necessário (CLIP requer RGB)
    if image.mode != "RGB":
        image = image.convert("RGB")
    
    return image


@app.post("/inference/clip", response_model=ClipResponse)
@limiter.limit("60/minute")  # SEGURANÇA: Rate limit 60 req/min (OWASP API4)
async def generate_embedding(
    request_http: Request,  # Necessário para SlowAPI
    request: ClipRequest,
    api_key: str = Depends(verify_api_key),
    salad_api_key: Optional[str] = Header(None, alias="Salad-Api-Key"),
    salad_organization: Optional[str] = Header(None, alias="Salad-Organization"),
) -> ClipResponse:
    """
    Gera embedding CLIP para texto ou imagem.
    
    REQUER AUTENTICAÇÃO: Header X-API-Key com token válido.
    
    Retorna vetor de 768 dimensões no mesmo espaço vetorial,
    permitindo busca cross-modal (texto → imagem, imagem → texto).
    
    Apenas um dos campos (text ou image) deve ser fornecido.
    Limite de imagem: 10MB (configurável via MAX_IMAGE_SIZE_BYTES).
    Rate limit: 60 requisições/minuto por IP.
    Timeout: 30 segundos por requisição.
    """
    start_time = time.time()
    
    # Validar input
    if not request.text and not request.image:
        raise HTTPException(
            status_code=400,
            detail="Forneça 'text' ou 'image' para gerar embedding"
        )
    
    if request.text and request.image:
        raise HTTPException(
            status_code=400,
            detail="Forneça apenas 'text' OU 'image', não ambos"
        )
    
    # Validar tamanho da imagem (prevenir DoS/GPU hog)
    if request.image:
        # Estimar tamanho do base64 (cada 4 chars = 3 bytes)
        image_data = request.image
        if image_data.startswith("data:"):
            _, image_data = image_data.split(",", 1)
        estimated_size = len(image_data) * 3 // 4
        
        if estimated_size > MAX_IMAGE_SIZE_BYTES:
            logger.warning(f"Imagem rejeitada: {estimated_size} bytes > {MAX_IMAGE_SIZE_BYTES} bytes")
            raise HTTPException(
                status_code=HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Imagem muito grande. Máximo: {MAX_IMAGE_SIZE_BYTES // (1024*1024)}MB"
            )
    
    # SEGURANÇA: Timeout para prevenir DoS (OWASP API4)
    async def process_embedding():
        with torch.no_grad():
            if request.text:
                # Embedding de texto
                text_tokens = clip.tokenize([request.text]).to(device)
                text_features = model.encode_text(text_tokens)
                
                # Normalizar (L2 norm) - padrão CLIP
                text_features = text_features / text_features.norm(dim=-1, keepdim=True)
                
                embedding = text_features[0].cpu().numpy().tolist()
                input_type = "text"
                
                logger.info(f"Text embedding gerado: {len(request.text)} chars")
                
            else:
                # Embedding de imagem
                image = decode_base64_image(request.image)
                image_input = preprocess(image).unsqueeze(0).to(device)
                
                image_features = model.encode_image(image_input)
                
                # Normalizar (L2 norm) - padrão CLIP
                image_features = image_features / image_features.norm(dim=-1, keepdim=True)
                
                embedding = image_features[0].cpu().numpy().tolist()
                input_type = "image"
                
                logger.info(f"Image embedding gerado: {image.size}")
        
        return embedding, input_type
    
    try:
        # Aplicar timeout configurável (default 30s)
        embedding, input_type = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, lambda: asyncio.run(process_embedding())),
            timeout=REQUEST_TIMEOUT_SECONDS
        )
        
        processing_time_ms = int((time.time() - start_time) * 1000)
        
        return ClipResponse(
            embedding=embedding,
            model=MODEL_NAME,
            input_type=input_type,
            processing_time_ms=processing_time_ms,
        )
        
    except asyncio.TimeoutError:
        logger.warning(f"Timeout ao processar embedding após {REQUEST_TIMEOUT_SECONDS}s")
        raise HTTPException(
            status_code=HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Timeout: processamento excedeu {REQUEST_TIMEOUT_SECONDS} segundos"
        )
    except Exception as e:
        logger.error(f"Erro ao gerar embedding: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao processar input: {str(e)}"
        )


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check do serviço"""
    return HealthResponse(
        status="ok",
        model=MODEL_NAME,
        device=device,
        embedding_dim=EMBEDDING_DIM,
    )


@app.get("/")
async def root():
    """Endpoint raiz com informações do serviço"""
    return {
        "service": "CLIP Inference Service",
        "version": "1.0.0",
        "model": MODEL_NAME,
        "embedding_dim": EMBEDDING_DIM,
        "device": device,
        "endpoints": {
            "inference": "POST /inference/clip",
            "health": "GET /health",
        },
    }


if __name__ == "__main__":
    logger.info(f"Iniciando servidor CLIP na porta {PORT}")
    uvicorn.run(
        app,
        host="::",  # IPv6 para Container Gateway da Salad Cloud
        port=PORT,
        log_level="info",
    )
