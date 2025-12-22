#!/usr/bin/env python3
"""
Alice Enterprise Platform - Salad Cloud Status Script
=========================================================

Script enterprise-grade para verificar status de Container Groups GPU no Salad Cloud.
Usa o Python SDK oficial (salad-cloud-sdk) com fallback para REST API.

OPERAÇÕES SUPORTADAS:
- status: Verifica status de todos os Container Groups (RECOMENDADO)
- delete: Remove todos os Container Groups (USAR COM CUIDADO!)

ABORDAGEM HÍBRIDA (22/12/2025):
- Container Groups são PRÉ-CRIADOS MANUALMENTE no Salad Cloud Dashboard
- URLs são configuradas como secrets no GitHub
- Pipeline NÃO cria nem deleta Container Groups automaticamente
- Rollback apenas verifica status para diagnóstico

⚠️  ATENÇÃO: O comando 'delete' só deve ser usado manualmente quando
    realmente necessário recriar os Container Groups do zero.
    NÃO usar em pipelines CI/CD automáticas!

Best Practices 2025:
- Container Groups persistentes (não deletar em rollback)
- Apenas verificar status para diagnóstico
- Logging estruturado para auditoria

Autor: Fillipe Guerra
Data: 22 de Dezembro de 2025
"""

import os
import sys
import json
import time
import logging
import argparse
from typing import Optional, List, Dict, Any

# Configurar logging estruturado (Regra 8 CLAUDE.md)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S'
)
logger = logging.getLogger(__name__)

# =============================================================================
# IMPORTS COM FALLBACK
# =============================================================================

try:
    from salad_cloud_sdk import SaladCloudSdk
    SDK_AVAILABLE = True
    logger.info("Salad Cloud SDK disponível")
except ImportError:
    SDK_AVAILABLE = False
    logger.warning("Salad Cloud SDK não disponível, usando REST API direta")
    import urllib.request
    import urllib.error

# =============================================================================
# CONSTANTES
# =============================================================================

API_BASE_URL = "https://api.salad.com/api/public"
MAX_RETRIES = 3
RETRY_DELAY = 5  # segundos

# Container Groups da Alice (devem corresponder ao deploy.py)
CONTAINER_GROUPS = [
    "alice-mixtral-vllm",
    "alice-asr-canary",
    "alice-flux-schnell",
    "alice-embeddings-gpu",
]

# =============================================================================
# FUNÇÕES AUXILIARES
# =============================================================================

def get_env_or_default(name: str, default: str = "") -> str:
    """Obtém variável de ambiente ou retorna default."""
    return os.environ.get(name, default)


def get_required_env(name: str) -> str:
    """Obtém variável de ambiente obrigatória ou falha."""
    value = os.environ.get(name)
    if not value:
        logger.error(f"Variável de ambiente {name} não definida")
        sys.exit(1)
    return value


# =============================================================================
# OPERAÇÕES VIA SDK
# =============================================================================

def get_container_group_status_sdk(
    sdk: "SaladCloudSdk",
    org: str,
    project: str,
    name: str
) -> Optional[Dict[str, Any]]:
    """
    Obtém status de um Container Group via SDK.
    
    Returns:
        Dict com status ou None se não existir
    """
    try:
        cg = sdk.container_groups.get_container_group(
            organization_name=org,
            project_name=project,
            container_group_name=name
        )
        return {
            "name": name,
            "status": cg.current_state.status if cg.current_state else "unknown",
            "replicas": cg.replicas if hasattr(cg, 'replicas') else 0,
            "exists": True
        }
    except Exception as e:
        logger.debug(f"Container Group {name} não encontrado: {e}")
        return {"name": name, "status": "not_found", "exists": False}


def delete_container_group_sdk(
    sdk: "SaladCloudSdk",
    org: str,
    project: str,
    name: str
) -> bool:
    """
    Deleta um Container Group via SDK.
    
    Returns:
        True se deletado com sucesso ou não existia, False em caso de erro
    """
    try:
        # Verificar se existe antes de deletar
        status = get_container_group_status_sdk(sdk, org, project, name)
        if not status or not status.get("exists"):
            logger.info(f"Container Group {name} não existe, nada a deletar")
            return True
        
        # Deletar Container Group
        sdk.container_groups.delete_container_group(
            organization_name=org,
            project_name=project,
            container_group_name=name
        )
        logger.info(f"Container Group {name} deletado com sucesso")
        return True
        
    except Exception as e:
        logger.error(f"Erro ao deletar Container Group {name}: {e}")
        return False


