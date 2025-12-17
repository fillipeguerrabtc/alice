"""
Alice Enterprise Platform - ASR Canary Service
Serviço de transcrição de áudio usando NeMo Canary.

Autor: Fillipe Guerra
Data: 16 de Dezembro de 2025
"""

import os
import io
import logging
import tempfile
from typing import Optional

import torch
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response

# Configuração de logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Métricas Prometheus
TRANSCRIPTION_COUNTER = Counter(
    "asr_transcriptions_total",
    "Total de transcrições processadas",
    ["status"]
)
TRANSCRIPTION_DURATION = Histogram(
    "asr_transcription_duration_seconds",
    "Tempo de processamento de transcrições",
    buckets=[0.5, 1, 2, 5, 10, 30, 60]
)

# Configuração
MODEL_NAME = os.environ.get("MODEL_NAME", "nvidia/canary-1b")
DEVICE = os.environ.get("DEVICE", "cuda" if torch.cuda.is_available() else "cpu")

app = FastAPI(
    title="Alice ASR Service",
    description="Serviço de transcrição de áudio (Speech-to-Text) usando NeMo Canary",
    version="1.0.0"
)

# Modelo NeMo (carregado no startup)
model = None


class TranscriptionResponse(BaseModel):
    """Resposta de transcrição."""
    text: str
    language: Optional[str] = None
    confidence: Optional[float] = None
    duration_seconds: Optional[float] = None


@app.on_event("startup")
async def load_model():
    """Carrega o modelo NeMo Canary no startup."""
    global model
    
    logger.info(f"Carregando modelo NeMo ASR: {MODEL_NAME}")
    logger.info(f"Dispositivo: {DEVICE}")
    
    try:
        # Bug fix: Usar NeMo toolkit para modelos nvidia/canary (não transformers)
        # nvidia/canary-1b é um modelo NeMo, não HuggingFace transformers
        from nemo.collections.asr.models import EncDecMultiTaskModel
        
        # Carregar modelo NeMo Canary
        model = EncDecMultiTaskModel.from_pretrained(MODEL_NAME)
        
        # Mover para GPU se disponível
        if DEVICE == "cuda" and torch.cuda.is_available():
            model = model.to(DEVICE)
        
        # Modo de avaliação
        model.eval()
        
        logger.info("✅ Modelo NeMo Canary carregado com sucesso")
        
    except Exception as e:
        logger.error(f"❌ Erro ao carregar modelo NeMo ASR: {e}")
        logger.error("O serviço iniciará mas /transcribe retornará 503 até o modelo ser carregado")
        # O modelo será None e endpoints retornarão 503 (Service Unavailable)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "model": MODEL_NAME,
        "device": DEVICE,
        "gpu_available": torch.cuda.is_available()
    }


@app.get("/ready")
async def ready_check():
    """Readiness check - verifica se modelo está carregado."""
    if model is None:
        raise HTTPException(status_code=503, detail="Modelo não carregado")
    return {"status": "ready", "model": MODEL_NAME}


@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    file: UploadFile = File(...),
    language: Optional[str] = "pt"
):
    """
    Transcreve áudio para texto usando NeMo Canary.
    
    Args:
        file: Arquivo de áudio (wav, mp3, m4a, etc.)
        language: Código do idioma (default: pt para português)
    
    Returns:
        TranscriptionResponse com texto transcrito
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Modelo não carregado")
    
    import time
    start_time = time.time()
    
    # Bug fix: Declarar tmp_path fora do try para uso no finally
    tmp_path = None
    
    try:
        # Salvar arquivo temporário
        # Bug fix: Atribuir tmp_path ANTES de operações que podem falhar
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            tmp_path = tmp.name  # Primeiro - garante cleanup no finally
            content = await file.read()  # Pode falhar (client disconnect, OOM)
            tmp.write(content)
        
        # Transcrever com NeMo Canary
        # O modelo Canary usa transcribe() diretamente com path do arquivo
        with torch.no_grad():
            # NeMo Canary aceita lista de arquivos e retorna lista de transcrições
            transcriptions = model.transcribe(
                paths2audio_files=[tmp_path],
                batch_size=1,
                source_lang=language or "pt",
                target_lang=language or "pt",
            )
        
        # Extrair texto da transcrição
        text = transcriptions[0] if transcriptions else ""
        detected_language = language
        
        duration = time.time() - start_time
        
        TRANSCRIPTION_COUNTER.labels(status="success").inc()
        TRANSCRIPTION_DURATION.observe(duration)
        
        logger.info(f"Transcrição concluída em {duration:.2f}s")
        
        return TranscriptionResponse(
            text=text.strip() if isinstance(text, str) else str(text).strip(),
            language=detected_language,
            confidence=0.95,  # NeMo não retorna confidence diretamente
            duration_seconds=duration
        )
        
    except Exception as e:
        TRANSCRIPTION_COUNTER.labels(status="error").inc()
        logger.error(f"Erro na transcrição: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    finally:
        # Bug fix: Garantir limpeza do arquivo temporário mesmo em caso de erro
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass  # Ignorar erros de limpeza


@app.get("/metrics")
async def metrics():
    """Endpoint de métricas Prometheus."""
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
