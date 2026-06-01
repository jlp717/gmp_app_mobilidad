param(
  [Parameter(Mandatory=$true)][ValidateSet("gmp","granja")][string]$Project,
  [switch]$NoWeb
)

$ErrorActionPreference = "Stop"
$HomeDir = [Environment]::GetFolderPath("UserProfile")
$ConfigDir = Join-Path $HomeDir ".config\opencode"
$EnvFile = Join-Path $ConfigDir ".env"
$Node = "C:\Program Files\nodejs\node.exe"
$OpenCode = "C:\nvm4w\nodejs\opencode.cmd"

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
  Set-Content -LiteralPath $EnvFile -Value $lines -Encoding UTF8
  [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
}

function New-Secret([int]$Length = 32) {
  $chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $out = New-Object System.Text.StringBuilder
  foreach ($b in $bytes) { [void]$out.Append($chars[$b % $chars.Length]) }
  return $out.ToString()
}

function Ensure-OpenCodeWebAuth {
  if (-not $env:OPENCODE_SERVER_USERNAME) {
    Set-EnvFileValue "OPENCODE_SERVER_USERNAME" "Javier"
  }
  if (-not $env:OPENCODE_SERVER_PASSWORD) {
    Set-EnvFileValue "OPENCODE_SERVER_PASSWORD" (New-Secret 36)
  }
}

function Test-Url([string]$Url, [int]$TimeoutSec = 5) {
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

function Test-RemoteGmp([string]$Command) {
  try {
    & ssh -o BatchMode=yes -o ConnectTimeout=10 gmp@192.168.1.230 "bash -lc '$Command'" 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch { return $false }
}

function Send-Tg([string]$Message) {
  $tool = Join-Path $ConfigDir "tools\telegram-notifier.mjs"
  if (Test-Path -LiteralPath $tool) {
    try { & $Node $tool --message $Message 2>$null | Out-Null } catch {}
  }
}

function Get-MemoryCount([string]$ProjectDir) {
  $dir = Join-Path $ProjectDir ".opencode\memory"
  if (-not (Test-Path -LiteralPath $dir)) { return 0 }
  return @(Get-ChildItem -LiteralPath $dir -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @(".md",".json",".jsonl",".logfmt") }).Count
}

function Get-PendingStateCount([string]$ProjectDir) {
  $dir = Join-Path $ProjectDir ".opencode\state"
  if (-not (Test-Path -LiteralPath $dir)) { return 0 }
  $count = 0
  foreach ($file in Get-ChildItem -LiteralPath $dir -Filter *.json -File -ErrorAction SilentlyContinue) {
    try {
      $state = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
      if ($state.current_step -and $state.current_step -ne "DELIVER") { $count++ }
    } catch {}
  }
  return $count
}

function Get-ValidSkillCount([string]$ProjectDir) {
  $dir = Join-Path $ProjectDir ".opencode\skills"
  if (-not (Test-Path -LiteralPath $dir)) { return 0 }
  return @(Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "SKILL.md") }).Count
}

function Start-MetricsServer([string]$ProjectDir) {
  if (Test-Url "http://127.0.0.1:9091/health" 2) { return "listo:9091" }
  $server = Join-Path $ProjectDir ".opencode\metrics-server.js"
  if (-not (Test-Path -LiteralPath $server)) { return "no_configurado" }
  Start-Process -FilePath $Node -ArgumentList @($server) -WorkingDirectory $ProjectDir -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 2
  foreach ($port in @(9091,9092,9093)) {
    if (Test-Url "http://127.0.0.1:$port/health" 2) { return "listo:$port" }
  }
  return "degradado"
}

function Ensure-Chroma([string]$ProjectDir) {
  if (Test-Url "http://127.0.0.1:8000/api/v2/heartbeat" 2) { return "listo" }
  $chroma = Get-Command chroma -ErrorAction SilentlyContinue
  if (-not $chroma) { return "degradado_sin_chroma_cli" }
  $dataDir = Join-Path $ProjectDir ".opencode\chromadb"
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  Start-Process -FilePath $chroma.Source -ArgumentList @("run","--host","localhost","--port","8000","--path",$dataDir) -WorkingDirectory $ProjectDir -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 4
  if (Test-Url "http://127.0.0.1:8000/api/v2/heartbeat" 2) { return "listo" }
  return "degradado"
}

function Get-AgentCount {
  try {
    $raw = & $OpenCode debug config --pure
    $cfg = ($raw -join "`n") | ConvertFrom-Json
    return @($cfg.agent.PSObject.Properties | Where-Object { -not $_.Value.disable }).Count
  } catch { return 0 }
}

Load-Env
Ensure-OpenCodeWebAuth
$env:OPENAI_API_KEY = $null
$env:XDG_CONFIG_HOME = Join-Path $HomeDir ".opencode-runtime"
$env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = "32768"
$env:OPENCODE_EXPERIMENTAL_LSP_TOOL = "true"
$env:PATH = "C:\Program Files\Git\usr\bin;C:\nvm4w\nodejs;C:\Program Files\nodejs;C:\Users\Javier\AppData\Roaming\npm;C:\Users\Javier\AppData\Roaming\Python\Python311\Scripts;C:\Python311;C:\Users\Javier\AppData\Local\cursor-agent;" + $env:PATH

