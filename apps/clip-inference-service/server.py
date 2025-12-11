"""
CLIP Inference Server - Alice Enterprise Platform

Servidor de inferência para embeddings multimodais (texto + imagem) e embeddings de texto puro.
Modelos:
- CLIP ViT-L/14 (768 dimensões) - embeddings multimodais (texto + imagem)
- multilingual-e5-base (768 dimensões) - embeddings de texto puro (100+ idiomas)
Licenças: MIT (CLIP) e Apache 2.0 (multilingual-e5-base) - uso comercial permitido

Endpoints:
- POST /inference/clip - Gera embedding CLIP de texto ou imagem (serviço interno - sem auth)
- POST /inference/text-embedding - Gera embedding de texto puro multilíngue (serviço interno - sem auth)
- GET /health - Health check (público para docker healthcheck)

ARQUITETURA AUTÔNOMA:
- Serviço roda localmente no Hetzner (CPU ou GPU)
- Acesso controlado pela rede Docker privada (alice-network)
- Não requer autenticação - serviço confiável na mesma rede
- GPUs Salad Cloud são APENAS para LLM (inferência) e treinamento
- Embeddings 100% locais (Regra 6 - Autonomia Total)

Documentação em PT-BR (Regra 10 CLAUDE.md)
Segurança Enterprise (Regra 16 CLAUDE.md)
"""

import os
import io
import sys
import base64
import logging
import time
import asyncio
from datetime import datetime
from typing import Optional, Union, List
from contextlib import asynccontextmanager

import torch
import clip
from PIL import Image
from sentence_transformers import SentenceTransformer
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
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
TEXT_EMBEDDING_MODEL = os.getenv("TEXT_EMBEDDING_MODEL", "intfloat/multilingual-e5-base")
PORT = int(os.getenv("PORT", 8080))
EMBEDDING_DIM = 768  # CLIP ViT-L/14 e multilingual-e5-base produzem embeddings de 768 dimensões
TEXT_EMBEDDING_DIM = 768  # multilingual-e5-base produz embeddings de 768 dimensões

# Configuração de limites
MAX_IMAGE_SIZE_BYTES = int(os.getenv("MAX_IMAGE_SIZE_BYTES", 10 * 1024 * 1024))  # 10MB default
REQUEST_TIMEOUT_SECONDS = int(os.getenv("REQUEST_TIMEOUT_SECONDS", 30))  # 30s default

# NOTA: Serviço interno na rede Docker privada - não requer autenticação
# Acesso é controlado pela rede Docker (alice-network) e não é exposto publicamente
# ARQUITETURA AUTÔNOMA: Serviço local para embeddings CLIP (CPU/GPU no Hetzner)

# SEGURANÇA: Rate limiter (FastAPI 2025 + OWASP API4)
limiter = Limiter(key_func=get_remote_address)

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
TEXT_EMBEDDING_REQUESTS_TOTAL = Counter(
    'text_embedding_requests_total',
    'Total de requisições de embedding de texto puro',
    ['status']
)
TEXT_EMBEDDING_LATENCY = Histogram(
    'text_embedding_latency_seconds',
    'Latência de requisições de embedding de texto puro em segundos',
    buckets=[0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
)
CIRCUIT_BREAKER_STATE = Gauge(
    'clip_circuit_breaker_state',
    'Estado do circuit breaker CLIP (0=closed, 1=open, 0.5=half-open)'
)
CIRCUIT_BREAKER_FAILURES = Counter(
    'clip_circuit_breaker_failures_total',
    'Total de falhas registradas pelo circuit breaker CLIP'
)
TEXT_EMBEDDING_CIRCUIT_BREAKER_STATE = Gauge(
    'text_embedding_circuit_breaker_state',
    'Estado do circuit breaker text embeddings (0=closed, 1=open, 0.5=half-open)'
)
TEXT_EMBEDDING_CIRCUIT_BREAKER_FAILURES = Counter(
    'text_embedding_circuit_breaker_failures_total',
    'Total de falhas registradas pelo circuit breaker text embeddings'
)

# ============================================================================
# CIRCUIT BREAKER PARA INFERÊNCIA CLIP (Regra 16 - Best Practices 2025)
# Protege contra falhas em cascata do modelo Torch/CLIP
# ============================================================================

class ClipBreakerListener(pybreaker.CircuitBreakerListener):
    """Listener para métricas e logging do circuit breaker CLIP."""
    
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
        logger.error(f"Circuit breaker CLIP registrou falha: {exc}")

# Configuração do circuit breaker CLIP (Enterprise-Grade)
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

# Inicializar estado do circuit breaker CLIP
CIRCUIT_BREAKER_STATE.set(0)

# ============================================================================
# CIRCUIT BREAKER PARA TEXT EMBEDDINGS (Regra 16 - Best Practices 2025)
# Protege contra falhas em cascata do modelo sentence-transformers
# ============================================================================

class TextEmbeddingBreakerListener(pybreaker.CircuitBreakerListener):
    """Listener para métricas e logging do circuit breaker text embeddings."""
    
    def state_change(self, cb: pybreaker.CircuitBreaker, old_state: pybreaker.CircuitBreakerState, new_state: pybreaker.CircuitBreakerState) -> None:
        state_value = 0.0  # closed
        if new_state.name == 'open':
            state_value = 1.0
        elif new_state.name == 'half-open':
            state_value = 0.5
        TEXT_EMBEDDING_CIRCUIT_BREAKER_STATE.set(state_value)
        logger.warning(f"Circuit breaker text embeddings: {old_state.name} -> {new_state.name}")
    
    def failure(self, cb: pybreaker.CircuitBreaker, exc: Exception) -> None:
        TEXT_EMBEDDING_CIRCUIT_BREAKER_FAILURES.inc()
        logger.error(f"Circuit breaker text embeddings registrou falha: {exc}")

# Configuração do circuit breaker text embeddings (Enterprise-Grade)
text_embedding_breaker = pybreaker.CircuitBreaker(
    fail_max=5,
    reset_timeout=30,
    exclude=[HTTPException],
    listeners=[TextEmbeddingBreakerListener()],
    name='text-embedding-inference'
)

# Inicializar estado do circuit breaker text embeddings
TEXT_EMBEDDING_CIRCUIT_BREAKER_STATE.set(0)

# Dispositivo (GPU se disponível)
device = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"Dispositivo de inferência: {device}")

