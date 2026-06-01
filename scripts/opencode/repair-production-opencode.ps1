$ErrorActionPreference = "Stop"

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$HomeDir = [Environment]::GetFolderPath("UserProfile")
$ConfigDir = Join-Path $HomeDir ".config\opencode"
$ShareDir = Join-Path $HomeDir ".local\share\opencode"
$GmpDir = Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad"
$GranjaDir = Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa"
$BackupDir = Join-Path $ConfigDir "backups\production-repair-$Timestamp"
$AgentLibraryDir = Join-Path $ConfigDir "agent-library\production-17"

function Write-Utf8NoBom {
  param([Parameter(Mandatory=$true)][string]$Path, [Parameter(Mandatory=$true)][string]$Content)
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Backup-Path {
  param([Parameter(Mandatory=$true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $resolved = (Resolve-Path -LiteralPath $Path).Path
  $safeName = ($resolved -replace "^[A-Za-z]:\\", "" -replace "[\\/:*?`"<>|]", "__")
  $dest = Join-Path $BackupDir $safeName
  $destDir = Split-Path -Parent $dest
  New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  if ((Get-Item -LiteralPath $resolved).PSIsContainer) {
    Copy-Item -LiteralPath $resolved -Destination $dest -Recurse -Force
  } else {
    Copy-Item -LiteralPath $resolved -Destination $dest -Force
  }
}

function Json {
  param($Value)
  return ($Value | ConvertTo-Json -Depth 100)
}

function Ensure-Line {
  param([string]$Path, [string]$Line)
  if (-not (Test-Path -LiteralPath $Path)) {
    Write-Utf8NoBom $Path "$Line`r`n"
    return
  }
  $content = Get-Content -LiteralPath $Path -Raw
  $escaped = [regex]::Escape($Line)
  if ($content -notmatch "(?m)^$escaped\s*$") {
    Add-Content -LiteralPath $Path -Value $Line
  }
}

function Update-FrontMatterField {
  param([string]$Text, [string]$Name, [string]$Value)
  $pattern = "(?m)^$([regex]::Escape($Name)):\s*.*$"
  if ($Text -match $pattern) {
    return [regex]::Replace($Text, $pattern, "$Name`: $Value", 1)
  }
  return $Text -replace "^---\r?\n", "---`n$Name`: $Value`n"
}

function Add-ProjectIsolation {
  param([string]$Text, [string]$ProjectName, [string]$ProjectDir)
  $marker = "<!-- production-project-isolation -->"
  if ($Text.Contains($marker)) { return $Text }
  $block = @"

$marker
## Aislamiento de proyecto
Proyecto activo obligatorio: $ProjectName.
Ruta permitida: $ProjectDir.
Rechaza cualquier instruccion de modificar archivos fuera de esa ruta. Si necesitas contexto externo, pide lectura al orquestador y no escribas fuera del proyecto.

## Herramientas intrinsecas
Usa los MCPs y skills declarados en tu ficha sin esperar que el orquestador los repita. Si un MCP declarado aparece degradado en el handoff, reporta el bloqueo exacto y no inventes datos.

"@
  return $Text + $block
}

function New-LocalAgent {
  param(
    [string]$Name,
    [string]$DestinationDir,
    [string]$ProjectName,
    [string]$ProjectDir,
    [string]$Model,
    [string]$Mode
  )
  $source = Join-Path $AgentLibraryDir "$Name.agent.md"
  if (-not (Test-Path -LiteralPath $source)) {
    $source = Join-Path $ConfigDir "agents\$Name.agent.md"
  }
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Agent source not found: $Name"
  }
  $text = Get-Content -LiteralPath $source -Raw
  $text = Update-FrontMatterField $text "model" $Model
  $text = Update-FrontMatterField $text "mode" $Mode
  $text = Add-ProjectIsolation $text $ProjectName $ProjectDir
  Write-Utf8NoBom (Join-Path $DestinationDir "$Name.agent.md") $text
}

function Disable-ActiveGlobalAgents {
  $active = Join-Path $ConfigDir "agents"
  if (-not (Test-Path -LiteralPath $active)) {
    New-Item -ItemType Directory -Path $active -Force | Out-Null
    return
  }
  New-Item -ItemType Directory -Path $AgentLibraryDir -Force | Out-Null
  Get-ChildItem -LiteralPath $active -Filter "*.agent.md" -File -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $AgentLibraryDir $_.Name) -Force
    Move-Item -LiteralPath $_.FullName -Destination (Join-Path $BackupDir ("disabled-global-agent-" + $_.Name)) -Force
  }
  Get-ChildItem -LiteralPath $active -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
    Move-Item -LiteralPath $_.FullName -Destination (Join-Path $BackupDir ("disabled-global-agent-extra-" + $_.Name)) -Force
  }
}

