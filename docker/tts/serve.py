import os
import pathlib
import sys

# Configurações do TTS ANTES do import (obrigatório para inicialização correta)
# TTS_HOME: diretório de modelos pré-baixados no build
# COQUI_TOS_AGREED: aceite automático de licença (necessário para execução não-interativa)
os.environ.setdefault("TTS_HOME", "/opt/tts-models")
os.environ.setdefault("COQUI_TOS_AGREED", "1")

from TTS.api import TTS


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        print(f"Variável obrigatória ausente: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def ensure_parent(path: str) -> None:
    pathlib.Path(path).parent.mkdir(parents=True, exist_ok=True)


def main() -> None:
    text = require_env("TEXT")
    output_path = require_env("OUTPUT_PATH")
    voice = os.getenv("VOICE")
    # TTS_LANG: código de idioma (en, pt, es, etc.) - NÃO usar LANG que é locale do sistema (en_US.UTF-8)
    lang = os.getenv("TTS_LANG", "pt")
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
