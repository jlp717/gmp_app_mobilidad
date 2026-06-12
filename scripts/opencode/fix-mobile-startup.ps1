param(
  [string]$ProjectRoot = (Resolve-Path ".").Path,
  [string]$GlobalConfigRoot = "$env:USERPROFILE\.config\opencode",
  [string]$CodexConfig = "$env:USERPROFILE\.codex\config.toml"
)

$ErrorActionPreference = "Stop"

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Backup-File([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backup = "$Path.bak-mobile-$stamp"
  Copy-Item -LiteralPath $Path -Destination $backup -Force
  return $backup
}

function Set-JsonProperty($Object, [string]$Name, $Value) {
  if ($Object.PSObject.Properties.Name -contains $Name) { $Object.$Name = $Value }
  else { $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force }
}

$startupPath = Join-Path $GlobalConfigRoot "tools\start-opencode-project.ps1"
if (-not (Test-Path -LiteralPath $startupPath)) { throw "No existe $startupPath" }
Backup-File $startupPath | Out-Null
$startup = Get-Content -LiteralPath $startupPath -Raw

# Daily/curator reports are manual by default. Startup must only send one useful readiness message.
$startup = $startup -replace 'if \(-not \$NoTelegram\) \{ \$runnerArgs \+= "--telegram" \}', 'if (-not $NoTelegram -and $env:OPENCODE_STARTUP_SEND_CURATOR -eq "1") { $runnerArgs += "--telegram" }'
$startup = $startup -replace '\$curatorReportStatus = Invoke-TeamCuratorRunner \$ProjectDir', '$curatorReportStatus = if ($env:OPENCODE_RUN_CURATOR_ON_START -eq "1") { Invoke-TeamCuratorRunner $ProjectDir } else { "omitido_inicio_manual_/team-curator" }'

# Chrome DevTools, GitHub, memory and sequential-thinking are useful but not startup blockers.
$startup = $startup -replace 'if \(\$criticalMcpStatus -like "ERROR:\*"\) \{ throw \$criticalMcpStatus \}', 'if ($criticalMcpStatus -like "ERROR:*") { Write-Warning $criticalMcpStatus }'
$startup = $startup -replace 'if \(\$mcpRuntimeStatus -like "ERROR:\*"\) \{ throw \$mcpRuntimeStatus \}', 'if ($mcpRuntimeStatus -like "ERROR:*") { Write-Warning $mcpRuntimeStatus }'
$startup = $startup -replace 'localhost:3335/api/health', 'localhost:3197/api/health'

# Add a real pending-task formatter if it is not already present.
if ($startup -notmatch 'function Get-PendingStateSummary') {
  $pendingFunction = @'

function Get-PendingStateSummary([string]$ProjectDir) {
  $dir = Join-Path $ProjectDir ".opencode\state"
  if (-not (Test-Path -LiteralPath $dir)) { return @() }
  $items = @()
  foreach ($file in Get-ChildItem -LiteralPath $dir -Filter *.json -File -ErrorAction SilentlyContinue) {
    try {
      $state = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
      if (-not $state.current_step -or $state.current_step -eq "DELIVER") { continue }
      $label = $state.task_description
      if (-not $label) { $label = $state.summary }
      if (-not $label) { $label = $state.task_id }
      if (-not $label) { $label = $file.BaseName }
      $items += [pscustomobject]@{
        task_id = $state.task_id
        step = $state.current_step
        tier = $state.tier
        label = $label
        updated = $state.ts_updated
      }
    } catch {}
  }
  return @($items | Sort-Object updated -Descending | Select-Object -First 5)
}
'@
  $startup = $startup -replace '(function Get-PendingStateCount)', "$pendingFunction`r`n`$1"
}

# Replace Telegram payload with a short, actionable mobile startup message.
if ($startup -notmatch 'Mobile startup summary v2') {
  $mobileBlock = @'

$pendingItems = Get-PendingStateSummary $ProjectDir
$pendingLine = if ($pendingItems.Count -eq 0) {
  "ninguna"
} else {
  (($pendingItems | ForEach-Object { "- $($_.label) [$($_.step)]" }) -join "`n")
}

$mobileSummary = @"
✅ [$ProjectName] OpenCode listo

Web local: http://127.0.0.1:$Port
Web movil: http://100.107.11.80:$Port (si Tailscale esta activo)
Agente inicial: $env:OPENCODE_AGENT

DB2 192.168.1.22: $db2Status
SSH/backend 192.168.1.230: $sshStatus
Backend health 3197: $backendHealthStatus
Telegram: activo
Chrome DevTools: opcional, no bloquea

Tareas interrumpidas:
$pendingLine

Escribe una peticion concreta en OpenCode Web. Ejemplos:
- "Revisa los errores de cobros y proponme plan"
- "Dime cuantos pedidos hay esta semana"
- "Cambia el texto del boton de confirmar pedido"
"@
'@
  $startup = $startup -replace 'Write-Host \$summary\s+Send-Tg \$summary', "$mobileBlock`r`nWrite-Host `$summary`r`n# Mobile startup summary v2`r`nSend-Tg `$mobileSummary"
}

Write-Utf8NoBom $startupPath $startup

# Disable noisy daily digest by default.
$digestConfig = Join-Path $ProjectRoot ".opencode\config\daily-digest.yaml"
if (Test-Path -LiteralPath $digestConfig) {
  Backup-File $digestConfig | Out-Null
  $digestYaml = @'
daily_digest:
  schedule:
    time: "${DAILY_DIGEST_HOUR}"
    timezone: "${DAILY_DIGEST_TZ}"
    enabled: false
  sections:
    - id: system_health
      label: "Estado del Sistema"
      sources: ["preflight-last", "metrics"]
      include_slo_burndown: false
    - id: pending_tasks
      label: "Tareas pendientes reales"
      sources: [".opencode/state/*.json", "bd ready"]
    - id: recent_activity
      label: "Actividad reciente"
      sources: ["TEAM_TRACE.jsonl", "git log"]
    - id: blockers
      label: "Bloqueos accionables"
      sources: ["readiness-latest", "preflight-last"]
  delivery:
    telegram: false
    voice_synthesis: false
    format: "actionable_only_no_na"
  rules:
    - "No enviar si no hay cambios reales desde el ultimo digest."
    - "Nunca usar N/A: si no hay datos, escribir 'sin datos recientes' y la causa."
    - "Listar tareas pendientes con titulo, estado y origen; no solo un numero."
'@
  Write-Utf8NoBom $digestConfig $digestYaml
}

$digestCommand = Join-Path $ProjectRoot ".opencode\commands\digest.md"
if (Test-Path -LiteralPath $digestCommand) {
  Backup-File $digestCommand | Out-Null
}
$digestCommandText = @'
---
description: Genera un resumen operativo manual, solo con datos reales y accionables.
agent: chief-engineer-assistant
---

Genera un resumen operativo manual con argumentos: `$ARGUMENTS`.

Reglas:
- No enviar a Telegram salvo que Javier lo pida explicitamente con `telegram`.
- No usar `N/A`. Si una fuente no tiene datos, indicar `sin datos recientes` y la causa.
- No decir solo "16 tareas pendientes": listar cada tarea con titulo, estado, origen y fecha real si existe.
- Si no hay tareas pendientes reales, decir `No hay tareas interrumpidas reales`.
- Incluir solo informacion accionable: bloqueos, tareas abiertas, errores recientes, PRs, estado DB2/SSH/backend.
- Si Javier escribe `Daily Digest Summary`, responder con este resumen operativo, no con una plantilla vacia.

Fuentes obligatorias:
- `.opencode/state/*.json`
- `.opencode/state/preflight-last.json`
- `.opencode/state/readiness-latest.json`
- `.opencode/TEAM_TRACE.jsonl`
- `bd ready`
- `git status --short`
'@
Write-Utf8NoBom $digestCommand $digestCommandText

# OpenCode GMP: keep Playwright, disable Chrome DevTools on startup.
$projectConfigPath = Join-Path $ProjectRoot ".opencode\opencode.json"
if (Test-Path -LiteralPath $projectConfigPath) {
  Backup-File $projectConfigPath | Out-Null
  $cfg = Get-Content -LiteralPath $projectConfigPath -Raw | ConvertFrom-Json
  if ($cfg.mcp -and $cfg.mcp.'chrome-devtools') { $cfg.mcp.'chrome-devtools'.enabled = $false }
  if ($cfg.mcp -and $cfg.mcp.playwright) { $cfg.mcp.playwright.enabled = $true }
  $json = $cfg | ConvertTo-Json -Depth 100
  Write-Utf8NoBom $projectConfigPath ($json + "`n")
}

$globalConfigPath = Join-Path $GlobalConfigRoot "opencode.json"
if (Test-Path -LiteralPath $globalConfigPath) {
  Backup-File $globalConfigPath | Out-Null
  $cfg = Get-Content -LiteralPath $globalConfigPath -Raw | ConvertFrom-Json
  if ($cfg.mcp -and $cfg.mcp.'chrome-devtools') { $cfg.mcp.'chrome-devtools'.enabled = $false }
  $json = $cfg | ConvertTo-Json -Depth 100
  Write-Utf8NoBom $globalConfigPath ($json + "`n")
}

# Codex config.toml is separate from OpenCode, but its chrome-devtools timeout can stall local sessions.
if (Test-Path -LiteralPath $CodexConfig) {
  Backup-File $CodexConfig | Out-Null
  $toml = Get-Content -LiteralPath $CodexConfig -Raw
  $toml = $toml -replace 'startup_timeout_ms\s*=\s*120000', 'startup_timeout_ms = 10000'
  Write-Utf8NoBom $CodexConfig $toml
}

Write-Host "Mobile startup fixes applied."