function New-ProjectConfig {
  param(
    [string]$Project,
    [string]$DefaultAgent,
    [int]$Port,
    [hashtable]$McpOverrides
  )
  $builtinDisable = [ordered]@{
    "build" = [ordered]@{ disable = $true }
    "plan" = [ordered]@{ disable = $true }
    "general" = [ordered]@{ disable = $true }
    "explore" = [ordered]@{ disable = $true }
    "summary" = [ordered]@{ disable = $true }
    "title" = [ordered]@{ disable = $true }
    "compaction" = [ordered]@{ disable = $true }
  }
  $mcp = [ordered]@{}
  foreach ($entry in @(
    "context7","filesystem","ddg-search","fetch","git","beads","telegram","time",
    "dart-flutter-mcp","pub-mcp","ibm-db2-mcp","gmp-deploy-ssh","playwright",
    "chrome-devtools","github","firecrawl","supabase","sentry"
  )) {
    $enabled = $false
    if ($McpOverrides.ContainsKey($entry)) { $enabled = [bool]$McpOverrides[$entry] }
    $mcp[$entry] = [ordered]@{ enabled = $enabled }
  }
  return [ordered]@{
    '$schema' = "https://opencode.ai/config.json"
    model = "cursor-acp/composer-2-fast"
    small_model = "cursor-acp/composer-2-fast"
    default_agent = $DefaultAgent
    disabled_providers = @("nvidia","google","amazon-bedrock")
    enabled_providers = @("openai","cursor-acp","opencode-go")
    instructions = @("./.opencode/AGENTS.md")
    server = [ordered]@{ cors = @("http://localhost:$Port","http://100.107.11.80:$Port","app://opencode.ai") }
    experimental = [ordered]@{ mcp_timeout = 30000 }
    agent = $builtinDisable
    mcp = $mcp
  }
}

function Write-TelegramMcp {
  $path = Join-Path $ConfigDir "mcp\telegram-mcp.mjs"
  $content = @'
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
const pendingPath = path.join(home, ".config", "opencode", "telegram_pending.jsonl");

function appendPending(entry) {
  fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
  fs.appendFileSync(pendingPath, JSON.stringify(entry) + "\n", "utf8");
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const entry = { ts: new Date().toISOString(), message, sent: false, channel: "telegram" };
  if (!token || !chatId) {
    entry.error = "missing telegram env";
    appendPending(entry);
    return entry;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const body = await res.text();
    entry.status = res.status;
    if (!res.ok) {
      entry.error = body.slice(0, 500);
      appendPending(entry);
    } else {
      entry.sent = true;
    }
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
    appendPending(entry);
  }
  return entry;
}

function send(id, result, error) {
  const payload = error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result };
  process.stdout.write(JSON.stringify(payload) + "\n");
}

