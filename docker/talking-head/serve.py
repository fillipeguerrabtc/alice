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


def find_latest_video(folder: pathlib.Path) -> Optional[pathlib.Path]:
    exts = {".mp4", ".mov", ".mkv", ".avi"}
    candidates = [p for p in folder.glob("**/*") if p.is_file() and p.suffix.lower() in exts]
    if not candidates:
        return None
    return max(candidates, key=lambda f: f.stat().st_mtime)


def main() -> None:
    image_path = pathlib.Path(require_env("IMAGE_PATH")).resolve()
    audio_path = pathlib.Path(require_env("AUDIO_PATH")).resolve()
    output_path = pathlib.Path(require_env("OUTPUT_PATH")).resolve()
    workdir = pathlib.Path("/app/run")
    ensure_dir(workdir.as_posix())

    # SadTalker não possui pacote instalável com setup.py; usamos o script de inferência direto do repo clonado
    sadtalker_script = "/opt/sadtalker/inference.py"
    env = os.environ.copy()
    existing_py = env.get("PYTHONPATH")
    env["PYTHONPATH"] = f"/opt/sadtalker:{existing_py}" if existing_py else "/opt/sadtalker"
    cmd = [
        "python3",
        sadtalker_script,
        "--source_image",
        str(image_path),
        "--driven_audio",
        str(audio_path),
        "--result_dir",
        workdir.as_posix(),
        "--preprocess",
        "full",
        "--still",
        "--enhancer",
        "gfpgan",
    ]

    print(f"Executando SadTalker: {' '.join(cmd)}")
    subprocess.run(cmd, check=True, cwd="/opt/sadtalker", env=env)

    latest = find_latest_video(workdir)
    if not latest:
        print("Nenhum vídeo gerado pelo SadTalker.", file=sys.stderr)
        sys.exit(1)

    pathlib.Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    final_path = latest.replace(output_path)
    print(f"Talking-head gerado em {final_path}")


if __name__ == "__main__":
    main()
