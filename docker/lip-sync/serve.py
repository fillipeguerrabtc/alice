import os
import pathlib
import subprocess
import sys


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        print(f"Variável obrigatória ausente: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def main() -> None:
    video_path = require_env("VIDEO_PATH")
    audio_path = require_env("AUDIO_PATH")
    output_path = require_env("OUTPUT_PATH")

    pathlib.Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "python3",
        "-m",
        "Wav2Lip.inference",
        "--face",
        video_path,
        "--audio",
        audio_path,
        "--outfile",
        output_path,
    ]

    print(f"Executando Wav2Lip: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)
    print(f"Lip-sync gerado em {output_path}")


if __name__ == "__main__":
    main()
