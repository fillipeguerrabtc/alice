"""
Biometrics Service - Alice Enterprise Platform

Biometria facial server-side CPU-only (sem liveness).
Armazena embeddings no PostgreSQL (pgvector) + cópia criptografada.

Documentação em PT-BR (Regra 10 CLAUDE.md).
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

import asyncpg
import face_recognition
import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from pgvector.asyncpg import register_vector

INTERNAL_API_SECRET = os.getenv("INTERNAL_API_SECRET", "").strip()
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
BIOMETRICS_ENCRYPTION_KEY = os.getenv("BIOMETRICS_ENCRYPTION_KEY", "").strip()
BIOMETRICS_MATCH_THRESHOLD = os.getenv("BIOMETRICS_MATCH_THRESHOLD", "").strip()
BIOMETRICS_VERIFY_RATE_LIMIT = os.getenv("BIOMETRICS_VERIFY_RATE_LIMIT", "").strip()
BIOMETRICS_ENROLL_RATE_LIMIT = os.getenv("BIOMETRICS_ENROLL_RATE_LIMIT", "").strip()

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

MATCH_THRESHOLD = parse_threshold(BIOMETRICS_MATCH_THRESHOLD)
VERIFY_RATE_LIMIT = parse_rate_limit(BIOMETRICS_VERIFY_RATE_LIMIT, 5)
ENROLL_RATE_LIMIT = parse_rate_limit(BIOMETRICS_ENROLL_RATE_LIMIT, 3)

def decode_encryption_key(raw: str) -> bytes:
  cleaned = raw.strip()
  if len(cleaned) == 64:
    return bytes.fromhex(cleaned)
  return base64.b64decode(cleaned)

ENCRYPTION_KEY = decode_encryption_key(BIOMETRICS_ENCRYPTION_KEY)
if len(ENCRYPTION_KEY) != 32:
  raise RuntimeError("BIOMETRICS_ENCRYPTION_KEY deve ter 32 bytes (hex 64 ou base64).")

aesgcm = AESGCM(ENCRYPTION_KEY)

app = FastAPI(title="Alice Biometrics Service", version="1.0.0")
pool: Optional[asyncpg.Pool] = None
pool_lock = asyncio.Lock()

class EnrollRequest(BaseModel):
  userId: str = Field(..., min_length=36)
  tenantId: str = Field(..., min_length=36)
  imageBase64: str
  metadata: Optional[dict[str, Any]] = None

class VerifyRequest(BaseModel):
  userId: str = Field(..., min_length=36)
  tenantId: str = Field(..., min_length=36)
  imageBase64: str
  actionType: str = Field(..., min_length=2)
  actionContext: Optional[dict[str, Any]] = None

class StatusRequest(BaseModel):
  userId: str = Field(..., min_length=36)
  tenantId: str = Field(..., min_length=36)

def ensure_internal_auth(internal_secret: Optional[str]) -> None:
  if not internal_secret or internal_secret.strip() != INTERNAL_API_SECRET:
    raise HTTPException(status_code=401, detail="Unauthorized")

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
  return {"status": "ok"}

@app.get("/ready")
async def ready() -> dict[str, str]:
  try:
    conn = await init_pool()
    async with conn.acquire() as db:
      await db.execute("SELECT 1")
    return {"status": "ready"}
  except Exception:  # noqa: BLE001
    raise HTTPException(status_code=500, detail="Database not ready")

@app.post("/status")
async def status(
  payload: StatusRequest,
  x_internal_api_secret: Optional[str] = Header(None),
) -> dict[str, Any]:
  ensure_internal_auth(x_internal_api_secret)
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
  x_internal_api_secret: Optional[str] = Header(None),
) -> dict[str, Any]:
  ensure_internal_auth(x_internal_api_secret)
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

      image = decode_image(payload.imageBase64)
      embedding = extract_embedding(image)
      encrypted = encrypt_embedding(embedding)
      embedding_hash = hashlib.sha256(embedding.tobytes()).hexdigest()

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
          INSERT INTO biometric_verifications
          (profile_id, tenant_id, user_id, action_type, status, score, threshold, ip, user_agent, context)
          VALUES ($1, $2, $3, 'enroll', 'success', NULL, NULL, NULL, NULL, '{}'::jsonb)
          """,
          profile_id,
          payload.tenantId,
          payload.userId,
        )
      return profile_id

    profile_id = await with_rate_limit_lock(
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
  }

@app.post("/verify")
async def verify(
  payload: VerifyRequest,
  x_internal_api_secret: Optional[str] = Header(None),
  x_forwarded_for: Optional[str] = Header(None),
  user_agent: Optional[str] = Header(None),
) -> dict[str, Any]:
  ensure_internal_auth(x_internal_api_secret)
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

      image = decode_image(payload.imageBase64)
      embedding = extract_embedding(image)

      record = await db.fetchrow(
      """
      SELECT p.id AS profile_id, e.embedding
      FROM biometric_profiles p
      JOIN biometric_embeddings e ON e.profile_id = p.id
      WHERE p.user_id = $1 AND p.tenant_id = $2 AND p.status = 'active' AND e.is_active = true
      ORDER BY e.created_at DESC
      LIMIT 1
      """,
      payload.userId,
      payload.tenantId,
      )
      if not record:
        raise HTTPException(status_code=404, detail="Biometria não cadastrada.")

      stored_embedding = np.array(record["embedding"], dtype=np.float32)
      distance = float(face_recognition.face_distance([stored_embedding], embedding)[0])
      match = distance <= MATCH_THRESHOLD

      await db.execute(
        """
        INSERT INTO biometric_verifications
        (profile_id, tenant_id, user_id, action_type, status, score, threshold, ip, user_agent, context)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::jsonb, '{}'::jsonb))
        """,
        record["profile_id"],
        payload.tenantId,
        payload.userId,
        payload.actionType,
        "success" if match else "failed",
        distance,
        MATCH_THRESHOLD,
        x_forwarded_for,
        user_agent,
        payload.actionContext,
      )

      if match:
        await db.execute(
          "UPDATE biometric_profiles SET last_verified_at = NOW(), updated_at = NOW() WHERE id = $1",
          record["profile_id"],
        )

      return match, distance, record["profile_id"]

    match, distance, profile_id = await with_rate_limit_lock(
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
  }

