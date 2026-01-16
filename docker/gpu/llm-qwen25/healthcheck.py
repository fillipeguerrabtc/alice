#!/usr/bin/env python3
# =============================================================================
# Alice Enterprise Platform - LLM Health Check (vLLM)
# =============================================================================
# Script de verificação de saúde para o servidor vLLM (OpenAI-compatible).
#
# Autor: Fillipe Guerra
# Data: 16 de Janeiro de 2026
# =============================================================================

import json
import sys
import urllib.error
import urllib.request


def check_health() -> bool:
    """Verifica se o servidor vLLM está respondendo."""
    try:
        url = "http://localhost:8000/health"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status == 200
    except urllib.error.URLError:
        return False
    except Exception:
        return False


def check_models() -> bool:
    """Verifica se pelo menos 1 modelo está carregado."""
    try:
        url = "http://localhost:8000/v1/models"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status != 200:
                return False
            data = json.loads(response.read().decode("utf-8"))
            models = data.get("data", [])
            return bool(models)
    except Exception:
        return False


if __name__ == "__main__":
    if not check_health():
        sys.exit(1)
    if not check_models():
        sys.exit(1)
    sys.exit(0)

