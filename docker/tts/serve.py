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


def main() -> None:
    # Parâmetros podem vir de MEDIA_PARAMS (JSON) ou variáveis de ambiente individuais
    params = parse_media_params()
    
    # text: obrigatório (MEDIA_PARAMS.text ou TEXT env)
    text = params.get("text") or os.getenv("TEXT")
    if not text:
        print("Variável obrigatória ausente: TEXT (ou MEDIA_PARAMS.text)", file=sys.stderr)
        sys.exit(1)
    
    output_path = require_env("OUTPUT_PATH")
    
    # voice: opcional (MEDIA_PARAMS.voice ou VOICE env)
    voice = params.get("voice") or os.getenv("VOICE")
    
    # lang: prioridade MEDIA_PARAMS.lang > TTS_LANG env > default "pt"
    # Código ISO 639-1: pt, en, es, fr, de, etc.
    lang = params.get("lang") or os.getenv("TTS_LANG") or DEFAULT_LANG
    
    model_name = os.getenv("MODEL_NAME", "tts_models/multilingual/multi-dataset/xtts_v2")

    device = "cuda" if os.getenv("FORCE_CPU", "false").lower() not in ("1", "true", "yes") else "cpu"
    tts = TTS(model_name)
    try:
        tts.to(device)
    except Exception:
        # fallback automático
        tts.to("cpu")

    ensure_parent(output_path)
    tts.tts_to_file(
        text=text,
        speaker=voice,
        language=lang,
        file_path=output_path,
    )
    print(f"Áudio gerado em {output_path}")


if __name__ == "__main__":
    main()
