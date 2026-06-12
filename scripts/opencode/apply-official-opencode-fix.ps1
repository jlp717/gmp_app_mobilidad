param(
  [switch]$NoBackup
)

$ErrorActionPreference = "Stop"
$HomeDir = [Environment]::GetFolderPath("UserProfile")
$ConfigDir = Join-Path $HomeDir ".config\opencode"
$GmpRoot = Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad"
$GranjaRoot = Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa"
$TierA = "openai/gpt-5.5"
$TierB = "openai/gpt-5.4-mini-fast"
$TierC = "opencode-go/kimi-k2.6"
$OrchestratorModel = "openai/gpt-5.4-mini-fast"

function Write-Utf8NoBomJson($Path, $Object) {
  $json = $Object | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}

function Backup-Path($Path, $BackupRoot) {
  if ($NoBackup -or -not (Test-Path -LiteralPath $Path)) { return }
  $dest = Join-Path $BackupRoot (($Path -replace '^[A-Za-z]:\\','') -replace '[\\/:*?"<>|]', '_')
  $parent = Split-Path -Parent $dest
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  if ((Get-Item -LiteralPath $Path).PSIsContainer) {
    Copy-Item -LiteralPath $Path -Destination $dest -Recurse -Force
  } else {
    Copy-Item -LiteralPath $Path -Destination $dest -Force
  }
}

function Convert-Map($Hashtable) {
  $ordered = [ordered]@{}
  foreach ($key in $Hashtable.Keys) { $ordered[$key] = $Hashtable[$key] }
  return $ordered
}

