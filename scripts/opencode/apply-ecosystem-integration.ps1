param(
  [switch]$SkipGlobal
)

$ErrorActionPreference = "Stop"

$HomeDir = [Environment]::GetFolderPath("UserProfile")
$ConfigDir = Join-Path $HomeDir ".config\opencode"
$GmpDir = Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad"
$GranjaDir = Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $ConfigDir "backups\ecosystem-$Stamp"

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
}

function Backup-File([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $dest = Join-Path $BackupDir ($Path -replace '^[A-Za-z]:\\','' -replace '[\\/:*?"<>|]', '_')
  $destDir = Split-Path -Parent $dest
  if (-not (Test-Path -LiteralPath $destDir)) {
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  }
  Copy-Item -LiteralPath $Path -Destination $dest -Force
}

function Read-Json([string]$Path) {
  return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json)
}

function Write-Json([string]$Path, $Object) {
  $json = $Object | ConvertTo-Json -Depth 100
  Write-Utf8NoBom $Path ($json + "`r`n")
}

function Set-Prop($Object, [string]$Name, $Value) {
  if ($Object.PSObject.Properties[$Name]) {
    $Object.$Name = $Value
  } else {
    Add-Member -InputObject $Object -MemberType NoteProperty -Name $Name -Value $Value
  }
}

function Remove-Prop($Object, [string]$Name) {
  if ($Object.PSObject.Properties[$Name]) {
    $Object.PSObject.Properties.Remove($Name)
  }
}

function Add-UniqueString($ArrayValue, [string]$Item) {
  $items = @()
  if ($null -ne $ArrayValue) { $items = @($ArrayValue) }
  if ($items -notcontains $Item) { $items += $Item }
  return $items
}

function Set-McpEntry($Config, [string]$Name, $Value) {
  if (-not $Config.PSObject.Properties["mcp"] -or $null -eq $Config.mcp) {
    Set-Prop $Config "mcp" ([pscustomobject]@{})
  }
  if ($Config.mcp.PSObject.Properties[$Name]) {
    $Config.mcp.$Name = $Value
  } else {
    Add-Member -InputObject $Config.mcp -MemberType NoteProperty -Name $Name -Value $Value
  }
}

function Set-ProjectMcpFlag($Config, [string]$Name, [bool]$Enabled) {
  if (-not $Config.PSObject.Properties["mcp"] -or $null -eq $Config.mcp) {
    Set-Prop $Config "mcp" ([pscustomobject]@{})
  }
  if (-not $Config.mcp.PSObject.Properties[$Name] -or $null -eq $Config.mcp.$Name) {
    Add-Member -InputObject $Config.mcp -MemberType NoteProperty -Name $Name -Value ([pscustomobject]@{ enabled = $Enabled })
  } elseif ($Config.mcp.$Name.PSObject.Properties["enabled"]) {
    $Config.mcp.$Name.enabled = $Enabled
  } else {
    Add-Member -InputObject $Config.mcp.$Name -MemberType NoteProperty -Name enabled -Value $Enabled
  }
}

function Get-ModelForAgent([string]$Name) {
  switch -Regex ($Name) {
    '^(GMP-Orchestrator|Granja-Orchestrator)$' { return "opencode-go/glm-5.1" }
    '^Repo-Explorer$' { return "opencode-go/glm-5.1" }
    '^(Web-Researcher|Release-Notifier)$' { return "opencode-go/kimi-k2.6" }
    '^(Architect-Planner|Security-Validator)$' { return "cursor-acp/claude-opus-4-7" }
    default { return "cursor-acp/composer-2.5" }
  }
}

function Get-FallbackForModel([string]$Model) {
  if ($Model -eq "cursor-acp/claude-opus-4-7") {
    return "cursor-acp/gpt-5.5 -> cursor-acp/composer-2.5 -> openai/gpt-5.5-pro -> opencode-go/kimi-k2.6"
  }
  if ($Model -eq "cursor-acp/composer-2.5") {
    return "cursor-acp/claude-4.6-sonnet -> cursor-acp/gpt-5.5 -> opencode-go/kimi-k2.6"
  }
  if ($Model -eq "opencode-go/glm-5.1") {
    return "opencode-go/kimi-k2.6 for non-Task coordination -> opencode-go/deepseek-v4-pro -> cursor-acp/composer-2.5"
  }
  return "opencode-go/glm-5.1 -> opencode-go/deepseek-v4-pro -> openai/gpt-5.4-mini-fast"
}

function Get-PeerList([string]$Name) {
  $map = @{
    "Flutter-UI-Specialist" = @("Flutter-Data-Specialist","Test-Specialist")
    "Flutter-Data-Specialist" = @("Flutter-UI-Specialist","Node-Express-Specialist","DB2-AS400-Specialist")
    "Node-Express-Specialist" = @("DB2-AS400-Specialist","DevOps-CICD-Specialist","Security-Validator","Performance-Analyst")
    "DB2-AS400-Specialist" = @("Node-Express-Specialist","Performance-Analyst","Security-Validator")
    "NextJS-Shadcn-Specialist" = @("Supabase-Postgres-Specialist","Test-Specialist","Performance-Analyst")
    "Supabase-Postgres-Specialist" = @("NextJS-Shadcn-Specialist","Security-Validator","Performance-Analyst")
    "DevOps-CICD-Specialist" = @("Node-Express-Specialist","Performance-Analyst","Code-Reviewer")
    "Test-Specialist" = @("Performance-Analyst","Code-Reviewer")
    "Security-Validator" = @("Node-Express-Specialist","DB2-AS400-Specialist","Supabase-Postgres-Specialist")
    "Performance-Analyst" = @("DB2-AS400-Specialist","Node-Express-Specialist","Test-Specialist")
    "Code-Reviewer" = @("Test-Specialist","Security-Validator","Performance-Analyst")
  }
  if ($map.ContainsKey($Name)) { return $map[$Name] }
  return @()
}

function Set-TaskPermissionBlock([string]$Frontmatter, [string[]]$Peers) {
  $block = "  task: deny"
  if ($Peers.Count -gt 0) {
    $lines = @("  task:", '    "*": deny')
    foreach ($peer in $Peers) { $lines += "    ""$peer"": allow" }
    $block = $lines -join "`r`n"
  }
  return [regex]::Replace($Frontmatter, '(?ms)^  task:.*?(?=^  [A-Za-z_][A-Za-z0-9_-]*:|\z)', ($block + "`r`n"))
}