# Carregar modelo CLIP
logger.info(f"Carregando modelo CLIP {MODEL_NAME}...")
start_time = time.time()
clip_model, preprocess = clip.load(MODEL_NAME, device=device)
clip_model.eval()  # Modo de inferência
clip_load_time = time.time() - start_time
logger.info(f"Modelo CLIP carregado em {clip_load_time:.2f}s")

# Carregar modelo de text embeddings (multilingual-e5-base)
logger.info(f"Carregando modelo de text embeddings {TEXT_EMBEDDING_MODEL}...")
start_time = time.time()
text_embedding_model = SentenceTransformer(TEXT_EMBEDDING_MODEL, device=device)
text_embedding_load_time = time.time() - start_time
logger.info(f"Modelo de text embeddings carregado em {text_embedding_load_time:.2f}s")


# =============================================================================
# GRACEFUL SHUTDOWN (Fator 9 - Disposability - Best Practices 2025)
# Lifespan manager cuida de startup/shutdown
# uvicorn.run() já implementa signal handlers nativos para SIGTERM/SIGINT
# =============================================================================

@asynccontextmanager
async def lifespan(app):
    """
    Lifespan manager para graceful shutdown.
    
    - Startup: Modelo já carregado globalmente (acima)
    - Shutdown: Aguarda requisições em andamento + cleanup
    
    Documentação: https://fastapi.tiangolo.com/advanced/events/
    """
    logger.info("CLIP Inference Service iniciado - pronto para requisições")
    yield
    # Shutdown graceful
    logger.info("Iniciando graceful shutdown do CLIP Inference Service...")
    # Aguardar um pouco para requisições em andamento terminarem
    await asyncio.sleep(2)
    # Liberar recursos dos modelos (se necessário)
    if clip_model is not None:
        logger.info("Liberando recursos do modelo CLIP...")
    if text_embedding_model is not None:
        logger.info("Liberando recursos do modelo de text embeddings...")
    logger.info("CLIP Inference Service encerrado com sucesso")


# FastAPI app com lifespan
app = FastAPI(
    title="CLIP Inference Service",
    description="Embeddings multimodais (texto + imagem) via CLIP ViT-L/14 e embeddings de texto puro via multilingual-e5-base",
    version="1.1.0",
    lifespan=lifespan,
)

# SEGURANÇA: Rate limiter exception handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS: Serviço interno na rede Docker privada - permite todas as origens internas
# Não exposto publicamente via Traefik (apenas acesso interno)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Serviço interno - acesso controlado pela rede Docker
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
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


