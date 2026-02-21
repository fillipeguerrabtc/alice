"""
Alice Enterprise Platform - LoRA Trainer (GPU)

Serviço responsável por executar slices curtas de fine-tuning LoRA/QLoRA em GPU única (20GB),
com persistência em disco e sem manter o modelo residente entre chamadas (preempção real).

Autor: Fillipe Guerra
Data: 26 de Dezembro de 2025
"""

from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path
from typing import Any, Dict, Optional

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from prometheus_client import Counter, Gauge, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response

from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForCausalLM, TrainingArguments
from transformers.trainer import Trainer
from peft import LoraConfig, get_peft_model, PeftModel


app = FastAPI(title="Alice LoRA Trainer", version="1.0.0")

SERVICE_START = time.time()
TRAIN_SLICES_TOTAL = Counter("lora_trainer_slices_total", "Total de slices de treino processadas", ["status"])
TRAIN_SLICE_DURATION = Histogram("lora_trainer_slice_duration_seconds", "Duração de slice de treino (s)")
GPU_MEMORY_USED = Gauge("lora_trainer_gpu_memory_bytes", "Memória GPU utilizada")
LAST_REQUEST_TIME = Gauge("lora_trainer_last_request_timestamp", "Timestamp do último request (para monitoramento)")

DEVICE = os.environ.get("DEVICE", "cuda").strip().lower()
if DEVICE != "cuda":
    # Regra 6 (sem fallback CPU): treinamento exige GPU CUDA real.
    raise RuntimeError("LoRA Trainer requer DEVICE=cuda (GPU obrigatória).")
if not torch.cuda.is_available():
    # Fail-fast: não permitir container iniciar sem CUDA disponível.
    raise RuntimeError("LoRA Trainer requer GPU CUDA disponível (torch.cuda.is_available()=false).")


def _storage_dir() -> Path:
    base = os.environ.get("STORAGE_DIR", "/opt/alice/uploads/training")
    return Path(base)


def _ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def _update_gpu_metrics() -> None:
    if torch.cuda.is_available():
        GPU_MEMORY_USED.set(int(torch.cuda.memory_allocated()))
    else:
        GPU_MEMORY_USED.set(0)


class LoraHyperparams(BaseModel):
    epochs: int = Field(3, ge=1, le=50)
    learningRate: float = Field(1e-4, gt=0, lt=1.0)
    batchSize: int = Field(2, ge=1, le=64)
    maxSeqLen: int = Field(1536, ge=256, le=32768)
    gradientAccumulationSteps: int = Field(2, ge=1, le=128)
    warmupSteps: int = Field(0, ge=0, le=10000)
    loraRank: int = Field(16, ge=4, le=128)
    loraAlpha: int = Field(32, ge=8, le=256)
    loraDropout: float = Field(0.05, ge=0.0, le=0.5)


class TrainSliceRequest(BaseModel):
    jobId: str = Field(..., min_length=1, max_length=128)
    baseModel: str = Field(..., min_length=3, max_length=512)
    trainJsonlPath: str = Field(..., min_length=1, max_length=1000)
    evalJsonlPath: Optional[str] = Field(None, min_length=1, max_length=1000)
    outputDir: str = Field(..., min_length=1, max_length=1000)
    hyperparameters: LoraHyperparams
    stepsThisSlice: int = Field(10, ge=1, le=500)
    seed: int = Field(42, ge=0, le=2**31 - 1)


class TrainSliceResponse(BaseModel):
    jobId: str
    status: str
    stepsCompleted: int
    adapterPath: Optional[str] = None
    metrics: Dict[str, Any] = Field(default_factory=dict)
    durationMs: int


class CancelRequest(BaseModel):
    jobId: str = Field(..., min_length=1, max_length=128)


@app.get("/health")
def health() -> Dict[str, Any]:
    LAST_REQUEST_TIME.set(time.time())
    _update_gpu_metrics()
    return {
        "status": "ok",
        "uptimeSeconds": int(time.time() - SERVICE_START),
        "cudaAvailable": torch.cuda.is_available(),
    }