function Ensure-BashAllows([string]$Frontmatter, [string[]]$Commands) {
  $match = [regex]::Match($Frontmatter, '(?ms)^  bash:\r?\n(?<body>.*?)(?=^  [A-Za-z_][A-Za-z0-9_-]*:|\z)')
  if (-not $match.Success) { return $Frontmatter }
  $section = $match.Value
  $body = $match.Groups["body"].Value
  foreach ($cmd in $Commands) {
    $line = "    ""$cmd"": allow"
    if ($section -notmatch [regex]::Escape($line)) {
      $body = $body.TrimEnd() + "`r`n$line`r`n"
    }
  }
  $newSection = "  bash:`r`n$body"
  return $Frontmatter.Substring(0, $match.Index) + $newSection + $Frontmatter.Substring($match.Index + $section.Length)
}

function Ensure-ExternalDirectoryDeny([string]$Frontmatter) {
  if ($Frontmatter -match '(?m)^  external_directory:') { return $Frontmatter }
  if ($Frontmatter -match '(?m)^  webfetch:') {
    return [regex]::Replace($Frontmatter, '(?m)^  webfetch:', "  external_directory: deny`r`n  webfetch:", 1)
  }
  return $Frontmatter.TrimEnd() + "`r`n  external_directory: deny"
}

function Get-ToolPolicy([string]$Name) {
  $all = @(
    "skill",
    "context7_*",
    "filesystem_*",
    "ddg-search_*",
    "fetch_*",
    "git_*",
    "beads_*",
    "telegram_*",
    "time_*",
    "dart-flutter-mcp_*",
    "pub-mcp_*",
    "ibm-db2-mcp_*",
    "gmp-deploy-ssh_*",
    "playwright_*",
    "gh_grep_*",
    "supabase_*",
    "postgres_*",
    "sentry_*",
    "claude-flow_*",
    "guardvibe_*"
  )
  $allow = @()
  switch -Regex ($Name) {
    '^Web-Researcher$' { $allow = @("context7_*","gh_grep_*","ddg-search_*","fetch_*") }
    '^Flutter-' { $allow = @("dart-flutter-mcp_*","pub-mcp_*") }
    '^Node-Express-Specialist$' { $allow = @("gmp-deploy-ssh_*","sentry_*","guardvibe_*") }
    '^DB2-AS400-Specialist$' { $allow = @("ibm-db2-mcp_*","gmp-deploy-ssh_*") }
    '^NextJS-Shadcn-Specialist$' { $allow = @("playwright_*","context7_*") }
    '^Supabase-Postgres-Specialist$' { $allow = @("supabase_*","postgres_*") }
    '^DevOps-CICD-Specialist$' { $allow = @("git_*","gmp-deploy-ssh_*","sentry_*","claude-flow_*") }
    '^Test-Specialist$' { $allow = @("playwright_*","dart-flutter-mcp_*") }
    '^Security-Validator$' { $allow = @("sentry_*","guardvibe_*","gh_grep_*") }
    '^Performance-Analyst$' { $allow = @("gmp-deploy-ssh_*","playwright_*","ibm-db2-mcp_*","postgres_*","supabase_*") }
    '^Code-Reviewer$' { $allow = @("git_*","guardvibe_*") }
    '^Release-Notifier$' { $allow = @("telegram_*","time_*") }
  }
  $policy = [ordered]@{}
  foreach ($tool in $all) { $policy[$tool] = $false }
  foreach ($tool in $allow) { $policy[$tool] = $true }
  return $policy
}

function Convert-ToolPolicyToYaml($Policy) {
  $lines = @("tools:")
  foreach ($entry in $Policy.GetEnumerator()) {
    $value = if ($entry.Value) { "true" } else { "false" }
    $lines += "  ""$($entry.Key)"": $value"
  }
  return ($lines -join "`r`n")
}

function Convert-ToolPolicyToObject($Policy) {
  $obj = [pscustomobject]@{}
  foreach ($entry in $Policy.GetEnumerator()) {
    Add-Member -InputObject $obj -MemberType NoteProperty -Name $entry.Key -Value $entry.Value
  }
  return $obj
}

function Set-ToolsBlock([string]$Frontmatter, [string]$Name) {
  $block = Convert-ToolPolicyToYaml (Get-ToolPolicy $Name)
  if ($Frontmatter -match '(?ms)^tools:\r?\n.*?(?=^[A-Za-z_][A-Za-z0-9_-]*:|\z)') {
    return [regex]::Replace($Frontmatter, '(?ms)^tools:\r?\n.*?(?=^[A-Za-z_][A-Za-z0-9_-]*:|\z)', ($block + "`r`n"), 1)
  }
  if ($Frontmatter -match '(?m)^permission:') {
    return [regex]::Replace($Frontmatter, '(?m)^permission:', ($block + "`r`npermission:"), 1)
  }
  return $Frontmatter.TrimEnd() + "`r`n" + $block
}

function Remove-ToolsBlock([string]$Frontmatter) {
  if ($Frontmatter -match '(?ms)^tools:\r?\n.*?(?=^[A-Za-z_][A-Za-z0-9_-]*:|\z)') {
    return [regex]::Replace($Frontmatter, '(?ms)^tools:\r?\n.*?(?=^[A-Za-z_][A-Za-z0-9_-]*:|\z)', '', 1).TrimEnd()
  }
  return $Frontmatter
}

