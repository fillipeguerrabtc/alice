#!/usr/bin/env python3
"""
Alice Enterprise Platform - Salad Cloud Deploy Script
======================================================

Script enterprise-grade para deploy de Container Groups GPU no Salad Cloud.
Usa o Python SDK oficial (salad-cloud-sdk) com fallback para REST API.

PIPELINE CI/CD:
- Executado apos deploy Hetzner bem-sucedido
- Cria/atualiza 4 Container Groups de GPU
- Configura autenticacao GHCR para pull de imagens
- Configura health probes para monitoramento

Autor: Fillipe Guerra
Data: 17 de Dezembro de 2025
"""

import os
import sys
import json
import time
import logging
from typing import Optional

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
    from salad_cloud_sdk.models import (
        CreateContainerGroup,
        ContainerGroupLivenessProbe,
        ContainerGroupStartupProbe,
        CreateContainer,
        CreateContainerGroupNetworking,
        ContainerGroupPriority,
        ContainerRestartPolicy,
        ContainerResourceRequirements,
        HttpFormat,
    )
    SDK_AVAILABLE = True
    logger.info("Salad Cloud SDK disponivel")
except ImportError:
    SDK_AVAILABLE = False
    logger.warning("Salad Cloud SDK nao disponivel, usando REST API direta")
    import urllib.request
    import urllib.error

from config import get_container_groups, get_ghcr_auth_config, ContainerGroupConfig

# =============================================================================
# CONSTANTES
# =============================================================================

API_BASE_URL = "https://api.salad.com/api/public"
MAX_RETRIES = 3
RETRY_DELAY = 5  # segundos

# =============================================================================
# FUNCOES AUXILIARES
# =============================================================================

def get_required_env(name: str) -> str:
    """Obtem variavel de ambiente obrigatoria ou falha."""
    value = os.environ.get(name)
    if not value:
        logger.error(f"Variavel de ambiente {name} nao definida")
        sys.exit(1)
    return value


def wait_for_container_group(
    sdk: Optional["SaladCloudSdk"],
    org: str,
    project: str,
    name: str,
    api_key: str,
    timeout: int = 300
) -> bool:
    """
    Aguarda Container Group ficar pronto (running).
    
    Args:
        sdk: SDK instance (ou None para usar REST API)
        org: Organization ID
        project: Project ID
        name: Nome do Container Group
        api_key: API Key para autenticacao
        timeout: Timeout em segundos
    
    Returns:
        True se Container Group ficou pronto, False caso contrario
    """
    start_time = time.time()
    
    while time.time() - start_time < timeout:
        try:
            if SDK_AVAILABLE and sdk:
                cg = sdk.container_groups.get_container_group(
                    organization_name=org,
                    project_name=project,
                    container_group_name=name
                )
                status = cg.current_state.status if cg.current_state else "unknown"
            else:
                # Fallback REST API
                url = f"{API_BASE_URL}/organizations/{org}/projects/{project}/containers/{name}"
                req = urllib.request.Request(url, method="GET")
                req.add_header("Salad-Api-Key", api_key)
                
                with urllib.request.urlopen(req, timeout=30) as response:
                    data = json.loads(response.read().decode())
                    status = data.get("current_state", {}).get("status", "unknown")
            
            logger.info(f"Container Group {name}: status={status}")
            
            if status == "running":
                return True
            elif status in ["failed", "stopped"]:
                logger.error(f"Container Group {name} falhou: {status}")
                return False
                
        except Exception as e:
            logger.warning(f"Erro ao verificar status de {name}: {e}")
        
        time.sleep(10)
    
    logger.error(f"Timeout aguardando Container Group {name}")
    return False


# =============================================================================
# DEPLOY VIA SDK
# =============================================================================

