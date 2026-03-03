#!/usr/bin/env python3
# =============================================================================
# Script Enterprise para Atualização Automática de Versões de Componentes
# Alice Enterprise Platform
# 
# Autor: Fillipe Guerra
# Data: 08/12/2025
# 
# REGRA 6: Enterprise-grade - sem workarounds, mocks ou soluções temporárias
# REGRA 11: Seguir documentação oficial - usar APIs oficiais
# REGRA 16: Buscar SHA256 digests para segurança (Supply Chain Security)
# =============================================================================

"""
Script para atualizar automaticamente versões e SHA256 digests de todos os
componentes externos no docker-compose.prod.yml.

Este script:
1. Recebe versões e digests via argumentos de linha de comando
2. Atualiza docker-compose.prod.yml usando ruamel.yaml (manipulação YAML precisa)
3. Mantém estrutura YAML intacta (comentários, formatação, etc)
"""

import argparse
import sys
from pathlib import Path
from typing import Dict, Optional

try:
    from ruamel.yaml import YAML
except ImportError:
    print("❌ ERRO: ruamel.yaml não está instalado")
    print("   Instale com: pip install ruamel.yaml")
    sys.exit(1)


# =============================================================================
# CONFIGURAÇÃO DE COMPONENTES
# =============================================================================
COMPONENT_CONFIG = {
    "prometheus": {
        "docker_image": "prom/prometheus",
        "version_prefix": "v",
        "services": ["prometheus"],
    },
    "grafana": {
        "docker_image": "grafana/grafana",
        "version_prefix": "",
        "services": ["grafana"],
    },
    "loki": {
        "docker_image": "grafana/loki",
        "version_prefix": "",
        "services": ["loki"],
    },
    "promtail": {
        "docker_image": "grafana/promtail",
        "version_prefix": "",
        "services": ["promtail"],
    },
    "jaeger": {
        "docker_image": "jaegertracing/all-in-one",
        "version_prefix": "",
        "services": ["jaeger"],
    },
    "langfuse": {
        "docker_image": "langfuse/langfuse",
        "version_prefix": "",
        "services": ["langfuse"],
    },
    "redis": {
        "docker_image": "redis",
        "version_prefix": "",
        "services": ["alice-redis"],
    },
}


def update_docker_compose(
    compose_file: Path,
    versions: Dict[str, str],
    digests: Dict[str, Optional[str]],
) -> bool:
    """
    Atualiza docker-compose.prod.yml com versões e digests.
    
    Args:
        compose_file: Caminho para docker-compose.prod.yml
        versions: Dict com versões {component: version}
        digests: Dict com digests {component: digest}
    
    Returns:
        True se atualização foi bem-sucedida
    """
    yaml = YAML()
    yaml.preserve_quotes = True
    yaml.width = 4096  # Evitar quebra de linhas longas
    yaml.indent(mapping=2, sequence=4, offset=2)
    
    try:
        with open(compose_file, "r", encoding="utf-8") as f:
            data = yaml.load(f)
        
        if not data or "services" not in data:
            print(f"❌ ERRO: docker-compose.prod.yml não tem estrutura válida")
            return False
        
        updated_count = 0
        
        # Atualizar cada componente
        for component, version in versions.items():
            if component not in COMPONENT_CONFIG:
                continue
            
            config = COMPONENT_CONFIG[component]
            docker_image = config["docker_image"]
            version_prefix = config["version_prefix"]
            services = config["services"]
            
            # Construir tag completa
            full_tag = f"{version_prefix}{version}"
            
            # Obter digest
            digest = digests.get(component)
            
            # Construir image string
            if digest and digest.strip():
                image_str = f"{docker_image}:{full_tag}@{digest}"
            else:
                image_str = f"{docker_image}:{full_tag}"
                if not digest or not digest.strip():
                    print(f"⚠️  {component}: digest não fornecido, usando apenas tag")
            
            # Atualizar serviços
            for service_name in services:
                if service_name in data["services"]:
                    old_image = data["services"][service_name].get("image", "")
                    data["services"][service_name]["image"] = image_str
                    updated_count += 1
                    print(f"✅ {service_name}: {old_image.split('@')[0] if '@' in old_image else old_image} → {image_str.split('@')[0] if '@' in image_str else image_str}")
        
        # Salvar arquivo atualizado
        with open(compose_file, "w", encoding="utf-8") as f:
            yaml.dump(data, f)
        
        print(f"\n✅ {updated_count} serviços atualizados no docker-compose.prod.yml")
        return True
        
    except Exception as e:
        print(f"❌ ERRO ao atualizar docker-compose.prod.yml: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Função principal do script."""
    parser = argparse.ArgumentParser(
        description="Atualizar versões e digests no docker-compose.prod.yml",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    
    parser.add_argument(
        "--compose-file",
        type=Path,
        default=Path("infra/docker/docker-compose.prod.yml"),
        help="Caminho para docker-compose.prod.yml",
    )
    
    # Argumentos para cada componente
    components = ["prometheus", "grafana", "loki", "promtail", "jaeger", "langfuse", "redis"]
    for component in components:
        parser.add_argument(f"--{component}-version", help=f"Versão do {component}")
        parser.add_argument(f"--{component}-digest", default="", help=f"SHA256 digest do {component}")
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("Versionamento Automático Enterprise - Alice Platform")
    print("=" * 60)
    print()
    
    compose_file = args.compose_file
    if not compose_file.is_absolute():
        # Bug 1 corrigido: usar CWD (diretório de trabalho atual) como base para caminhos relativos
        # Isso funciona corretamente quando o script é executado de /opt/alice/app
        # e recebe --compose-file infra/docker/docker-compose.prod.yml
        cwd = Path.cwd()
        compose_file = cwd / compose_file
    
    if not compose_file.exists():
        print(f"❌ ERRO: docker-compose.prod.yml não encontrado em {compose_file}")
        print(f"   CWD atual: {Path.cwd()}")
        print(f"   Caminho relativo fornecido: {args.compose_file}")
        sys.exit(1)
    
    print(f"📄 Arquivo: {compose_file}")
    print()
    
    # Coletar versões e digests dos argumentos
    versions = {}
    digests = {}
    
    for component in components:
        version_attr = f"{component.replace('-', '_')}_version"
        digest_attr = f"{component.replace('-', '_')}_digest"
        
        version = getattr(args, version_attr, None)
        digest = getattr(args, digest_attr, None) or ""
        
        if version:
            versions[component] = version
            digests[component] = digest if digest else None
            print(f"✅ {component}: {version}{' @' + digest[:20] + '...' if digest else ' (sem digest)'}")
    
    print()
    
    # Atualizar docker-compose.prod.yml
    print("🔄 Atualizando docker-compose.prod.yml...")
    success = update_docker_compose(compose_file, versions, digests)
    
    if success:
        print()
        print("=" * 60)
        print("✅ Versionamento automático concluído com sucesso!")
        print("=" * 60)
        sys.exit(0)
    else:
        print()
        print("=" * 60)
        print("❌ ERRO: Falha ao atualizar docker-compose.prod.yml")
        print("=" * 60)
        sys.exit(1)


if __name__ == "__main__":
    main()
