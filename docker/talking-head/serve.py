import os
import pathlib
import subprocess
import sys
from typing import Optional
import json
import time


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        print(f"Variável obrigatória ausente: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def ensure_dir(path: str) -> None:
    pathlib.Path(path).mkdir(parents=True, exist_ok=True)


# #region agent log
def _agent_log(location: str, message: str, data: dict, hypothesis_id: str) -> None:
    payload = {
        "sessionId": "debug-session",
        "runId": "pre-fix",
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    try:
        with open(r"c:\APPs\alice\.cursor\debug.log", "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=True) + "\n")
    except Exception:
        pass
# #endregion


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
    _agent_log("serve.py:29", "paths_resolved", {"image": str(image_path), "audio": str(audio_path), "output": str(output_path), "workdir": workdir.as_posix()}, "H1")

    # SadTalker não possui pacote instalável com setup.py; usamos o script de inferência direto do repo clonado
    sadtalker_script = "/opt/sadtalker/inference.py"
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
    subprocess.run(cmd, check=True, cwd="/opt/sadtalker")
    _agent_log("serve.py:54", "sadtalker_completed", {"result_dir": workdir.as_posix()}, "H1")

    latest = find_latest_video(workdir)
    if not latest:
        print("Nenhum vídeo gerado pelo SadTalker.", file=sys.stderr)
        sys.exit(1)

    pathlib.Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    latest.replace(output_path)
    print(f"Talking-head gerado em {output_path}")


if __name__ == "__main__":
    main()
