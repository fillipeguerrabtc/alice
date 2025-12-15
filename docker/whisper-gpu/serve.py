"""
Whisper GPU Inference Server - Alice Enterprise Platform

Servidor de transcrição de áudio via faster-whisper em GPU (Salad Cloud).

Endpoints:
- POST /transcribe - Transcrição de áudio (JSON com base64)
- POST /transcribe/file - Transcrição de áudio (multipart form)
- GET /health - Health check básico
- GET /ready - Readiness probe (modelo carregado)
- GET /metrics - Métricas Prometheus

ARQUITETURA HÍBRIDA (Opção B - Híbrido Inteligente):
- Este serviço: Transcrição de áudio via GPU (Salad Cloud)
- clip-inference-service: Embeddings de texto/imagem via CPU (Hetzner)

Benefícios:
- 7-9x mais rápido que CPU para transcrição
- Modelo large-v3 para máxima qualidade
- Libera CPU do Hetzner para embeddings

Autor: Fillipe Guerra
Data: 15 de Dezembro de 2025
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
from datetime import datetime
from typing import Optional
from contextlib import asynccontextmanager

import torch
from faster_whisper import WhisperModel
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from starlette.status import HTTP_413_REQUEST_ENTITY_TOO_LARGE, HTTP_503_SERVICE_UNAVAILABLE, HTTP_504_GATEWAY_TIMEOUT
from pydantic import BaseModel, Field
import uvicorn
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import pybreaker
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response

# Configuração de logging estruturado (Regra 8 - Pino equivalent)
IS_PRODUCTION = os.getenv("NODE_ENV", "production") == "production"
logging.basicConfig(
    level=logging.INFO,
    format='{"timestamp": "%(asctime)s", "level": "%(levelname)s", "service": "whisper-gpu", "message": "%(message)s"}'
)
logger = logging.getLogger(__name__)

# Configuração
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "large-v3")
PORT = int(os.getenv("PORT", 8080))

# Limites (configuráveis via env)
MAX_AUDIO_SIZE_BYTES = int(os.getenv("MAX_AUDIO_SIZE_BYTES", 100 * 1024 * 1024))  # 100MB default
TRANSCRIPTION_TIMEOUT_SECONDS = int(os.getenv("TRANSCRIPTION_TIMEOUT_SECONDS", 600))  # 10min para áudios longos

# SEGURANÇA: Rate limiter (FastAPI 2025 + OWASP API4)
limiter = Limiter(key_func=get_remote_address)

# ============================================================================
# PROMETHEUS METRICS (Regra 16 - Enterprise Observability)
# ============================================================================
WHISPER_REQUESTS_TOTAL = Counter(
    'whisper_gpu_requests_total',
    'Total de requisições de transcrição Whisper GPU',
    ['status']
)
WHISPER_LATENCY = Histogram(
    'whisper_gpu_latency_seconds',
    'Latência de requisições Whisper GPU em segundos',
    buckets=[1.0, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0, 600.0]
)
WHISPER_AUDIO_DURATION = Histogram(
    'whisper_gpu_audio_duration_seconds',
    'Duração do áudio processado em segundos',
    buckets=[5.0, 15.0, 30.0, 60.0, 120.0, 300.0, 600.0, 1800.0, 3600.0]
)
WHISPER_REALTIME_FACTOR = Histogram(
    'whisper_gpu_realtime_factor',
    'Fator de tempo real (duração_áudio / tempo_processamento)',
    buckets=[0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0]
)
CIRCUIT_BREAKER_STATE = Gauge(
    'whisper_gpu_circuit_breaker_state',
    'Estado do circuit breaker (0=closed, 1=open, 0.5=half-open)'
)
CIRCUIT_BREAKER_FAILURES = Counter(
    'whisper_gpu_circuit_breaker_failures_total',
    'Total de falhas registradas pelo circuit breaker'
)
MODEL_LOADED = Gauge(
    'whisper_gpu_model_loaded',
    'Indica se o modelo está carregado (1=sim, 0=não)'
)

# ============================================================================
# CIRCUIT BREAKER (Regra 16 - Best Practices 2025)
# ============================================================================
class WhisperBreakerListener(pybreaker.CircuitBreakerListener):
    """Listener para métricas e logging do circuit breaker."""
    
    def state_change(self, cb: pybreaker.CircuitBreaker, old_state: pybreaker.CircuitBreakerState, new_state: pybreaker.CircuitBreakerState) -> None:
        state_value = 0.0
        if new_state.name == 'open':
            state_value = 1.0
        elif new_state.name == 'half-open':
            state_value = 0.5
        CIRCUIT_BREAKER_STATE.set(state_value)
        logger.warning(f"Circuit breaker: {old_state.name} -> {new_state.name}")
    
    def failure(self, cb: pybreaker.CircuitBreaker, exc: Exception) -> None:
        CIRCUIT_BREAKER_FAILURES.inc()
        logger.error(f"Circuit breaker registrou falha: {exc}")

whisper_breaker = pybreaker.CircuitBreaker(
    fail_max=3,
    reset_timeout=60,
    exclude=[HTTPException],
    listeners=[WhisperBreakerListener()],
    name='whisper-gpu-inference'
)

CIRCUIT_BREAKER_STATE.set(0)

# ============================================================================
# CARREGAR MODELO WHISPER (GPU)
# ============================================================================
device = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"Dispositivo de inferência: {device}")

if device != "cuda":
    logger.warning("GPU não disponível! Este container é otimizado para GPU. Performance será degradada em CPU.")

logger.info(f"Carregando modelo Whisper {WHISPER_MODEL_SIZE}...")
start_time = time.time()

# compute_type: float16 para GPU (máxima performance), int8 para CPU
compute_type = "float16" if device == "cuda" else "int8"
whisper_model: Optional[WhisperModel] = None

try:
    whisper_model = WhisperModel(
        WHISPER_MODEL_SIZE,
        device=device,
        compute_type=compute_type,
        num_workers=2,  # Workers paralelos para pipeline
    )
    load_time = time.time() - start_time
    logger.info(f"Modelo Whisper carregado em {load_time:.2f}s (device={device}, compute_type={compute_type})")
    MODEL_LOADED.set(1)
except Exception as e:
    logger.error(f"ERRO CRÍTICO ao carregar modelo Whisper: {e}")
    MODEL_LOADED.set(0)
    raise RuntimeError(f"Falha crítica ao carregar Whisper: {e}") from e


# ============================================================================
# FASTAPI APP
# ============================================================================
@asynccontextmanager
async def lifespan(app):
    """Lifespan manager para graceful shutdown."""
    logger.info("Whisper GPU Service iniciado - pronto para requisições")
    yield
    logger.info("Iniciando graceful shutdown do Whisper GPU Service...")
    await asyncio.sleep(2)
    logger.info("Whisper GPU Service encerrado com sucesso")

app = FastAPI(
    title="Whisper GPU Inference Service",
    description="Transcrição de áudio via faster-whisper em GPU (Salad Cloud)",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS: Permite acesso do RAG service
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Internal-Secret"],
)


# ============================================================================
# SCHEMAS
# ============================================================================
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
    realtime_factor: float = Field(..., description="Fator de tempo real (quanto mais rápido que tempo real)")
    model: str = Field(..., description="Modelo Whisper usado")
    device: str = Field(..., description="Dispositivo usado (cuda/cpu)")


class HealthResponse(BaseModel):
    """Response do health check"""
    status: str
    model: str
    device: str
    model_loaded: bool


# ============================================================================
# ENDPOINTS
# ============================================================================
@app.post("/transcribe", response_model=TranscribeResponse)
@limiter.limit("30/minute")
async def transcribe_audio(
    request_http: Request,
    request: TranscribeRequest,
) -> TranscribeResponse:
    """
    Transcreve áudio usando faster-whisper em GPU.
    
    ARQUITETURA HÍBRIDA: Este endpoint roda em GPU (Salad Cloud) para
    performance 7-9x mais rápida que CPU.
    
    Rate limit: 30 requisições/minuto por IP.
    Timeout: 10 minutos por requisição (áudios muito longos).
    """
    start_time = time.time()
    
    if whisper_model is None:
        raise HTTPException(
            status_code=HTTP_503_SERVICE_UNAVAILABLE,
            detail="Modelo Whisper não carregado. Serviço indisponível."
        )
    
    # Decodificar áudio base64
    try:
        audio_data = request.audio
        if audio_data.startswith("data:"):
            comma_idx = audio_data.find(",")
            if comma_idx != -1:
                audio_data = audio_data[comma_idx + 1:]
        
        audio_bytes = base64.b64decode(audio_data)
    except Exception as e:
        logger.error(f"Erro ao decodificar áudio base64: {e}")
        raise HTTPException(status_code=400, detail="Formato de áudio inválido. Use base64 válido.")
    
    # Validar tamanho
    if len(audio_bytes) > MAX_AUDIO_SIZE_BYTES:
        raise HTTPException(
            status_code=HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Áudio muito grande. Máximo: {MAX_AUDIO_SIZE_BYTES // (1024 * 1024)}MB"
        )
    
    # Processar transcrição
    def process_transcription_sync() -> dict:
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as tmp_file:
                tmp_path = tmp_file.name
                tmp_file.write(audio_bytes)
            
            requested_lang = request.language
            segments, info = whisper_model.transcribe(
                tmp_path,
                language=requested_lang,
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500),
            )
            
            # Concatenar segmentos
            full_text = ""
            confidences = []
            for segment in segments:
                seg_text = getattr(segment, "text", "")
                if isinstance(seg_text, str) and seg_text:
                    if full_text and not full_text[-1].isspace() and not seg_text[0].isspace():
                        # Evitar espaço antes de pontuação
                        if seg_text[0] not in ".,;:!?)]}>»"":
                            full_text += " "
                    full_text += seg_text
                
                avg_logprob = getattr(segment, "avg_logprob", None)
                if avg_logprob is not None and isinstance(avg_logprob, (int, float)) and avg_logprob < 0:
                    import math
                    try:
                        if math.isfinite(avg_logprob):
                            conf = math.exp(avg_logprob)
                            conf = max(0.0, min(1.0, conf))
                            confidences.append(conf)
                    except Exception:
                        pass
            
            avg_confidence = sum(confidences) / len(confidences) if confidences else None
            full_text_stripped = full_text.strip()
            
            if not full_text_stripped:
                return {
                    "_error": {
                        "status_code": 422,
                        "detail": "Áudio contém apenas silêncio ou é muito curto. Nenhum texto detectado.",
                    },
                    "duration_seconds": info.duration,
                    "language": info.language,
                    "requested_language": requested_lang,
                }
            
            logger.info(f"Transcrição GPU: {info.duration:.1f}s áudio, {len(full_text_stripped)} chars, idioma={info.language}")
            
            return {
                "text": full_text_stripped,
                "language": info.language,
                "requested_language": requested_lang,
                "confidence": avg_confidence,
                "duration_seconds": info.duration,
            }
            
        finally:
            if tmp_path:
                try:
                    import os as temp_os
                    temp_os.unlink(tmp_path)
                except Exception:
                    pass
    
    try:
        result = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None,
                lambda: whisper_breaker.call(process_transcription_sync)
            ),
            timeout=TRANSCRIPTION_TIMEOUT_SECONDS
        )
        
        if isinstance(result, dict) and "_error" in result:
            err = result["_error"]
            raise HTTPException(status_code=err.get("status_code", 500), detail=err.get("detail", "Erro"))
        
        processing_time_ms = int((time.time() - start_time) * 1000)
        duration_seconds = result["duration_seconds"]
        processing_time_seconds = processing_time_ms / 1000
        realtime_factor = duration_seconds / processing_time_seconds if processing_time_seconds > 0 else 0
        
        # Métricas
        WHISPER_REQUESTS_TOTAL.labels(status='success').inc()
        WHISPER_LATENCY.observe(processing_time_seconds)
        WHISPER_AUDIO_DURATION.observe(duration_seconds)
        WHISPER_REALTIME_FACTOR.observe(realtime_factor)
        
        return TranscribeResponse(
            text=result["text"],
            language=result["language"],
            requested_language=result["requested_language"],
            confidence=result["confidence"],
            duration_seconds=duration_seconds,
            processing_time_ms=processing_time_ms,
            realtime_factor=round(realtime_factor, 2),
            model=f"faster-whisper-{WHISPER_MODEL_SIZE}",
            device=device,
        )
        
    except pybreaker.CircuitBreakerError:
        WHISPER_REQUESTS_TOTAL.labels(status='circuit_open').inc()
        raise HTTPException(
            status_code=HTTP_503_SERVICE_UNAVAILABLE,
            detail="Serviço temporariamente indisponível. Tente novamente em 60 segundos."
        )
    except asyncio.TimeoutError:
        WHISPER_REQUESTS_TOTAL.labels(status='timeout').inc()
        raise HTTPException(
            status_code=HTTP_504_GATEWAY_TIMEOUT,
            detail=f"Timeout: transcrição excedeu {TRANSCRIPTION_TIMEOUT_SECONDS} segundos"
        )
    except HTTPException:
        WHISPER_REQUESTS_TOTAL.labels(status='client_error').inc()
        raise
    except Exception as e:
        WHISPER_REQUESTS_TOTAL.labels(status='error').inc()
        logger.error(f"Erro ao transcrever: {e}")
        raise HTTPException(status_code=500, detail=f"Erro: {str(e)}")


@app.post("/transcribe/file", response_model=TranscribeResponse)
@limiter.limit("30/minute")
async def transcribe_audio_file(
    request_http: Request,
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
) -> TranscribeResponse:
    """
    Transcreve áudio via upload de arquivo (multipart form).
    Alternativa ao endpoint JSON para arquivos grandes.
    """
    audio_bytes = await file.read()
    
    # Converter para base64 e reutilizar endpoint principal
    audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
    
    request_obj = TranscribeRequest(audio=audio_base64, language=language)
    return await transcribe_audio(request_http, request_obj)


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Health check do serviço."""
    model_loaded = whisper_model is not None
    return HealthResponse(
        status="ok" if model_loaded else "degraded",
        model=f"faster-whisper-{WHISPER_MODEL_SIZE}",
        device=device,
        model_loaded=model_loaded,
    )