function Get-RoleExtra([string]$Name, [string]$Project) {
  switch -Regex ($Name) {
    'Orchestrator' {
      return @"
### Orquestacion productiva
- Al iniciar una tarea carga memoria persistente, lee correcciones recientes, consulta `bd ready` y registra `task_id`.
- Si hay issue relacionado, reclama con beads antes de delegar y cierra al terminar.
- Tier 1: Repo-Explorer si falta contexto -> especialista -> Test-Specialist -> Code-Reviewer -> Release-Notifier.
- Tier 2: discovery paralelo, Sentry/logs/DB si aplica, plan aprobado por Telegram, snapshot, locks, especialistas, validadores, PR.
- Tier 3: discovery completo, Architect-Planner, aprobacion Telegram, worktrees, y `claude-flow` si hay mas de 3 workstreams paralelos.
- No implementa codigo. Si Task no permite agente exacto, se bloquea y reporta.
"@
    }
    'Node-Express' {
      return @"
### Backend GMP real
- Backend: `backend/`, PM2 proceso `gmp-api`, puerto prod 3335 y pre 3334.
- Antes de tocar backend: consultar Sentry si esta autenticado; si no, leer `instrument.js`, logs PM2 via SSH y reportar que Sentry MCP esta pendiente de auth.
- Leer logs via SSH: `pm2 logs gmp-api --lines 200` o logs en `/opt/gmp-api/logs/`.
- Prometheus: baseline en `curl -s http://localhost:3335/api/metrics`.
- KPI: rutas `/api/kpi/health`, `/api/kpi/metrics`, `/api/kpi/alerts/summary`.
"@
    }
    'DB2-AS400' {
      return @"
### DB2 / AS400 real
- DSN: GMP. Schema principal: JAVIER. Driver ODBC operativo.
- Tablas conocidas: CVC, CPC, CLI, CLC, CLP, DSEDAC, DSCDAC, VISTA_DEUDA_BASE.
- Usa VISTA_DEUDA_BASE antes que query directa a CVC cuando aplique a deuda/cobros.
- CPC tiene duplicados: usa `ROW_NUMBER()` para deduplicar.
- Pool backend maximo: 50 conexiones. No hagas exploraciones sin limites.
- CCSID=1208, NAM=1. Verifica tablas y columnas via MCP antes de escribir SQL.
"@
    }
    'Performance' {
      return @"
### Metricas reales
- Antes de optimizar backend/API: leer Prometheus via SSH (`curl -s http://localhost:3335/api/metrics`).
- KPI/Redis: revisar `redis-cli keys "kpi:*"` si Redis esta disponible y `/api/kpi/metrics`.
- Baseline y post-medicion son obligatorios; no aceptes opiniones sin numeros.
"@
    }
    'Security' {
      return @"
### Seguridad real
- Backend tiene Sentry en `backend/instrument.js`; consultar Sentry MCP si esta autenticado.
- GuardVibe esta disponible como MCP para revisar cambios sensibles cuando el MCP este conectado.
- Cualquier auth/API/DB exige validacion de entrada, autorizacion por rol, SQL parametrizado y scan de secretos.
"@
    }
    'DevOps' {
      return @"
### DevOps real
- GitHub Actions tiene `/oc` en `.github/workflows/opencode.yml` y autoheal en `ci-self-heal.yml`.
- Para Tier 3 paralelo usa `agentree` si aporta CLI; si no, fallback oficial: `git worktree add`.
- Deploy/restart PM2 requiere confirmacion Telegram explicita.
"@
    }
    'Flutter' {
      return @"
### Flutter GMP real
- App tablet Flutter 3.x, Riverpod y ChangeNotifier conviven.
- Reglas CLAUDE.md: no editar `albaran_detail_page.dart` para bugs de repartidor; UI real `rutero_detail_modal.dart`.
- Nueva tab: actualizar a la vez `_getNavItems` y `_buildCurrentPage` en `main_shell.dart`.
- Tras cambiar modelos/providers Dart: `dart run build_runner build --delete-conflicting-outputs`.
"@
    }
    'Release' {
      return @"
### Telegram y observabilidad
- Unico responsable de mensajes a Javier.
- Si Telegram falla, escribe `.opencode/telegram_pending.jsonl` y deja retry pendiente.
- Los mensajes no incluyen pasos internos; solo estado, decisiones, aprobaciones, errores criticos y entrega.
"@
    }
    default {
      return @"
### Ecosistema compartido
- Usa memoria persistente antes de decidir.
- Usa peer consultation cuando una decision tecnica bloquee tu dominio.
- Si detectas un problema fuera de tu especialidad, devuelve `next_recommended_agent`.
"@
    }
  }
}

function Update-AgentFile([string]$Path, [string]$Project) {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($Path)
  $model = Get-ModelForAgent $name
  $fallback = Get-FallbackForModel $model
  $content = Get-Content -LiteralPath $Path -Raw
  if ($content -notmatch '(?s)^---\r?\n(?<fm>.*?)\r?\n---\r?\n(?<body>.*)$') {
    throw "Agent file without markdown frontmatter: $Path"
  }
  $fm = $Matches.fm
  $body = $Matches.body
  $body = $body.Replace(
    "Si falta un campo: no trabaja. Devuelve status=failed con missing_fields.",
    "Si faltan campos en una tarea productiva, devuelve status=failed con missing_fields. Si la invocacion es una consulta simple y clara de smoke test, exploracion o peer consultation, responde igualmente con lo verificado y lista los campos ausentes como warnings."
  )
  if ($fm -match '(?m)^model:\s*') {
    $fm = [regex]::Replace($fm, '(?m)^model:\s*.*$', "model: $model")
  } else {
    $fm = [regex]::Replace($fm, '(?m)^mode:\s*.*$', "`$0`r`nmodel: $model")
  }
  if ($name -match 'Orchestrator$') {
    $agentDir = Split-Path -Parent $Path
    $peers = @(Get-ChildItem -LiteralPath $agentDir -Filter "*.md" -File | ForEach-Object { [System.IO.Path]::GetFileNameWithoutExtension($_.Name) } | Where-Object { $_ -ne $name })
  } else {
    $peers = Get-PeerList $name
  }
  $fm = Set-TaskPermissionBlock $fm $peers
  if ($name -match 'Orchestrator') {
    $fm = Ensure-BashAllows $fm @("bd ready*","bd show*","bd update*","bd close*","bd create*","opencode mcp list*","git worktree*","claude-flow*")
  }
  if ($name -eq "DevOps-CICD-Specialist") {
    $fm = Ensure-BashAllows $fm @("git worktree*","bd ready*","bd show*")
  }
  if ($name -match 'Orchestrator') {
    $fm = Set-ToolsBlock $fm $name
  } else {
    $fm = Remove-ToolsBlock $fm
  }
  $fm = Ensure-ExternalDirectoryDeny $fm
  $body = [regex]::Replace($body, 'MODELO PRINCIPAL:\s*.+', "MODELO PRINCIPAL: $model")
  $body = [regex]::Replace($body, 'MODELO FALLBACK:\s*.+', "MODELO FALLBACK: $fallback")
  $extra = Get-RoleExtra $name $Project
  $ecosystem = @"
<!-- ecosystem-integration-v1 -->
## Ecosystem integration v1

### Model routing
- Modelo principal verificado: `$model`.
- Fallback chain: `$fallback`.
- Timeout de modelo: 15s sin respuesta, HTTP 429 o 5xx activa fallback con backoff 5s -> 30s -> 120s.
- Nunca caer al modelo default del sistema sin registrar degradacion.

### Memoria persistente
- Plugin activo previsto: `opencode-agent-memory@0.2.0`.
- Lee al inicio: `.opencode/memory/project.md`, `.opencode/memory/team-capabilities.md`, `.opencode/memory/corrections.md`, `.opencode/memory/operational-state.md` y `.agent/nhallucinate/lessons-learned.md`.
- Cuando Javier corrige algo, registra la correccion en `.opencode/memory/corrections.logfmt` con `ts`, `agent`, `error`, `correct`, `domain`.
- Si una correccion se repite 3 veces, pide al orquestador convertirla en regla permanente en AGENTS.md.

### Peer consultation
Puedes consultar pares permitidos con Task usando este JSON exacto:
```json
{
  "type": "peer_consultation",
  "from": "$name",
  "to": "agent-name",
  "task_id": "task_id padre",
  "question": "pregunta concreta",
  "context": "contexto minimo",
  "urgency": "blocking|normal"
}
```
Si la respuesta cambia plan, informa al orquestador en el handoff saliente.

### Hooks operativos
- `session.created`: memoria + beads + salud DB2/SSH + reglas CLAUDE.md.
- `session.idle`: guardar resumen y notificar si hay trabajo en curso.
- `context.compaction`: guardar decisiones y lecciones.
- `tool.error`: registrar fallo y usar alternativa si existe.
- `task.completed`: TEAM_TRACE + beads + memoria.
- Nunca devuelvas una respuesta vacia a Task. Si no puedes completar, entrega JSON con `status=failed`, `error_message` y `next_recommended_agent`.

### Beads, GitHub Actions y CI self-heal
- Beads es el tracker local. No trates `.beads/issues.jsonl` como protocolo de sync.
- GitHub `/oc` esta conectado en `.github/workflows/opencode.yml`.
- `ci-self-heal.yml` crea PR o issue para fallos conocidos/no conocidos y debe notificar Telegram.

### Reglas CLAUDE.md internalizadas
- Siempre leer archivo completo antes de editar.
- Nunca guardar archivos de trabajo en la raiz.
- Nunca crear `.md` innecesarios durante tareas de producto.
- Para repartidor, no editar `albaran_detail_page.dart`; UI real `rutero_detail_modal.dart`.
- Nueva pestana en Flutter: actualizar `_getNavItems` y `_buildCurrentPage`.
- Backend prod puerto 3335, pre 3334; verificar con SSH antes de asumir.
- Vendor `ALL` es caso especial; no convertirlo a vendor real.
- `RUTERO_CONFIG`: borrar solo `ORDEN >= 0`.
- `pedidosProvider`: no usar `autoDispose`.

$extra
<!-- /ecosystem-integration-v1 -->
"@
  if ($body -match '(?s)<!-- ecosystem-integration-v1 -->.*?<!-- /ecosystem-integration-v1 -->') {
    $body = [regex]::Replace($body, '(?s)<!-- ecosystem-integration-v1 -->.*?<!-- /ecosystem-integration-v1 -->', $ecosystem.TrimEnd())
  } else {
    $body = $body.TrimEnd() + "`r`n" + $ecosystem
  }
  Write-Utf8NoBom $Path ("---`r`n$fm`r`n---`r`n$body")
}

