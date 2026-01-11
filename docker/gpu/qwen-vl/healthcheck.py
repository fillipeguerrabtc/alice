#!/usr/bin/env python3
# =============================================================================
# Alice Enterprise Platform - Qwen2.5-VL Health Check
# =============================================================================
# Script de verificação de saúde para o servidor vLLM Qwen2.5-VL
#
# Autor: Fillipe Guerra
# Data: 11 de Janeiro de 2026
# =============================================================================

import sys
import urllib.request
import json


def check_health():
    """Verifica se o servidor vLLM está respondendo."""
    try:
        # Verificar endpoint de saúde do vLLM
        url = "http://localhost:8000/health"
        req = urllib.request.Request(url, method='GET')
        
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                print("vLLM server healthy")
                return True
            else:
                print(f"vLLM server unhealthy: status {response.status}")
                return False
                
    except urllib.error.URLError as e:
        print(f"vLLM server não acessível: {e}")
        return False
    except Exception as e:
        print(f"Erro no healthcheck: {e}")
        return False


def check_models():
    """Verifica se o modelo está carregado."""
    try:
        url = "http://localhost:8000/v1/models"
        req = urllib.request.Request(url, method='GET')
        
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                models = data.get('data', [])
                if models:
                    print(f"Modelo carregado: {models[0].get('id', 'unknown')}")
                    return True
                else:
                    print("Nenhum modelo carregado")
                    return False
            return False
            
    except Exception as e:
        print(f"Erro ao verificar modelos: {e}")
        return False


if __name__ == "__main__":
    # Verificar saúde básica
    if not check_health():
        sys.exit(1)
    
    # Verificar se modelo está carregado
    if not check_models():
        sys.exit(1)
    
    sys.exit(0)