class TextEmbeddingRequest(BaseModel):
    """Request para gerar embedding de texto puro"""
    text: str = Field(..., description="Texto para embedding (suporta 100+ idiomas incluindo PT-BR e EN)")
    context: str = Field(default="query", description="Contexto: 'query' para queries de busca, 'passage' para documentos sendo indexados")


class TextEmbeddingResponse(BaseModel):
    """Response com embedding de texto puro"""
    embedding: List[float] = Field(..., description="Vetor de embedding (768 dimensões)")
    model: str = Field(..., description="Modelo usado (multilingual-e5-base)")
    processing_time_ms: int = Field(..., description="Tempo de processamento em ms")


class HealthResponse(BaseModel):
    """Response do health check"""
    status: str
    clip_model: str
    text_embedding_model: str
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
) -> ClipResponse:
    """
    Gera embedding CLIP para texto ou imagem.
    
    SERVIÇO INTERNO: Acesso controlado pela rede Docker privada (alice-network).
    Não requer autenticação - serviço confiável na mesma rede.
    
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
    
    # Determinar tipo de input para métricas
    input_type = "text" if request.text else "image"
    
    # ============================================================================
    # INFERÊNCIA COM CIRCUIT BREAKER (Regra 16 - Best Practices 2025)
    # Protege contra falhas em cascata do modelo Torch/CLIP
    # ============================================================================
    
    def process_embedding_sync() -> tuple[list[float], str]:
        """Função síncrona de inferência CLIP protegida por circuit breaker."""
        with torch.no_grad():
            if request.text:
                # Embedding de texto via CLIP (para busca cross-modal com imagens)
                text_tokens = clip.tokenize([request.text]).to(device)
                text_features = clip_model.encode_text(text_tokens)
                
                # Normalizar (L2 norm) - padrão CLIP
                text_features = text_features / text_features.norm(dim=-1, keepdim=True)
                
                embedding = text_features[0].cpu().numpy().tolist()
                result_type = "text"
                
                logger.info(f"CLIP text embedding gerado: {len(request.text)} chars")
                
            else:
                # Embedding de imagem
                image = decode_base64_image(request.image)
                image_input = preprocess(image).unsqueeze(0).to(device)
                
                image_features = clip_model.encode_image(image_input)
                
                # Normalizar (L2 norm) - padrão CLIP
                image_features = image_features / image_features.norm(dim=-1, keepdim=True)
                
                embedding = image_features[0].cpu().numpy().tolist()
                result_type = "image"
                
                logger.info(f"CLIP image embedding gerado: {image.size}")
        
        return embedding, result_type
    
    try:
        # Aplicar circuit breaker + timeout (Enterprise-Grade)
        embedding, result_type = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None, 
                lambda: clip_breaker.call(process_embedding_sync)
            ),
            timeout=REQUEST_TIMEOUT_SECONDS
        )
        
        processing_time_ms = int((time.time() - start_time) * 1000)
        
        # Métricas de sucesso
        REQUESTS_TOTAL.labels(input_type=result_type, status='success').inc()
        REQUEST_LATENCY.labels(input_type=result_type).observe(processing_time_ms / 1000)
        
        return ClipResponse(
            embedding=embedding,
            model=MODEL_NAME,
            input_type=result_type,
            processing_time_ms=processing_time_ms,
        )
        
    except pybreaker.CircuitBreakerError:
        # Circuit breaker aberto - serviço temporariamente indisponível
        REQUESTS_TOTAL.labels(input_type=input_type, status='circuit_open').inc()
        logger.error("Circuit breaker CLIP aberto - serviço temporariamente indisponível")
        raise HTTPException(
            status_code=HTTP_503_SERVICE_UNAVAILABLE,
            detail="Serviço de inferência temporariamente indisponível. Tente novamente em 30 segundos."
        )
        
    except asyncio.TimeoutError:
        REQUESTS_TOTAL.labels(input_type=input_type, status='timeout').inc()
        logger.warning(f"Timeout ao processar embedding após {REQUEST_TIMEOUT_SECONDS}s")
        raise HTTPException(
            status_code=HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Timeout: processamento excedeu {REQUEST_TIMEOUT_SECONDS} segundos"
        )
        
    except Exception as e:
        REQUESTS_TOTAL.labels(input_type=input_type, status='error').inc()
        logger.error(f"Erro ao gerar embedding: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao processar input: {str(e)}"
        )


@app.post("/inference/text-embedding", response_model=TextEmbeddingResponse)
@limiter.limit("60/minute")  # SEGURANÇA: Rate limit 60 req/min (OWASP API4)
async def generate_text_embedding(
    request_http: Request,  # Necessário para SlowAPI
    request: TextEmbeddingRequest,
) -> TextEmbeddingResponse:
    """
    Gera embedding de texto puro usando multilingual-e5-base.
    
    SERVIÇO INTERNO: Acesso controlado pela rede Docker privada (alice-network).
    Não requer autenticação - serviço confiável na mesma rede.
    
    Retorna vetor de 768 dimensões otimizado para busca semântica de texto.
    Suporta 100+ idiomas incluindo PT-BR e EN (Regra 13 - Internacionalização).
    
    Rate limit: 60 requisições/minuto por IP.
    Timeout: 30 segundos por requisição.
    """
    start_time = time.time()
    
    # Validar input
    if not request.text or not request.text.strip():
        raise HTTPException(
            status_code=400,
            detail="Texto não pode estar vazio"
        )
    
    # Limitar tamanho do texto (prevenir DoS)
    MAX_TEXT_LENGTH = 8192  # 8k caracteres (configurável via env se necessário)
    if len(request.text) > MAX_TEXT_LENGTH:
        logger.warning(f"Texto muito longo: {len(request.text)} chars > {MAX_TEXT_LENGTH} chars")
        raise HTTPException(
            status_code=HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Texto muito longo. Máximo: {MAX_TEXT_LENGTH} caracteres"
        )
    
    # ============================================================================
    # INFERÊNCIA COM CIRCUIT BREAKER (Regra 16 - Best Practices 2025)
    # Protege contra falhas em cascata do modelo sentence-transformers
    # ============================================================================
    
    def process_text_embedding_sync() -> list[float]:
        """Função síncrona de inferência text embedding protegida por circuit breaker."""
        # multilingual-e5-base requer prefixo "query: " ou "passage: " dependendo do uso
        # Para busca semântica, usar "query: " para queries e "passage: " para documentos
        # Se o texto já tem prefixo, usar como está; caso contrário, adicionar baseado no contexto
        if request.text.startswith(("query:", "passage:")):
            prefixed_text = request.text
        else:
            # Usar contexto fornecido (query ou passage)
            prefix = "query" if request.context == "query" else "passage"
            prefixed_text = f"{prefix}: {request.text}"
        
        # Gerar embedding
        embedding = text_embedding_model.encode(
            prefixed_text,
            normalize_embeddings=True,  # Normalizar (L2 norm) para busca semântica
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        
        logger.info(f"Text embedding gerado: {len(request.text)} chars, {len(embedding)} dim")
        return embedding.tolist()
    
    try:
        # Aplicar circuit breaker + timeout (Enterprise-Grade)
        embedding = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None, 
                lambda: text_embedding_breaker.call(process_text_embedding_sync)
            ),
            timeout=REQUEST_TIMEOUT_SECONDS
        )
        
        processing_time_ms = int((time.time() - start_time) * 1000)
        
        # Métricas de sucesso
        TEXT_EMBEDDING_REQUESTS_TOTAL.labels(status='success').inc()
        TEXT_EMBEDDING_LATENCY.observe(processing_time_ms / 1000)
        
        return TextEmbeddingResponse(
            embedding=embedding,
            model=TEXT_EMBEDDING_MODEL,
            processing_time_ms=processing_time_ms,
        )
        
    except pybreaker.CircuitBreakerError:
        # Circuit breaker aberto - serviço temporariamente indisponível
        TEXT_EMBEDDING_REQUESTS_TOTAL.labels(status='circuit_open').inc()
        logger.error("Circuit breaker text embeddings aberto - serviço temporariamente indisponível")
        raise HTTPException(
            status_code=HTTP_503_SERVICE_UNAVAILABLE,
            detail="Serviço de text embeddings temporariamente indisponível. Tente novamente em 30 segundos."
        )
        
    except asyncio.TimeoutError:
        TEXT_EMBEDDING_REQUESTS_TOTAL.labels(status='timeout').inc()
        logger.warning(f"Timeout ao processar text embedding após {REQUEST_TIMEOUT_SECONDS}s")
        raise HTTPException(
            status_code=HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Timeout: processamento excedeu {REQUEST_TIMEOUT_SECONDS} segundos"
        )
        
    except Exception as e:
        TEXT_EMBEDDING_REQUESTS_TOTAL.labels(status='error').inc()
        logger.error(f"Erro ao gerar text embedding: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao processar texto: {str(e)}"
        )


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check do serviço"""
    return HealthResponse(
        status="ok",
        clip_model=MODEL_NAME,
        text_embedding_model=TEXT_EMBEDDING_MODEL,
        device=device,
        embedding_dim=EMBEDDING_DIM,
    )