function Write-MemoryBlocks([string]$ProjectDir, [string]$ProjectName) {
  $memoryDir = Join-Path $ProjectDir ".opencode\memory"
  New-Item -ItemType Directory -Path $memoryDir -Force | Out-Null
  Write-Utf8NoBom (Join-Path $memoryDir "project.md") @"
---
label: project
description: Source of truth for $ProjectName operational context, code conventions, services, and non-obvious constraints.
limit: 9000
---

# $ProjectName Project Memory

- OpenCode agents must read project rules before acting.
- GMP backend uses PM2 `gmp-api`, prod port 3335 and pre port 3334.
- GMP DB2 uses DSN `GMP`, schema `JAVIER`.
- Beads issue tracker is active; run `bd ready` at session start and claim/close related issues.
- Do not trust stale memory over files, DB schema, Sentry, logs, or tests.
"@
  Write-Utf8NoBom (Join-Path $memoryDir "team-capabilities.md") @"
---
label: team-capabilities
description: Current multi-agent roster, model tiers, MCPs, and integration capabilities.
limit: 9000
---

# Team Capabilities

- Tier A: `cursor-acp/claude-opus-4-7`, fallback `cursor-acp/gpt-5.5`, `cursor-acp/composer-2.5`, `openai/gpt-5.5-pro`, `opencode-go/kimi-k2.6`.
- Tier B: `cursor-acp/composer-2.5`, fallback `cursor-acp/claude-4.6-sonnet`, `cursor-acp/gpt-5.5`, `opencode-go/kimi-k2.6`.
- Tier C: `opencode-go/glm-5.1` para orquestadores y Repo-Explorer porque delega/responde con `Task` en pruebas reales; `opencode-go/kimi-k2.6` queda para investigacion externa/notificaciones sin `Task`.
- Connected MCPs include filesystem, git, beads, telegram, DB2, SSH, Playwright, Context7, gh_grep.
- `claude-flow` is available for Tier 3 mesh coordination when a task has more than 3 parallel workstreams.
- `agentree` npm package is installed; if no CLI is exposed, use `git worktree` directly.
"@
  Write-Utf8NoBom (Join-Path $memoryDir "corrections.md") @"
---
label: corrections
description: Javier corrections and repeated mistakes that must change future agent behavior.
limit: 9000
---

# Corrections

- DSN is `GMP`, not `gmp_app` or lowercase variants.
- For repartidor UI bugs, use `rutero_detail_modal.dart`, not `albaran_detail_page.dart`.
- Root scratch files are forbidden.
"@
  $correctionsLog = Join-Path $memoryDir "corrections.logfmt"
  if (-not (Test-Path -LiteralPath $correctionsLog)) {
    Write-Utf8NoBom $correctionsLog "ts=$(Get-Date -Format o) agent=system event=bootstrap correct=""Persistent corrections log initialized"" domain=opencode`r`n"
  }
  Write-Utf8NoBom (Join-Path $memoryDir "operational-state.md") @"
---
label: operational-state
description: Runtime state remembered between sessions: ports, services, monitoring, and startup checks.
limit: 9000
---

# Operational State

- DB2 and SSH target: `192.168.1.230`.
- Backend logs: PM2 `gmp-api`; prefer `pm2 logs gmp-api --lines 200`.
- Prometheus metrics: `/api/metrics`.
- KPI module: `/api/kpi/health`, `/api/kpi/metrics`, `/api/kpi/alerts/summary`.
- Sentry is instrumented in `backend/instrument.js`; MCP auth may require `opencode mcp auth sentry`.
"@
}

