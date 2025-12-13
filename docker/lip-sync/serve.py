import os
import pathlib
import subprocess
import sys
import requests


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

    # Criar diretório pai com permissões enterprise (750)
    parent_dir = pathlib.Path(output_path).parent
    parent_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(parent_dir, 0o750)

    # Execução direta do script oficial, com cwd em /opt/wav2lip
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

    upload_url = os.getenv("UPLOAD_URL")
    upload_token = os.getenv("UPLOAD_TOKEN")
    if not upload_url or not upload_token:
        print("ERRO: UPLOAD_URL ou UPLOAD_TOKEN ausentes - arquivo gerado será perdido no container efêmero", file=sys.stderr)
        sys.exit(1)  # Falhar com exit code não-zero para evitar sucesso silencioso

    with open(output_path, "rb") as f:
        resp = requests.post(
            upload_url,
            headers={"X-Upload-Token": upload_token},
            data={
                "jobId": os.getenv("UPLOAD_JOB_ID"),
                "jobType": os.getenv("UPLOAD_JOB_TYPE"),
                "tenantId": os.getenv("UPLOAD_TENANT_ID"),
            },
            files={"file": (output_path.name, f, "video/mp4")},
            timeout=300,
        )
        if resp.status_code >= 400:
            print(f"Falha no upload para RAG: {resp.status_code} - {resp.text}", file=sys.stderr)
            sys.exit(1)
        print("Upload concluído para RAG")


if __name__ == "__main__":
    main()