# ============================================================================
# KUBERNETES PROBES: /ready e /live (Regra 16 - Best Practices 2025)
# /live: Processo está vivo? Se não, Kubernetes reinicia o container
# /ready: Pronto para tráfego? Verifica se modelo CLIP está carregado
# ============================================================================

@app.get("/live")
async def liveness_probe():
    """Liveness probe - verificação simples que o processo responde"""
    return {
        "status": "alive",
        "service": "clip-inference-service",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@app.get("/ready")
async def readiness_probe():
    """Readiness probe - verifica se modelos estão carregados e circuit breakers fechados"""
    clip_model_loaded = clip_model is not None
    text_embedding_model_loaded = text_embedding_model is not None
    clip_circuit_ready = clip_breaker.current_state != "open"
    text_embedding_circuit_ready = text_embedding_breaker.current_state != "open"
    
    all_ready = clip_model_loaded and text_embedding_model_loaded and clip_circuit_ready and text_embedding_circuit_ready
    
    if all_ready:
        return {
            "status": "ready",
            "service": "clip-inference-service",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "dependencies": {
                "clip_model": "ready",
                "text_embedding_model": "ready",
                "clip_circuit_breaker": "closed",
                "text_embedding_circuit_breaker": "closed",
            },
        }
    else:
        from fastapi.responses import JSONResponse
        reasons = []
        if not clip_model_loaded:
            reasons.append("Modelo CLIP não carregado")
        if not text_embedding_model_loaded:
            reasons.append("Modelo text embeddings não carregado")
        if not clip_circuit_ready:
            reasons.append("Circuit breaker CLIP aberto")
        if not text_embedding_circuit_ready:
            reasons.append("Circuit breaker text embeddings aberto")
        
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": "clip-inference-service",
                "reason": "; ".join(reasons),
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "dependencies": {
                    "clip_model": "ready" if clip_model_loaded else "not_ready",
                    "text_embedding_model": "ready" if text_embedding_model_loaded else "not_ready",
                    "clip_circuit_breaker": "closed" if clip_circuit_ready else "open",
                    "text_embedding_circuit_breaker": "closed" if text_embedding_circuit_ready else "open",
                },
            }
        )


