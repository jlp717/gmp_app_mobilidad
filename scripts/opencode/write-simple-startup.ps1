param(
  [string]$GlobalConfigRoot = "$env:USERPROFILE\.config\opencode"
)

$ErrorActionPreference = "Stop"

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

$startupPath = Join-Path $GlobalConfigRoot "tools\start-opencode-project.ps1"
if (Test-Path -LiteralPath $startupPath) {
  $backup = "$startupPath.bak-simple-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Copy-Item -LiteralPath $startupPath -Destination $backup -Force
}

$content = @'
param(
  [Parameter(Mandatory=$true)][ValidateSet("gmp","granja")][string]$Project,
  [switch]$NoWeb,
  [switch]$NoTelegram
)

$ErrorActionPreference = "Stop"
$HomeDir = [Environment]::GetFolderPath("UserProfile")
$ConfigDir = Join-Path $HomeDir ".config\opencode"
$EnvFile = Join-Path $ConfigDir ".env"
$Node = "C:\Program Files\nodejs\node.exe"
$OpenCode = "C:\nvm4w\nodejs\opencode.cmd"

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
}

function Load-Env {
  if (-not (Test-Path -LiteralPath $EnvFile)) { return }
  foreach ($line in Get-Content -LiteralPath $EnvFile) {
    if ($line -match "^\s*#" -or $line -notmatch "=") { continue }
    $parts = $line -split "=", 2
    $name = $parts[0].Trim()
    if (-not $name -or $name -ieq "OPENAI_API_KEY") { continue }
    [Environment]::SetEnvironmentVariable($name, $parts[1], "Process")
  }
}

function Set-EnvFileValue([string]$Name, [string]$Value) {
  $lines = @()
  if (Test-Path -LiteralPath $EnvFile) { $lines = @(Get-Content -LiteralPath $EnvFile) }
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^$([regex]::Escape($Name))=") {
      $lines[$i] = "$Name=$Value"
      $found = $true
      break
    }
  }
  if (-not $found) { $lines += "$Name=$Value" }
  Write-Utf8NoBom $EnvFile ($lines -join [Environment]::NewLine)
  [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
}

function New-Secret([int]$Length = 36) {
  $chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $out = New-Object System.Text.StringBuilder
  foreach ($b in $bytes) { [void]$out.Append($chars[$b % $chars.Length]) }
  return $out.ToString()
}

function Ensure-OpenCodeWebAuth {
  if (-not $env:OPENCODE_SERVER_USERNAME) { Set-EnvFileValue "OPENCODE_SERVER_USERNAME" "Javier" }
  if (-not $env:OPENCODE_SERVER_PASSWORD) { Set-EnvFileValue "OPENCODE_SERVER_PASSWORD" (New-Secret 36) }
}

function Test-Url([string]$Url, [int]$TimeoutSec = 3) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch { return $false }
}

function Test-Tcp([string]$HostName, [int]$Port, [int]$TimeoutMs = 1000) {
  $client = [Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync($HostName, $Port)
    if (-not $task.Wait($TimeoutMs)) { return $false }
    return $client.Connected
  } catch { return $false }
  finally { $client.Dispose() }
}

function Test-RemoteHttp([string]$HostName, [string]$User, [string[]]$Urls) {
  $ssh = "C:\Program Files\Git\usr\bin\ssh.exe"
  if (-not (Test-Path -LiteralPath $ssh)) { return "ssh_no_disponible" }
  $checks = @()
  foreach ($url in $Urls) {
    $checks += "if curl -sf -A GMP-StartupCheck/2.0 '$url' >/tmp/opencode-health-body 2>/dev/null; then echo 'remote_health_ok:$url'; head -c 180 /tmp/opencode-health-body | tr '\n' ' '; exit 0; fi"
  }
  $script = ($checks -join "; ") + "; echo remote_health_fail; exit 1"
  try {
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
    $remote = "printf '%s' '$encoded' | base64 -d | bash"
    $output = & $ssh @("-o","BatchMode=yes","-o","ConnectTimeout=5","$User@$HostName",$remote) 2>$null
    if ($LASTEXITCODE -eq 0 -and $output) { return (($output -join " ") -replace "\s+", " ").Trim() }
    return "remote_health_fail"
  } catch {
    return "remote_health_error: $($_.Exception.Message)"
  }
}

function Send-Tg([string]$Message) {
  if ($NoTelegram) { return }
  $tool = Join-Path $ConfigDir "tools\telegram-notifier.mjs"
  if (Test-Path -LiteralPath $tool) {
    try { & $Node $tool --message $Message 2>$null | Out-Null } catch {}
  }
}