# =============================================================================
# OPERAÇÕES VIA REST API (FALLBACK)
# =============================================================================

def get_container_group_status_rest(
    api_key: str,
    org: str,
    project: str,
    name: str
) -> Optional[Dict[str, Any]]:
    """
    Obtém status de um Container Group via REST API.
    
    Returns:
        Dict com status ou None se não existir
    """
    try:
        url = f"{API_BASE_URL}/organizations/{org}/projects/{project}/containers/{name}"
        req = urllib.request.Request(url, method="GET")
        req.add_header("Salad-Api-Key", api_key)
        
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode())
            return {
                "name": name,
                "status": data.get("current_state", {}).get("status", "unknown"),
                "replicas": data.get("replicas", 0),
                "exists": True
            }
            
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"name": name, "status": "not_found", "exists": False}
        logger.error(f"Erro HTTP ao verificar {name}: {e.code}")
        return None
    except Exception as e:
        logger.error(f"Erro ao verificar Container Group {name}: {e}")
        return None


def delete_container_group_rest(
    api_key: str,
    org: str,
    project: str,
    name: str
) -> bool:
    """
    Deleta um Container Group via REST API.
    
    Returns:
        True se deletado com sucesso ou não existia, False em caso de erro
    """
    try:
        # Verificar se existe antes de deletar
        status = get_container_group_status_rest(api_key, org, project, name)
        if not status or not status.get("exists"):
            logger.info(f"Container Group {name} não existe, nada a deletar")
            return True
        
        # Deletar Container Group
        url = f"{API_BASE_URL}/organizations/{org}/projects/{project}/containers/{name}"
        req = urllib.request.Request(url, method="DELETE")
        req.add_header("Salad-Api-Key", api_key)
        
        urllib.request.urlopen(req, timeout=60)
        logger.info(f"Container Group {name} deletado com sucesso")
        return True
        
    except urllib.error.HTTPError as e:
        if e.code == 404:
            logger.info(f"Container Group {name} não existe (404)")
            return True
        logger.error(f"Erro HTTP ao deletar {name}: {e.code}")
        return False
    except Exception as e:
        logger.error(f"Erro ao deletar Container Group {name}: {e}")
        return False


# =============================================================================
# OPERAÇÕES DE ALTO NÍVEL
# =============================================================================

def check_all_status(
    sdk: Optional["SaladCloudSdk"],
    api_key: str,
    org: str,
    project: str
) -> List[Dict[str, Any]]:
    """
    Verifica status de todos os Container Groups.
    
    Returns:
        Lista com status de cada Container Group
    """
    results = []
    
    for name in CONTAINER_GROUPS:
        if SDK_AVAILABLE and sdk:
            status = get_container_group_status_sdk(sdk, org, project, name)
        else:
            status = get_container_group_status_rest(api_key, org, project, name)
        
        if status:
            results.append(status)
            logger.info(f"  {name}: {status.get('status', 'unknown')}")
    
    return results


def delete_all_container_groups(
    sdk: Optional["SaladCloudSdk"],
    api_key: str,
    org: str,
    project: str
) -> bool:
    """
    Deleta todos os Container Groups.
    
    Returns:
        True se todos deletados com sucesso, False caso contrário
    """
    success = True
    deleted_count = 0
    
    for name in CONTAINER_GROUPS:
        logger.info(f"Deletando Container Group: {name}")
        
        # Tentar com retry
        for attempt in range(1, MAX_RETRIES + 1):
            if SDK_AVAILABLE and sdk:
                result = delete_container_group_sdk(sdk, org, project, name)
            else:
                result = delete_container_group_rest(api_key, org, project, name)
            
            if result:
                deleted_count += 1
                break
            
            if attempt < MAX_RETRIES:
                logger.info(f"  Retry {attempt}/{MAX_RETRIES} em {RETRY_DELAY}s...")
                time.sleep(RETRY_DELAY)
        else:
            logger.error(f"  FALHA ao deletar {name} após {MAX_RETRIES} tentativas")
            success = False
    
    logger.info(f"Container Groups deletados: {deleted_count}/{len(CONTAINER_GROUPS)}")
    return success


