param(
  [ValidateSet('all', 'alice', 'infra', 'observability', 'backup')]
  [string]$Stack = 'all',
  [string]$EnvFile = '',
  [string]$ComposeFile = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($EnvFile -ne '') {
  if (-not (Test-Path $EnvFile)) {
    throw "Env file not found: $EnvFile"
  }

  Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $parts = $_ -split '=', 2
    if ($parts.Count -eq 2) {
      $name = $parts[0].Trim()
      $value = $parts[1]
      [Environment]::SetEnvironmentVariable($name, $value)
    }
  }
}

$commonSecrets = @(
  'POSTGRES_PASSWORD',
  'REDIS_CACHE_PASSWORD',
  'REDIS_QUEUE_PASSWORD',
  'SESSION_SECRET',
  'INTERNAL_API_SECRET',
  'QDRANT_API_KEY'
)

$aliceSecrets = @(
  'OPENAI_API_KEY',
  'SEARXNG_SECRET_KEY',
  'CORS_ORIGIN'
)

$observabilitySecrets = @(
  'GRAFANA_ADMIN_USER',
  'GRAFANA_ADMIN_PASSWORD'
)

$backupSecrets = @(
  'BACKUP_CIPHER_PASS'
)

$required = @()
switch ($Stack) {
  'all' { $required = $commonSecrets + $aliceSecrets + $observabilitySecrets + $backupSecrets }
  'alice' { $required = $commonSecrets + $aliceSecrets }
  'infra' { $required = $commonSecrets }
  'observability' { $required = $commonSecrets + $observabilitySecrets }
  'backup' { $required = $commonSecrets + $backupSecrets }
}

$missing = @()
foreach ($name in $required) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    $missing += $name
  }
}

if ($missing.Count -gt 0) {
  Write-Host "ERROR: missing required secrets for stack '$Stack':"
  $missing | ForEach-Object { Write-Host "  - $_" }
  exit 1
}

if ($ComposeFile -ne '') {
  $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
  if ($null -eq $dockerCmd) {
    throw 'docker command not found (required for compose preflight).'
  }

  if ($EnvFile -ne '') {
    docker compose --env-file $EnvFile -f $ComposeFile config | Out-Null
  } else {
    docker compose -f $ComposeFile config | Out-Null
  }
}

Write-Host "OK: preflight secrets check passed for stack '$Stack'."
