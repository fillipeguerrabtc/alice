"""
Biometrics Service - Alice Enterprise Platform

Biometria facial server-side CPU-only (sem liveness).
Armazena embeddings no PostgreSQL (pgvector) + cópia criptografada.
Expõe /metrics para Prometheus (observabilidade enterprise).

Documentação em PT-BR (Regra 10 CLAUDE.md).
"""

from __future__ import annotations

import asyncio
import base64
import hmac
import hashlib
import io
import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

import asyncpg
import face_recognition
import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from pgvector.asyncpg import register_vector
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    REGISTRY,
    Counter,
    Histogram,
    generate_latest,
)

INTERNAL_API_SECRET = os.getenv("INTERNAL_API_SECRET", "").strip()
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
BIOMETRICS_ENCRYPTION_KEY = os.getenv("BIOMETRICS_ENCRYPTION_KEY", "").strip()
BIOMETRICS_MATCH_THRESHOLD = os.getenv("BIOMETRICS_MATCH_THRESHOLD", "").strip()
BIOMETRICS_VERIFY_RATE_LIMIT = os.getenv("BIOMETRICS_VERIFY_RATE_LIMIT", "").strip()
BIOMETRICS_ENROLL_RATE_LIMIT = os.getenv("BIOMETRICS_ENROLL_RATE_LIMIT", "").strip()
BIOMETRICS_LIVENESS_THRESHOLD = os.getenv("BIOMETRICS_LIVENESS_THRESHOLD", "").strip()
BIOMETRICS_ENFORCE_LIVENESS = os.getenv("BIOMETRICS_ENFORCE_LIVENESS", "").strip()
INTERNAL_AUTH_MAX_DRIFT_SECONDS = os.getenv("INTERNAL_AUTH_MAX_DRIFT_SECONDS", "").strip()

if not INTERNAL_API_SECRET:
  raise RuntimeError("INTERNAL_API_SECRET é obrigatório para biometria.")
if not DATABASE_URL:
  raise RuntimeError("DATABASE_URL é obrigatório para biometria.")
if not BIOMETRICS_ENCRYPTION_KEY:
  raise RuntimeError("BIOMETRICS_ENCRYPTION_KEY é obrigatório para biometria.")

def parse_threshold(raw: str) -> float:
  if not raw:
    return 0.6
  value = float(raw)
  if value <= 0 or value > 1:
    raise RuntimeError("BIOMETRICS_MATCH_THRESHOLD deve estar entre 0 e 1.")
  return value

def parse_rate_limit(raw: str, fallback: int) -> int:
  if not raw:
    return fallback
  value = int(raw)
  if value <= 0:
    raise RuntimeError("Rate limit inválido para biometria.")
  return value

def parse_env_boolean(raw: str, fallback: bool) -> bool:
  if not raw:
    return fallback
  normalized = raw.strip().lower()
  if normalized in ("1", "true", "yes", "on"):
    return True
  if normalized in ("0", "false", "no", "off"):
    return False
  raise RuntimeError("Valor booleano invalido para biometria.")

MATCH_THRESHOLD = parse_threshold(BIOMETRICS_MATCH_THRESHOLD)
VERIFY_RATE_LIMIT = parse_rate_limit(BIOMETRICS_VERIFY_RATE_LIMIT, 5)
ENROLL_RATE_LIMIT = parse_rate_limit(BIOMETRICS_ENROLL_RATE_LIMIT, 3)
LIVENESS_THRESHOLD = parse_threshold(BIOMETRICS_LIVENESS_THRESHOLD) if BIOMETRICS_LIVENESS_THRESHOLD else 0.45
ENFORCE_LIVENESS = parse_env_boolean(BIOMETRICS_ENFORCE_LIVENESS, True)
MAX_AUTH_DRIFT_SECONDS = parse_rate_limit(INTERNAL_AUTH_MAX_DRIFT_SECONDS, 300)
MAX_ACTIVE_EMBEDDINGS = 3
SERVICE_NAME = "biometrics-service"
SERVICE_VERSION = "1.0.0"