# =============================================================================
# MAIN
# =============================================================================

def main():
    """Função principal de rollback/cleanup."""
    
    # Parser de argumentos
    parser = argparse.ArgumentParser(
        description="Alice Enterprise - Salad Cloud Rollback/Cleanup",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos:
  python rollback.py status              # Verificar status de todos os Container Groups
  python rollback.py delete              # Deletar todos os Container Groups
  python rollback.py delete --force      # Deletar sem confirmação (CI/CD)

Variáveis de ambiente obrigatórias:
  SALAD_API_KEY       - API Key do Salad Cloud
  SALAD_ORG           - Organization ID
  SALAD_PROJECT       - Project ID
        """
    )
    
    parser.add_argument(
        "action",
        choices=["status", "delete"],
        help="Ação a executar: status (verificar), delete (remover)"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Executar sem confirmação (para CI/CD)"
    )
    
    args = parser.parse_args()
    
    # Banner
    logger.info("=" * 60)
    logger.info("Alice Enterprise Platform - Salad Cloud Rollback")
    logger.info("=" * 60)
    
    # Obter variáveis de ambiente
    api_key = get_required_env("SALAD_API_KEY")
    org = get_required_env("SALAD_ORG")
    project = get_required_env("SALAD_PROJECT")
    
    logger.info(f"Organization: {org}")
    logger.info(f"Project: {project}")
    logger.info(f"SDK Available: {SDK_AVAILABLE}")
    logger.info(f"Action: {args.action}")
    logger.info("-" * 60)
    
    # Inicializar SDK se disponível
    sdk = None
    if SDK_AVAILABLE:
        try:
            sdk = SaladCloudSdk(api_key=api_key)
            logger.info("SDK inicializado com sucesso")
        except Exception as e:
            logger.warning(f"Erro ao inicializar SDK, usando REST API: {e}")
            sdk = None
    
    # Executar ação
    if args.action == "status":
        logger.info("Verificando status dos Container Groups...")
        results = check_all_status(sdk, api_key, org, project)
        
        # Resumo
        existing = sum(1 for r in results if r.get("exists"))
        running = sum(1 for r in results if r.get("status") == "running")
        
        logger.info("=" * 60)
        logger.info("RESUMO")
        logger.info("=" * 60)
        logger.info(f"Total configurados: {len(CONTAINER_GROUPS)}")
        logger.info(f"Existentes: {existing}")
        logger.info(f"Running: {running}")
        
        sys.exit(0)
    
    elif args.action == "delete":
        # Confirmação (exceto em modo force)
        if not args.force:
            logger.warning("ATENÇÃO: Esta operação irá DELETAR todos os Container Groups GPU!")
            logger.warning("Container Groups a serem deletados:")
            for name in CONTAINER_GROUPS:
                logger.warning(f"  - {name}")
            
            confirm = input("\nDigite 'DELETE' para confirmar: ")
            if confirm != "DELETE":
                logger.info("Operação cancelada pelo usuário")
                sys.exit(0)
        
        logger.info("Iniciando deleção de todos os Container Groups...")
        success = delete_all_container_groups(sdk, api_key, org, project)
        
        # Aguardar propagação
        logger.info("Aguardando 10s para propagação...")
        time.sleep(10)
        
        # Verificar status final
        logger.info("Verificando status final...")
        results = check_all_status(sdk, api_key, org, project)
        
        existing = sum(1 for r in results if r.get("exists"))
        
        # Resumo
        logger.info("=" * 60)
        logger.info("RESUMO DO ROLLBACK")
        logger.info("=" * 60)
        
        if success and existing == 0:
            logger.info("✅ Todos os Container Groups foram deletados com sucesso")
            logger.info("✅ Recursos GPU liberados")
            sys.exit(0)
        else:
            logger.error(f"❌ {existing} Container Groups ainda existem")
            logger.error("❌ Rollback incompleto - verificar manualmente")
            sys.exit(1)


if __name__ == "__main__":
    main()
