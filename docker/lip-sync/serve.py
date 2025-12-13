import os
import pathlib
import subprocess
import sys
import json
import time


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        print(f"Variável obrigatória ausente: {name}", file=sys.stderr)
        sys.exit(1)
    return value


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


def main() -> None:
    video_path = require_env("VIDEO_PATH")
    audio_path = require_env("AUDIO_PATH")
    output_path = require_env("OUTPUT_PATH")

    pathlib.Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    wav2lip_script = "/opt/wav2lip/inference.py"
    cmd = [
        "python3",
        wav2lip_script,
        "--face",
        video_path,
        "--audio",
        audio_path,
        "--outfile",
        output_path,
    ]

    print(f"Executando Wav2Lip: {' '.join(cmd)}")
    _agent_log("serve.py:33", "execute_command", {"cmd": cmd}, "H2")
    subprocess.run(cmd, check=True)
    _agent_log("serve.py:35", "completed_command", {"outfile": output_path}, "H2")
    print(f"Lip-sync gerado em {output_path}")


if __name__ == "__main__":
    main()