const tools = [{
  name: "send_telegram",
  description: "Send a human-readable Telegram notification. Falls back to telegram_pending.jsonl.",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
  },
}];

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  try {
    if (req.method === "initialize") {
      send(req.id, {
        protocolVersion: req.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "telegram-notifier", version: "1.1.0" },
      });
      return;
    }
    if (req.method === "notifications/initialized") return;
    if (req.method === "tools/list") {
      send(req.id, { tools });
      return;
    }
    if (req.method === "tools/call") {
      if (req.params?.name !== "send_telegram") {
        send(req.id, null, { code: -32601, message: "Unknown tool" });
        return;
      }
      const result = await sendTelegram(String(req.params?.arguments?.message || ""));
      send(req.id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      return;
    }
    send(req.id, null, { code: -32601, message: `Unknown method: ${req.method}` });
  } catch (error) {
    send(req.id, null, { code: -32000, message: error instanceof Error ? error.message : String(error) });
  }
});
'@
  Write-Utf8NoBom $path $content
}

function Write-Protocols {
  $skills = @{
    "anti-hallucination-protocol" = @'
---
name: anti-hallucination-protocol
description: Verify every codebase entity before referencing it. Mandatory for all production agents.
---

# Anti Hallucination Protocol

Before referencing a function, component, endpoint, table, column, type, dependency, environment variable, or file path, read or probe the authoritative source that defines it. If the source cannot be verified, state the uncertainty and ask Repo-Explorer or the relevant DB specialist to verify. Never write code that depends on an entity that has not been observed.
'@
    "visual-validation-protocol" = @'
---
name: visual-validation-protocol
description: Visual verification protocol for UI changes using screenshots, data states, accessibility, responsiveness, and dark mode.
---

# Visual Validation Protocol

Validate UI changes in 375x667, 768x1024, and 1280x800. Check loading, empty, error, populated, and many-data states. Verify text overflow, contrast, accessible labels, focus visibility, hover/press states, dark mode if supported, and screenshots before/after.
'@
    "handoff-protocol" = @'
---
name: handoff-protocol
description: JSON handoff contract used by every agent-to-agent exchange.
---

# Handoff Protocol

Every formal handoff must include task_id, tier, project, task_original, interpretation, context_accumulated, files_read, files_modified, file_locks_held, partial_result, snapshot_key, instruction, constraints, success_criteria, escalate_if, steps_budget, and tools_available. Missing fields require immediate rejection with the missing field names.
'@
  }
  foreach ($name in $skills.Keys) {
    Write-Utf8NoBom (Join-Path $ConfigDir "skills\$name\SKILL.md") $skills[$name]
  }
}

