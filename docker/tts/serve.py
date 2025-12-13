import json
import os
import pathlib
import sys
import requests

import numpy as np
import soundfile as sf

# Configurações do TTS ANTES do import (obrigatório para inicialização correta)
# TTS_HOME: diretório de modelos pré-baixados no build
# COQUI_TOS_AGREED: aceite automático de licença (necessário para execução não-interativa)
os.environ.setdefault("TTS_HOME", "/opt/tts-models")
os.environ.setdefault("COQUI_TOS_AGREED", "1")

from TTS.api import TTS

# Default: Português Brasileiro (Regra 13 CLAUDE.md - PT-BR primário)
DEFAULT_LANG = "pt"

# Speaker padrão do XTTS v2 (evita erro quando speaker=None)
# Lista completa disponível em: tts.speakers após carregar o modelo
DEFAULT_SPEAKER = "Claribel Dervla"


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        print(f"Variável obrigatória ausente: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def parse_media_params() -> dict:
    """Parseia MEDIA_PARAMS JSON passado pelo media-worker (Salad container)."""
    raw = os.getenv("MEDIA_PARAMS", "{}")
    try:
        return json.loads(raw) if raw else {}
    except json.JSONDecodeError as e:
        print(f"Aviso: MEDIA_PARAMS inválido, usando defaults: {e}", file=sys.stderr)
        return {}


def ensure_parent(path: str) -> None:
    """Cria diretório pai com permissões enterprise (750)."""
    parent = pathlib.Path(path).parent
    parent.mkdir(parents=True, exist_ok=True)
    # Aplicar permissões enterprise: 750 (rwxr-x---)
    os.chmod(parent, 0o750)


def normalize_str(value: object | None) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed if trimmed else None


def main() -> None:
    # Parâmetros podem vir de MEDIA_PARAMS (JSON) ou variáveis de ambiente individuais
    params = parse_media_params()
    
    # text: obrigatório (MEDIA_PARAMS.text ou TEXT env) — não tratar string vazia como ausente
    text_param = normalize_str(params.get("text"))
    text_env = normalize_str(os.getenv("TEXT"))
    text = text_param if text_param is not None else text_env
    if text is None:
        print("Variável obrigatória ausente: TEXT (ou MEDIA_PARAMS.text)", file=sys.stderr)
        sys.exit(1)
    
    output_path = require_env("OUTPUT_PATH")
    
    # voice/speaker: MEDIA_PARAMS.voice > VOICE env > DEFAULT_SPEAKER
    # XTTS v2 requer speaker válido (não aceita None)
    voice = normalize_str(params.get("voice")) or normalize_str(os.getenv("VOICE")) or DEFAULT_SPEAKER
    
    # speaker_wav: áudio de referência para voice cloning (opcional, deve ser caminho local)
    speaker_wav = normalize_str(params.get("speaker_wav")) or normalize_str(os.getenv("SPEAKER_WAV"))
    if speaker_wav and speaker_wav.startswith(("http://", "https://")):
        print("speaker_wav deve ser caminho local montado no container (URLs não são suportadas)", file=sys.stderr)
        sys.exit(1)
    
    # lang: prioridade MEDIA_PARAMS.lang > TTS_LANG env > default "pt"
    # Código ISO 639-1: pt, en, es, fr, de, etc.
    lang = normalize_str(params.get("lang")) or normalize_str(os.getenv("TTS_LANG")) or DEFAULT_LANG
    
    model_name = os.getenv("MODEL_NAME", "tts_models/multilingual/multi-dataset/xtts_v2")

    device = "cuda" if os.getenv("FORCE_CPU", "false").lower() not in ("1", "true", "yes") else "cpu"
    tts = TTS(model_name)
    try:
        tts.to(device)
    except Exception:
        # fallback automático
        tts.to("cpu")

    ensure_parent(output_path)
    
    # Voice cloning: se speaker_wav presente, gera latentes e escreve manualmente.
    if speaker_wav:
        print(f"Usando voice cloning com referência: {speaker_wav}")
        gpt_cond_latent, speaker_embedding = tts.get_conditioning_latents(audio_path=speaker_wav, language=lang)
        result = tts.inference(
            text=text,
            language=lang,
            gpt_cond_latent=gpt_cond_latent,
            speaker_embedding=speaker_embedding,
        )
        wav = result.get("wav")
        sample_rate = result.get("sample_rate", 24000)
        if wav is None:
            print("Falha ao gerar áudio (wav ausente)", file=sys.stderr)
            sys.exit(1)
        if hasattr(wav, "cpu"):
            wav_arr = wav.cpu().numpy()
        else:
            wav_arr = np.asarray(wav)
        sf.write(output_path, np.squeeze(wav_arr), sample_rate)
    else:
        print(f"Usando speaker: {voice}")
        tts.tts_to_file(
            text=text,
            speaker=voice,
            language=lang,
            file_path=output_path,
        )

    upload_url = os.getenv("UPLOAD_URL")
    upload_token = os.getenv("UPLOAD_TOKEN")
    if not upload_url or not upload_token:
        print("Aviso: UPLOAD_URL ou UPLOAD_TOKEN ausentes; saída permanece somente no container Salad", file=sys.stderr)
        return

    with open(output_path, "rb") as f:
        resp = requests.post(
            upload_url,
            headers={"X-Upload-Token": upload_token},
            data={
                "jobId": os.getenv("UPLOAD_JOB_ID"),
                "jobType": os.getenv("UPLOAD_JOB_TYPE"),
                "tenantId": os.getenv("UPLOAD_TENANT_ID"),
            },
            files={"file": (pathlib.Path(output_path).name, f, "audio/wav")},
            timeout=120,
        )
        if resp.status_code >= 400:
            print(f"Falha no upload para RAG: {resp.status_code} - {resp.text}", file=sys.stderr)
            sys.exit(1)
        print("Upload concluído para RAG")

    print(f"Áudio gerado em {output_path}")


if __name__ == "__main__":
    main()