def deploy_with_sdk(
    sdk: "SaladCloudSdk",
    org: str,
    project: str,
    config: ContainerGroupConfig,
    ghcr_username: str,
    ghcr_token: str,
) -> bool:
    """
    Faz deploy de um Container Group usando o SDK oficial.
    
    Args:
        sdk: Instancia do SDK
        org: Organization ID
        project: Project ID
        config: Configuracao do Container Group
        ghcr_username: Username GHCR
        ghcr_token: Token GHCR
    
    Returns:
        True se deploy bem-sucedido, False caso contrario
    """
    try:
        # Verificar se Container Group ja existe
        try:
            existing = sdk.container_groups.get_container_group(
                organization_name=org,
                project_name=project,
                container_group_name=config.name
            )
            logger.info(f"Container Group {config.name} ja existe, atualizando...")
            
            # Atualizar Container Group existente
            # SDK atualmente nao suporta update completo, entao deletamos e recriamos
            sdk.container_groups.delete_container_group(
                organization_name=org,
                project_name=project,
                container_group_name=config.name
            )
            logger.info(f"Container Group {config.name} deletado para recriacao")
            time.sleep(5)  # Aguardar propagacao
            
        except Exception:
            logger.info(f"Container Group {config.name} nao existe, criando...")
        
        # Criar Container Group
        container_group = CreateContainerGroup(
            name=config.name,
            display_name=config.display_name,
            container=CreateContainer(
                image=config.image,
                resources=ContainerResourceRequirements(
                    cpu=config.cpu,
                    memory=config.memory * 1024,  # Converter GB para MB
                    gpu_classes=[config.gpu_class],
                ),
                environment_variables=config.env_vars,
                command=config.command,
            ),
            replicas=config.replicas,
            autostart_policy=True,
            restart_policy=ContainerRestartPolicy.ALWAYS,
            networking=CreateContainerGroupNetworking(
                protocol="http",
                port=config.port,
                auth=False,
            ),
            liveness_probe=ContainerGroupLivenessProbe(
                http=HttpFormat(
                    path=config.liveness_probe_path,
                    port=config.port,
                ),
                period_seconds=config.liveness_period,
                timeout_seconds=config.liveness_timeout,
                failure_threshold=3,
                success_threshold=1,
            ),
            startup_probe=ContainerGroupStartupProbe(
                http=HttpFormat(
                    path=config.startup_probe_path,
                    port=config.port,
                ),
                initial_delay_seconds=config.startup_initial_delay,
                period_seconds=10,
                timeout_seconds=30,
                failure_threshold=30,
                success_threshold=1,
            ),
        )
        
        # Configurar autenticacao GHCR
        # Nota: SDK pode nao suportar isso diretamente, verificar docs
        
        result = sdk.container_groups.create_container_group(
            organization_name=org,
            project_name=project,
            request_body=container_group
        )
        
        logger.info(f"Container Group {config.name} criado com sucesso")
        return True
        
    except Exception as e:
        logger.error(f"Erro ao fazer deploy de {config.name}: {e}")
        return False


# =============================================================================
# DEPLOY VIA REST API (FALLBACK)
# =============================================================================

def deploy_with_rest_api(
    api_key: str,
    org: str,
    project: str,
    config: ContainerGroupConfig,
    ghcr_username: str,
    ghcr_token: str,
) -> bool:
    """
    Faz deploy de um Container Group usando REST API direta.
    
    Args:
        api_key: Salad API Key
        org: Organization ID
        project: Project ID
        config: Configuracao do Container Group
        ghcr_username: Username GHCR
        ghcr_token: Token GHCR
    
    Returns:
        True se deploy bem-sucedido, False caso contrario
    """
    try:
        base_url = f"{API_BASE_URL}/organizations/{org}/projects/{project}/containers"
        
        # Verificar se Container Group ja existe
        check_url = f"{base_url}/{config.name}"
        try:
            req = urllib.request.Request(check_url, method="GET")
            req.add_header("Salad-Api-Key", api_key)
            
            with urllib.request.urlopen(req, timeout=30) as response:
                logger.info(f"Container Group {config.name} ja existe, deletando...")
                
                # Deletar para recriar
                del_req = urllib.request.Request(check_url, method="DELETE")
                del_req.add_header("Salad-Api-Key", api_key)
                urllib.request.urlopen(del_req, timeout=30)
                time.sleep(5)
                
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            logger.info(f"Container Group {config.name} nao existe, criando...")
        
        # Payload para criar Container Group
        payload = {
            "name": config.name,
            "display_name": config.display_name,
            "container": {
                "image": config.image,
                "resources": {
                    "cpu": config.cpu,
                    "memory": config.memory * 1024,  # GB para MB
                    "gpu_classes": [config.gpu_class],
                },
                "environment_variables": config.env_vars,
            },
            "replicas": config.replicas,
            "autostart_policy": True,
            "restart_policy": "always",
            "networking": {
                "protocol": "http",
                "port": config.port,
                "auth": False,
            },
            "liveness_probe": {
                "http": {
                    "path": config.liveness_probe_path,
                    "port": config.port,
                },
                "period_seconds": config.liveness_period,
                "timeout_seconds": config.liveness_timeout,
                "failure_threshold": 3,
                "success_threshold": 1,
            },
            "startup_probe": {
                "http": {
                    "path": config.startup_probe_path,
                    "port": config.port,
                },
                "initial_delay_seconds": config.startup_initial_delay,
                "period_seconds": 10,
                "timeout_seconds": 30,
                "failure_threshold": 30,
                "success_threshold": 1,
            },
            # Autenticacao GHCR
            "container_gateway": {
                "image_caching": {
                    "enabled": True,
                },
            },
        }
        
        # Adicionar autenticacao GHCR se disponivel
        if ghcr_username and ghcr_token:
            payload["container"]["registry_authentication"] = {
                "basic": {
                    "username": ghcr_username,
                    "password": ghcr_token,
                }
            }
        
        # Criar Container Group
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(base_url, data=data, method="POST")
        req.add_header("Salad-Api-Key", api_key)
        req.add_header("Content-Type", "application/json")
        
        with urllib.request.urlopen(req, timeout=60) as response:
            result = json.loads(response.read().decode())
            logger.info(f"Container Group {config.name} criado: {result.get('id', 'N/A')}")
            return True
            
    except Exception as e:
        logger.error(f"Erro ao fazer deploy de {config.name} via REST: {e}")
        return False