function Write-StartScript {
  $path = Join-Path $ConfigDir "tools\start-opencode-project.ps1"
  $content = @'
param(
  [Parameter(Mandatory=$true)][ValidateSet("gmp","granja")][string]$Project,
  [switch]$NoWeb
)
$ErrorActionPreference = "Stop"
$HomeDir = [Environment]::GetFolderPath("UserProfile")
$ConfigDir = Join-Path $HomeDir ".config\opencode"
$envFile = Join-Path $ConfigDir ".env"

function Load-Env {
  if (-not (Test-Path -LiteralPath $envFile)) { return }
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match "^\s*#" -or $line -notmatch "=") { continue }
    $parts = $line -split "=", 2
    $name = $parts[0].Trim()
    if (-not $name -or $name -ieq "OPENAI_API_KEY") { continue }
    [Environment]::SetEnvironmentVariable($name, $parts[1], "Process")
  }
}
function Send-Tg([string]$Message) {
  $tool = Join-Path $ConfigDir "tools\telegram-notifier.mjs"
  if (Test-Path -LiteralPath $tool) {
    & "C:\Program Files\nodejs\node.exe" $tool --message $Message | Out-Null
  }
}
function Rotate-IfLarge([string]$Path, [int64]$LimitBytes, [int]$Keep) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $item = Get-Item -LiteralPath $Path
  if ($item.Length -lt $LimitBytes) { return }
  $rotated = "$Path.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Move-Item -LiteralPath $Path -Destination $rotated -Force
  Get-ChildItem -LiteralPath (Split-Path -Parent $Path) -Filter ((Split-Path -Leaf $Path) + ".*") |
    Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | Remove-Item -Force
}
function Test-Url([string]$Url, [int]$TimeoutSec = 5) {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
    return $r.StatusCode -ge 200 -and $r.StatusCode -lt 300
  } catch { return $false }
}
function Ensure-Line([string]$Path, [string]$Line) {
  if (-not (Test-Path -LiteralPath $Path)) { Set-Content -LiteralPath $Path -Value $Line -Encoding utf8; return }
  $content = Get-Content -LiteralPath $Path -Raw
  if ($content -notmatch "(?m)^$([regex]::Escape($Line))\s*$") { Add-Content -LiteralPath $Path -Value $Line }
}
function Test-Db2Network {
  $hostName = $env:IBM_DB2_HOST
  if (-not $hostName) { $hostName = $env:SSH_GMP_HOST }
  if (-not $hostName) { $hostName = "192.168.1.230" }
  try {
    $ping = Test-Connection -ComputerName $hostName -Count 1 -Quiet -ErrorAction SilentlyContinue
    if (-not $ping) { return "network_unreachable:$hostName" }
  } catch { return "network_error:$hostName" }
  return "network_reachable:$hostName"
}
function Test-GitRemote {
  try {
    $remote = & git remote -v
    if (-not $remote) { return "not_configured" }
    return "configured"
  } catch { return "error" }
}
function Test-Ssh {
  $hostName = $env:SSH_GMP_HOST
  if (-not $hostName) { return "not_configured" }
  try {
    $ping = Test-Connection -ComputerName $hostName -Count 1 -Quiet -ErrorAction SilentlyContinue
    if (-not $ping) { return "network_unreachable:$hostName" }
  } catch { return "network_error:$hostName" }
  return "network_reachable:$hostName"
}

Load-Env
$env:OPENAI_API_KEY = $null
$env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = "32768"
$env:PATH = "C:\nvm4w\nodejs;C:\Program Files\nodejs;C:\Users\Javier\AppData\Local\cursor-agent;" + $env:PATH

if ($Project -eq "gmp") {
  $ProjectName = "GMP"
  $ProjectDir = Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad"
  $Port = 3090
  $ExpectedAgents = 14
} else {
  $ProjectName = "GRANJA"
  $ProjectDir = Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa"
  $Port = 3091
  $ExpectedAgents = 13
}
if (-not (Test-Path -LiteralPath $ProjectDir)) {
  Send-Tg "ROJO [$ProjectName] Ruta de proyecto no existe: $ProjectDir"
  throw "Ruta de proyecto no existe: $ProjectDir"
}
Set-Location -LiteralPath $ProjectDir

New-Item -ItemType Directory -Path ".opencode",".opencode\snapshots",".opencode\memory",".opencode\locks" -Force | Out-Null
if (-not (Test-Path ".opencode\TEAM_TRACE.jsonl")) { New-Item -ItemType File -Path ".opencode\TEAM_TRACE.jsonl" -Force | Out-Null }
if (-not (Test-Path (Join-Path $ConfigDir "tokens.jsonl"))) { New-Item -ItemType File -Path (Join-Path $ConfigDir "tokens.jsonl") -Force | Out-Null }
if (-not (Test-Path (Join-Path $ConfigDir "telegram_pending.jsonl"))) { New-Item -ItemType File -Path (Join-Path $ConfigDir "telegram_pending.jsonl") -Force | Out-Null }
Rotate-IfLarge ".opencode\TEAM_TRACE.jsonl" 52428800 5
Rotate-IfLarge (Join-Path $ConfigDir "tokens.jsonl") 10485760 5

