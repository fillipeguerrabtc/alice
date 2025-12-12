"""
CLIP Inference Server - Alice Enterprise Platform

Servidor de inferência multimodal 100% LOCAL (CPU Hetzner - Regra 6 Autonomia Total).

Modelos:
- CLIP ViT-L/14 (768 dimensões) - embeddings multimodais (texto + imagem)
- multilingual-e5-base (768 dimensões) - embeddings de texto puro (100+ idiomas)
- faster-whisper medium - transcrição de áudio (Speech-to-Text)
Licenças: MIT (CLIP, faster-whisper) e Apache 2.0 (multilingual-e5-base) - uso comercial permitido

Endpoints:
- POST /inference/clip - Gera embedding CLIP de texto ou imagem (serviço interno - sem auth)
- POST /inference/text-embedding - Gera embedding de texto puro multilíngue (serviço interno - sem auth)
- POST /inference/transcribe - Transcrição de áudio via Whisper (serviço interno - sem auth)
- GET /health - Health check (público para docker healthcheck)

ARQUITETURA AUTÔNOMA (Regra 6 CLAUDE.md):
- Serviço roda localmente no Hetzner via CPU (100% local)
- Embeddings de texto: multilingual-e5-base (768 dim)
- Embeddings de imagem: CLIP ViT-L/14 (768 dim)
- Transcrição de áudio: faster-whisper medium (100+ idiomas)
- Acesso controlado pela rede Docker privada (alice-network)
- Não requer autenticação - serviço confiável na mesma rede
- NENHUMA dependência externa para processamento multimodal

Autor: Fillipe Guerra
Data: 12 de Dezembro de 2025
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
import tempfile
import wave
from datetime import datetime
from typing import Optional, Union, List
from contextlib import asynccontextmanager

import torch
import clip
from PIL import Image
from sentence_transformers import SentenceTransformer
from faster_whisper import WhisperModel
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
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

# =============================================================================
# WHISPER FUNCTIONAL SELF-TEST (Enterprise / Best Practices 2025)
# - Evita falso-positivo de "modelo funcional" baseado apenas em hasattr(...)
# - Executa UM auto-teste leve no startup (silêncio curto em WAV) e depois usa:
#   - flag global do auto-teste + circuit breaker + validação de runtime do device
# - Sem dados hardcoded persistidos; amostra é gerada em memória e removida do disco
# =============================================================================

def _build_silence_wav_bytes(duration_ms: int = 250, sample_rate: int = 16000) -> bytes:
    """Gera um WAV PCM mono com silêncio (curto) para auto-teste do Whisper."""
    if duration_ms <= 0:
        raise ValueError("duration_ms deve ser > 0")
    if sample_rate <= 0:
        raise ValueError("sample_rate deve ser > 0")

    frames = int(sample_rate * (duration_ms / 1000.0))
    pcm_s16le = b"\x00\x00" * frames  # 16-bit PCM mono

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_s16le)
    return buf.getvalue()


def _whisper_device_runtime_ok(inference_device: str) -> bool:
    """
    Validação leve do runtime do device.
    - CPU: assume ok (se processo está vivo).
    - CUDA: valida disponibilidade + alocação mínima para detectar falhas de device pós-startup.
    """
    if inference_device != "cuda":
        return True
    try:
        if not torch.cuda.is_available() or torch.cuda.device_count() < 1:
            return False
        _ = torch.empty((1,), device="cuda")
        torch.cuda.synchronize()
        return True
    except Exception as e:
        logger.warning(f"Falha ao validar runtime CUDA no Whisper: {e}")
        return False


def _whisper_selftest(model: WhisperModel, inference_device: str) -> bool:
    """
    Auto-teste funcional leve do Whisper no startup.
    Objetivo: garantir que o pipeline de transcrição não quebra imediatamente.
    """
    if not _whisper_device_runtime_ok(inference_device):
        return False

    tmp_path: Optional[str] = None
    try:
        wav_bytes = _build_silence_wav_bytes()
        with tempfile.NamedTemporaryFile(prefix="alice-whisper-selftest-", suffix=".wav", delete=False) as tmp_file:
            tmp_path = tmp_file.name
            tmp_file.write(wav_bytes)
            tmp_file.flush()

        # Chamada leve: silêncio tende a retornar 0 segmentos (ok). Sucesso = não lançar exceção.
        segments, _info = model.transcribe(
            tmp_path,
            beam_size=1,
            vad_filter=False,
        )
        for _ in segments:
            break
        return True
    except Exception as e:
        logger.warning(f"Auto-teste do Whisper falhou no startup: {e}")
        return False
    finally:
        if tmp_path is not None:
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception as cleanup_err:
                logger.warning(f"Falha ao remover arquivo temporário do auto-teste Whisper: {cleanup_err}")


# Configuração
MODEL_NAME = os.getenv("MODEL_NAME", "ViT-L/14")
TEXT_EMBEDDING_MODEL = os.getenv("TEXT_EMBEDDING_MODEL", "intfloat/multilingual-e5-base")
# Whisper: medium oferece melhor equilíbrio qualidade/velocidade em CPU
# Opções: tiny, base, small, medium, large-v2, large-v3
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "medium")
PORT = int(os.getenv("PORT", 8080))
EMBEDDING_DIM = 768  # CLIP ViT-L/14 e multilingual-e5-base produzem embeddings de 768 dimensões
TEXT_EMBEDDING_DIM = 768  # multilingual-e5-base produz embeddings de 768 dimensões

# Configuração de limites
MAX_IMAGE_SIZE_BYTES = int(os.getenv("MAX_IMAGE_SIZE_BYTES", 10 * 1024 * 1024))  # 10MB default
MAX_AUDIO_SIZE_BYTES = int(os.getenv("MAX_AUDIO_SIZE_BYTES", 50 * 1024 * 1024))  # 50MB default para áudio
REQUEST_TIMEOUT_SECONDS = int(os.getenv("REQUEST_TIMEOUT_SECONDS", 30))  # 30s default
WHISPER_TIMEOUT_SECONDS = int(os.getenv("WHISPER_TIMEOUT_SECONDS", 300))  # 5min para transcrição (áudios longos)

# NOTA: Serviço interno na rede Docker privada - não requer autenticação
# Acesso é controlado pela rede Docker (alice-network) e não é exposto publicamente
# ARQUITETURA AUTÔNOMA: Serviço local para embeddings CLIP (100% local via CPU no Hetzner)

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

# Métricas Whisper (Transcrição de Áudio)
WHISPER_REQUESTS_TOTAL = Counter(
    'whisper_requests_total',
    'Total de requisições de transcrição Whisper',
    ['status']
)
WHISPER_LATENCY = Histogram(
    'whisper_latency_seconds',
    'Latência de requisições Whisper em segundos',
    buckets=[1.0, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0]  # Buckets maiores para áudio
)
WHISPER_AUDIO_DURATION = Histogram(
    'whisper_audio_duration_seconds',
    'Duração do áudio processado em segundos',
    buckets=[5.0, 15.0, 30.0, 60.0, 120.0, 300.0, 600.0]
)
WHISPER_CIRCUIT_BREAKER_STATE = Gauge(
    'whisper_circuit_breaker_state',
    'Estado do circuit breaker Whisper (0=closed, 1=open, 0.5=half-open)'
)
WHISPER_CIRCUIT_BREAKER_FAILURES = Counter(
    'whisper_circuit_breaker_failures_total',
    'Total de falhas registradas pelo circuit breaker Whisper'
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

# ============================================================================
# CIRCUIT BREAKER PARA WHISPER (Regra 16 - Best Practices 2025)
# Protege contra falhas em cascata do modelo faster-whisper
# ============================================================================

class WhisperBreakerListener(pybreaker.CircuitBreakerListener):
    """Listener para métricas e logging do circuit breaker Whisper."""
    
    def state_change(self, cb: pybreaker.CircuitBreaker, old_state: pybreaker.CircuitBreakerState, new_state: pybreaker.CircuitBreakerState) -> None:
        state_value = 0.0  # closed
        if new_state.name == 'open':
            state_value = 1.0
        elif new_state.name == 'half-open':
            state_value = 0.5
        WHISPER_CIRCUIT_BREAKER_STATE.set(state_value)
        logger.warning(f"Circuit breaker Whisper: {old_state.name} -> {new_state.name}")
    
    def failure(self, cb: pybreaker.CircuitBreaker, exc: Exception) -> None:
        WHISPER_CIRCUIT_BREAKER_FAILURES.inc()
        logger.error(f"Circuit breaker Whisper registrou falha: {exc}")

# Configuração do circuit breaker Whisper (Enterprise-Grade)
# - fail_max: 3 (Whisper pode falhar por OOM em áudios grandes)
# - reset_timeout: 60s (tempo maior para recuperação de memória)
whisper_breaker = pybreaker.CircuitBreaker(
    fail_max=3,
    reset_timeout=60,
    exclude=[HTTPException],
    listeners=[WhisperBreakerListener()],
    name='whisper-inference'
)

# Inicializar estado do circuit breaker Whisper
WHISPER_CIRCUIT_BREAKER_STATE.set(0)

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

# Carregar modelo Whisper (faster-whisper - transcrição de áudio)
# compute_type: int8 para CPU (menor uso de memória), float16 para GPU
logger.info(f"Carregando modelo Whisper {WHISPER_MODEL_SIZE}...")
start_time = time.time()
whisper_compute_type = "float16" if device == "cuda" else "int8"
whisper_model = None  # Inicializar como None para evitar NameError no shutdown
WHISPER_REQUIRED = os.getenv("WHISPER_REQUIRED", "true").lower() in ("1", "true", "yes", "y", "on")
WHISPER_SELFTEST_OK = False
try:
    whisper_model = WhisperModel(
        WHISPER_MODEL_SIZE,
        device=device,
        compute_type=whisper_compute_type,
        cpu_threads=4,  # Usar 4 threads em CPU (metade dos 8 vCPUs do Hetzner CX43)
    )
    whisper_load_time = time.time() - start_time
    logger.info(f"Modelo Whisper carregado em {whisper_load_time:.2f}s (compute_type={whisper_compute_type})")

    # Validação funcional leve (evita "ready" falso-positivo por checagem de atributos).
    WHISPER_SELFTEST_OK = _whisper_selftest(whisper_model, device)
    if not WHISPER_SELFTEST_OK:
        if WHISPER_REQUIRED:
            raise RuntimeError(
                "Whisper carregou, mas falhou no auto-teste funcional. "
                "Abortando startup (WHISPER_REQUIRED=true)."
            )
        logger.warning(
            "Whisper carregou, mas falhou no auto-teste funcional e WHISPER_REQUIRED=false: "
            "serviço iniciará sem transcrição (Whisper será tratado como indisponível)."
        )
        whisper_model = None
except Exception as e:
    logger.error(f"ERRO CRÍTICO ao carregar modelo Whisper: {e}")
    # Fail-fast enterprise: Whisper é componente crítico do serviço multimodal (Regra 6 - Autonomia Total).
    # Se não carregar, o container NÃO deve iniciar para evitar degradação silenciosa em produção.
    if WHISPER_REQUIRED:
        raise RuntimeError(
            "Falha crítica ao carregar Whisper (faster-whisper). "
            "Abortando startup (WHISPER_REQUIRED=true)."
        ) from e
    logger.warning(
        "Whisper não carregou, mas WHISPER_REQUIRED=false: serviço iniciará sem transcrição "
        "(o endpoint /ready/whisper retornará 503; /ready global pode ficar ready)."
    )


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
    logger.info("Iniciando graceful shutdown do Multimodal Inference Service...")
    # Aguardar um pouco para requisições em andamento terminarem
    await asyncio.sleep(2)
    # Liberar recursos dos modelos (se necessário)
    if clip_model is not None:
        logger.info("Liberando recursos do modelo CLIP...")
    if text_embedding_model is not None:
        logger.info("Liberando recursos do modelo de text embeddings...")
    if whisper_model is not None:
        logger.info("Liberando recursos do modelo Whisper...")
    logger.info("Multimodal Inference Service encerrado com sucesso")


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


class TranscribeRequest(BaseModel):
    """Request para transcrição de áudio"""
    audio: str = Field(..., description="Áudio em base64 (data:audio/...;base64,...) ou base64 puro")
    language: Optional[str] = Field(None, description="Código do idioma (ex: 'pt', 'en'). Se None, detecta automaticamente.")


class TranscribeResponse(BaseModel):
    """Response com transcrição de áudio"""
    text: str = Field(..., description="Texto transcrito")
    language: str = Field(..., description="Idioma DETECTADO pelo modelo (ex: 'pt', 'en')")
    requested_language: Optional[str] = Field(None, description="Idioma SOLICITADO pelo cliente (None = auto-detect)")
    confidence: Optional[float] = Field(None, description="Confiança média da transcrição (0-1)")
    duration_seconds: float = Field(..., description="Duração do áudio em segundos")
    processing_time_ms: int = Field(..., description="Tempo de processamento em ms")
    model: str = Field(..., description="Modelo Whisper usado")


class HealthResponse(BaseModel):
    """Response do health check"""
    status: str
    clip_model: str
    text_embedding_model: str
    whisper_model: str
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


# ============================================================================
# ENDPOINT DE TRANSCRIÇÃO DE ÁUDIO (Regra 6 - Autonomia Total)
# Transcrição 100% LOCAL via faster-whisper (CPU Hetzner)
# ============================================================================

@app.post("/inference/transcribe", response_model=TranscribeResponse)
@limiter.limit("30/minute")  # SEGURANÇA: Rate limit menor para transcrição (processamento intensivo)
async def transcribe_audio(
    request_http: Request,  # Necessário para SlowAPI
    request: TranscribeRequest,
) -> TranscribeResponse:
    """
    Transcreve áudio usando faster-whisper (100% LOCAL - CPU Hetzner).
    
    SERVIÇO INTERNO: Acesso controlado pela rede Docker privada (alice-network).
    Não requer autenticação - serviço confiável na mesma rede.
    
    ARQUITETURA AUTÔNOMA (Regra 6 CLAUDE.md):
    - Transcrição 100% local via CPU no servidor Hetzner
    - Modelo: faster-whisper medium (equilíbrio qualidade/velocidade)
    - Suporta 100+ idiomas incluindo PT-BR e EN
    - Detecção automática de idioma se não especificado
    
    Rate limit: 30 requisições/minuto por IP (processamento intensivo).
    Timeout: 5 minutos por requisição (áudios longos).
    """
    start_time = time.time()
    
    # Validar input
    if not request.audio or not request.audio.strip():
        raise HTTPException(
            status_code=400,
            detail="Áudio não pode estar vazio"
        )
    
    # Decodificar áudio base64
    try:
        audio_data = request.audio
        # Remover prefixo data:audio/...;base64, se presente
        if audio_data.startswith("data:"):
            # Formato: data:audio/mp3;base64,XXXXXX
            comma_idx = audio_data.find(",")
            if comma_idx != -1:
                audio_data = audio_data[comma_idx + 1:]
        
        audio_bytes = base64.b64decode(audio_data)
            
    except Exception as e:
        logger.error(f"Erro ao decodificar áudio base64: {e}")
        raise HTTPException(
            status_code=400,
            detail="Formato de áudio inválido. Use base64 válido."
        )
    
    # Validar tamanho APÓS decodificação (fora do try/catch para propagar HTTPException corretamente)
    if len(audio_bytes) > MAX_AUDIO_SIZE_BYTES:
        raise HTTPException(
            status_code=HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Áudio muito grande. Máximo: {MAX_AUDIO_SIZE_BYTES // (1024 * 1024)}MB"
        )
    
    # ============================================================================
    # VALIDAÇÃO DE DISPONIBILIDADE DO MODELO (Regra 6 - Fail-Fast)
    # - Se WHISPER_REQUIRED=true, ausência do modelo é erro (503) e indica falha crítica.
    # - Se WHISPER_REQUIRED=false, transcrição está DESABILITADA (501) e o serviço pode operar
    #   apenas com CLIP + text embeddings (uso por outros consumidores internos).
    # ============================================================================
    if whisper_model is None:
        if WHISPER_REQUIRED:
            logger.error("Tentativa de transcrição com modelo Whisper não disponível (WHISPER_REQUIRED=true)")
            raise HTTPException(
                status_code=HTTP_503_SERVICE_UNAVAILABLE,
                detail="Modelo Whisper não disponível. Serviço em degradação - verifique logs de inicialização."
            )

        logger.warning("Transcrição solicitada, mas WHISPER_REQUIRED=false e Whisper não está carregado (transcrição desabilitada)")
        raise HTTPException(
            status_code=HTTP_501_NOT_IMPLEMENTED,
            detail="Transcrição desabilitada neste deployment (WHISPER_REQUIRED=false)."
        )
    
    # ============================================================================
    # INFERÊNCIA COM CIRCUIT BREAKER (Regra 16 - Best Practices 2025)
    # Protege contra falhas em cascata do modelo faster-whisper
    # ============================================================================
    
    def process_transcription_sync() -> dict:
        """Função síncrona de transcrição protegida por circuit breaker."""
        import tempfile
        import os as temp_os
        
        # Inicializar tmp_path antes do bloco try/finally para evitar NameError (Enterprise-Grade)
        tmp_path = None
        
        # Salvar áudio em arquivo temporário (faster-whisper precisa de arquivo).
        # IMPORTANTE: atribuir `tmp_path` ANTES do write() para garantir cleanup em caso de exceção
        # (NamedTemporaryFile com delete=False pode deixar arquivo órfão).
        with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as tmp_file:
            tmp_path = tmp_file.name
            tmp_file.write(audio_bytes)
        
        try:
            # Transcrever com faster-whisper (já validamos que whisper_model is not None)
            requested_lang = request.language  # Preservar idioma solicitado
            segments, info = whisper_model.transcribe(
                tmp_path,
                language=requested_lang,  # None = detecção automática
                beam_size=5,
                vad_filter=True,  # Filtrar silêncio
                vad_parameters=dict(min_silence_duration_ms=500),
            )
            
            # Concatenar segmentos preservando separação de palavras.
            # Alguns builds do faster-whisper podem retornar `segment.text` sem espaços de fronteira.
            #
            # Regras (enterprise-grade):
            # - Nunca duplica whitespace (se já existe em qualquer lado, não adiciona).
            # - Não adiciona espaço após pontuação de abertura (ex.: "(") nem antes de pontuação de fechamento (ex.: ",", ".", ")").
            # - Mantém contrações com apóstrofo (ex.: "I" + "'m" => "I'm").
            # - Caso padrão: adiciona espaço para evitar junção indevida ("hello." + "world" => "hello. world").
            def needs_space(prev: str, nxt: str) -> bool:
                if not prev or not nxt:
                    return False
                if prev[-1].isspace() or nxt[0].isspace():
                    return False

                prev_last = prev[-1]
                nxt_first = nxt[0]

                # Não adicionar espaço após pontuação de abertura (ex.: "(")
                if prev_last in "([{<«“":
                    return False

                # Não adicionar espaço antes de pontuação de fechamento ou sinais colados ao token anterior
                if nxt_first in ".,;:!?)]}>»”":
                    return False

                # Evitar adicionar espaço em contrações (ex.: I'm, don't) quando o próximo segmento inicia com apóstrofo
                if nxt_first == "'" and prev_last.isalnum():
                    return False

                # Evitar adicionar espaço ao redor de hífens/barras que costumam formar tokens compostos
                if prev_last in "-/" or nxt_first in "-/":
                    return False

                return True

            full_text = ""
            confidences = []
            for segment in segments:
                seg_text = getattr(segment, "text", "")
                if isinstance(seg_text, str) and seg_text:
                    if needs_space(full_text, seg_text):
                        full_text += " "
                    full_text += seg_text
                # `avg_logprob` pode não existir (varia por versão/build do faster-whisper) ou pode vir inválido.
                # Enterprise-grade: nunca quebrar o endpoint por ausência/valor inesperado; apenas omitir confiança.
                avg_logprob = getattr(segment, "avg_logprob", None)
                if avg_logprob is not None:
                    # Converter log prob para confiança aproximada
                    # avg_logprob deve ser negativo (log de probabilidade), validar antes de exp()
                    import math
                    try:
                        if isinstance(avg_logprob, (int, float)) and math.isfinite(avg_logprob) and avg_logprob < 0:
                            conf = math.exp(avg_logprob)
                            # Clampar para [0, 1] por segurança
                            conf = max(0.0, min(1.0, conf))
                            confidences.append(conf)
                    except Exception:
                        # Não propagar erro de cálculo de confiança
                        pass
            
            # Calcular confiança média
            avg_confidence = sum(confidences) / len(confidences) if confidences else None
            
            # Validar texto vazio (áudio silencioso ou muito curto)
            full_text_stripped = full_text.strip()
            if not full_text_stripped:
                logger.warning(f"Transcrição vazia detectada: {info.duration:.1f}s áudio, idioma={info.language}")
                # IMPORTANTE: esta função roda em thread pool (run_in_executor).
                # Para evitar dependência do transporte/exceções entre threads, retornamos erro estruturado
                # e deixamos o handler async levantar o HTTPException com métricas corretas.
                return {
                    "_error": {
                        "status_code": 422,
                        "detail": "Áudio contém apenas silêncio ou é muito curto para transcrição. Nenhum texto detectado.",
                    },
                    "duration_seconds": info.duration,
                    "language": info.language,
                    "requested_language": requested_lang,
                }
            
            logger.info(f"Transcrição concluída: {info.duration:.1f}s áudio, {len(full_text_stripped)} chars, idioma detectado={info.language}, solicitado={requested_lang}")
            
            return {
                "text": full_text_stripped,
                "language": info.language,  # Idioma DETECTADO
                "requested_language": requested_lang,  # Idioma SOLICITADO (pode ser None)
                "confidence": avg_confidence,
                "duration_seconds": info.duration,
            }
            
        finally:
            # Limpar arquivo temporário (apenas se foi criado com sucesso)
            if tmp_path is not None:
                try:
                    temp_os.unlink(tmp_path)
                except Exception as cleanup_error:
                    # Log mas não propagar erro de cleanup
                    logger.warning(f"Erro ao limpar arquivo temporário {tmp_path}: {cleanup_error}")
                    pass
    
    try:
        # Aplicar circuit breaker + timeout (Enterprise-Grade)
        result = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None, 
                lambda: whisper_breaker.call(process_transcription_sync)
            ),
            timeout=WHISPER_TIMEOUT_SECONDS
        )

        # Se o worker síncrono retornou erro estruturado, levantar HTTPException aqui (fora do executor).
        if isinstance(result, dict) and "_error" in result and isinstance(result.get("_error"), dict):
            err = result["_error"]
            status_code = err.get("status_code", 500)
            detail = err.get("detail", "Erro ao transcrever áudio")
            raise HTTPException(status_code=int(status_code), detail=str(detail))
        
        processing_time_ms = int((time.time() - start_time) * 1000)
        
        # Métricas de sucesso
        WHISPER_REQUESTS_TOTAL.labels(status='success').inc()
        WHISPER_LATENCY.observe(processing_time_ms / 1000)
        WHISPER_AUDIO_DURATION.observe(result["duration_seconds"])
        
        return TranscribeResponse(
            text=result["text"],
            language=result["language"],
            requested_language=result["requested_language"],
            confidence=result["confidence"],
            duration_seconds=result["duration_seconds"],
            processing_time_ms=processing_time_ms,
            model=f"faster-whisper-{WHISPER_MODEL_SIZE}",
        )
        
    except pybreaker.CircuitBreakerError:
        # Circuit breaker aberto - serviço temporariamente indisponível
        WHISPER_REQUESTS_TOTAL.labels(status='circuit_open').inc()
        logger.error("Circuit breaker Whisper aberto - serviço temporariamente indisponível")
        raise HTTPException(
            status_code=HTTP_503_SERVICE_UNAVAILABLE,
            detail="Serviço de transcrição temporariamente indisponível. Tente novamente em 60 segundos."
        )
        
    except asyncio.TimeoutError:
        WHISPER_REQUESTS_TOTAL.labels(status='timeout').inc()
        logger.warning(f"Timeout ao transcrever áudio após {WHISPER_TIMEOUT_SECONDS}s")
        raise HTTPException(
            status_code=HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Timeout: transcrição excedeu {WHISPER_TIMEOUT_SECONDS} segundos"
        )
        
    except HTTPException as e:
        # Preservar status code e detail originais (ex: 422 quando transcrição é vazia)
        # Evita converter erros de validação em HTTP 500 (Best Practices 2025 + Regra 5 - Não Mentir)
        WHISPER_REQUESTS_TOTAL.labels(status='client_error').inc()
        raise e
        
    except Exception as e:
        WHISPER_REQUESTS_TOTAL.labels(status='error').inc()
        logger.error(f"Erro ao transcrever áudio: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao transcrever áudio: {str(e)}"
        )


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """
    Health check do serviço - inclui todos os modelos multimodais.
    
    IMPORTANTE: Retorna status REAL dos modelos, não valores hardcoded.
    Se whisper_model falhou ao carregar (is None), reporta como string vazia
    para que consumers possam detectar falhas de inicialização.
    """
    # Consistência com /ready:
    # - /ready é o sinal canônico de prontidão (pode retornar 503 quando não pronto)
    # - /health deve refletir o mesmo estado de disponibilidade (sem sinais contraditórios)
    clip_model_loaded = clip_model is not None
    text_embedding_model_loaded = text_embedding_model is not None
    whisper_model_loaded = whisper_model is not None
    whisper_functional = (
        whisper_model_loaded
        and WHISPER_SELFTEST_OK
        and _whisper_device_runtime_ok(device)
    )

    clip_circuit_ready = clip_breaker.current_state.name != "open"
    text_embedding_circuit_ready = text_embedding_breaker.current_state.name != "open"
    whisper_circuit_ready = whisper_breaker.current_state.name != "open"

    # Health deve refletir disponibilidade real do serviço sem sinais contraditórios:
    # - Sempre exige CLIP + text embeddings
    # - Exige Whisper SOMENTE quando WHISPER_REQUIRED=true
    all_ready = (
        clip_model_loaded
        and text_embedding_model_loaded
        and clip_circuit_ready
        and text_embedding_circuit_ready
        and (
            (not WHISPER_REQUIRED)
            or (whisper_model_loaded and whisper_functional and whisper_circuit_ready)
        )
    )

    return HealthResponse(
        status="ok" if all_ready else "degraded",
        clip_model=MODEL_NAME,
        text_embedding_model=TEXT_EMBEDDING_MODEL,
        # Retornar nome do modelo SOMENTE se carregou com sucesso (Regra 5 - Não Mentir)
        whisper_model=f"faster-whisper-{WHISPER_MODEL_SIZE}" if whisper_model is not None else "",
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
    """
    Readiness probe - verifica se TODOS os modelos multimodais estão carregados E FUNCIONAIS.
    
    IMPORTANTE: Não verifica apenas se variáveis existem, mas se modelos podem ser usados.
    Se dispositivo (GPU/CPU) falhar após startup, readiness deve detectar e reportar falha.
    """
    clip_model_loaded = clip_model is not None
    text_embedding_model_loaded = text_embedding_model is not None
    whisper_model_loaded = whisper_model is not None
    whisper_required = WHISPER_REQUIRED
    whisper_functional = (
        whisper_model_loaded
        and WHISPER_SELFTEST_OK
        and _whisper_device_runtime_ok(device)
    )
    
    # pybreaker.current_state retorna CircuitBreakerState object, não string
    # Usar .name para comparar com string
    clip_circuit_ready = clip_breaker.current_state.name != "open"
    text_embedding_circuit_ready = text_embedding_breaker.current_state.name != "open"
    whisper_circuit_ready = whisper_breaker.current_state.name != "open"
    
    # Readiness global do serviço:
    # - Sempre exige CLIP + text embeddings (componentes core multimodais)
    # - Exige Whisper SOMENTE quando WHISPER_REQUIRED=true
    all_ready = (
        clip_model_loaded
        and text_embedding_model_loaded
        and clip_circuit_ready
        and text_embedding_circuit_ready
        and (
            (not whisper_required)
            or (whisper_model_loaded and whisper_functional and whisper_circuit_ready)
        )
    )
    
    if all_ready:
        whisper_dependency_status = (
            "ready"
            if (whisper_model_loaded and whisper_functional and whisper_circuit_ready)
            else ("not_ready" if whisper_required else "optional")
        )
        return {
            "status": "ready",
            "service": "clip-inference-service",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "whisper_required": whisper_required,
            "dependencies": {
                "clip_model": "ready",
                "text_embedding_model": "ready",
                # "ready" deve refletir carregado + funcional (evita falso-positivo quando modelo está carregado mas não funcional)
                "whisper_model": whisper_dependency_status,
                "clip_circuit_breaker": "closed",
                "text_embedding_circuit_breaker": "closed",
                "whisper_circuit_breaker": ("closed" if whisper_circuit_ready else "open") if whisper_required else "optional",
            },
        }
    else:
        from fastapi.responses import JSONResponse
        reasons = []
        if not clip_model_loaded:
            reasons.append("Modelo CLIP não carregado")
        if not text_embedding_model_loaded:
            reasons.append("Modelo text embeddings não carregado")
        if whisper_required:
            if not whisper_model_loaded:
                reasons.append("Modelo Whisper não carregado")
            elif whisper_model_loaded and not whisper_functional:
                reasons.append("Modelo Whisper carregado mas não funcional (dispositivo indisponível ou modelo corrompido)")
        if not clip_circuit_ready:
            reasons.append("Circuit breaker CLIP aberto")
        if not text_embedding_circuit_ready:
            reasons.append("Circuit breaker text embeddings aberto")
        if whisper_required and not whisper_circuit_ready:
            reasons.append("Circuit breaker Whisper aberto")
        
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "service": "clip-inference-service",
                "reason": "; ".join(reasons),
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "whisper_required": whisper_required,
                "dependencies": {
                    "clip_model": "ready" if clip_model_loaded else "not_ready",
                    "text_embedding_model": "ready" if text_embedding_model_loaded else "not_ready",
                    "whisper_model": (
                        "ready"
                        if (whisper_model_loaded and whisper_functional and whisper_circuit_ready)
                        else ("not_ready" if whisper_required else "optional")
                    ),
                    "clip_circuit_breaker": "closed" if clip_circuit_ready else "open",
                    "text_embedding_circuit_breaker": "closed" if text_embedding_circuit_ready else "open",
                    "whisper_circuit_breaker": (
                        ("closed" if whisper_circuit_ready else "open") if whisper_required else "optional"
                    ),
                },
            }
        )


# ============================================================================
# PROBES POR CAPACIDADE (Enterprise-Grade)
# Permite que serviços consumidores validem somente as dependências necessárias.
# Ex: image-processor depende de CLIP; audio-processor depende de Whisper + text embeddings.
# ============================================================================

@app.get("/ready/clip")
async def readiness_clip_probe():
    """Readiness do CLIP: modelo carregado + circuit breaker fechado."""
    from fastapi.responses import JSONResponse

    clip_model_loaded = clip_model is not None
    clip_circuit_ready = clip_breaker.current_state.name != "open"
    ready = clip_model_loaded and clip_circuit_ready

    if ready:
        return {
            "status": "ready",
            "capability": "clip",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    reasons = []
    if not clip_model_loaded:
        reasons.append("Modelo CLIP não carregado")
    if not clip_circuit_ready:
        reasons.append("Circuit breaker CLIP aberto")

    return JSONResponse(
        status_code=503,
        content={
            "status": "not_ready",
            "capability": "clip",
            "reason": "; ".join(reasons),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
    )


@app.get("/ready/text-embedding")
async def readiness_text_embedding_probe():
    """Readiness de text embeddings: modelo carregado + circuit breaker fechado."""
    from fastapi.responses import JSONResponse

    text_embedding_model_loaded = text_embedding_model is not None
    text_embedding_circuit_ready = text_embedding_breaker.current_state.name != "open"
    ready = text_embedding_model_loaded and text_embedding_circuit_ready

    if ready:
        return {
            "status": "ready",
            "capability": "text-embedding",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    reasons = []
    if not text_embedding_model_loaded:
        reasons.append("Modelo text embeddings não carregado")
    if not text_embedding_circuit_ready:
        reasons.append("Circuit breaker text embeddings aberto")

    return JSONResponse(
        status_code=503,
        content={
            "status": "not_ready",
            "capability": "text-embedding",
            "reason": "; ".join(reasons),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
    )


@app.get("/ready/whisper")
async def readiness_whisper_probe():
    """Readiness do Whisper: modelo carregado + funcional + circuit breaker fechado."""
    from fastapi.responses import JSONResponse

    whisper_model_loaded = whisper_model is not None
    whisper_circuit_ready = whisper_breaker.current_state.name != "open"
    whisper_functional = (
        whisper_model_loaded
        and WHISPER_SELFTEST_OK
        and _whisper_device_runtime_ok(device)
    )

    ready = whisper_model_loaded and whisper_functional and whisper_circuit_ready

    if ready:
        return {
            "status": "ready",
            "capability": "whisper",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }

    reasons = []
    if not whisper_model_loaded:
        reasons.append("Modelo Whisper não carregado")
    elif whisper_model_loaded and not whisper_functional:
        reasons.append("Modelo Whisper carregado mas não funcional")
    if not whisper_circuit_ready:
        reasons.append("Circuit breaker Whisper aberto")

    return JSONResponse(
        status_code=503,
        content={
            "status": "not_ready",
            "capability": "whisper",
            "reason": "; ".join(reasons),
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
    )


@app.get("/metrics")
async def metrics():
    """Endpoint de métricas Prometheus (Regra 16 - Observability Enterprise)"""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/api/circuit-breaker/status")
async def circuit_breaker_status():
    """Status dos circuit breakers - inclui TODOS os modelos multimodais (Regra 16 - Best Practices 2025)"""
    return {
        "clip": {
            "name": "clip-inference",
            "state": clip_breaker.current_state.name,  # CircuitBreakerState tem atributo .name
            "fail_counter": clip_breaker.fail_counter,
            "fail_max": clip_breaker.fail_max,
            "reset_timeout": clip_breaker.reset_timeout,
        },
        "text_embedding": {
            "name": "text-embedding-inference",
            "state": text_embedding_breaker.current_state.name,  # CircuitBreakerState tem atributo .name
            "fail_counter": text_embedding_breaker.fail_counter,
            "fail_max": text_embedding_breaker.fail_max,
            "reset_timeout": text_embedding_breaker.reset_timeout,
        },
        "whisper": {
            "name": "whisper-transcription",
            "state": whisper_breaker.current_state.name,
            "fail_counter": whisper_breaker.fail_counter,
            "fail_max": whisper_breaker.fail_max,
            "reset_timeout": whisper_breaker.reset_timeout,
        },
    }


@app.get("/")
async def root():
    """Endpoint raiz com informações do serviço multimodal"""
    return {
        "service": "Multimodal Inference Service (100% LOCAL)",
        "version": "1.2.0",
        "models": {
            "clip": MODEL_NAME,
            "text_embedding": TEXT_EMBEDDING_MODEL,
            "whisper": f"faster-whisper-{WHISPER_MODEL_SIZE}",
        },
        "embedding_dim": EMBEDDING_DIM,
        "device": device,
        "endpoints": {
            "clip_inference": "POST /inference/clip",
            "text_embedding": "POST /inference/text-embedding",
            "audio_transcription": "POST /inference/transcribe",
            "health": "GET /health",
            "readiness": "GET /ready",
            "circuit_breaker_status": "GET /api/circuit-breaker/status",
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
