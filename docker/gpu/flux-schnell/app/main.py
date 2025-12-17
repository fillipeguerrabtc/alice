"""
Alice Enterprise Platform - FLUX.1 Schnell Image Generation
Serviço de geração de imagens usando FLUX.1 Schnell.

Autor: Fillipe Guerra
Data: 16 de Dezembro de 2025
"""

import os
import io
import logging
import base64
from typing import Optional

import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response
from PIL import Image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Métricas
IMAGE_GEN_COUNTER = Counter("flux_images_generated_total", "Total de imagens geradas", ["status"])
IMAGE_GEN_DURATION = Histogram("flux_generation_duration_seconds", "Tempo de geração", buckets=[1, 2, 5, 10, 30, 60])

MODEL_NAME = os.environ.get("MODEL_NAME", "black-forest-labs/FLUX.1-schnell")
NUM_STEPS = int(os.environ.get("NUM_INFERENCE_STEPS", "4"))
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

app = FastAPI(
    title="Alice FLUX.1 Schnell",
    description="Serviço de geração de imagens",
    version="1.0.0"
)

pipe = None


class ImageRequest(BaseModel):
    """Request para geração de imagem."""
    prompt: str = Field(..., description="Prompt para geração")
    negative_prompt: Optional[str] = Field(None, description="Prompt negativo")
    width: int = Field(1024, ge=256, le=2048)
    height: int = Field(1024, ge=256, le=2048)
    num_inference_steps: int = Field(4, ge=1, le=50)
    guidance_scale: float = Field(3.5, ge=0, le=20)
    seed: Optional[int] = None


class ImageResponse(BaseModel):
    """Resposta com imagem gerada."""
    image_base64: str
    width: int
    height: int
    seed: int
    generation_time_ms: int


@app.on_event("startup")
async def load_model():
    """Carrega o modelo FLUX no startup."""
    global pipe
    
    logger.info(f"Carregando modelo FLUX: {MODEL_NAME}")
    logger.info(f"Dispositivo: {DEVICE}")
    
    try:
        from diffusers import FluxPipeline
        
        pipe = FluxPipeline.from_pretrained(
            MODEL_NAME,
            torch_dtype=torch.bfloat16 if DEVICE == "cuda" else torch.float32,
        )
        
        if DEVICE == "cuda":
            # Bug fix: NÃO usar .to(DEVICE) junto com enable_model_cpu_offload()
            # enable_model_cpu_offload() gerencia device automaticamente
            pipe.enable_model_cpu_offload()  # Move componentes para GPU apenas durante forward pass
        
        logger.info("✅ Modelo FLUX carregado com sucesso")
        
    except Exception as e:
        logger.error(f"Erro ao carregar modelo: {e}")
        raise


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model": MODEL_NAME,
        "device": DEVICE,
        "gpu_available": torch.cuda.is_available()
    }


@app.get("/ready")
async def ready_check():
    if pipe is None:
        raise HTTPException(status_code=503, detail="Modelo não carregado")
    return {"status": "ready", "model": MODEL_NAME}


@app.post("/generate", response_model=ImageResponse)
async def generate_image(request: ImageRequest):
    """Gera uma imagem a partir do prompt."""
    if pipe is None:
        raise HTTPException(status_code=503, detail="Modelo não carregado")
    
    import time
    start_time = time.time()
    
    try:
        # Configurar seed
        generator = None
        seed = request.seed
        if seed is not None:
            generator = torch.Generator(device=DEVICE).manual_seed(seed)
        else:
            seed = torch.randint(0, 2**32, (1,)).item()
            generator = torch.Generator(device=DEVICE).manual_seed(seed)
        
        # Gerar imagem
        with torch.inference_mode():
            result = pipe(
                prompt=request.prompt,
                negative_prompt=request.negative_prompt,
                width=request.width,
                height=request.height,
                num_inference_steps=request.num_inference_steps,
                guidance_scale=request.guidance_scale,
                generator=generator,
            )
        
        image = result.images[0]
        
        # Converter para base64
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        image_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        generation_time_ms = int((time.time() - start_time) * 1000)
        
        IMAGE_GEN_COUNTER.labels(status="success").inc()
        IMAGE_GEN_DURATION.observe(generation_time_ms / 1000)
        
        logger.info(f"Imagem gerada em {generation_time_ms}ms")
        
        return ImageResponse(
            image_base64=image_base64,
            width=request.width,
            height=request.height,
            seed=seed,
            generation_time_ms=generation_time_ms
        )
        
    except Exception as e:
        IMAGE_GEN_COUNTER.labels(status="error").inc()
        logger.error(f"Erro na geração: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/metrics")
async def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