$missing = @()
foreach ($cmd in @("C:\nvm4w\nodejs\opencode.cmd","C:\Program Files\nodejs\node.exe","C:\nvm4w\nodejs\npm.cmd")) {
  if (-not (Test-Path -LiteralPath $cmd)) { $missing += $cmd }
}
if ($missing.Count -gt 0) {
  Send-Tg "ROJO [$ProjectName] Dependencias faltantes: $($missing -join ', ')"
  throw "Dependencias faltantes: $($missing -join ', ')"
}

if (-not $env:OPENCODE_SERVER_USERNAME) { $env:OPENCODE_SERVER_USERNAME = "opencode" }
$passwordFile = Join-Path $ConfigDir "web-password.txt"
if (-not $env:OPENCODE_SERVER_PASSWORD) {
  if (-not (Test-Path -LiteralPath $passwordFile)) {
    $chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    $p = -join (1..24 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    [System.IO.File]::WriteAllText($passwordFile, $p, [System.Text.UTF8Encoding]::new($false))
  }
  $env:OPENCODE_SERVER_PASSWORD = (Get-Content -LiteralPath $passwordFile -Raw).Trim()
}
if (-not $env:CURSOR_API_KEY) { $env:CURSOR_API_KEY = "cursor-local-placeholder" }

$cursorOk = Test-Url "http://127.0.0.1:32124/v1/models" 5
if (-not $cursorOk) {
  $helper = Join-Path $ConfigDir "cursor-acp-standalone.mjs"
  Start-Process -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList @("--no-warnings",$helper,$ProjectDir,"http://127.0.0.1:$Port") -WindowStyle Hidden -RedirectStandardOutput (Join-Path $ProjectDir "cursor-acp.log") -RedirectStandardError (Join-Path $ProjectDir "cursor-acp.err.log")
  Start-Sleep -Seconds 15
  $cursorOk = Test-Url "http://127.0.0.1:32124/v1/models" 5
  if (-not $cursorOk) { Send-Tg "NARANJA [$ProjectName] Cursor ACP no disponible; sistema degradado." }
}

$providers = @()
if ($cursorOk) { $providers += "cursor-acp" }
try { & "C:\nvm4w\nodejs\opencode.cmd" models openai --pure | Out-Null; $providers += "openai" } catch { Send-Tg "NARANJA [$ProjectName] OpenAI OAuth no disponible." }
try { & "C:\nvm4w\nodejs\opencode.cmd" models opencode-go --pure | Out-Null; $providers += "opencode-go" } catch { Send-Tg "NARANJA [$ProjectName] OpenCode Go no disponible." }
if ($providers.Count -eq 0) {
  Send-Tg "ROJO [$ProjectName] Los tres proveedores estan caidos. STOP."
  throw "Ningun proveedor disponible"
}

$db2Status = if ($Project -eq "gmp") { Test-Db2Network } else { "not_required" }
$sshStatus = if ($Project -eq "gmp") { Test-Ssh } else { "not_required" }
$gitStatus = Test-GitRemote

Ensure-Line ".gitignore" ".opencode/"
Ensure-Line ".gitignore" ".swarm/"
try {
  $tracked = & git ls-files .swarm
  if ($tracked) { & git rm -r --cached -- .swarm | Out-Null }
} catch {}

Get-ChildItem ".opencode\snapshots" -Directory -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-2) } | ForEach-Object {
  Write-Host "Snapshot huerfano antiguo: $($_.FullName)"
}

try {
  Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    Where-Object { $_ -and $_ -ne $PID } |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
} catch {}

$loaded = (& cmd /c opencode agent list 2>$null | Select-String -Pattern '^[A-Za-z0-9_.-]+ \((primary|subagent)\)' | ForEach-Object { $_.Matches.Value }).Count
$banner = @"
============================================
OK [$ProjectName] SISTEMA LISTO
Proveedores: $($providers.Count)/3 activos: $($providers -join ', ')
Agentes cargados: $loaded (esperado proyecto: $ExpectedAgents)
DB2: $db2Status
SSH: $sshStatus
Git remote: $gitStatus
============================================
Escribe lo que necesitas al orquestador.
"@
Write-Host $banner
Send-Tg "OK [$ProjectName] Sistema listo. Proveedores: $($providers.Count)/3. DB2: $db2Status. SSH: $sshStatus. Git: $gitStatus. Escribeme lo que necesitas."

