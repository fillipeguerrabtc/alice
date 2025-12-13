import json
import os
import pathlib
import sys

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
    pathlib.Path(path).parent.mkdir(parents=True, exist_ok=True)


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
    speaker_wav = params.get("speaker_wav") or os.getenv("SPEAKER_WAV")
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
    
    # Uso do caminho suportado pelo TTS API para voice cloning:
    # tts_to_file com speaker_wav quando disponível; caso contrário, speaker fixo.
    tts_kwargs = {
        "text": text,
        "language": lang,
        "file_path": output_path,
    }
    if speaker_wav:
        tts_kwargs["speaker_wav"] = speaker_wav
        print(f"Usando voice cloning com referência: {speaker_wav}")
    else:
        tts_kwargs["speaker"] = voice
        print(f"Usando speaker: {voice}")
    tts.tts_to_file(**tts_kwargs)

    print(f"Áudio gerado em {output_path}")


if __name__ == "__main__":
    main()