@app.get("/ready")
async def readiness_probe():
    """Readiness probe - verifica se modelo está carregado."""
    if whisper_model is None:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "reason": "Modelo Whisper não carregado",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )
    
    circuit_ready = whisper_breaker.current_state.name != "open"
    if not circuit_ready:
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "reason": "Circuit breaker aberto",
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
        )
    
    return {
        "status": "ready",
        "service": "whisper-gpu",
        "model": f"faster-whisper-{WHISPER_MODEL_SIZE}",
        "device": device,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@app.get("/live")
async def liveness_probe():
    """Liveness probe - processo está vivo."""
    return {
        "status": "alive",
        "service": "whisper-gpu",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@app.get("/metrics")
async def metrics():
    """Métricas Prometheus."""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/")
async def root():
    """Endpoint raiz com informações do serviço."""
    return {
        "service": "Whisper GPU Inference Service (Salad Cloud)",
        "version": "1.0.0",
        "model": f"faster-whisper-{WHISPER_MODEL_SIZE}",
        "device": device,
        "endpoints": {
            "transcribe_json": "POST /transcribe",
            "transcribe_file": "POST /transcribe/file",
            "health": "GET /health",
            "readiness": "GET /ready",
            "liveness": "GET /live",
            "metrics": "GET /metrics",
        },
    }


if __name__ == "__main__":
    logger.info(f"Iniciando Whisper GPU Server na porta {PORT}")
    uvicorn.run(
        app,
        host="::",
        port=PORT,
        log_level="info",
        timeout_graceful_shutdown=30,
    )