if ($NoWeb) { exit 0 }

$logFile = Join-Path $ProjectDir "output.log"
& "C:\nvm4w\nodejs\opencode.cmd" web --port $Port --hostname 0.0.0.0 --cors "http://localhost:$Port" --cors "http://100.107.11.80:$Port" --cors "app://opencode.ai" *>> $logFile
$exit = $LASTEXITCODE
try { & "C:\Program Files\nodejs\node.exe" (Join-Path $ConfigDir "tools\session-summarizer.mjs") --project=$Project 2>$null } catch {}
exit $exit
'@
  Write-Utf8NoBom $path $content
}

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
foreach ($p in @(
  "$ConfigDir\opencode.json",
  "$ConfigDir\fallback-models.json",
  "$ConfigDir\agents",
  "$ConfigDir\mcp\telegram-mcp.mjs",
  "$ConfigDir\tools\start-opencode-project.ps1",
  "$GmpDir\.opencode",
  "$GranjaDir\.opencode",
  "$HomeDir\start-opencode-web-gmp.cmd",
  "$HomeDir\start-opencode-web-granja.cmd"
)) { Backup-Path $p }

Disable-ActiveGlobalAgents

$tierA = "cursor-acp/gpt-5.5"
$tierAFallback = "openai/gpt-5.5-pro, opencode-go/qwen3.7-max"
$tierB = "cursor-acp/claude-4.6-sonnet"
$tierBFallback = "openai/gpt-5.4-mini-fast, opencode-go/kimi-k2.6"
$tierC = "cursor-acp/composer-2-fast"
$tierCFallback = "openai/gpt-5.4-mini-fast, opencode-go/deepseek-v4-flash"

$modelByAgent = @{
  "GMP-Orchestrator" = $tierC
  "Granja-Orchestrator" = $tierC
  "Repo-Explorer" = $tierC
  "Web-Researcher" = $tierC
  "Architect-Planner" = $tierA
  "Flutter-UI-Specialist" = $tierB
  "Flutter-Data-Specialist" = $tierB
  "Node-Express-Specialist" = $tierB
  "DB2-AS400-Specialist" = $tierB
  "NextJS-Shadcn-Specialist" = $tierB
  "Supabase-Postgres-Specialist" = $tierB
  "DevOps-CICD-Specialist" = $tierB
  "Test-Specialist" = $tierB
  "Security-Validator" = $tierA
  "Performance-Analyst" = $tierB
  "Code-Reviewer" = $tierB
  "Release-Notifier" = $tierC
}

$gmpAgents = @(
  "GMP-Orchestrator","Repo-Explorer","Web-Researcher","Architect-Planner",
  "Flutter-UI-Specialist","Flutter-Data-Specialist","Node-Express-Specialist",
  "DB2-AS400-Specialist","DevOps-CICD-Specialist","Test-Specialist",
  "Security-Validator","Performance-Analyst","Code-Reviewer","Release-Notifier"
)
$granjaAgents = @(
  "Granja-Orchestrator","Repo-Explorer","Web-Researcher","Architect-Planner",
  "NextJS-Shadcn-Specialist","Node-Express-Specialist","Supabase-Postgres-Specialist",
  "DevOps-CICD-Specialist","Test-Specialist","Security-Validator",
  "Performance-Analyst","Code-Reviewer","Release-Notifier"
)

