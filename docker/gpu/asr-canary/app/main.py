"""
Alice Enterprise Platform - ASR Canary Service
Serviço de transcrição de áudio usando Canary-Qwen ou NeMo.

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
    description="Serviço de transcrição de áudio (Speech-to-Text)",
    version="1.0.0"
)

# Modelo (carregado no startup)
model = None
processor = None


class TranscriptionResponse(BaseModel):
    """Resposta de transcrição."""
    text: str
    language: Optional[str] = None
    confidence: Optional[float] = None
    duration_seconds: Optional[float] = None


@app.on_event("startup")
async def load_model():
    """Carrega o modelo ASR no startup."""
    global model, processor
    
    logger.info(f"Carregando modelo ASR: {MODEL_NAME}")
    logger.info(f"Dispositivo: {DEVICE}")
    
    try:
        # Usar transformers para modelos HuggingFace
        from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
        
        processor = AutoProcessor.from_pretrained(MODEL_NAME)
        model = AutoModelForSpeechSeq2Seq.from_pretrained(
            MODEL_NAME,
            torch_dtype=torch.float16 if DEVICE == "cuda" else torch.float32,
            device_map="auto" if DEVICE == "cuda" else None
        )
        
        if DEVICE == "cuda":
            model = model.to(DEVICE)
        
        logger.info("✅ Modelo ASR carregado com sucesso")
        
    except Exception as e:
        logger.error(f"❌ Erro ao carregar modelo ASR: {e}")
        logger.error("O serviço iniciará mas /transcribe retornará 503 até o modelo ser carregado")
        # Nota: Não usamos fallback whisper pois não está instalado no container
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
    language: Optional[str] = None
):
    """
    Transcreve áudio para texto.
    
    Args:
        file: Arquivo de áudio (wav, mp3, m4a, etc.)
        language: Código do idioma (opcional, auto-detect se não especificado)
    
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
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name
        
        # Processar com modelo HuggingFace/NeMo (único modelo suportado)
        # Nota: Whisper não está instalado no container, apenas nemo_toolkit[asr] + transformers
        import torchaudio
        waveform, sample_rate = torchaudio.load(tmp_path)
        inputs = processor(
            waveform.squeeze().numpy(),
            sampling_rate=sample_rate,
            return_tensors="pt"
        ).to(DEVICE)
        
        with torch.no_grad():
            generated_ids = model.generate(**inputs)
        
        text = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
        detected_language = language
        
        duration = time.time() - start_time
        
        TRANSCRIPTION_COUNTER.labels(status="success").inc()
        TRANSCRIPTION_DURATION.observe(duration)
        
        logger.info(f"Transcrição concluída em {duration:.2f}s")
        
        return TranscriptionResponse(
            text=text.strip(),
            language=detected_language,
            confidence=0.95,  # TODO: calcular confidence real
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