@app.get("/metrics")
async def metrics():
    """Endpoint de métricas Prometheus (Regra 16 - Observability Enterprise)"""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/api/circuit-breaker/status")
async def circuit_breaker_status():
    """Status dos circuit breakers (Regra 16 - Best Practices 2025)"""
    return {
        "clip": {
            "name": "clip-inference",
            "state": clip_breaker.current_state,
            "fail_counter": clip_breaker.fail_counter,
            "fail_max": clip_breaker.fail_max,
            "reset_timeout": clip_breaker.reset_timeout,
        },
        "text_embedding": {
            "name": "text-embedding-inference",
            "state": text_embedding_breaker.current_state,
            "fail_counter": text_embedding_breaker.fail_counter,
            "fail_max": text_embedding_breaker.fail_max,
            "reset_timeout": text_embedding_breaker.reset_timeout,
        },
    }


@app.get("/")
async def root():
    """Endpoint raiz com informações do serviço"""
    return {
        "service": "CLIP Inference Service",
        "version": "1.1.0",
        "models": {
            "clip": MODEL_NAME,
            "text_embedding": TEXT_EMBEDDING_MODEL,
        },
        "embedding_dim": EMBEDDING_DIM,
        "device": device,
        "endpoints": {
            "clip_inference": "POST /inference/clip",
            "text_embedding": "POST /inference/text-embedding",
            "health": "GET /health",
        },
    }


if __name__ == "__main__":
    # ==========================================================================
    # GRACEFUL SHUTDOWN (Fator 9 - Disposability)
    # uvicorn.run() já implementa signal handling nativo para SIGTERM/SIGINT
    # O lifespan manager (definido acima) cuida do cleanup de recursos
    # Ref: https://www.uvicorn.org/deployment/#running-programmatically
    # ==========================================================================
    logger.info(f"Iniciando servidor CLIP na porta {PORT}")
    logger.info("Graceful shutdown habilitado via uvicorn (SIGTERM/SIGINT)")
    
    # uvicorn.run() já implementa:
    # - Signal handlers para SIGTERM/SIGINT
    # - Graceful shutdown com timeout
    # - Aguarda requisições em andamento terminarem
    uvicorn.run(
        app,
        host="::",  # IPv6 para Container Gateway da Salad Cloud
        port=PORT,
        log_level="info",
        timeout_graceful_shutdown=30,  # 30s para finalizar requisições
    )
