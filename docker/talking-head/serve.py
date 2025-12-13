import os
import pathlib
import subprocess
import sys
import requests
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

    latest = find_latest_video(workdir)
    if not latest:
        print("Nenhum vídeo gerado pelo SadTalker.", file=sys.stderr)
        sys.exit(1)

    pathlib.Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    final_path = latest.replace(output_path)
    print(f"Talking-head gerado em {final_path}")

    upload_url = os.getenv("UPLOAD_URL")
    upload_token = os.getenv("UPLOAD_TOKEN")
    if not upload_url or not upload_token:
        print("Aviso: UPLOAD_URL ou UPLOAD_TOKEN ausentes; saída permanece somente no container Salad", file=sys.stderr)
        return

    with open(final_path, "rb") as f:
        resp = requests.post(
            upload_url,
            headers={"X-Upload-Token": upload_token},
            data={
                "jobId": os.getenv("UPLOAD_JOB_ID"),
                "jobType": os.getenv("UPLOAD_JOB_TYPE"),
                "tenantId": os.getenv("UPLOAD_TENANT_ID"),
            },
            files={"file": (final_path.name, f, "video/mp4")},
            timeout=300,
        )
        if resp.status_code >= 400:
            print(f"Falha no upload para RAG: {resp.status_code} - {resp.text}", file=sys.stderr)
            sys.exit(1)
        print("Upload concluído para RAG")


if __name__ == "__main__":
    main()