# =============================================================================
# MAIN
# =============================================================================

def get_container_group_url(
    sdk: Optional["SaladCloudSdk"],
    org: str,
    project: str,
    name: str,
    api_key: str,
) -> Optional[str]:
    """
    Obtem a URL publica de um Container Group apos criacao.
    
    ENTERPRISE-GRADE (21/12/2025):
    - Consulta API do Salad Cloud para obter networking.dns
    - Retorna URL no formato https://<dns>
    - Necessario para configurar secrets automaticamente
    
    Args:
        sdk: SDK instance (ou None para usar REST API)
        org: Organization ID
        project: Project ID
        name: Nome do Container Group
        api_key: API Key para autenticacao
    
    Returns:
        URL publica ou None se nao disponivel
    """
    try:
        if SDK_AVAILABLE and sdk:
            cg = sdk.container_groups.get_container_group(
                organization_name=org,
                project_name=project,
                container_group_name=name
            )
            # SDK retorna networking.dns com o dominio
            if hasattr(cg, 'networking') and cg.networking:
                dns = getattr(cg.networking, 'dns', None)
                if dns:
                    return f"https://{dns}"
        else:
            # Fallback REST API
            url = f"{API_BASE_URL}/organizations/{org}/projects/{project}/containers/{name}"
            req = urllib.request.Request(url, method="GET")
            req.add_header("Salad-Api-Key", api_key)
            
            with urllib.request.urlopen(req, timeout=30) as response:
                data = json.loads(response.read().decode())
                networking = data.get("networking", {})
                dns = networking.get("dns")
                if dns:
                    return f"https://{dns}"
        
        return None
        
    except Exception as e:
        logger.warning(f"Erro ao obter URL de {name}: {e}")
        return None