@app.get("/metrics")
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/train/lora/slice", response_model=TrainSliceResponse)
def train_lora_slice(req: TrainSliceRequest) -> TrainSliceResponse:
    """
    Executa um slice curto de treino:
    - Carrega checkpoint existente se houver
    - Treina N steps
    - Salva adapter LoRA + estado do trainer
    - Libera VRAM ao final (processo continua, mas modelo é deletado)
    """
    LAST_REQUEST_TIME.set(time.time())
    start = time.time()

    storage = _storage_dir()
    _ensure_dir(storage)

    job_dir = storage / "jobs" / req.jobId
    _ensure_dir(job_dir)

    cancel_flag = job_dir / "CANCEL"
    if cancel_flag.exists():
        TRAIN_SLICES_TOTAL.labels(status="cancelled").inc()
        raise HTTPException(status_code=409, detail="Job cancelado")

    # Validar paths: devem estar dentro do storage (evita path traversal)
    train_path = Path(req.trainJsonlPath).resolve()
    out_dir = Path(req.outputDir).resolve()
    storage_resolved = storage.resolve()
    if storage_resolved not in train_path.parents:
        raise HTTPException(status_code=400, detail="trainJsonlPath fora do STORAGE_DIR")
    if storage_resolved not in out_dir.parents:
        raise HTTPException(status_code=400, detail="outputDir fora do STORAGE_DIR")

    eval_path = Path(req.evalJsonlPath).resolve() if req.evalJsonlPath else None
    if eval_path and storage_resolved not in eval_path.parents:
        raise HTTPException(status_code=400, detail="evalJsonlPath fora do STORAGE_DIR")

    _ensure_dir(out_dir)

    # Estado persistido
    state_file = job_dir / "state.json"
    state: Dict[str, Any] = {"stepsCompleted": 0}
    if state_file.exists():
        state = json.loads(state_file.read_text(encoding="utf-8"))

    steps_completed = int(state.get("stepsCompleted", 0))

    with TRAIN_SLICE_DURATION.time():
        try:
            torch.manual_seed(req.seed)
            if torch.cuda.is_available():
                torch.cuda.manual_seed_all(req.seed)

            # Dataset JSONL -> HF datasets
            dataset = load_dataset("json", data_files={"train": str(train_path)}, split="train")
            if eval_path:
                eval_dataset = load_dataset("json", data_files={"eval": str(eval_path)}, split="eval")
            else:
                eval_dataset = None

            # Tokenizer
            tokenizer = AutoTokenizer.from_pretrained(req.baseModel, use_fast=True, trust_remote_code=True)
            if tokenizer.pad_token is None:
                tokenizer.pad_token = tokenizer.eos_token

            def tokenize_fn(ex: Dict[str, Any]) -> Dict[str, Any]:
                text = ex.get("text")
                if not isinstance(text, str) or len(text) == 0:
                    raise ValueError("Campo 'text' ausente/vazio no JSONL")
                tokens = tokenizer(
                    text,
                    truncation=True,
                    max_length=req.hyperparameters.maxSeqLen,
                    padding="max_length",
                )
                tokens["labels"] = tokens["input_ids"].copy()
                return tokens

            dataset = dataset.map(tokenize_fn, remove_columns=dataset.column_names)
            if eval_dataset is not None:
                eval_dataset = eval_dataset.map(tokenize_fn, remove_columns=eval_dataset.column_names)

            # Modelo base (4-bit QLoRA)
            # Regra 6: PROIBIDO fallback silencioso (ex.: "cair para fp16") pois mascara
            # misconfiguração e pode estourar VRAM em produção.
            try:
                model = AutoModelForCausalLM.from_pretrained(
                    req.baseModel,
                    torch_dtype=torch.float16,
                    device_map="auto",
                    trust_remote_code=True,
                    load_in_4bit=True,
                )
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Falha ao carregar modelo em 4-bit (QLoRA). Verifique CUDA/bitsandbytes. Erro: {type(e).__name__}: {e}",
                ) from e

            lora_cfg = LoraConfig(
                r=req.hyperparameters.loraRank,
                lora_alpha=req.hyperparameters.loraAlpha,
                lora_dropout=req.hyperparameters.loraDropout,
                bias="none",
                task_type="CAUSAL_LM",
            )

            model = get_peft_model(model, lora_cfg)
            model.print_trainable_parameters()

            # Se já existe adapter salvo, recarregar para continuar
            adapter_dir = out_dir / "adapter"
            if adapter_dir.exists():
                model = PeftModel.from_pretrained(model, str(adapter_dir))

            # Trainer config: limitar steps por slice
            args = TrainingArguments(
                output_dir=str(out_dir / "trainer"),
                overwrite_output_dir=False,
                do_train=True,
                do_eval=eval_dataset is not None,
                num_train_epochs=req.hyperparameters.epochs,
                learning_rate=req.hyperparameters.learningRate,
                per_device_train_batch_size=req.hyperparameters.batchSize,
                per_device_eval_batch_size=req.hyperparameters.batchSize,
                gradient_accumulation_steps=req.hyperparameters.gradientAccumulationSteps,
                warmup_steps=req.hyperparameters.warmupSteps,
                logging_steps=1,
                save_steps=req.stepsThisSlice,
                eval_steps=req.stepsThisSlice if eval_dataset is not None else None,
                max_steps=steps_completed + req.stepsThisSlice,
                bf16=False,
                fp16=True,
                report_to=[],
            )

            trainer = Trainer(
                model=model,
                args=args,
                train_dataset=dataset,
                eval_dataset=eval_dataset,
                tokenizer=tokenizer,
            )

            trainer.train(resume_from_checkpoint=str(out_dir / "trainer") if (out_dir / "trainer").exists() else None)

            # Persistir adapter
            _ensure_dir(adapter_dir)
            model.save_pretrained(str(adapter_dir))
            tokenizer.save_pretrained(str(out_dir / "tokenizer"))

            steps_completed = steps_completed + req.stepsThisSlice
            state_file.write_text(json.dumps({"stepsCompleted": steps_completed}, indent=2), encoding="utf-8")

            _update_gpu_metrics()
            TRAIN_SLICES_TOTAL.labels(status="ok").inc()
            duration_ms = int((time.time() - start) * 1000)

            # Liberar VRAM
            del trainer
            del model
            del tokenizer
            torch.cuda.empty_cache()

            return TrainSliceResponse(
                jobId=req.jobId,
                status="ok",
                stepsCompleted=steps_completed,
                adapterPath=str(adapter_dir),
                metrics={},
                durationMs=duration_ms,
            )
        except HTTPException:
            raise
        except Exception as e:
            TRAIN_SLICES_TOTAL.labels(status="error").inc()
            _update_gpu_metrics()
            raise HTTPException(status_code=500, detail=f"Erro no treino: {str(e)}") from e


@app.post("/train/lora/cancel")
def cancel_job(req: CancelRequest) -> Dict[str, Any]:
    storage = _storage_dir()
    job_dir = storage / "jobs" / req.jobId
    _ensure_dir(job_dir)
    (job_dir / "CANCEL").write_text("cancelled\n", encoding="utf-8")
    return {"status": "ok", "jobId": req.jobId}


@app.delete("/train/lora/purge/{job_id}")
def purge_job(job_id: str) -> Dict[str, Any]:
    storage = _storage_dir()
    job_dir = storage / "jobs" / job_id
    out_dir = storage / "artifacts" / job_id
    removed = 0
    for p in [job_dir, out_dir]:
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)
            removed += 1
    return {"status": "ok", "jobId": job_id, "removed": removed}