function Frontmatter($Name, $Description, $Mode, $Model, $Steps, $Permission, [bool]$Hidden) {
  $lines = @(
    "---",
    "description: $Description",
    "mode: $Mode",
    "model: $Model",
    "temperature: 0.1",
    "steps: $Steps"
  )
  # Do not emit hidden:true. Official docs say Task should still see hidden
  # subagents, but OpenCode 1.15.10 run mode exposes the built-in general
  # agent more reliably when custom subagents are hidden. Keeping mode=subagent
  # preserves Tab isolation while making Task descriptions explicit.
  $lines += "permission:"
  foreach ($key in $Permission.Keys) {
    $value = $Permission[$key]
    if ($value -is [string]) {
      $lines += "  ${key}: $value"
    } else {
      $lines += "  ${key}:"
      foreach ($subKey in $value.Keys) {
        $lines += "    `"${subKey}`": $($value[$subKey])"
      }
    }
  }
  $lines += "---"
  return ($lines -join "`r`n")
}

function Replace-Frontmatter($Path, $Frontmatter, $Model) {
  $text = Get-Content -LiteralPath $Path -Raw
  if ($text -notmatch '(?s)^---\r?\n.*?\r?\n---\r?\n') {
    throw "No YAML frontmatter found: $Path"
  }
  $body = $text -replace '(?s)^---\r?\n.*?\r?\n---\r?\n', ''
  $body = $body -replace 'MODELO PRINCIPAL: [^\r\n]+', "MODELO PRINCIPAL: $Model"
  $body = $body -replace 'MODELO FALLBACK: [^\r\n]+', 'MODELO FALLBACK: ver fallback-models.json; activar ante timeout, 429/5xx, auth/quota o caida del proveedor.'
  if ($body -notmatch '## OpenCode official-docs runtime contract') {
    $body += @"

## OpenCode official-docs runtime contract
- Este agente usa `steps`, no `maxSteps`.
- El campo `description` del frontmatter es la fuente principal para invocacion automatica.
- Si es subagent, `hidden: true` solo lo oculta del autocomplete; el orquestador puede invocarlo con Task si `permission.task` lo permite.
- El orden de permisos importa: el patron catch-all va primero y las reglas especificas despues, porque gana la ultima coincidencia.
- Los subagentes tienen `task: deny` para impedir recursion. Solo los orquestadores pueden delegar.
- Las entidades de codigo, tablas, endpoints, componentes y tipos se verifican antes de referenciarse.
"@
  }
  if ((Split-Path -Leaf $Path) -match 'Orchestrator\.md$' -and $body -notmatch '## Task invocation contract') {
    $body = $body -replace '(?s)## Task invocation contract.*?## System prompt completo', '## System prompt completo'
    $body = $body -replace '(?m)^## System prompt completo', @'
## Task invocation contract
Cuando uses la herramienta Task, SIEMPRE especifica el agente exacto por nombre.
NUNCA invoques Task sin agente, NUNCA uses deliberadamente el agente general/default, y NUNCA uses un nombre distinto de los listados en `permission.task`.
Si necesitas exploracion: agente exacto `Repo-Explorer`.
Si necesitas documentacion externa: agente exacto `Web-Researcher`.
Si necesitas arquitectura Tier 3: agente exacto `Architect-Planner`.
Si necesitas notificar a Javier: agente exacto `Release-Notifier`.
Si un intento accidental va al agente general/default y falla por permisos, reintenta inmediatamente con el agente exacto permitido. No abandones la delegacion si el agente exacto existe en `permission.task`.

## System prompt completo
'@
  }
  [System.IO.File]::WriteAllText($Path, $Frontmatter + "`r`n" + $body.TrimStart(), [System.Text.UTF8Encoding]::new($false))
}

function AgentPermission($Kind, $TaskAgents) {
  $base = [ordered]@{
    read = "allow"
    list = "allow"
    glob = "allow"
    grep = "allow"
    edit = "deny"
    bash = [ordered]@{ "*" = "deny" }
    task = "deny"
    external_directory = "deny"
    webfetch = "deny"
    websearch = "deny"
    lsp = "allow"
    skill = "allow"
    doom_loop = "allow"
    question = "deny"
  }
  switch ($Kind) {
    "orchestrator" {
      $task = [ordered]@{ "*" = "deny" }
      foreach ($agent in $TaskAgents) { $task[$agent] = "allow" }
      $base.edit = "deny"
      $base.bash = [ordered]@{
        "*" = "deny"
        "git status*" = "allow"
        "git diff*" = "allow"
        "git log*" = "allow"
        "opencode models*" = "allow"
      }
      $base.task = $task
      $base.webfetch = "allow"
      $base.websearch = "allow"
      $base.question = "allow"
    }
    "explorer" {
      $base.bash = [ordered]@{
        "*" = "deny"
        "rg *" = "allow"
        "git status*" = "allow"
        "git diff*" = "allow"
        "git log*" = "allow"
      }
    }
    "researcher" {
      $base.webfetch = "allow"
      $base.websearch = "allow"
      $base.read = "deny"
      $base.list = "deny"
      $base.glob = "deny"
      $base.grep = "deny"
      $base.lsp = "deny"
    }
    "implementer" {
      $base.edit = "allow"
      $base.bash = [ordered]@{
        "*" = "deny"
        "flutter analyze*" = "allow"
        "flutter test*" = "allow"
        "dart format*" = "allow"
        "npm test*" = "allow"
        "npm run lint*" = "allow"
        "npm run type-check*" = "allow"
        "node --check *" = "allow"
      }
    }
    "db" {
      $base.grep = "allow"
      $base.lsp = "deny"
    }
    "devops" {
      $base.edit = "ask"
      $base.bash = [ordered]@{
        "*" = "ask"
        "git status*" = "allow"
        "git diff*" = "allow"
        "git log*" = "allow"
        "git fetch*" = "allow"
        "git branch*" = "allow"
        "git checkout -b *" = "allow"
      }
    }
    "validator" {
      $base.bash = [ordered]@{
        "*" = "deny"
        "flutter analyze*" = "allow"
        "flutter test*" = "allow"
        "npm test*" = "allow"
        "npm run lint*" = "allow"
        "npm run type-check*" = "allow"
        "npm audit*" = "allow"
        "rg *" = "allow"
        "npx playwright*" = "allow"
      }
    }
    "notifier" {
      $base.edit = [ordered]@{
        "*" = "deny"
        ".opencode/telegram_pending.jsonl" = "allow"
        ".opencode/TEAM_TRACE.jsonl" = "allow"
      }
      $base.read = "deny"
      $base.list = "deny"
      $base.glob = "deny"
      $base.grep = "deny"
      $base.lsp = "deny"
    }
  }
  return $base
}

function Patch-AgentSet($ProjectRoot, $Agents) {
  foreach ($agent in $Agents) {
    $agentDir = Join-Path $ProjectRoot ".opencode\agents"
    $path = Join-Path $agentDir $agent.File
    if ($agent.File -like "*.agent.md") {
      $canonical = Join-Path $agentDir ($agent.File -replace '\.agent\.md$', '.md')
      if (Test-Path -LiteralPath $path) {
        Move-Item -LiteralPath $path -Destination $canonical -Force
      }
      $path = $canonical
    }
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing agent file: $path" }
    $fm = Frontmatter $agent.Name $agent.Description $agent.Mode $agent.Model $agent.Steps $agent.Permission $agent.Hidden
    Replace-Frontmatter $path $fm $agent.Model
  }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $ConfigDir "backups\official-docs-fix-$stamp"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
foreach ($p in @(
  (Join-Path $ConfigDir "opencode.json"),
  (Join-Path $ConfigDir "fallback-models.json"),
  (Join-Path $ConfigDir "tools\start-opencode-project.ps1"),
  "C:\Users\Javier\start-opencode-web-gmp.cmd",
  "C:\Users\Javier\start-opencode-web-granja.cmd",
  (Join-Path $GmpRoot ".opencode"),
  (Join-Path $GranjaRoot ".opencode")
)) { Backup-Path $p $backupRoot }

$gmpTasks = @(
  "Repo-Explorer","Web-Researcher","Architect-Planner","Flutter-UI-Specialist",
  "Flutter-Data-Specialist","Node-Express-Specialist","DB2-AS400-Specialist",
  "DevOps-CICD-Specialist","Test-Specialist","Security-Validator",
  "Performance-Analyst","Code-Reviewer","Release-Notifier"
)
$granjaTasks = @(
  "Repo-Explorer","Web-Researcher","Architect-Planner","NextJS-Shadcn-Specialist",
  "Node-Express-Specialist","Supabase-Postgres-Specialist","DevOps-CICD-Specialist",
  "Test-Specialist","Security-Validator","Performance-Analyst","Code-Reviewer",
  "Release-Notifier"
)

$gmpAgents = @(
  @{File="GMP-Orchestrator.agent.md";Name="GMP-Orchestrator";Description="Orquestador principal del proyecto GMP. Recibe peticiones de Javier, clasifica por tier y DEBE delegar mediante Task a los subagentes GMP especializados.";Mode="primary";Model=$OrchestratorModel;Steps=50;Hidden=$false;Permission=(AgentPermission "orchestrator" $gmpTasks)}
  @{File="Repo-Explorer.agent.md";Name="Repo-Explorer";Description="Explorador de codebase solo lectura. Usar para localizar archivos, dependencias, imports, simbolos y radio de impacto antes de implementar.";Mode="subagent";Model=$TierC;Steps=20;Hidden=$true;Permission=(AgentPermission "explorer" @())}
  @{File="Web-Researcher.agent.md";Name="Web-Researcher";Description="Investigador externo de documentacion oficial, issues y patrones actualizados. Usar cuando falta contexto de librerias o APIs externas.";Mode="subagent";Model=$TierC;Steps=15;Hidden=$true;Permission=(AgentPermission "researcher" @())}
  @{File="Architect-Planner.agent.md";Name="Architect-Planner";Description="Arquitecto para tareas Tier 3. Produce plan JSON completo antes de que los especialistas escriban codigo.";Mode="subagent";Model=$TierA;Steps=40;Hidden=$true;Permission=(AgentPermission "explorer" @())}
  @{File="Flutter-UI-Specialist.agent.md";Name="Flutter-UI-Specialist";Description="Especialista Flutter UI de GMP. Implementa widgets, pantallas, navegacion, estados visuales y Material/Riverpod UI.";Mode="subagent";Model=$TierB;Steps=60;Hidden=$true;Permission=(AgentPermission "implementer" @())}
  @{File="Flutter-Data-Specialist.agent.md";Name="Flutter-Data-Specialist";Description="Especialista Flutter data de GMP. Implementa repositorios, modelos, Riverpod providers, Dio, serializacion y errores de red.";Mode="subagent";Model=$TierB;Steps=60;Hidden=$true;Permission=(AgentPermission "implementer" @())}
  @{File="Node-Express-Specialist.agent.md";Name="Node-Express-Specialist";Description="Especialista Node.js/Express. Implementa endpoints, middleware, validacion, auth, logging y health checks.";Mode="subagent";Model=$TierB;Steps=60;Hidden=$true;Permission=(AgentPermission "implementer" @())}
  @{File="DB2-AS400-Specialist.agent.md";Name="DB2-AS400-Specialist";Description="Especialista IBM DB2 for i / AS400. Verifica tablas y columnas reales antes de escribir queries o responder sobre datos ERP.";Mode="subagent";Model=$TierB;Steps=40;Hidden=$true;Permission=(AgentPermission "db" @())}
  @{File="DevOps-CICD-Specialist.agent.md";Name="DevOps-CICD-Specialist";Description="Especialista DevOps/CI/CD. Gestiona logs, ramas, health checks, scripts de arranque y deploys con aprobacion.";Mode="subagent";Model=$TierB;Steps=50;Hidden=$true;Permission=(AgentPermission "devops" @())}
  @{File="Test-Specialist.agent.md";Name="Test-Specialist";Description="Especialista de testing. Ejecuta y escribe tests, valida cambios visuales con Playwright y comprueba regresiones.";Mode="subagent";Model=$TierB;Steps=50;Hidden=$true;Permission=(AgentPermission "validator" @())}
  @{File="Security-Validator.agent.md";Name="Security-Validator";Description="Validador de seguridad solo lectura. Revisa auth, DB, API publica, secretos y CVEs antes de entregar.";Mode="subagent";Model=$TierA;Steps=30;Hidden=$true;Permission=(AgentPermission "validator" @())}
  @{File="Performance-Analyst.agent.md";Name="Performance-Analyst";Description="Analista de rendimiento solo lectura. Mide queries, API, bundle, Flutter frames y umbrales de performance.";Mode="subagent";Model=$TierB;Steps=30;Hidden=$true;Permission=(AgentPermission "validator" @())}
  @{File="Code-Reviewer.agent.md";Name="Code-Reviewer";Description="Revisor final solo lectura. Evalua calidad, patrones, naming, deuda tecnica y documentacion antes de entregar.";Mode="subagent";Model=$TierB;Steps=25;Hidden=$true;Permission=(AgentPermission "validator" @())}
  @{File="Release-Notifier.agent.md";Name="Release-Notifier";Description="Notificador de entregas. Envia a Telegram inicio, checkpoints, aprobaciones, errores y resumen final en lenguaje humano.";Mode="subagent";Model=$TierC;Steps=10;Hidden=$true;Permission=(AgentPermission "notifier" @())}
)

$granjaAgents = @(
  @{File="Granja-Orchestrator.agent.md";Name="Granja-Orchestrator";Description="Orquestador principal del proyecto Granja Mari Pepa. Recibe peticiones de Javier, clasifica por tier y DEBE delegar mediante Task a subagentes web/Supabase.";Mode="primary";Model=$OrchestratorModel;Steps=50;Hidden=$false;Permission=(AgentPermission "orchestrator" $granjaTasks)}
  @{File="Repo-Explorer.agent.md";Name="Repo-Explorer";Description="Explorador de codebase solo lectura. Usar para localizar archivos, dependencias, imports, simbolos y radio de impacto antes de implementar.";Mode="subagent";Model=$TierC;Steps=20;Hidden=$true;Permission=(AgentPermission "explorer" @())}
  @{File="Web-Researcher.agent.md";Name="Web-Researcher";Description="Investigador externo de documentacion oficial, issues y patrones actualizados. Usar cuando falta contexto de librerias o APIs externas.";Mode="subagent";Model=$TierC;Steps=15;Hidden=$true;Permission=(AgentPermission "researcher" @())}
  @{File="Architect-Planner.agent.md";Name="Architect-Planner";Description="Arquitecto para tareas Tier 3. Produce plan JSON completo antes de que los especialistas escriban codigo.";Mode="subagent";Model=$TierA;Steps=40;Hidden=$true;Permission=(AgentPermission "explorer" @())}
  @{File="NextJS-Shadcn-Specialist.agent.md";Name="NextJS-Shadcn-Specialist";Description="Especialista Next.js App Router, TypeScript, Tailwind y shadcn/ui para el frontend Granja.";Mode="subagent";Model=$TierB;Steps=60;Hidden=$true;Permission=(AgentPermission "implementer" @())}
  @{File="Node-Express-Specialist.agent.md";Name="Node-Express-Specialist";Description="Especialista Node.js/Express. Implementa endpoints, middleware, validacion, auth, logging y health checks.";Mode="subagent";Model=$TierB;Steps=60;Hidden=$true;Permission=(AgentPermission "implementer" @())}
  @{File="Supabase-Postgres-Specialist.agent.md";Name="Supabase-Postgres-Specialist";Description="Especialista Supabase/PostgreSQL. Verifica schema, RLS, migraciones y queries antes de tocar datos.";Mode="subagent";Model=$TierB;Steps=40;Hidden=$true;Permission=(AgentPermission "implementer" @())}
  @{File="DevOps-CICD-Specialist.agent.md";Name="DevOps-CICD-Specialist";Description="Especialista DevOps/CI/CD. Gestiona logs, ramas, health checks, scripts de arranque y deploys con aprobacion.";Mode="subagent";Model=$TierB;Steps=50;Hidden=$true;Permission=(AgentPermission "devops" @())}
  @{File="Test-Specialist.agent.md";Name="Test-Specialist";Description="Especialista de testing. Ejecuta y escribe tests, valida cambios visuales con Playwright y comprueba regresiones.";Mode="subagent";Model=$TierB;Steps=50;Hidden=$true;Permission=(AgentPermission "validator" @())}
  @{File="Security-Validator.agent.md";Name="Security-Validator";Description="Validador de seguridad solo lectura. Revisa auth, DB, API publica, secretos y CVEs antes de entregar.";Mode="subagent";Model=$TierA;Steps=30;Hidden=$true;Permission=(AgentPermission "validator" @())}
  @{File="Performance-Analyst.agent.md";Name="Performance-Analyst";Description="Analista de rendimiento solo lectura. Mide queries, API, bundle, Core Web Vitals y umbrales de performance.";Mode="subagent";Model=$TierB;Steps=30;Hidden=$true;Permission=(AgentPermission "validator" @())}
  @{File="Code-Reviewer.agent.md";Name="Code-Reviewer";Description="Revisor final solo lectura. Evalua calidad, patrones, naming, deuda tecnica y documentacion antes de entregar.";Mode="subagent";Model=$TierB;Steps=25;Hidden=$true;Permission=(AgentPermission "validator" @())}
  @{File="Release-Notifier.agent.md";Name="Release-Notifier";Description="Notificador de entregas. Envia a Telegram inicio, checkpoints, aprobaciones, errores y resumen final en lenguaje humano.";Mode="subagent";Model=$TierC;Steps=10;Hidden=$true;Permission=(AgentPermission "notifier" @())}
)

Patch-AgentSet $GmpRoot $gmpAgents
Patch-AgentSet $GranjaRoot $granjaAgents

$globalConfigPath = Join-Path $ConfigDir "opencode.json"
$global = Get-Content -LiteralPath $globalConfigPath -Raw | ConvertFrom-Json
$global | Add-Member -Force -NotePropertyName "model" -NotePropertyValue $TierC
$global | Add-Member -Force -NotePropertyName "small_model" -NotePropertyValue $TierC
$global | Add-Member -Force -NotePropertyName "enabled_providers" -NotePropertyValue @("openai", "opencode-go", "cursor-acp")
$global | Add-Member -Force -NotePropertyName "disabled_providers" -NotePropertyValue @("nvidia", "google", "amazon-bedrock")
$global | Add-Member -Force -NotePropertyName "lsp" -NotePropertyValue $true
if (-not $global.PSObject.Properties["experimental"]) {
  $global | Add-Member -NotePropertyName "experimental" -NotePropertyValue ([pscustomobject]@{})
}
$global.experimental | Add-Member -Force -NotePropertyName "mcp_timeout" -NotePropertyValue 30000
if (-not $global.mcp.PSObject.Properties["gh_grep"]) {
  $global.mcp | Add-Member -NotePropertyName "gh_grep" -NotePropertyValue ([pscustomobject]@{type="remote";url="https://mcp.grep.app";enabled=$true;timeout=10000})
}
if (-not $global.mcp.PSObject.Properties["postgres"]) {
  $pgEnabled = [bool]$env:SUPABASE_DB_URL
  $global.mcp | Add-Member -NotePropertyName "postgres" -NotePropertyValue ([pscustomobject]@{type="local";command=@("npx","-y","@modelcontextprotocol/server-postgres","{env:SUPABASE_DB_URL}");enabled=$pgEnabled;timeout=10000})
}
if ($global.mcp.PSObject.Properties["sentry"]) {
  $global.mcp.sentry = [pscustomobject]@{type="remote";url="https://mcp.sentry.dev/mcp";oauth=[pscustomobject]@{};enabled=$false;timeout=10000}
}
Write-Utf8NoBomJson $globalConfigPath $global

foreach ($pair in @(@($GmpRoot, "GMP-Orchestrator", 14, $true), @($GranjaRoot, "Granja-Orchestrator", 13, $false))) {
  $root = $pair[0]
  $defaultAgent = $pair[1]
  $configPath = Join-Path $root ".opencode\opencode.json"
  $cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  $cfg.model = $TierC
  $cfg.small_model = $TierC
  $cfg.default_agent = $defaultAgent
  $cfg | Add-Member -Force -NotePropertyName "lsp" -NotePropertyValue $true
  if (-not $cfg.PSObject.Properties["permission"]) {
    $cfg | Add-Member -NotePropertyName "permission" -NotePropertyValue ([pscustomobject]@{})
  }
  if ($cfg.permission.PSObject.Properties["task"]) { $cfg.permission.PSObject.Properties.Remove("task") }
  $cfg.permission | Add-Member -Force -NotePropertyName "skill" -NotePropertyValue ([pscustomobject]@{"*"="allow"})
  $cfg.permission | Add-Member -Force -NotePropertyName "lsp" -NotePropertyValue "allow"
  $cfg.mcp | Add-Member -Force -NotePropertyName "gh_grep" -NotePropertyValue ([pscustomobject]@{enabled=$true})
  $cfg.mcp | Add-Member -Force -NotePropertyName "postgres" -NotePropertyValue ([pscustomobject]@{enabled=([bool]$env:SUPABASE_DB_URL -and -not [bool]$pair[3])})
  Write-Utf8NoBomJson $configPath $cfg
}

$launcher = @'
@echo off
title OpenCode Web - GMP
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.config\opencode\tools\start-opencode-project.ps1" -Project gmp
exit /b %ERRORLEVEL%
'@
$launcherText = $launcher -replace "`n","`r`n"
[System.IO.File]::WriteAllText("C:\Users\Javier\start-opencode-web-gmp.cmd", $launcherText, [System.Text.UTF8Encoding]::new($false))
$launcher = @'
@echo off
title OpenCode Web - Granja
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.config\opencode\tools\start-opencode-project.ps1" -Project granja
exit /b %ERRORLEVEL%
'@
$launcherText = $launcher -replace "`n","`r`n"
[System.IO.File]::WriteAllText("C:\Users\Javier\start-opencode-web-granja.cmd", $launcherText, [System.Text.UTF8Encoding]::new($false))

$startup = Join-Path $ConfigDir "tools\start-opencode-project.ps1"
$text = Get-Content -LiteralPath $startup -Raw
if ($text -notmatch 'OPENCODE_EXPERIMENTAL_LSP_TOOL') {
  $replacement = '$env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = "32768"' + "`r`n" + '$env:OPENCODE_EXPERIMENTAL_LSP_TOOL = "true"'
  $text = $text -replace '\$env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = "32768"', $replacement
}
$text = $text -replace 'function Test-Db2Network \{(?s).*?\r?\n\}', @'
function Resolve-Server {
  $local = if ($env:GMP_SERVER_LOCAL_IP) { $env:GMP_SERVER_LOCAL_IP } else { "192.168.1.230" }
  $tailscale = $env:GMP_SERVER_TAILSCALE_IP
  foreach ($candidate in @($local, $tailscale)) {
    if (-not $candidate) { continue }
    try {
      if (Test-Connection -ComputerName $candidate -Count 1 -Quiet -ErrorAction SilentlyContinue) {
        $env:IBM_DB2_HOST = $candidate
        $env:SSH_GMP_HOST = $candidate
        $env:SSH_HOST = $candidate
        return [pscustomobject]@{Reachable=$true; Ip=$candidate; Source=($(if ($candidate -eq $local) {"local"} else {"tailscale"}))}
      }
    } catch {}
  }
  $env:IBM_DB2_HOST = "unavailable"
  $env:SSH_GMP_HOST = "unavailable"
  $env:SSH_HOST = "unavailable"
  return [pscustomobject]@{Reachable=$false; Ip=$local; Source="offline"}
}
function Test-Db2Network {
  $server = Resolve-Server
  if (-not $server.Reachable) { return "offline:$($server.Ip)" }
  return "network_reachable:$($server.Ip):$($server.Source)"
}
'@
$text = $text -replace 'function Test-Ssh \{(?s).*?\r?\n\}', @'
function Test-Ssh {
  $hostName = $env:SSH_GMP_HOST
  if (-not $hostName -or $hostName -eq "unavailable") { return "offline" }
  try {
    $ping = Test-Connection -ComputerName $hostName -Count 1 -Quiet -ErrorAction SilentlyContinue
    if (-not $ping) { return "network_unreachable:$hostName" }
  } catch { return "network_error:$hostName" }
  return "network_reachable:$hostName"
}
'@
$firstResolve = $text.IndexOf("function Resolve-Server {")
if ($firstResolve -ge 0) {
  $secondResolve = $text.IndexOf("function Resolve-Server {", $firstResolve + 1)
  if ($secondResolve -gt $firstResolve) {
    $testDb2Start = $text.IndexOf("function Test-Db2Network", $secondResolve)
    if ($testDb2Start -gt $secondResolve) {
      $text = $text.Remove($secondResolve, $testDb2Start - $secondResolve)
    } else {
      $text = $text.Remove($firstResolve, $secondResolve - $firstResolve)
    }
  }
}
[System.IO.File]::WriteAllText($startup, $text, [System.Text.UTF8Encoding]::new($false))

Write-Host "Official OpenCode docs fix applied. Backup: $backupRoot"