def main():
    """Funcao principal de deploy."""
    
    logger.info("=" * 60)
    logger.info("Alice Enterprise Platform - Salad Cloud Deploy")
    logger.info("=" * 60)
    
    # Obter variaveis de ambiente
    api_key = get_required_env("SALAD_API_KEY")
    org = get_required_env("SALAD_ORG")
    project = get_required_env("SALAD_PROJECT")
    image_tag = get_required_env("IMAGE_TAG")
    ghcr_token = get_required_env("GHCR_TOKEN")
    huggingface_token = os.environ.get("HUGGINGFACE_TOKEN", "")
    
    # Username GHCR (extrair de GITHUB_REPOSITORY ou usar default)
    github_repo = os.environ.get("GITHUB_REPOSITORY", "")
    ghcr_username = github_repo.split("/")[0] if "/" in github_repo else "alice-platform"
    
    logger.info(f"Organization: {org}")
    logger.info(f"Project: {project}")
    logger.info(f"Image Tag: {image_tag}")
    logger.info(f"GHCR Username: {ghcr_username}")
    logger.info(f"SDK Available: {SDK_AVAILABLE}")
    
    # Obter configuracoes dos Container Groups
    configs = get_container_groups(
        image_tag=image_tag,
        ghcr_username=ghcr_username,
        ghcr_token=ghcr_token,
        huggingface_token=huggingface_token,
    )
    
    # Inicializar SDK se disponivel
    sdk = None
    if SDK_AVAILABLE:
        try:
            sdk = SaladCloudSdk(api_key=api_key)
            logger.info("SDK inicializado com sucesso")
        except Exception as e:
            logger.warning(f"Erro ao inicializar SDK, usando REST API: {e}")
            sdk = None
    
    # Deploy de cada Container Group
    success_count = 0
    failed_groups = []
    deployed_urls = {}  # NOVO: Armazenar URLs dos Container Groups
    
    for config in configs:
        logger.info("-" * 40)
        logger.info(f"Deployando: {config.display_name}")
        logger.info(f"  Image: {config.image}")
        logger.info(f"  GPU: RTX 4090 (24GB VRAM)")
        logger.info(f"  Resources: {config.cpu} CPU, {config.memory}GB RAM")
        
        # Tentar deploy com retry
        success = False
        for attempt in range(1, MAX_RETRIES + 1):
            logger.info(f"  Tentativa {attempt}/{MAX_RETRIES}...")
            
            if sdk:
                success = deploy_with_sdk(
                    sdk=sdk,
                    org=org,
                    project=project,
                    config=config,
                    ghcr_username=ghcr_username,
                    ghcr_token=ghcr_token,
                )
            else:
                success = deploy_with_rest_api(
                    api_key=api_key,
                    org=org,
                    project=project,
                    config=config,
                    ghcr_username=ghcr_username,
                    ghcr_token=ghcr_token,
                )
            
            if success:
                break
            
            if attempt < MAX_RETRIES:
                logger.info(f"  Aguardando {RETRY_DELAY}s antes de retry...")
                time.sleep(RETRY_DELAY)
        
        if success:
            success_count += 1
            logger.info(f"  SUCESSO: {config.name}")
            
            # NOVO: Aguardar um pouco e obter URL do Container Group
            time.sleep(5)  # Aguardar propagacao
            url = get_container_group_url(sdk, org, project, config.name, api_key)
            if url:
                deployed_urls[config.name] = url
                logger.info(f"  URL: {url}")
            else:
                logger.warning(f"  URL ainda nao disponivel para {config.name}")
        else:
            failed_groups.append(config.name)
            logger.error(f"  FALHA: {config.name}")
    
    # Resumo
    logger.info("=" * 60)
    logger.info("RESUMO DO DEPLOY")
    logger.info("=" * 60)
    logger.info(f"Total: {len(configs)}")
    logger.info(f"Sucesso: {success_count}")
    logger.info(f"Falha: {len(failed_groups)}")
    
    # NOVO: Imprimir URLs para GitHub Actions capturar como outputs
    # Formato: ::set-output name=<key>::<value> (deprecated) ou GITHUB_OUTPUT
    logger.info("")
    logger.info("=" * 60)
    logger.info("URLS DOS CONTAINER GROUPS (para GitHub Actions)")
    logger.info("=" * 60)
    
    github_output = os.environ.get("GITHUB_OUTPUT")
    
    # Mapeamento de nomes para variaveis de ambiente
    url_mapping = {
        "alice-mixtral-vllm": "SALAD_MIXTRAL_URL",
        "alice-embeddings-gpu": "EMBEDDINGS_GPU_URL",
        "alice-flux-schnell": "SALAD_FLUX_URL",
        "alice-asr-canary": "SALAD_ASR_URL",
    }
    
    for cg_name, env_var in url_mapping.items():
        url = deployed_urls.get(cg_name, "")
        logger.info(f"{env_var}={url}")
        
        # Escrever para GITHUB_OUTPUT se disponivel
        if github_output and url:
            try:
                with open(github_output, "a") as f:
                    f.write(f"{env_var}={url}\n")
            except Exception as e:
                logger.warning(f"Erro ao escrever GITHUB_OUTPUT: {e}")
    
    # SALAD_WHISPER_URL usa mesma URL do ASR
    whisper_url = deployed_urls.get("alice-asr-canary", "")
    logger.info(f"SALAD_WHISPER_URL={whisper_url}")
    if github_output and whisper_url:
        try:
            with open(github_output, "a") as f:
                f.write(f"SALAD_WHISPER_URL={whisper_url}\n")
        except Exception:
            pass
    
    logger.info("=" * 60)
    
    if failed_groups:
        logger.error(f"Container Groups com falha: {', '.join(failed_groups)}")
        sys.exit(1)
    
    logger.info("Deploy concluido com sucesso!")
    sys.exit(0)


if __name__ == "__main__":
    main()