function Start-MetricsServer([string]$ProjectDir) {
  if (Test-Url "http://127.0.0.1:9091/health" 1) { return "listo:9091" }
  $server = Join-Path $ProjectDir ".opencode\metrics-server.js"
  if (-not (Test-Path -LiteralPath $server)) { return "no_configurado" }
  try {
    Start-Process -WindowStyle Hidden -FilePath $Node -ArgumentList @($server) -WorkingDirectory $ProjectDir | Out-Null
    Start-Sleep -Seconds 1
    foreach ($port in @(9091,9092,9093)) {
      if (Test-Url "http://127.0.0.1:$port/health" 1) { return "listo:$port" }
    }
  } catch {}
  return "degradado"
}

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

function Get-AgentStats {
  try {
    $raw = & $OpenCode debug config --pure 2>&1
    if ($LASTEXITCODE -ne 0) { return [pscustomobject]@{ ok=$false; count=0; primary=""; model=""; error=($raw -join " ") } }
    $text = ($raw -join "`n").Trim()
    $jsonStart = $text.IndexOf("{")
    if ($jsonStart -lt 0) { return [pscustomobject]@{ ok=$false; count=0; primary=""; model=""; error="sin JSON" } }
    $cfg = $text.Substring($jsonStart) | ConvertFrom-Json
    $agents = @($cfg.agent.PSObject.Properties | Where-Object { -not $_.Value.disable })
    $primary = @($agents | Where-Object { $_.Value.mode -in @("primary","all") } | ForEach-Object Name)
    return [pscustomobject]@{ ok=$true; count=$agents.Count; primary=($primary -join ", "); model=$cfg.model; error="" }
  } catch {
    return [pscustomobject]@{ ok=$false; count=0; primary=""; model=""; error=$_.Exception.Message }
  }
}

Load-Env
Ensure-OpenCodeWebAuth
$env:OPENAI_API_KEY = $null
$env:XDG_CONFIG_HOME = Join-Path $HomeDir ".opencode-runtime"
$env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = "32768"
$env:OPENCODE_EXPERIMENTAL_LSP_TOOL = "true"
$env:CURSOR_ACP_MCP_BRIDGE = "false"
$env:CURSOR_ACP_LOG_SILENT = "true"
$env:PATH = "C:\Program Files\Git\usr\bin;C:\nvm4w\nodejs;C:\Program Files\nodejs;C:\Users\Javier\AppData\Roaming\npm;C:\Users\Javier\AppData\Local\cursor-agent;" + $env:PATH

if ($Project -eq "gmp") {
  $ProjectName = "GMP"
  $ProjectDir = Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad"
  $Port = 3090
  $env:OPENCODE_AGENT = "chief-engineer-assistant"
} else {
  $ProjectName = "GRANJA"
  $ProjectDir = Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa"
  $Port = 3091
  $env:OPENCODE_AGENT = "Granja-Orchestrator"
}

if (-not (Test-Path -LiteralPath $ProjectDir)) { throw "Ruta de proyecto no existe: $ProjectDir" }
Set-Location -LiteralPath $ProjectDir

New-Item -ItemType Directory -Path ".opencode",".opencode\state",".opencode\metrics",".opencode\logs" -Force | Out-Null
if (-not (Test-Path ".opencode\TEAM_TRACE.jsonl")) { New-Item -ItemType File -Path ".opencode\TEAM_TRACE.jsonl" -Force | Out-Null }
if (-not (Test-Path ".opencode\tokens.jsonl")) { New-Item -ItemType File -Path ".opencode\tokens.jsonl" -Force | Out-Null }

$env:GMP_APP_SERVER_HOST = "192.168.1.230"
$env:GMP_DB2_HOST = "192.168.1.22"
$env:IBM_DB2_HOST = "192.168.1.22"
$env:GMP_IMAGE_HOST = "192.168.1.191"
$env:GMP_BACKEND_PORT = "3335"
$env:ODBC_DSN = "GMP"
if (-not $env:ODBC_SCHEMA) { $env:ODBC_SCHEMA = "JAVIER" }
$env:SSH_GMP_HOST = "192.168.1.230"
if (-not $env:SSH_GMP_USER) { $env:SSH_GMP_USER = "gmp" }

$nodeStatus = if (Test-Path -LiteralPath $Node) { "listo" } else { "no_encontrado" }
$opencodeStatus = if (Test-Path -LiteralPath $OpenCode) { "listo" } else { "no_encontrado" }
if ($nodeStatus -ne "listo" -or $opencodeStatus -ne "listo") {
  Write-Host "Falta dependencia: Node=$nodeStatus OpenCode=$opencodeStatus"
  exit 1
}

