#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para atualizar o branding da Alice Enterprise Platform.
Processa a imagem de origem e gera todos os assets necessarios.

Uso:
    python scripts/update-branding.py <imagem-origem>

Exemplo:
    python scripts/update-branding.py assets/branding/alice-new-logo.png

Autor: Fillipe Guerra
Data: 12 de Janeiro de 2026
"""

import sys
import shutil
import io
from pathlib import Path
from PIL import Image

# Forcar UTF-8 no stdout para Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Diretorios base
PROJECT_ROOT = Path(__file__).parent.parent
BRANDING_DIR = PROJECT_ROOT / "assets" / "branding"
FRONTEND_PUBLIC = PROJECT_ROOT / "apps" / "frontend-service" / "public"

# Configuracoes de tamanho
FAVICON_SIZE = (64, 64)  # Favicon 64x64 para boa qualidade em telas retina
LOGO_SIZE = (512, 512)   # Logo principal 512x512

def process_image(source_path: Path) -> None:
    """Processa a imagem de origem e gera todos os assets."""
    
    print(f"[*] Processando imagem: {source_path}")
    
    if not source_path.exists():
        print(f"[ERRO] Arquivo nao encontrado: {source_path}")
        print(f"\n[INFO] Por favor, salve a imagem do novo logo como:")
        print(f"   {BRANDING_DIR / 'alice-new-logo.png'}")
        sys.exit(1)
    
    # Abrir imagem de origem
    with Image.open(source_path) as img:
        # Converter para RGBA se necessario (suportar transparencia)
        if img.mode != 'RGBA':
            img = img.convert('RGBA')
        
        print(f"   Tamanho original: {img.size[0]}x{img.size[1]}")
        print(f"   Modo: {img.mode}")
        
        # 1. Gerar favicon (64x64)
        favicon_path = BRANDING_DIR / "favicon.png"
        favicon = img.copy()
        favicon.thumbnail(FAVICON_SIZE, Image.Resampling.LANCZOS)
        
        # Criar canvas quadrado para manter proporcao
        favicon_canvas = Image.new('RGBA', FAVICON_SIZE, (255, 255, 255, 0))
        offset = ((FAVICON_SIZE[0] - favicon.size[0]) // 2, 
                  (FAVICON_SIZE[1] - favicon.size[1]) // 2)
        favicon_canvas.paste(favicon, offset, favicon if favicon.mode == 'RGBA' else None)
        favicon_canvas.save(favicon_path, 'PNG', optimize=True)
        print(f"   [OK] favicon.png gerado ({FAVICON_SIZE[0]}x{FAVICON_SIZE[1]})")
        
        # 2. Gerar logo-round (512x512)
        logo_path = BRANDING_DIR / "logo-round.png"
        logo = img.copy()
        logo.thumbnail(LOGO_SIZE, Image.Resampling.LANCZOS)
        
        # Criar canvas quadrado para manter proporcao
        logo_canvas = Image.new('RGBA', LOGO_SIZE, (255, 255, 255, 0))
        offset = ((LOGO_SIZE[0] - logo.size[0]) // 2, 
                  (LOGO_SIZE[1] - logo.size[1]) // 2)
        logo_canvas.paste(logo, offset, logo if logo.mode == 'RGBA' else None)
        logo_canvas.save(logo_path, 'PNG', optimize=True)
        print(f"   [OK] logo-round.png gerado ({LOGO_SIZE[0]}x{LOGO_SIZE[1]})")


def copy_to_destinations() -> None:
    """Copia os assets para todos os destinos."""
    
    print("\n[*] Copiando para destinos...")
    
    # Frontend service
    if FRONTEND_PUBLIC.exists():
        shutil.copy2(BRANDING_DIR / "favicon.png", FRONTEND_PUBLIC / "favicon.png")
        print(f"   [OK] {FRONTEND_PUBLIC / 'favicon.png'}")
        
        shutil.copy2(BRANDING_DIR / "logo-round.png", FRONTEND_PUBLIC / "logo-round.png")
        print(f"   [OK] {FRONTEND_PUBLIC / 'logo-round.png'}")
    else:
        print(f"   [WARN] Diretorio nao encontrado: {FRONTEND_PUBLIC}")


def main():
    print("=" * 60)
    print("Alice Platform - Atualizacao de Branding")
    print("=" * 60)
    
    # Determinar arquivo de origem
    if len(sys.argv) > 1:
        source_path = Path(sys.argv[1])
        if not source_path.is_absolute():
            source_path = PROJECT_ROOT / source_path
    else:
        # Padrao: buscar alice-new-logo.png
        source_path = BRANDING_DIR / "alice-new-logo.png"
    
    # Processar imagem
    process_image(source_path)
    
    # Copiar para destinos
    copy_to_destinations()
    
    print("\n" + "=" * 60)
    print("[OK] Branding atualizado com sucesso!")
    print("=" * 60)
    print("\nProximos passos:")
    print("   1. Verifique as imagens geradas em:")
    print(f"      - {BRANDING_DIR}")
    print(f"      - {FRONTEND_PUBLIC}")
    print("   2. Teste localmente com: pnpm dev")
    print("   3. Faca commit consolidado com as mudancas")


if __name__ == "__main__":
    main()