function Write-GmpAgentsMd {
  $text = @'
# GMP App Mobilidad - Reglas del Equipo de Agentes

## Stack Tecnico Real
- Mobile: Flutter 3.x, Dart, Riverpod y ChangeNotifier, Dio/http, GoRouter.
- Backend: Node.js/Express CommonJS en `backend/`, PM2 proceso `gmp-api`.
- Puertos: prod 3335, pre 3334. Verificar por SSH antes de asumir.
- DB2/AS400: DSN `GMP`, schema principal `JAVIER`, servidor `192.168.1.230`.
- Sentry: instrumentado en `backend/instrument.js` con `SENTRY_DSN`.
- Prometheus: middleware en `backend/middleware/prometheus-metrics.js`, endpoint `/api/metrics`.
- KPI: `backend/kpi/` con DB2, Redis, scheduler y FTPS/SFTP.
- Beads: `.beads/` es el tracker de tareas; Dolt es el protocolo real de sync.
- Claude-flow: `.mcp.json` define `CLAUDE_FLOW_MODE=v3`, topology `hierarchical-mesh`, max 60 agentes.

## Reglas Inmutables de CLAUDE.md
- Siempre leer archivo completo antes de editar.
- Nunca guardar archivos de trabajo en la raiz del repo.
- Nunca crear `.md` innecesarios para tareas de producto.
- Para bugs de repartidor, no editar `albaran_detail_page.dart`; la UI real es `rutero_detail_modal.dart`.
- Nueva pestana Flutter: actualizar a la vez `_getNavItems` y `_buildCurrentPage` en `main_shell.dart`.
- Tras modificar modelos/providers Dart: `dart run build_runner build --delete-conflicting-outputs`.
- Vendor `ALL` es especial; no convertirlo a codigo de vendedor real.
- `RUTERO_CONFIG`: borrar solo filas `ORDEN >= 0`.
- `pedidosProvider`: no usar `autoDispose`.
- Backend prod 3335 y pre 3334; confirmar con SSH/logs.

## Flujo Base
1. Cargar memoria persistente y correcciones.
2. Consultar `bd ready`; reclamar issue relacionado si existe.
3. Consultar Sentry/logs/Prometheus/DB2 segun dominio.
4. Clasificar Tier 1/2/3; en duda, tier superior.
5. Delegar con Task al agente exacto; el orquestador no implementa.
6. Especialistas hacen PRE-ESCRITURA, snapshot, locks, implementan y verifican.
7. Verificacion: tests, seguridad, rendimiento, code review.
8. Guardar memoria/lecciones, cerrar beads, notificar Telegram.

## Tablas DB2 Conocidas
- ERP/deuda/cobros: `CVC`, `CPC`, `CLI`, `CLC`, `CLP`, `DSEDAC`, `DSCDAC`, `VISTA_DEUDA_BASE`.
- KPI: `KPI_LOADS`, `KPI_ALERTS`, `KPI_FILE_AUDIT`.
- `CPC` puede tener duplicados; usar `ROW_NUMBER()` para deduplicar.
- Verificar siempre tabla y columnas con MCP DB2 antes de escribir SQL.

## Subagentes
- `Repo-Explorer`: lectura y mapa del codebase.
- `Web-Researcher`: docs oficiales, Context7 y gh_grep.
- `Architect-Planner`: planes Tier 3.
- `Flutter-UI-Specialist`: widgets, navegacion, layout, visual.
- `Flutter-Data-Specialist`: providers, modelos, repositorios, API.
- `Node-Express-Specialist`: rutas backend, middleware, validacion.
- `DB2-AS400-Specialist`: esquema y queries DB2.
- `DevOps-CICD-Specialist`: SSH, PM2, GitHub Actions, worktrees.
- `Test-Specialist`: tests y validacion visual.
- `Security-Validator`: auth, API, DB, CVE, secretos.
- `Performance-Analyst`: Prometheus, KPI, Redis, DB/API perf.
- `Code-Reviewer`: revision final.
- `Release-Notifier`: Telegram y lenguaje humano.

## Peer Consultation
Los especialistas pueden consultar pares permitidos con JSON:
`{ "type": "peer_consultation", "from": "...", "to": "...", "task_id": "...", "question": "...", "context": "...", "urgency": "blocking|normal" }`

## Aprendizaje
Correcciones de Javier se guardan en `.opencode/memory/corrections.logfmt`.
Si el mismo error ocurre 3 veces, el orquestador lo convierte en regla permanente aqui.
'@
  Write-Utf8NoBom (Join-Path $GmpDir ".opencode\AGENTS.md") ($text + "`r`n")
}

function Write-GranjaAgentsMd {
  $text = @'
# Granja Mari Pepa - Reglas del Equipo de Agentes

## Stack Tecnico Real
- Web: Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui.
- Backend: Node.js.
- Datos: Supabase/PostgreSQL cuando las credenciales esten activas.
- Web servidor: `/var/www/mari-pepa/` via SSH cuando este disponible.

## Flujo Base
1. Cargar memoria persistente y correcciones.
2. Consultar beads si esta activo.
3. Clasificar Tier 1/2/3.
4. Delegar al subagente exacto.
5. Validar con tsc/lint/tests/Playwright.
6. Guardar memoria y notificar Telegram.

## Subagentes
- `Repo-Explorer`, `Web-Researcher`, `Architect-Planner`.
- `NextJS-Shadcn-Specialist`, `Supabase-Postgres-Specialist`, `Node-Express-Specialist`.
- `DevOps-CICD-Specialist`, `Test-Specialist`, `Security-Validator`, `Performance-Analyst`, `Code-Reviewer`, `Release-Notifier`.

## Reglas
- No modificar fuera de `C:\Users\Javier\Desktop\Repositorios\granja_mari_pepa`.
- Server Components por defecto; `use client` solo con justificacion.
- Cambios visuales requieren Playwright en 375, 768, 1280 y 1920px.
- Sentry/Supabase MCPs requieren credenciales antes de afirmar datos reales.
'@
  Write-Utf8NoBom (Join-Path $GranjaDir ".opencode\AGENTS.md") ($text + "`r`n")
}

function Update-RootAgentsMd {
  $path = Join-Path $GmpDir "AGENTS.md"
  $backupDir = Join-Path $GmpDir ".opencode\backups"
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
  $existing = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
  if ($existing -and $existing.Length -gt 50000) {
    Copy-Item -LiteralPath $path -Destination (Join-Path $backupDir "AGENTS.pre-compact-auto.md") -Force
  }
  $content = @'
# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd prime` when full workflow context is needed.

Issues live in the local Dolt database under `.beads/dolt/`. Cross-machine sync uses `bd dolt push/pull` through the git remote under `refs/dolt/data`. `.beads/issues.jsonl` is a passive export, not the sync protocol.

## Non-Interactive Shell Commands

Always use non-interactive flags for file operations:

```bash
cp -f source dest
mv -f source dest
rm -f file
rm -rf directory
cp -rf source dest
scp -o BatchMode=yes source host:path
ssh -o BatchMode=yes host command
```

## OpenCode Multi-Agent Rules

The operational source of truth for the OpenCode team is `.opencode/AGENTS.md`. Keep this root file compact because OpenCode loads it automatically into every agent prompt.

Hard rules:
- Always read a file before editing it.
- Never place scratch/work files in the repository root.
- Never create unnecessary `.md` files during product tasks.
- Use beads at task start and completion when an issue is related.
- For repartidor UI bugs, use `rutero_detail_modal.dart`; do not edit `albaran_detail_page.dart`.
- For new Flutter tabs, update both `_getNavItems` and `_buildCurrentPage` in `main_shell.dart`.
- After modifying Dart models/providers, run `dart run build_runner build --delete-conflicting-outputs`.
- DB2 DSN is `GMP`; primary schema is `JAVIER`.
- Backend production port is `3335`; preproduction is `3334`; verify with SSH/logs before assuming.

## References

- Project agent rules: `.opencode/AGENTS.md`
- Project memory: `.opencode/memory/`
- Lessons learned: `.agent/nhallucinate/lessons-learned.md`
- Beads docs: `CLAUDE.md` section "Beads Issue Tracker"

The previous oversized root `AGENTS.md` is preserved under `.opencode/backups/` when compaction is needed.
'@
  Write-Utf8NoBom $path ($content + "`r`n")
}