if ($Project -eq "gmp") {
  $ProjectName = "GMP"
  $ProjectDir = Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad"
  $Port = 3090
  $ExpectedAgents = 30
  $env:ODBC_DSN = "GMP"
  if (-not $env:ODBC_SCHEMA) { $env:ODBC_SCHEMA = "JAVIER" }
  $env:OPENCODE_AGENT = "chief-engineer-assistant"
  if (-not $env:MOBILE_TRIGGER_KEYWORD) { $env:MOBILE_TRIGGER_KEYWORD = "Equipo" }
} else {
  $ProjectName = "GRANJA"
  $ProjectDir = Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa"
  $Port = 3091
  $ExpectedAgents = 13
  $env:ODBC_DSN = "GMP"
  if (-not $env:ODBC_SCHEMA) { $env:ODBC_SCHEMA = "JAVIER" }
}

if (-not (Test-Path -LiteralPath $ProjectDir)) { throw "Ruta de proyecto no existe: $ProjectDir" }
Set-Location -LiteralPath $ProjectDir

New-Item -ItemType Directory -Path ".opencode",".opencode\memory",".opencode\state",".opencode\metrics",".opencode\sandbox",".opencode\doom-loops" -Force | Out-Null
if (-not (Test-Path ".opencode\TEAM_TRACE.jsonl")) { New-Item -ItemType File -Path ".opencode\TEAM_TRACE.jsonl" -Force | Out-Null }
if (-not (Test-Path ".opencode\tokens.jsonl")) { New-Item -ItemType File -Path ".opencode\tokens.jsonl" -Force | Out-Null }

$cursorStatus = if (Test-Url "http://127.0.0.1:32124/v1/models" 5) { "listo" } else { "degradado" }
$providerLines = @()
try { $providerLines = @(& $OpenCode models | Where-Object { $_ -match "/" }) } catch {}
$providers = @($providerLines | ForEach-Object { ($_ -split "/",2)[0] } | Sort-Object -Unique)
$db2Status = if (Test-Connection -ComputerName "192.168.1.22" -Count 1 -Quiet -ErrorAction SilentlyContinue) { "red_ok" } else { "degradado" }
$sshStatus = if (Test-Connection -ComputerName "192.168.1.230" -Count 1 -Quiet -ErrorAction SilentlyContinue) { "red_ok" } else { "degradado" }
$imageStatus = if ($Project -eq "gmp" -and (Test-Connection -ComputerName "192.168.1.191" -Count 1 -Quiet -ErrorAction SilentlyContinue)) { "red_ok" } elseif ($Project -eq "gmp") { "degradado" } else { "no_aplica" }
$chromaStatus = Ensure-Chroma $ProjectDir
$redisStatus = if (Test-Tcp "localhost" 6379 1000) { "listo" } else { "degradado" }
$metricsStatus = Start-MetricsServer $ProjectDir
$dockerStatus = try { docker info --format "{{.ServerVersion}}" 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { "listo" } else { "degradado" } } catch { "degradado" }
if ($Project -eq "gmp") {
  $chromaStatus = if (Test-RemoteGmp "/tmp/remote-check-services.sh | grep -q '^chromadb:ok'") { "remoto_listo" } else { "degradado" }
  $redisStatus = if (Test-RemoteGmp "redis-cli ping | grep -q PONG") { "remoto_listo" } else { "degradado" }
  $dockerStatus = if (Test-RemoteGmp "docker version --format '{{.Server.Version}}' >/dev/null") { "remoto_listo" } else { "degradado" }
  $voiceStatus = if (Test-RemoteGmp "curl -sf http://localhost:8765/health >/dev/null") { "remoto_listo" } else { "degradado" }
  $backendHealthStatus = if (Test-RemoteGmp "curl -sf -A GMP-SRE-HealthCheck/1.0 http://localhost:3335/api/health >/dev/null") { "remoto_listo" } else { "degradado" }
} else {
  $voiceStatus = "no_aplica"
  $backendHealthStatus = $sshStatus
}
$memoryCount = Get-MemoryCount $ProjectDir
$pendingCount = Get-PendingStateCount $ProjectDir
$skillCount = Get-ValidSkillCount $ProjectDir
$agentCount = Get-AgentCount
$webAuthStatus = if ($env:OPENCODE_SERVER_PASSWORD) { "activo" } else { "NO_CONFIGURADO" }

$summary = @"
Entrada V4: chief-engineer-assistant
Alias compatible: chief-engineer-assitant
✅ [$ProjectName] listo
Proveedores: $($providers.Count)/3 ($($providers -join ", "))
Agentes: $agentCount/$ExpectedAgents proyecto
DB2 192.168.1.22: $db2Status
Backend 192.168.1.230: $sshStatus
Backend health: $backendHealthStatus
Imagenes 192.168.1.191: $imageStatus
Cursor ACP: $cursorStatus
OpenCode Web Auth: $webAuthStatus
ChromaDB: $chromaStatus
Redis: $redisStatus
Metricas: $metricsStatus
Docker: $dockerStatus
Voz ElevenLabs: $voiceStatus
Memoria: $memoryCount entradas
Skills: $skillCount validas
Tareas interrumpidas: $pendingCount
"@

Write-Host $summary
Send-Tg $summary

if ($NoWeb) { exit 0 }

if (Test-Tcp "127.0.0.1" $Port 1000) {
  Write-Host "OpenCode Web ya esta escuchando en el puerto $Port."
  exit 0
}

$logFile = Join-Path $ProjectDir "output.log"
& $OpenCode web --port $Port --hostname 0.0.0.0 --cors "http://localhost:$Port" --cors "http://100.107.11.80:$Port" --cors "app://opencode.ai" *>> $logFile
exit $LASTEXITCODE
