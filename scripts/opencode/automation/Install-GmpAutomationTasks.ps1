param(
  [string]$ProjectDir = "$env:USERPROFILE\Desktop\Repositorios\gmp_app_mobilidad"
)

$ErrorActionPreference = "Stop"
$bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $bun) {
  Write-Host "ERROR: bun no encontrado. Instala bun para automatizacion local."
  exit 1
}

$script = Join-Path $ProjectDir ".opencode\scripts\post-web-startup.mjs"
if (-not (Test-Path -LiteralPath $script)) {
  Write-Host "ERROR: no existe $script"
  exit 1
}

$taskName = "GMP-OpenCode-Automation"
$existing = schtasks /Query /TN $taskName 2>$null
if ($LASTEXITCODE -eq 0) {
  schtasks /Delete /TN $taskName /F | Out-Null
}

$action = "cmd /c `"$bun`" `"$script`""
schtasks /Create /TN $taskName /TR $action /SC DAILY /ST 08:15 /RL LIMITED /F | Out-Null

Write-Host "OK: tarea Windows '$taskName' creada (diaria 08:15)."
Write-Host "Logs: $ProjectDir\.opencode\logs\background-automation.*.log"
Write-Host "Tambien corre al arrancar start-opencode-web-gmp.cmd (no bloqueante)."