function Write-LessonsSeed {
  $path = Join-Path $GmpDir ".agent\nhallucinate\lessons-learned.md"
  $text = @'
# Lessons Learned

- Persistent memory is now mandatory at session start.
- Repeated Javier corrections must be promoted to `.opencode/memory/corrections.logfmt`.
- DB2 DSN is `GMP`, schema is `JAVIER`.
- Repartidor UI bugs use `rutero_detail_modal.dart`.
- Backend work starts with Sentry/logs; performance work starts with Prometheus/KPI baselines.
'@
  Write-Utf8NoBom $path ($text + "`r`n")
}

function Write-StartupScript {
  $path = Join-Path $ConfigDir "tools\start-opencode-project.ps1"
  Backup-File $path
  $script = @'
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
    try { & "C:\Program Files\nodejs\node.exe" $tool --message $Message | Out-Null } catch {}
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
function Test-GitRemote {
  try {
    $remote = & git remote -v
    if (-not $remote) { return "not_configured" }
    return "configured"
  } catch { return "error" }
}
function Test-NpmPackage([string]$Package) {
  try {
    $out = & "C:\nvm4w\nodejs\npm.cmd" list -g $Package --depth=0 2>$null
    if ($LASTEXITCODE -eq 0 -and ($out -match [regex]::Escape($Package))) { return "installed" }
  } catch {}
  return "missing"
}
function Get-MemorySummary([string]$ProjectDir) {
  $dir = Join-Path $ProjectDir ".opencode\memory"
  if (-not (Test-Path -LiteralPath $dir)) { return [pscustomobject]@{Count=0; Summary="none"} }
  $files = @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in @(".md",".logfmt") })
  $names = ($files | Sort-Object LastWriteTime -Descending | Select-Object -First 5 | ForEach-Object { $_.Name }) -join ", "
  return [pscustomobject]@{Count=$files.Count; Summary=$names}
}
function Get-BeadsSummary {
  if (-not (Test-Path -LiteralPath ".beads")) {
    return [pscustomobject]@{Count=0; Summary="not_configured"}
  }
  try {
    $out = & bd ready 2>$null
    $lines = @($out | Where-Object { $_ -and $_ -notmatch 'No ready work' -and $_ -notmatch '^Warning:' })
    return [pscustomobject]@{Count=$lines.Count; Summary=($lines | Select-Object -First 5) -join " | "}
  } catch {
    return [pscustomobject]@{Count=0; Summary="bd unavailable"}
  }
}
function Cleanup-Snapshots([string]$ProjectDir) {
  $root = Join-Path $ProjectDir ".opencode\snapshots"
  if (-not (Test-Path -LiteralPath $root)) { return }
  $resolvedProject = (Resolve-Path -LiteralPath $ProjectDir).Path
  $resolvedRoot = (Resolve-Path -LiteralPath $root).Path
  if (-not $resolvedRoot.StartsWith($resolvedProject, [StringComparison]::OrdinalIgnoreCase)) { return }
  Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-24) } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
}

Load-Env
$env:OPENAI_API_KEY = $null
$env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = "32768"
$env:OPENCODE_EXPERIMENTAL_LSP_TOOL = "true"
$env:PATH = "C:\nvm4w\nodejs;C:\Program Files\nodejs;C:\Users\Javier\AppData\Roaming\npm;C:\Users\Javier\AppData\Local\cursor-agent;" + $env:PATH

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

Write-Host "1/12 Rotacion de logs"
New-Item -ItemType Directory -Path ".opencode",".opencode\snapshots",".opencode\memory",".opencode\locks" -Force | Out-Null
if (-not (Test-Path ".opencode\TEAM_TRACE.jsonl")) { New-Item -ItemType File -Path ".opencode\TEAM_TRACE.jsonl" -Force | Out-Null }
if (-not (Test-Path (Join-Path $ConfigDir "tokens.jsonl"))) { New-Item -ItemType File -Path (Join-Path $ConfigDir "tokens.jsonl") -Force | Out-Null }
if (-not (Test-Path (Join-Path $ConfigDir "telegram_pending.jsonl"))) { New-Item -ItemType File -Path (Join-Path $ConfigDir "telegram_pending.jsonl") -Force | Out-Null }
Rotate-IfLarge ".opencode\TEAM_TRACE.jsonl" 52428800 5
Rotate-IfLarge (Join-Path $ConfigDir "tokens.jsonl") 10485760 5

Write-Host "2/12 Red al servidor"
$server = Resolve-Server
$db2Status = if ($Project -eq "gmp" -and $server.Reachable) { "network_reachable:$($server.Ip):$($server.Source)" } elseif ($Project -eq "gmp") { "offline:$($server.Ip)" } else { "not_required" }
$sshStatus = if ($Project -eq "gmp" -and $server.Reachable) { "network_reachable:$($server.Ip)" } elseif ($Project -eq "gmp") { "offline" } else { "not_required" }

Write-Host "3/12 Dependencias"
$missing = @()
foreach ($cmd in @("C:\nvm4w\nodejs\opencode.cmd","C:\Program Files\nodejs\node.exe","C:\nvm4w\nodejs\npm.cmd")) {
  if (-not (Test-Path -LiteralPath $cmd)) { $missing += $cmd }
}
try { & bd --version | Out-Null } catch { $missing += "bd" }
if ($missing.Count -gt 0) {
  Send-Tg "ROJO [$ProjectName] Dependencias faltantes: $($missing -join ', ')"
  throw "Dependencias faltantes: $($missing -join ', ')"
}
$agentreeStatus = Test-NpmPackage "agentree"
$memoryPluginStatus = Test-NpmPackage "opencode-agent-memory"
$claudeFlowStatus = if (Get-Command claude-flow -ErrorAction SilentlyContinue) { "installed" } else { "missing" }

Write-Host "4/12 Variables de entorno"
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
if ($Project -eq "gmp") {
  $env:ODBC_DSN = "GMP"
  if (-not $env:ODBC_SCHEMA) { $env:ODBC_SCHEMA = "JAVIER" }
}