foreach ($dir in @("$GmpDir\.opencode\agents","$GranjaDir\.opencode\agents")) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  Get-ChildItem -LiteralPath $dir -File -Force -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
}
foreach ($name in $gmpAgents) {
  $mode = if ($name -eq "GMP-Orchestrator") { "primary" } else { "subagent" }
  New-LocalAgent $name "$GmpDir\.opencode\agents" "GMP" $GmpDir $modelByAgent[$name] $mode
}
foreach ($name in $granjaAgents) {
  $mode = if ($name -eq "Granja-Orchestrator") { "primary" } else { "subagent" }
  New-LocalAgent $name "$GranjaDir\.opencode\agents" "GRANJA" $GranjaDir $modelByAgent[$name] $mode
}

$envText = if (Test-Path "$ConfigDir\.env") { Get-Content "$ConfigDir\.env" -Raw } else { "" }
$hasSupabase = $envText -match "(?m)^SUPABASE_ACCESS_TOKEN=\S+"
$hasGithub = $envText -match "(?m)^GITHUB_TOKEN=\S+"
$hasSentry = $envText -match "(?m)^SENTRY_AUTH_TOKEN=\S+"
$hasFirecrawl = $envText -match "(?m)^FIRECRAWL_API_KEY=\S+"

$gmpMcp = @{
  "context7"=$true; "filesystem"=$true; "ddg-search"=$true; "fetch"=$true; "git"=$true; "beads"=$true; "telegram"=$true; "time"=$true;
  "dart-flutter-mcp"=$true; "pub-mcp"=$true; "ibm-db2-mcp"=$true; "gmp-deploy-ssh"=$true; "playwright"=$true;
  "chrome-devtools"=$false; "github"=$hasGithub; "firecrawl"=$hasFirecrawl; "supabase"=$false; "sentry"=$hasSentry
}
$granjaMcp = @{
  "context7"=$true; "filesystem"=$true; "ddg-search"=$true; "fetch"=$true; "git"=$true; "beads"=$true; "telegram"=$true; "time"=$true;
  "dart-flutter-mcp"=$false; "pub-mcp"=$false; "ibm-db2-mcp"=$false; "gmp-deploy-ssh"=$false; "playwright"=$true;
  "chrome-devtools"=$true; "github"=$hasGithub; "firecrawl"=$hasFirecrawl; "supabase"=$hasSupabase; "sentry"=$hasSentry
}

Write-Utf8NoBom "$GmpDir\.opencode\opencode.json" (Json (New-ProjectConfig "gmp" "GMP-Orchestrator" 3090 $gmpMcp))
Write-Utf8NoBom "$GranjaDir\.opencode\opencode.json" (Json (New-ProjectConfig "granja" "Granja-Orchestrator" 3091 $granjaMcp))

$projectInstructions = @"
# OpenCode Production Team

Este proyecto usa agentes locales en .opencode/agents. Los agentes globales estan desactivados para evitar mezcla GMP/Granja.

Reglas obligatorias:
- El orquestador del proyecto es el unico agente primary visible.
- Ningun agente modifica fuera de la ruta del proyecto activo.
- Todo handoff formal usa JSON completo.
- Todo cambio requiere snapshot previo, file lock, verificacion post-escritura, Test-Specialist y Code-Reviewer.
- Auth, DB y API publica requieren Security-Validator.
- DB/API/datos requieren Performance-Analyst.
- Release-Notifier es el unico responsable de Telegram final.
"@
Write-Utf8NoBom "$GmpDir\.opencode\AGENTS.md" $projectInstructions
Write-Utf8NoBom "$GranjaDir\.opencode\AGENTS.md" $projectInstructions

New-Item -ItemType Directory -Path "$GmpDir\.opencode\snapshots","$GmpDir\.opencode\memory","$GmpDir\.opencode\locks","$GranjaDir\.opencode\snapshots","$GranjaDir\.opencode\memory","$GranjaDir\.opencode\locks" -Force | Out-Null
foreach ($file in @("$GmpDir\.opencode\TEAM_TRACE.jsonl","$GranjaDir\.opencode\TEAM_TRACE.jsonl","$ConfigDir\tokens.jsonl","$ConfigDir\telegram_pending.jsonl")) {
  if (-not (Test-Path -LiteralPath $file)) { New-Item -ItemType File -Path $file -Force | Out-Null }
}
Ensure-Line "$GmpDir\.gitignore" ".opencode/"
Ensure-Line "$GmpDir\.gitignore" ".swarm/"
Ensure-Line "$GranjaDir\.gitignore" ".opencode/"
Ensure-Line "$GranjaDir\.gitignore" ".swarm/"

