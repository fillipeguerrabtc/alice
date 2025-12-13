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
    video_path = pathlib.Path(require_env("VIDEO_PATH")).resolve()
    audio_path = pathlib.Path(require_env("AUDIO_PATH")).resolve()
    output_path = pathlib.Path(require_env("OUTPUT_PATH")).resolve()

    pathlib.Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    wav2lip_script = "/opt/wav2lip/inference.py"
    checkpoint_path = "/opt/wav2lip/checkpoints/wav2lip_gan.pth"
    cmd = [
        "python3",
        wav2lip_script,
        "--face",
        str(video_path),
        "--audio",
        str(audio_path),
        "--outfile",
        str(output_path),
        "--checkpoint_path",
        checkpoint_path,
    ]

    print(f"Executando Wav2Lip: {' '.join(cmd)}")
    subprocess.run(cmd, check=True, cwd="/opt/wav2lip")
    print(f"Lip-sync gerado em {output_path}")


if __name__ == "__main__":
    main()