Write-Host "5/12 Cursor ACP"
$cursorOk = Test-Url "http://127.0.0.1:32124/v1/models" 5
if (-not $cursorOk) {
  $helper = Join-Path $ConfigDir "cursor-acp-standalone.mjs"
  if (Test-Path -LiteralPath $helper) {
    Start-Process -FilePath "C:\Program Files\nodejs\node.exe" -ArgumentList @("--no-warnings",$helper,$ProjectDir,"http://127.0.0.1:$Port") -WindowStyle Hidden -RedirectStandardOutput (Join-Path $ProjectDir "cursor-acp.log") -RedirectStandardError (Join-Path $ProjectDir "cursor-acp.err.log")
    Start-Sleep -Seconds 15
    $cursorOk = Test-Url "http://127.0.0.1:32124/v1/models" 5
  }
  if (-not $cursorOk) { Send-Tg "NARANJA [$ProjectName] Cursor ACP no disponible; sistema degradado." }
}

Write-Host "6/12 Proveedores"
$providers = @()
if ($cursorOk) { $providers += "cursor-acp" }
try { & "C:\nvm4w\nodejs\opencode.cmd" models openai --pure | Out-Null; $providers += "openai" } catch { Send-Tg "NARANJA [$ProjectName] OpenAI OAuth no disponible." }
try { & "C:\nvm4w\nodejs\opencode.cmd" models opencode-go --pure | Out-Null; $providers += "opencode-go" } catch { Send-Tg "NARANJA [$ProjectName] OpenCode Go no disponible." }
if ($providers.Count -eq 0) {
  Send-Tg "ROJO [$ProjectName] Los tres proveedores estan caidos. STOP."
  throw "Ningun proveedor disponible"
}

Write-Host "7/12 Telegram"
Send-Tg "AZUL [$ProjectName] Startup probe Telegram OK"

Write-Host "8/12 Beads"
$beads = Get-BeadsSummary

Write-Host "9/12 Limpieza"
Ensure-Line ".gitignore" ".opencode/"
Ensure-Line ".gitignore" ".swarm/"
Cleanup-Snapshots $ProjectDir
try {
  Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    Where-Object { $_ -and $_ -ne $PID } |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
} catch {}

Write-Host "10/12 Memoria persistente"
$memory = Get-MemorySummary $ProjectDir
Write-Host "Recordando $($memory.Count) memorias: $($memory.Summary)"

Write-Host "11/12 Contexto OpenCode"
$loaded = (& cmd /c opencode agent list 2>$null | Select-String -Pattern '^[A-Za-z0-9_.-]+ \((primary|subagent)\)' | ForEach-Object { $_.Matches.Value }).Count
$gitStatus = Test-GitRemote
$sentryStatus = if ($env:SENTRY_DSN -or $env:SENTRY_AUTH_TOKEN) { "configured" } else { "backend_instrumented_mcp_auth_pending" }

$banner = @"
============================================
OK [$ProjectName] SISTEMA LISTO
Proveedores: $($providers.Count)/3 activos: $($providers -join ', ')
Agentes cargados: $loaded (esperado proyecto: $ExpectedAgents)
DB2: $db2Status
SSH: $sshStatus
Git remote: $gitStatus
Sentry: $sentryStatus
Beads ready: $($beads.Count)
Memoria: $($memory.Count) entradas
claude-flow: $claudeFlowStatus | agentree: $agentreeStatus | memory plugin: $memoryPluginStatus
============================================
Escribe lo que necesitas al orquestador.
"@
Write-Host $banner
Send-Tg "OK [$ProjectName] Listo. Proveedores: $($providers.Count)/3. DB2: $db2Status. SSH: $sshStatus. Issues beads: $($beads.Count). Memoria: $($memory.Count). Escribeme lo que necesitas."

if ($NoWeb) { exit 0 }

Write-Host "12/12 Arranque OpenCode Web"
$logFile = Join-Path $ProjectDir "output.log"
& "C:\nvm4w\nodejs\opencode.cmd" web --port $Port --hostname 0.0.0.0 --cors "http://localhost:$Port" --cors "http://100.107.11.80:$Port" --cors "app://opencode.ai" *>> $logFile
$exit = $LASTEXITCODE
try { & "C:\Program Files\nodejs\node.exe" (Join-Path $ConfigDir "tools\session-summarizer.mjs") --project=$Project 2>$null } catch {}
exit $exit
'@
  Write-Utf8NoBom $path ($script + "`r`n")
}

function Patch-SshMcpWhitelist {
  $path = Join-Path $ConfigDir "mcp\gmp-deploy-ssh-mcp.cjs"
  if (-not (Test-Path -LiteralPath $path)) { return }
  Backup-File $path
  $text = Get-Content -LiteralPath $path -Raw
  $text = $text -replace '\^pm2\\s\+\(list\|status\|logs\?\(\\s\+\\w\+\)\?\)\$', '^pm2\s+(list|status|logs?)(\s+[\w.-]+)?(\s+--lines\s+\d+)?$'
  $text = $text -replace '\^pm2\\s\+\(list\|status\|logs\?\(\\s\+\[\\w\.-\]\+\)\?\)\(\\s\+--lines\\s\+\\d\+\)\?\$', '^pm2\s+(list|status|logs?)(\s+[\w.-]+)?(\s+--lines\s+\d+)?$'
  $oldCurl = '  /^curl\s+-s\s+http:\/\/localhost:\d+\/health$/,'
  $newCurl = @'
  /^curl\s+-s(\s+-A\s+opencode)?\s+http:\/\/localhost:\d+\/(health|api\/health|api\/metrics|api\/kpi\/(health|metrics|alerts\/summary))$/,
  /^redis-cli\s+(keys\s+"?kpi:\*"?|info|dbsize)$/,
'@
  if ($text.Contains($oldCurl)) {
    $text = $text.Replace($oldCurl, $newCurl.TrimEnd())
  } else {
    $text = [regex]::Replace($text, '(?m)^  /\^curl\\s\+-s.*\$/,', $newCurl.TrimEnd())
  }
  Write-Utf8NoBom $path $text
}

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