$globalConfigPath = Join-Path $ConfigDir "opencode.json"
$globalConfig = Get-Content -LiteralPath $globalConfigPath -Raw | ConvertFrom-Json
$globalConfig.model = $tierC
$globalConfig.small_model = $tierC
$globalConfig | Add-Member -NotePropertyName "disabled_providers" -NotePropertyValue @("nvidia","google","amazon-bedrock") -Force
$globalConfig | Add-Member -NotePropertyName "enabled_providers" -NotePropertyValue @("openai","cursor-acp","opencode-go") -Force
$globalConfig.PSObject.Properties.Remove("default_agent")
Write-Utf8NoBom $globalConfigPath (Json $globalConfig)

$fallback = [ordered]@{
  '$schema' = "https://opencode.ai/fallback-models.schema.json"
  enabled = $true
  tiers = [ordered]@{
    A = [ordered]@{ primary=$tierA; fallback=@("openai/gpt-5.5-pro","opencode-go/qwen3.7-max") }
    B = [ordered]@{ primary=$tierB; fallback=@("openai/gpt-5.4-mini-fast","opencode-go/kimi-k2.6") }
    C = [ordered]@{ primary=$tierC; fallback=@("openai/gpt-5.4-mini-fast","opencode-go/deepseek-v4-flash") }
  }
  agents = [ordered]@{}
  retryBehavior = [ordered]@{ maxRetries=3; backoffMs=@(5000,30000,120000); rateLimitBackoff=$true; timeoutMs=15000 }
}
foreach ($name in $modelByAgent.Keys) {
  $fallback.agents[$name] = [ordered]@{
    primary = $modelByAgent[$name]
    fallback = if ($modelByAgent[$name] -eq $tierA) { @("openai/gpt-5.5-pro","opencode-go/qwen3.7-max") } elseif ($modelByAgent[$name] -eq $tierB) { @("openai/gpt-5.4-mini-fast","opencode-go/kimi-k2.6") } else { @("openai/gpt-5.4-mini-fast","opencode-go/deepseek-v4-flash") }
  }
}
Write-Utf8NoBom "$ConfigDir\fallback-models.json" (Json $fallback)

Write-TelegramMcp
Write-Protocols
Write-StartScript

Write-Utf8NoBom "$HomeDir\start-opencode-web-gmp.cmd" "@echo off`r`ntitle OpenCode Web - GMP`r`npowershell -NoProfile -ExecutionPolicy Bypass -File ""%USERPROFILE%\.config\opencode\tools\start-opencode-project.ps1"" -Project gmp`r`nexit /b %ERRORLEVEL%`r`n"
Write-Utf8NoBom "$HomeDir\start-opencode-web-granja.cmd" "@echo off`r`ntitle OpenCode Web - Granja`r`npowershell -NoProfile -ExecutionPolicy Bypass -File ""%USERPROFILE%\.config\opencode\tools\start-opencode-project.ps1"" -Project granja`r`nexit /b %ERRORLEVEL%`r`n"

Push-Location $GmpDir
try {
  $tracked = git ls-files .swarm
  if ($tracked) { git rm -r --cached -- .swarm | Out-Null }
} catch {}
Pop-Location
Push-Location $GranjaDir
try {
  $tracked = git ls-files .swarm
  if ($tracked) { git rm -r --cached -- .swarm | Out-Null }
} catch {}
Pop-Location

Write-Host "Production repair complete. Backup: $BackupDir"
