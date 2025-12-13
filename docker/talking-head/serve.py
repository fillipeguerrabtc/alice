import os
import pathlib
import subprocess
import sys
from typing import Optional


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        print(f"Variável obrigatória ausente: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def ensure_dir(path: str) -> None:
    pathlib.Path(path).mkdir(parents=True, exist_ok=True)


def find_latest_file(folder: pathlib.Path) -> Optional[pathlib.Path]:
    candidates = list(folder.glob("**/*"))
    files = [c for c in candidates if c.is_file()]
    if not files:
        return None
    return max(files, key=lambda f: f.stat().st_mtime)


def main() -> None:
    image_path = require_env("IMAGE_PATH")
    audio_path = require_env("AUDIO_PATH")
    output_path = require_env("OUTPUT_PATH")
    workdir = pathlib.Path("/app/run")
    ensure_dir(workdir.as_posix())

    # SadTalker não possui pacote instalável com setup.py; usamos o script de inferência direto do repo clonado
    sadtalker_script = "/opt/sadtalker/inference.py"
    cmd = [
        "python3",
        sadtalker_script,
        "--source_image",
        image_path,
        "--driven_audio",
        audio_path,
        "--result_dir",
        workdir.as_posix(),
        "--preprocess",
        "full",
        "--still",
        "--enhancer",
        "gfpgan",
    ]

    print(f"Executando SadTalker: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)

    latest = find_latest_file(workdir)
    if not latest:
        print("Nenhum arquivo gerado pelo SadTalker.", file=sys.stderr)
        sys.exit(1)

    pathlib.Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    latest.replace(output_path)
    print(f"Talking-head gerado em {output_path}")


if __name__ == "__main__":
    main()