$db2Status = if (Test-Connection -ComputerName "192.168.1.22" -Count 1 -Quiet -ErrorAction SilentlyContinue) { "red_ok" } else { "offline_o_sin_ping" }
$sshStatus = if (Test-Connection -ComputerName "192.168.1.230" -Count 1 -Quiet -ErrorAction SilentlyContinue) { "red_ok" } else { "offline_o_sin_ping" }
$imageStatus = if ($Project -eq "gmp" -and (Test-Connection -ComputerName "192.168.1.191" -Count 1 -Quiet -ErrorAction SilentlyContinue)) { "red_ok" } elseif ($Project -eq "gmp") { "offline_o_sin_ping" } else { "no_aplica" }
$backendHealthStatus = if ($Project -eq "gmp" -and $sshStatus -eq "red_ok") {
  $remote = Test-RemoteHttp "192.168.1.230" "gmp" @("http://localhost:3335/api/health", "http://localhost:3335/health")
  if ($remote -like "remote_health_ok:*") { $remote }
  elseif (Test-Tcp "192.168.1.230" 3335 1000) { "tcp_3335_ok_desde_PC" }
  else { "no_expuesto_desde_PC_y_$remote" }
} else { "no_verificado" }
$cursorStatus = if (Test-Url "http://127.0.0.1:32124/v1/models" 3) { "listo" } else { "opcional_no_disponible" }
$metricsStatus = Start-MetricsServer $ProjectDir
$agentStats = Get-AgentStats
$pendingItems = Get-PendingStateSummary $ProjectDir
$pendingLine = if ($pendingItems.Count -eq 0) {
  "ninguna"
} else {
  (($pendingItems | ForEach-Object { "- $($_.label) [$($_.step)]" }) -join "`n")
}

$preflightPayload = [ordered]@{
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
  project = $ProjectName
  node_status = $nodeStatus
  opencode_status = $opencodeStatus
  model = $agentStats.model
  agents = $agentStats.count
  primary_agents = $agentStats.primary
  db2_status = $db2Status
  backend_status = $sshStatus
  backend_health_status = $backendHealthStatus
  image_status = $imageStatus
  cursor_status = $cursorStatus
  metrics_status = $metricsStatus
  pending_tasks = @($pendingItems)
}
Write-Utf8NoBom ".opencode\state\preflight-last.json" (($preflightPayload | ConvertTo-Json -Depth 20) + "`n")

$consoleSummary = @"
OK [$ProjectName] OpenCode preflight
Node: $nodeStatus
OpenCode: $opencodeStatus
Modelo default: $($agentStats.model)
Agentes cargados: $($agentStats.count)
Primary: $($agentStats.primary)
DB2 192.168.1.22: $db2Status
SSH/backend 192.168.1.230: $sshStatus
Backend 3335: $backendHealthStatus
Imagenes 192.168.1.191: $imageStatus
Cursor ACP: $cursorStatus
Metricas: $metricsStatus
Chrome DevTools: opcional, no bloquea
Tareas interrumpidas:
$pendingLine
"@

$mobileSummary = @"
OK [$ProjectName] OpenCode listo

Web local: http://127.0.0.1:$Port
Web movil: http://100.107.11.80:$Port (si Tailscale esta activo)
Agente: $env:OPENCODE_AGENT

DB2: $db2Status
Backend: $sshStatus
Backend 3335: $backendHealthStatus
Cursor ACP: $cursorStatus
Chrome DevTools: opcional, no bloquea

Tareas interrumpidas:
$pendingLine

Escribe una peticion concreta en OpenCode Web.
"@

Write-Host $consoleSummary
Send-Tg $mobileSummary

if ($NoWeb) { exit 0 }

if (Test-Tcp "127.0.0.1" $Port 500) {
  Write-Host "El puerto $Port ya esta ocupado. Si OpenCode ya esta abierto, usa http://127.0.0.1:$Port. Si no, cierra el proceso que ocupa el puerto."
  exit 0
}

$logFile = Join-Path $ProjectDir (".opencode\logs\opencode-web-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
Write-Host "Logs OpenCode Web: $logFile"
& $OpenCode web --print-logs --log-level INFO --port $Port --hostname 0.0.0.0 --cors "http://localhost:$Port" --cors "http://127.0.0.1:$Port" --cors "http://100.107.11.80:$Port" --cors "app://opencode.ai" *>> $logFile
exit $LASTEXITCODE
'@

Write-Utf8NoBom $startupPath ($content.TrimEnd() + "`n")
Write-Host "Simple startup script written to $startupPath"