if (-not $SkipGlobal) {
  $globalPath = Join-Path $ConfigDir "opencode.json"
  Backup-File $globalPath
  $global = Read-Json $globalPath
  Set-Prop $global "plugin" (Add-UniqueString $global.plugin "opencode-agent-memory@0.2.0")
  Remove-Prop $global "tools"
  $claudeFlowCmd = if (Test-Path (Join-Path $HomeDir "AppData\Roaming\npm\claude-flow.cmd")) { Join-Path $HomeDir "AppData\Roaming\npm\claude-flow.cmd" } else { "claude-flow" }
  Set-McpEntry $global "claude-flow" ([pscustomobject]@{
    type = "local"
    command = @($claudeFlowCmd, "mcp", "start")
    environment = [pscustomobject]@{
      CLAUDE_FLOW_MODE = "v3"
      CLAUDE_FLOW_HOOKS_ENABLED = "true"
      CLAUDE_FLOW_TOPOLOGY = "hierarchical-mesh"
      CLAUDE_FLOW_MAX_AGENTS = "60"
      CLAUDE_FLOW_MEMORY_BACKEND = "hybrid"
      CLAUDE_FLOW_TOKEN_OPTIMIZER = "true"
      CLAUDE_FLOW_AGENT_BOOSTER = "true"
      CLAUDE_FLOW_WASM_BOOSTER = "true"
      CLAUDE_FLOW_SELF_LEARNING = "true"
    }
    enabled = $true
    timeout = 30000
  })
  Set-McpEntry $global "guardvibe" ([pscustomobject]@{
    type = "local"
    command = @("C:/nvm4w/nodejs/npx.cmd", "-y", "guardvibe@3.1.21")
    enabled = $true
    timeout = 30000
  })
  Write-Json $globalPath $global

  $fallbackPath = Join-Path $ConfigDir "fallback-models.json"
  Backup-File $fallbackPath
  $agents = [ordered]@{}
  $agentNames = @(
    "GMP-Orchestrator","Granja-Orchestrator","Repo-Explorer","Web-Researcher","Architect-Planner",
    "Flutter-UI-Specialist","Flutter-Data-Specialist","Node-Express-Specialist","DB2-AS400-Specialist",
    "NextJS-Shadcn-Specialist","Supabase-Postgres-Specialist","DevOps-CICD-Specialist","Test-Specialist",
    "Security-Validator","Performance-Analyst","Code-Reviewer","Release-Notifier"
  )
  foreach ($agent in $agentNames) {
    $model = Get-ModelForAgent $agent
    if ($model -eq "cursor-acp/claude-opus-4-7") {
      $agents[$agent] = [ordered]@{ primary=$model; fallback=@("cursor-acp/gpt-5.5","cursor-acp/composer-2.5","openai/gpt-5.5-pro","opencode-go/kimi-k2.6") }
    } elseif ($model -eq "cursor-acp/composer-2.5") {
      $agents[$agent] = [ordered]@{ primary=$model; fallback=@("cursor-acp/claude-4.6-sonnet","cursor-acp/gpt-5.5","opencode-go/kimi-k2.6") }
    } elseif ($model -eq "opencode-go/glm-5.1") {
      $agents[$agent] = [ordered]@{ primary=$model; fallback=@("opencode-go/kimi-k2.6","opencode-go/deepseek-v4-pro","cursor-acp/composer-2.5") }
    } else {
      $agents[$agent] = [ordered]@{ primary=$model; fallback=@("opencode-go/glm-5.1","opencode-go/deepseek-v4-pro","openai/gpt-5.4-mini-fast") }
    }
  }
  $fallback = [ordered]@{
    '$schema' = "https://opencode.ai/fallback-models.schema.json"
    enabled = $true
    tiers = [ordered]@{
      A = [ordered]@{ primary="cursor-acp/claude-opus-4-7"; fallback=@("cursor-acp/gpt-5.5","cursor-acp/composer-2.5","openai/gpt-5.5-pro","opencode-go/kimi-k2.6") }
      B = [ordered]@{ primary="cursor-acp/composer-2.5"; fallback=@("cursor-acp/claude-4.6-sonnet","cursor-acp/gpt-5.5","opencode-go/kimi-k2.6") }
      C = [ordered]@{ primary="opencode-go/glm-5.1"; fallback=@("opencode-go/kimi-k2.6","opencode-go/deepseek-v4-pro","cursor-acp/composer-2.5") }
    }
    agents = $agents
    retryBehavior = [ordered]@{ maxRetries=3; backoffMs=@(5000,30000,120000); rateLimitBackoff=$true; timeoutMs=15000 }
  }
  Write-Utf8NoBom $fallbackPath (($fallback | ConvertTo-Json -Depth 100) + "`r`n")

  $agentMemoryConfig = [ordered]@{
    journal = [ordered]@{
      enabled = $true
      tags = @(
        [ordered]@{ name="correction"; description="Correcciones de Javier que deben cambiar comportamiento futuro" },
        [ordered]@{ name="db2"; description="Aprendizajes de DB2/AS400 y schema JAVIER" },
        [ordered]@{ name="backend"; description="Sentry, PM2, Prometheus, rutas Node/Express" },
        [ordered]@{ name="flutter"; description="Patrones Flutter, Riverpod y UI GMP" },
        [ordered]@{ name="ci"; description="GitHub Actions, /oc y self-heal" }
      )
    }
  }
  Write-Utf8NoBom (Join-Path $ConfigDir "agent-memory.json") (($agentMemoryConfig | ConvertTo-Json -Depth 20) + "`r`n")
  Patch-SshMcpWhitelist
  Write-StartupScript
}

foreach ($project in @(
  [pscustomobject]@{Name="GMP"; Dir=$GmpDir; Claude="./CLAUDE.md"},
  [pscustomobject]@{Name="Granja"; Dir=$GranjaDir; Claude="./.opencode/CLAUDE.md"}
)) {
  $configPath = Join-Path $project.Dir ".opencode\opencode.json"
  Backup-File $configPath
  $cfg = Read-Json $configPath
  Set-Prop $cfg "model" "opencode-go/kimi-k2.6"
  Set-Prop $cfg "small_model" "opencode-go/kimi-k2.6"
  Remove-Prop $cfg "tools"
  $instructions = Add-UniqueString $cfg.instructions "./.opencode/AGENTS.md"
  if (Test-Path (Join-Path $project.Dir ($project.Claude -replace '^\./',''))) {
    $instructions = Add-UniqueString $instructions $project.Claude
  }
  Set-Prop $cfg "instructions" $instructions
  Set-ProjectMcpFlag $cfg "claude-flow" $true
  Set-ProjectMcpFlag $cfg "guardvibe" $true
  if ($project.Name -eq "GMP") {
    Set-ProjectMcpFlag $cfg "ibm-db2-mcp" $true
    Set-ProjectMcpFlag $cfg "gmp-deploy-ssh" $true
  }
  Write-Json $configPath $cfg

  $agentDir = Join-Path $project.Dir ".opencode\agents"
  Get-ChildItem -LiteralPath $agentDir -Filter "*.md" -File | ForEach-Object {
    Backup-File $_.FullName
    Update-AgentFile $_.FullName $project.Name
  }
  Write-MemoryBlocks $project.Dir $project.Name
}

Write-GmpAgentsMd
Write-GranjaAgentsMd
Update-RootAgentsMd
Write-LessonsSeed

Write-Host "Ecosystem integration applied. Backup: $BackupDir"
