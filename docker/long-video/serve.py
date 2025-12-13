import json
import os
import pathlib
import subprocess
import sys
import requests
from typing import List, Dict


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        print(f"Variável obrigatória ausente: {name}", file=sys.stderr)
        sys.exit(1)
    return value


def load_manifest(path: pathlib.Path) -> List[Dict[str, str]]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        print("Manifesto inválido: esperado lista de segmentos", file=sys.stderr)
        sys.exit(1)
    return data


def write_ffmpeg_list(tmp_list: pathlib.Path, segments: List[Dict[str, str]]) -> None:
    lines = []
    for segment in segments:
        src = segment.get("path")
        if not src:
            print("Segmento sem 'path' no manifest.", file=sys.stderr)
            sys.exit(1)
        lines.append(f"file '{src}'")
    tmp_list.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    manifest_path_env = os.getenv("MANIFEST_JSON")
    segments_dir_env = os.getenv("SEGMENTS_DIR")
    output_path = require_env("OUTPUT_PATH")
    codec = os.getenv("VIDEO_CODEC", "h264")

    if manifest_path_env:
        manifest_path = pathlib.Path(manifest_path_env)
        segments = load_manifest(manifest_path)
    elif segments_dir_env:
        seg_dir = pathlib.Path(segments_dir_env)
        files = sorted(seg_dir.glob("*"))
        segments = [{"path": f.as_posix()} for f in files if f.is_file()]
    else:
        print("Informe MANIFEST_JSON ou SEGMENTS_DIR.", file=sys.stderr)
        sys.exit(1)

    tmp_list = pathlib.Path("/tmp/concat.txt")
    write_ffmpeg_list(tmp_list, segments)

    pathlib.Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    ffmpeg_cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        tmp_list.as_posix(),
        "-c:v",
        codec,
        "-c:a",
        "copy",
        output_path,
    ]

    print(f"Executando FFmpeg: {' '.join(ffmpeg_cmd)}")
    subprocess.run(ffmpeg_cmd, check=True)
    print(f"Vídeo final gerado em {output_path}")

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
            files={"file": (pathlib.Path(output_path).name, f, "video/mp4")},
            timeout=600,
        )
        if resp.status_code >= 400:
            print(f"Falha no upload para RAG: {resp.status_code} - {resp.text}", file=sys.stderr)
            sys.exit(1)
        print("Upload concluído para RAG")


if __name__ == "__main__":
    main()