def decode_encryption_key(raw: str) -> bytes:
  cleaned = raw.strip()
  if len(cleaned) == 64:
    return bytes.fromhex(cleaned)
  return base64.b64decode(cleaned)

ENCRYPTION_KEY = decode_encryption_key(BIOMETRICS_ENCRYPTION_KEY)
if len(ENCRYPTION_KEY) != 32:
  raise RuntimeError("BIOMETRICS_ENCRYPTION_KEY deve ter 32 bytes (hex 64 ou base64).")

aesgcm = AESGCM(ENCRYPTION_KEY)

logger = logging.getLogger(SERVICE_NAME)
if not logger.handlers:
  stream_handler = logging.StreamHandler()
  stream_handler.setFormatter(logging.Formatter("%(message)s"))
  logger.addHandler(stream_handler)
logger.setLevel(logging.INFO)
logger.propagate = False

def log_event(level: str, message: str, **context: Any) -> None:
  payload = {
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "level": level,
    "service": SERVICE_NAME,
    "message": message,
    **context,
  }
  logger.log(getattr(logging, level.upper(), logging.INFO), json.dumps(payload, ensure_ascii=False))

# Métricas Prometheus (padrão alice_* - observabilidade enterprise)
_BIOMETRICS_REQUEST_DURATION = Histogram(
    "alice_biometrics_request_duration_seconds",
    "Duração das requisições do Biometrics Service em segundos",
    ["method", "route"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
    registry=REGISTRY,
)
_BIOMETRICS_REQUESTS_TOTAL = Counter(
    "alice_biometrics_requests_total",
    "Total de requisições do Biometrics Service",
    ["method", "route", "status_code"],
    registry=REGISTRY,
)

_BIOMETRICS_LIVENESS_REJECTIONS_TOTAL = Counter(
    "alice_biometrics_liveness_rejections_total",
    "Total de bloqueios por liveness/anti-spoof no Biometrics Service",
    ["action_type", "reason"],
    registry=REGISTRY,
)
_BIOMETRICS_AUTH_FAILURES_TOTAL = Counter(
    "alice_biometrics_auth_failures_total",
    "Total de falhas de autenticacao interna no Biometrics Service",
    ["auth_mode", "reason"],
    registry=REGISTRY,
)

def _normalize_route(path: str) -> str:
    """Normaliza path para evitar cardinalidade alta em métricas."""
    if path in ("/health", "/ready", "/metrics"):
        return path
    if path == "/status":
        return "/api/auth/biometrics/status"
    if path == "/enroll":
        return "/api/auth/biometrics/enroll"
    if path == "/verify":
        return "/api/auth/biometrics/verify"
    return path

app = FastAPI(
  title="Alice Biometrics Service",
  version=SERVICE_VERSION,
  description="Serviço de biometria facial com persistência em PostgreSQL/pgvector, autenticação interna e observabilidade Prometheus.",
)
pool: Optional[asyncpg.Pool] = None
pool_lock = asyncio.Lock()

@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    """Registra duração e contagem de requisições para Prometheus."""
    correlation_id = request.headers.get("x-correlation-id", "").strip() or str(uuid.uuid4())
    request_id = request.headers.get("x-request-id", "").strip() or str(uuid.uuid4())
    start = time.perf_counter()
    route = _normalize_route(request.scope.get("path", request.url.path))
    method = request.method
    try:
      response = await call_next(request)
      status = str(response.status_code)
      duration = time.perf_counter() - start
      _BIOMETRICS_REQUEST_DURATION.labels(method=method, route=route).observe(duration)
      _BIOMETRICS_REQUESTS_TOTAL.labels(method=method, route=route, status_code=status).inc()
      response.headers["x-correlation-id"] = correlation_id
      response.headers["x-request-id"] = request_id
      log_event(
        "info",
        "Requisição processada no biometrics-service",
        correlationId=correlation_id,
        requestId=request_id,
        method=method,
        route=route,
        statusCode=response.status_code,
        durationMs=round(duration * 1000, 3),
      )
      return response
    except Exception as exc:  # noqa: BLE001
      duration = time.perf_counter() - start
      _BIOMETRICS_REQUEST_DURATION.labels(method=method, route=route).observe(duration)
      _BIOMETRICS_REQUESTS_TOTAL.labels(method=method, route=route, status_code="500").inc()
      log_event(
        "error",
        "Erro nao tratado no biometrics-service",
        correlationId=correlation_id,
        requestId=request_id,
        method=method,
        route=route,
        durationMs=round(duration * 1000, 3),
        error=str(exc),
      )
      raise

class StrictApiModel(BaseModel):
  model_config = ConfigDict(extra="forbid")

class EnrollRequest(StrictApiModel):
  userId: uuid.UUID
  tenantId: uuid.UUID
  imageBase64: str = Field(..., min_length=100, max_length=20_000_000)
  captureMode: Optional[Literal["replace", "append"]] = None
  metadata: Optional[dict[str, Any]] = None

class VerifyRequest(StrictApiModel):
  userId: uuid.UUID
  tenantId: uuid.UUID
  imageBase64: str = Field(..., min_length=100, max_length=20_000_000)
  actionType: Literal["login", "approval"]
  actionContext: Optional[dict[str, Any]] = None

class StatusRequest(StrictApiModel):
  userId: uuid.UUID
  tenantId: uuid.UUID

def _is_legacy_secret_valid(internal_secret: Optional[str]) -> bool:
  if not internal_secret:
    return False
  normalized = internal_secret.strip()
  if not normalized:
    return False
  return hmac.compare_digest(normalized, INTERNAL_API_SECRET)

def _validate_hmac_auth(
  request: Request,
  expected_user_id: str,
  expected_tenant_id: str,
) -> None:
  internal_signature = request.headers.get("x-internal-signature", "").strip()
  internal_timestamp = request.headers.get("x-internal-timestamp", "").strip()
  internal_user_id = request.headers.get("x-internal-user-id", "").strip()
  internal_tenant_id = request.headers.get("x-internal-tenant-id", "").strip()
  internal_role = request.headers.get("x-internal-role", "").strip()
  internal_custom_role_id = request.headers.get("x-internal-custom-role-id", "").strip()

  if not internal_signature or not internal_timestamp or not internal_user_id or not internal_role:
    _BIOMETRICS_AUTH_FAILURES_TOTAL.labels(auth_mode="hmac", reason="missing_headers").inc()
    raise HTTPException(status_code=401, detail="Unauthorized")
  if len(internal_signature) != 64:
    _BIOMETRICS_AUTH_FAILURES_TOTAL.labels(auth_mode="hmac", reason="invalid_signature_length").inc()
    raise HTTPException(status_code=401, detail="Unauthorized")

  try:
    timestamp = int(internal_timestamp)
  except ValueError as exc:
    _BIOMETRICS_AUTH_FAILURES_TOTAL.labels(auth_mode="hmac", reason="invalid_timestamp").inc()
    raise HTTPException(status_code=401, detail="Unauthorized") from exc

  now = int(time.time())
  if abs(now - timestamp) > MAX_AUTH_DRIFT_SECONDS:
    _BIOMETRICS_AUTH_FAILURES_TOTAL.labels(auth_mode="hmac", reason="timestamp_expired").inc()
    raise HTTPException(status_code=401, detail="Unauthorized")

  payload = f"{internal_user_id}:{internal_tenant_id}:{internal_role}:{internal_custom_role_id}:{internal_timestamp}"
  expected_signature = hmac.new(
    INTERNAL_API_SECRET.encode("utf-8"),
    payload.encode("utf-8"),
    hashlib.sha256,
  ).hexdigest()

  if not hmac.compare_digest(internal_signature.lower(), expected_signature.lower()):
    _BIOMETRICS_AUTH_FAILURES_TOTAL.labels(auth_mode="hmac", reason="signature_mismatch").inc()
    raise HTTPException(status_code=401, detail="Unauthorized")

  if internal_user_id != expected_user_id:
    _BIOMETRICS_AUTH_FAILURES_TOTAL.labels(auth_mode="hmac", reason="user_mismatch").inc()
    raise HTTPException(status_code=401, detail="Unauthorized")
  if internal_tenant_id and internal_tenant_id != expected_tenant_id:
    _BIOMETRICS_AUTH_FAILURES_TOTAL.labels(auth_mode="hmac", reason="tenant_mismatch").inc()
    raise HTTPException(status_code=401, detail="Unauthorized")

def ensure_internal_auth(
  request: Request,
  internal_secret: Optional[str],
  expected_user_id: str,
  expected_tenant_id: str,
) -> None:
  if _is_legacy_secret_valid(internal_secret):
    return
  _BIOMETRICS_AUTH_FAILURES_TOTAL.labels(auth_mode="legacy_secret", reason="invalid_or_missing").inc()
  _validate_hmac_auth(request, expected_user_id, expected_tenant_id)

def decode_image(base64_str: str) -> np.ndarray:
  try:
    raw = base64.b64decode(base64_str.split(",")[-1])
  except Exception as exc:  # noqa: BLE001
    raise HTTPException(status_code=400, detail="Imagem base64 inválida.") from exc
  image = face_recognition.load_image_file(io.BytesIO(raw))
  return image

def extract_embedding(image: np.ndarray) -> np.ndarray:
  locations = face_recognition.face_locations(image)
  if len(locations) == 0:
    raise HTTPException(status_code=400, detail="Nenhuma face detectada.")
  if len(locations) > 1:
    raise HTTPException(status_code=400, detail="Mais de uma face detectada.")
  encodings = face_recognition.face_encodings(image, locations)
  if not encodings:
    raise HTTPException(status_code=400, detail="Falha ao gerar embedding.")
  embedding = np.array(encodings[0], dtype=np.float32)
  if embedding.shape[0] != 128:
    raise HTTPException(status_code=500, detail="Embedding inválido.")
  return embedding

def clamp01(value: float) -> float:
  return max(0.0, min(1.0, value))

def compute_passive_liveness(image: np.ndarray) -> tuple[float, dict[str, float]]:
  locations = face_recognition.face_locations(image)
  if len(locations) == 0:
    raise HTTPException(status_code=400, detail="Nenhuma face detectada para liveness.")
  if len(locations) > 1:
    raise HTTPException(status_code=400, detail="Mais de uma face detectada para liveness.")

  top, right, bottom, left = locations[0]
  if image.ndim != 3 or image.shape[2] < 3:
    raise HTTPException(status_code=400, detail="Imagem invalida para analise de liveness.")

  height, width = image.shape[:2]
  if height == 0 or width == 0:
    raise HTTPException(status_code=400, detail="Imagem invalida para analise de liveness.")

  face_top = max(0, min(top, height - 1))
  face_bottom = max(face_top + 1, min(bottom, height))
  face_left = max(0, min(left, width - 1))
  face_right = max(face_left + 1, min(right, width))

  grayscale = np.mean(image.astype(np.float32), axis=2)
  face_crop = grayscale[face_top:face_bottom, face_left:face_right]
  if face_crop.size == 0:
    raise HTTPException(status_code=400, detail="Falha ao extrair regiao facial para liveness.")

  face_area_ratio = (face_crop.shape[0] * face_crop.shape[1]) / float(height * width)
  brightness = float(np.mean(face_crop) / 255.0)
  contrast = float(np.std(face_crop) / 64.0)

  grad_x = np.abs(np.diff(face_crop, axis=1))
  grad_y = np.abs(np.diff(face_crop, axis=0))
  gradient_energy = float((np.mean(grad_x) + np.mean(grad_y)) / 255.0)

  brightness_score = 1.0 - clamp01(abs(brightness - 0.5) / 0.5)
  contrast_score = clamp01(contrast)
  sharpness_score = clamp01(gradient_energy * 2.5)
  face_size_score = clamp01((face_area_ratio - 0.05) / 0.20)

  final_score = clamp01(
    (brightness_score * 0.20)
    + (contrast_score * 0.25)
    + (sharpness_score * 0.35)
    + (face_size_score * 0.20)
  )

  return final_score, {
    "brightness": round(brightness, 4),
    "contrast": round(contrast, 4),
    "gradientEnergy": round(gradient_energy, 4),
    "faceAreaRatio": round(face_area_ratio, 4),
    "brightnessScore": round(brightness_score, 4),
    "contrastScore": round(contrast_score, 4),
    "sharpnessScore": round(sharpness_score, 4),
    "faceSizeScore": round(face_size_score, 4),
  }

def encrypt_embedding(embedding: np.ndarray) -> bytes:
  nonce = os.urandom(12)
  payload = embedding.tobytes()
  encrypted = aesgcm.encrypt(nonce, payload, None)
  return nonce + encrypted

async def init_pool() -> asyncpg.Pool:
  global pool
  if pool:
    return pool
  async with pool_lock:
    if pool:
      return pool

    async def init_connection(conn: asyncpg.Connection) -> None:
      await register_vector(conn)

    pool = await asyncpg.create_pool(
      DATABASE_URL,
      min_size=1,
      max_size=5,
      init=init_connection,
    )
    return pool

async def rate_limit_check(
  conn: asyncpg.Connection,
  user_id: str,
  action_type: str,
  window_seconds: int,
  max_requests: int,
) -> None:
  since = datetime.utcnow() - timedelta(seconds=window_seconds)
  count = await conn.fetchval(
    """
    SELECT COUNT(1)
    FROM biometric_verifications
    WHERE user_id = $1 AND action_type = $2 AND created_at >= $3
    """,
    user_id,
    action_type,
    since,
  )
  if count and count >= max_requests:
    raise HTTPException(status_code=429, detail="Limite de tentativas excedido. Tente novamente mais tarde.")

async def record_verification_attempt(
  conn: asyncpg.Connection,
  profile_id: Optional[str],
  tenant_id: str,
  user_id: str,
  action_type: str,
  status: str,
  score: Optional[float],
  threshold: Optional[float],
  ip: Optional[str],
  user_agent: Optional[str],
  context: Optional[dict[str, Any]],
  failure_reason: Optional[str],
) -> None:
  await conn.execute(
    """
    INSERT INTO biometric_verifications
    (profile_id, tenant_id, user_id, action_type, status, score, threshold, ip, user_agent, context, failure_reason)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::jsonb, '{}'::jsonb), $11)
    """,
    profile_id,
    tenant_id,
    user_id,
    action_type,
    status,
    score,
    threshold,
    ip,
    user_agent,
    context,
    failure_reason,
  )

async def with_rate_limit_lock(
  conn: asyncpg.Connection,
  tenant_id: str,
  user_id: str,
  action_type: str,
  handler,
) -> Any:
  lock_key = f"{tenant_id}:{user_id}:{action_type}"
  await conn.execute("SELECT pg_advisory_lock(hashtext($1))", lock_key)
  try:
    return await handler()
  finally:
    await conn.execute("SELECT pg_advisory_unlock(hashtext($1))", lock_key)

@app.get("/health")
async def health() -> dict[str, str]:
  return {"status": "ok", "service": SERVICE_NAME, "version": SERVICE_VERSION}

@app.get("/metrics")
def metrics() -> Response:
  """Endpoint Prometheus - scrape sem autenticação (rede interna)."""
  return Response(
    content=generate_latest(REGISTRY),
    media_type=CONTENT_TYPE_LATEST,
  )

@app.get("/ready")
async def ready() -> dict[str, str]:
  try:
    conn = await init_pool()
    async with conn.acquire() as db:
      await db.execute("SELECT 1")
    return {"status": "ready", "service": SERVICE_NAME}
  except Exception:  # noqa: BLE001
    raise HTTPException(status_code=500, detail="Database not ready")

@app.post("/status")
async def status(
  payload: StatusRequest,
  request: Request,
  x_internal_api_secret: Optional[str] = Header(None),
) -> dict[str, Any]:
  ensure_internal_auth(request, x_internal_api_secret, str(payload.userId), str(payload.tenantId))
  conn = await init_pool()
  async with conn.acquire() as db:
    row = await db.fetchrow(
      """
      SELECT id, status, last_verified_at
      FROM biometric_profiles
      WHERE user_id = $1 AND tenant_id = $2
      """,
      payload.userId,
      payload.tenantId,
    )
  return {
    "enrolled": bool(row),
    "status": row["status"] if row else None,
    "lastVerifiedAt": row["last_verified_at"].isoformat() if row and row["last_verified_at"] else None,
  }

@app.post("/enroll")
async def enroll(
  payload: EnrollRequest,
  request: Request,
  x_internal_api_secret: Optional[str] = Header(None),
) -> dict[str, Any]:
  ensure_internal_auth(request, x_internal_api_secret, str(payload.userId), str(payload.tenantId))
  conn = await init_pool()
  async with conn.acquire() as db:
    async def handle_enroll():
      await rate_limit_check(
        db,
        payload.userId,
        action_type="enroll",
        window_seconds=86400,
        max_requests=ENROLL_RATE_LIMIT,
      )

      profile_id = await db.fetchval(
        "SELECT id FROM biometric_profiles WHERE user_id = $1 AND tenant_id = $2",
        payload.userId,
        payload.tenantId,
      )
      liveness_score = 0.0
      liveness_details: dict[str, float] = {}

      try:
        image = decode_image(payload.imageBase64)
        embedding = extract_embedding(image)
        liveness_score, liveness_details = compute_passive_liveness(image)
      except HTTPException as exc:
        await record_verification_attempt(
          db,
          profile_id,
          payload.tenantId,
          payload.userId,
          "enroll",
          "failed",
          None,
          None,
          None,
          None,
          {},
          str(exc.detail),
        )
        raise

      if ENFORCE_LIVENESS and liveness_score < LIVENESS_THRESHOLD:
        _BIOMETRICS_LIVENESS_REJECTIONS_TOTAL.labels(action_type="enroll", reason="below_threshold").inc()
        await record_verification_attempt(
          db,
          profile_id,
          payload.tenantId,
          payload.userId,
          "enroll",
          "failed",
          liveness_score,
          LIVENESS_THRESHOLD,
          None,
          None,
          {
            "liveness": {
              "score": liveness_score,
              "threshold": LIVENESS_THRESHOLD,
              "details": liveness_details,
            },
          },
          "Liveness abaixo do limiar configurado.",
        )
        raise HTTPException(status_code=422, detail="Falha no liveness check. Tente novamente em melhor iluminacao.")

      encrypted = encrypt_embedding(embedding)
      embedding_hash = hashlib.sha256(embedding.tobytes()).hexdigest()
      capture_mode = (payload.captureMode or "replace").strip().lower()
      if capture_mode not in ("replace", "append"):
        raise HTTPException(status_code=400, detail="Modo de captura inválido.")

      async with db.transaction():
        profile = await db.fetchrow(
          """
          INSERT INTO biometric_profiles (tenant_id, user_id, status, metadata)
          VALUES ($1, $2, 'active', COALESCE($3::jsonb, '{}'::jsonb))
          ON CONFLICT (tenant_id, user_id)
          DO UPDATE SET status='active', updated_at=NOW(), metadata=COALESCE(EXCLUDED.metadata, biometric_profiles.metadata)
          RETURNING id
          """,
          payload.tenantId,
          payload.userId,
          payload.metadata,
        )
        profile_id = profile["id"]

        if capture_mode == "replace":
          await db.execute(
            "UPDATE biometric_embeddings SET is_active = false WHERE profile_id = $1",
            profile_id,
          )

        await db.execute(
          """
          INSERT INTO biometric_embeddings (profile_id, embedding, embedding_encrypted, embedding_hash, model, is_active)
          VALUES ($1, $2, $3, $4, $5, true)
          """,
          profile_id,
          embedding.tolist(),
          encrypted,
          embedding_hash,
          "face_recognition_128d",
        )

        await db.execute(
          """
          UPDATE biometric_embeddings
          SET is_active = false
          WHERE profile_id = $1
            AND is_active = true
            AND id IN (
              SELECT id
              FROM biometric_embeddings
              WHERE profile_id = $1
                AND is_active = true
              ORDER BY created_at DESC
              OFFSET $2
            )
          """,
          profile_id,
          MAX_ACTIVE_EMBEDDINGS,
        )

        await record_verification_attempt(
          db,
          profile_id,
          payload.tenantId,
          payload.userId,
          "enroll",
          "success",
          liveness_score,
          LIVENESS_THRESHOLD if ENFORCE_LIVENESS else None,
          None,
          None,
          {
            "liveness": {
              "score": liveness_score,
              "threshold": LIVENESS_THRESHOLD if ENFORCE_LIVENESS else None,
              "details": liveness_details,
            },
          },
          None,
        )
      return profile_id, liveness_score, liveness_details

    profile_id, liveness_score, liveness_details = await with_rate_limit_lock(
      db,
      payload.tenantId,
      payload.userId,
      "enroll",
      handle_enroll,
    )

  return {
    "profileId": str(profile_id),
    "status": "active",
    "model": "face_recognition_128d",
    "liveness": {
      "score": liveness_score,
      "threshold": LIVENESS_THRESHOLD if ENFORCE_LIVENESS else None,
      "passed": (not ENFORCE_LIVENESS) or (liveness_score >= LIVENESS_THRESHOLD),
      "details": liveness_details,
    },
  }

@app.post("/verify")
async def verify(
  payload: VerifyRequest,
  request: Request,
  x_internal_api_secret: Optional[str] = Header(None),
  x_forwarded_for: Optional[str] = Header(None),
  user_agent: Optional[str] = Header(None),
) -> dict[str, Any]:
  ensure_internal_auth(request, x_internal_api_secret, str(payload.userId), str(payload.tenantId))
  conn = await init_pool()
  async with conn.acquire() as db:
    async def handle_verify():
      await rate_limit_check(
        db,
        payload.userId,
        action_type=payload.actionType,
        window_seconds=60,
        max_requests=VERIFY_RATE_LIMIT,
      )

      profile_id = await db.fetchval(
        "SELECT id FROM biometric_profiles WHERE user_id = $1 AND tenant_id = $2",
        payload.userId,
        payload.tenantId,
      )
      liveness_score = 0.0
      liveness_details: dict[str, float] = {}

      try:
        image = decode_image(payload.imageBase64)
        embedding = extract_embedding(image)
        liveness_score, liveness_details = compute_passive_liveness(image)
      except HTTPException as exc:
        await record_verification_attempt(
          db,
          profile_id,
          payload.tenantId,
          payload.userId,
          payload.actionType,
          "failed",
          None,
          None,
          x_forwarded_for,
          user_agent,
          payload.actionContext,
          str(exc.detail),
        )
        raise

      if ENFORCE_LIVENESS and liveness_score < LIVENESS_THRESHOLD:
        _BIOMETRICS_LIVENESS_REJECTIONS_TOTAL.labels(action_type=payload.actionType, reason="below_threshold").inc()
        await record_verification_attempt(
          db,
          profile_id,
          payload.tenantId,
          payload.userId,
          payload.actionType,
          "failed",
          liveness_score,
          LIVENESS_THRESHOLD,
          x_forwarded_for,
          user_agent,
          {
            **(payload.actionContext or {}),
            "liveness": {
              "score": liveness_score,
              "threshold": LIVENESS_THRESHOLD,
              "details": liveness_details,
            },
          },
          "Liveness abaixo do limiar configurado.",
        )
        return False, 1.0, profile_id, liveness_score, liveness_details

      record = await db.fetchrow(
        """
        SELECT p.id AS profile_id
        FROM biometric_profiles p
        WHERE p.user_id = $1 AND p.tenant_id = $2 AND p.status = 'active'
        LIMIT 1
        """,
        payload.userId,
        payload.tenantId,
      )
      if not record:
        await record_verification_attempt(
          db,
          profile_id,
          payload.tenantId,
          payload.userId,
          payload.actionType,
          "failed",
          None,
          MATCH_THRESHOLD,
          x_forwarded_for,
          user_agent,
          payload.actionContext,
          "Biometria não cadastrada.",
        )
        raise HTTPException(status_code=404, detail="Biometria não cadastrada.")

      embeddings_rows = await db.fetch(
        """
        SELECT embedding
        FROM biometric_embeddings
        WHERE profile_id = $1 AND is_active = true
        ORDER BY created_at DESC
        """,
        record["profile_id"],
      )
      if not embeddings_rows:
        await record_verification_attempt(
          db,
          record["profile_id"],
          payload.tenantId,
          payload.userId,
          payload.actionType,
          "failed",
          None,
          MATCH_THRESHOLD,
          x_forwarded_for,
          user_agent,
          payload.actionContext,
          "Biometria não cadastrada.",
        )
        raise HTTPException(status_code=404, detail="Biometria não cadastrada.")

      stored_embeddings = [
        np.array(row["embedding"], dtype=np.float32)
        for row in embeddings_rows
      ]
      distances = face_recognition.face_distance(stored_embeddings, embedding)
      min_distance = float(np.min(distances))
      match = min_distance <= MATCH_THRESHOLD

      await record_verification_attempt(
        db,
        record["profile_id"],
        payload.tenantId,
        payload.userId,
        payload.actionType,
        "success" if match else "failed",
        min_distance,
        MATCH_THRESHOLD,
        x_forwarded_for,
        user_agent,
        {
          **(payload.actionContext or {}),
          "liveness": {
            "score": liveness_score,
            "threshold": LIVENESS_THRESHOLD if ENFORCE_LIVENESS else None,
            "details": liveness_details,
          },
        },
        None,
      )

      if match:
        await db.execute(
          "UPDATE biometric_profiles SET last_verified_at = NOW(), updated_at = NOW() WHERE id = $1",
          record["profile_id"],
        )

      return match, min_distance, record["profile_id"], liveness_score, liveness_details

    match, distance, profile_id, liveness_score, liveness_details = await with_rate_limit_lock(
      db,
      payload.tenantId,
      payload.userId,
      payload.actionType,
      handle_verify,
    )

  return {
    "match": match,
    "score": distance,
    "threshold": MATCH_THRESHOLD,
    "profileId": str(profile_id),
    "liveness": {
      "score": liveness_score,
      "threshold": LIVENESS_THRESHOLD if ENFORCE_LIVENESS else None,
      "passed": (not ENFORCE_LIVENESS) or (liveness_score >= LIVENESS_THRESHOLD),
      "details": liveness_details,
    },
  }
