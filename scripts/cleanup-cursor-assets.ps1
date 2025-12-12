# ==============================================================================
# Script de Limpeza - Cursor IDE Assets
# Alice Enterprise Platform
#
# Remove arquivos temporários do Cursor IDE (attached_assets/)
# Pode ser executado manualmente ou via Task Scheduler (diário)
#
# Autor: Fillipe Guerra
# Data: 11 de Dezembro de 2025
# ==============================================================================

param(
    [switch]$DryRun = $false,
    [switch]$Verbose = $false
)

$ErrorActionPreference = "Stop"

# Caminho do projeto (relativo ao script)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$AttachedAssetsPath = Join-Path $ProjectRoot "attached_assets"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Limpeza de Assets Temporários do Cursor" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $AttachedAssetsPath) {
    # Contar arquivos e calcular tamanho
    $files = Get-ChildItem -Recurse $AttachedAssetsPath -File
    $totalFiles = $files.Count
    $totalSize = ($files | Measure-Object -Property Length -Sum).Sum
    $totalSizeMB = [math]::Round($totalSize / 1MB, 2)

    Write-Host "Pasta encontrada: $AttachedAssetsPath" -ForegroundColor Yellow
    Write-Host "Arquivos: $totalFiles" -ForegroundColor Yellow
    Write-Host "Tamanho: $totalSizeMB MB" -ForegroundColor Yellow
    Write-Host ""

    if ($DryRun) {
        Write-Host "[DRY RUN] Nenhum arquivo foi excluído." -ForegroundColor Magenta
        if ($Verbose) {
            Write-Host ""
            Write-Host "Arquivos que seriam excluídos:" -ForegroundColor Gray
            $files | ForEach-Object { Write-Host "  - $($_.Name)" -ForegroundColor Gray }
        }
    } else {
        # Excluir a pasta
        Remove-Item -Recurse -Force $AttachedAssetsPath
        Write-Host "✓ Pasta excluída com sucesso!" -ForegroundColor Green
        Write-Host "  Liberados: $totalSizeMB MB ($totalFiles arquivos)" -ForegroundColor Green
    }
} else {
    Write-Host "✓ Pasta attached_assets/ não existe - nada a limpar." -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Limpeza concluída!" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# Para agendar execução diária no Windows Task Scheduler:
# 1. Abra Task Scheduler (taskschd.msc)
# 2. Create Basic Task...
# 3. Nome: "Alice - Limpeza Cursor Assets"
# 4. Trigger: Daily, 03:00
# 5. Action: Start a program
#    Program: powershell.exe
#    Arguments: -ExecutionPolicy Bypass -File "C:\APPs\alice\scripts\cleanup-cursor-assets.ps1"
# 6. Finish
