param(
  [string]$ProjectRoot = (Resolve-Path ".").Path,
  [string]$GlobalConfigRoot = "$env:USERPROFILE\.config\opencode",
  [string]$GranjaRoot = "$env:USERPROFILE\Desktop\Repositorios\granja_mari_pepa"
)

$ErrorActionPreference = "Stop"

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
  }
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $dir = Split-Path -Parent $Path
  if ($dir) { Ensure-Dir $dir }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $raw = Get-Content -LiteralPath $Path -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  return $raw | ConvertFrom-Json
}

function Save-JsonFile([string]$Path, $Object, [int]$Depth = 40) {
  $json = $Object | ConvertTo-Json -Depth $Depth
  Write-Utf8NoBom $Path ($json + "`n")
}

function Set-JsonProperty($Object, [string]$Name, $Value) {
  if ($Object.PSObject.Properties.Name -contains $Name) {
    $Object.$Name = $Value
  } else {
    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
  }
}

function Set-Note([string]$Path, [string]$Content) {
  Write-Utf8NoBom $Path ($Content.TrimEnd() + "`n")
}

$opencodeDir = Join-Path $ProjectRoot ".opencode"
$agentsDir = Join-Path $opencodeDir "agents"
$toolsDir = Join-Path $opencodeDir "tools"
$pluginsDir = Join-Path $opencodeDir "plugins"
$commandsDir = Join-Path $opencodeDir "commands"
$memoryDir = Join-Path $opencodeDir "memory"
$stateDir = Join-Path $opencodeDir "state"
$metricsDir = Join-Path $opencodeDir "metrics"
$monitoringDir = Join-Path $opencodeDir "monitoring"

@(
  $opencodeDir, $agentsDir, $toolsDir, $pluginsDir, $commandsDir, $memoryDir,
  (Join-Path $memoryDir "sessions"),
  (Join-Path $memoryDir "prompt-versions"),
  (Join-Path $memoryDir "deleted"),
  $stateDir,
  $metricsDir,
  (Join-Path $opencodeDir "doom-loops"),
  (Join-Path $opencodeDir "sandbox"),
  (Join-Path $opencodeDir "chromadb"),
  $monitoringDir,
  (Join-Path $monitoringDir "grafana-dashboards")
) | ForEach-Object { Ensure-Dir $_ }

$facts = [ordered]@{
  project = "GMP App Mobilidad"
  project_root = $ProjectRoot
  app_server = "192.168.1.230"
  db2_server = "192.168.1.22"
  image_server = "192.168.1.191"
  backend_remote_path = "/opt/gmp-api"
  backend_port = 3197
  db2_dsn = "GMP"
  db2_schemas = @("JAVIER", "DSEDAC")
  web_granja_remote_path = "/var/www/mari-pepa"
  no_postgres = $true
  no_supabase = $true
  generated_at = (Get-Date).ToUniversalTime().ToString("o")
}
Save-JsonFile (Join-Path $memoryDir "project-facts.json") $facts

# Compact root AGENTS.md. OpenCode loads this automatically; the detailed source of truth is .opencode/AGENTS.md.
$rootAgents = @"
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
- DB2 DSN is `GMP`; primary schemas are `JAVIER` and `DSEDAC`.
- DB2/AS400 server is `192.168.1.22`.
- Backend/application server is `192.168.1.230`; backend path is `/opt/gmp-api`; production port is `3197`.
- Image server is `192.168.1.191`.
- Granja also uses DB2/AS400. Do not introduce PostgreSQL or Supabase into agent plans for these projects.

## References

- Project agent rules: `.opencode/AGENTS.md`
- Deterministic rules: `.opencode/rules.json`
- Project memory: `.opencode/memory/`
- Lessons learned: `.agent/nhallucinate/lessons-learned.md`
- Beads docs: `CLAUDE.md` section "Beads Issue Tracker"
"@
Set-Note (Join-Path $ProjectRoot "AGENTS.md") $rootAgents

$projectAgentsMd = @"
# GMP App Mobilidad - Reglas del Equipo de Agentes

## Stack tecnico real
- Mobile: Flutter 3.24+ / Dart. Estado con ChangeNotifier y migracion progresiva a Riverpod.
- Backend: Node.js CommonJS + Express en `/opt/gmp-api/`.
- Puerto backend real: `3197`.
- Servidor backend/aplicacion: `192.168.1.230` por SSH usuario `gmp`.
- DB2/AS400: servidor `192.168.1.22`, DSN ODBC `GMP`, schemas principales `JAVIER` y `DSEDAC`.
- Servidor de imagenes: `192.168.1.191`, base `http://192.168.1.191/movilidad/ImagenesGestorDocumentalNuevo`.
- PM2: proceso `gmp-api`.
- Sentry: instrumentado en `backend/instrument.js`.
- Prometheus: middleware en `backend/middleware/prometheus-metrics.js`.
- Redis/KPI: `backend/kpi/`.
- Beads: `.beads/` con Dolt como protocolo de sync.

## Reglas inmutables
- Siempre leer un archivo antes de editarlo.
- Nunca guardar archivos de trabajo en la raiz del repo.
- Nunca crear `.md` innecesarios durante tareas de producto.
- Usar beads al inicio y cierre cuando haya issue relacionado.
- Para bugs UI de repartidor, usar `rutero_detail_modal.dart`; no editar `albaran_detail_page.dart`.
- Para nuevas tabs Flutter, actualizar `_getNavItems` y `_buildCurrentPage` en `main_shell.dart`.
- Tras modificar modelos/providers Dart, ejecutar `dart run build_runner build --delete-conflicting-outputs`.
- DB2 DSN es `GMP`; schemas `JAVIER` y `DSEDAC`.
- Backend prod: `3197`; verificar con SSH/logs antes de asumir estado runtime.
- No usar PostgreSQL ni Supabase para GMP o Granja salvo una orden explicita posterior que cambie arquitectura.

## Modulos y responsables
- `lib/features/commissions`, cobros, pedidos, reparto, warehouse, bolsa, auth: Flutter-UI-Specialist y Flutter-Data-Specialist segun capa.
- `backend/routes/*.js`: Node-Express-Specialist.
- DB2/AS400: DB2-AS400-Specialist.
- Sentry, Prometheus, PM2, GitHub Actions, despliegues: DevOps-CICD-Specialist y Metrics-Observer.
- Tests: Test-Writer antes de implementar en Tier 2/3; Test-Specialist despues.
- Seguridad: Security-Validator.
- Revision: Check-Reviewer y Simplify-Reviewer con debate estructurado.
- Memoria, stategraph y contexto entre sesiones: Context-Manager.

## Tablas DB2 conocidas
- Servidor: `192.168.1.22`.
- DSN: `GMP`.
- Schemas: `JAVIER`, `DSEDAC`.
- Tablas frecuentes: `CVC`, `CPC`, `CLI`, `CLC`, `CLP`, `DSEDAC`, `DSCDAC`, `VISTA_DEUDA_BASE`.
- Antes de usar cualquier tabla o columna: verificar con `QSYS2.SYSTABLES` y `QSYS2.SYSCOLUMNS`.
- `VISTA_DEUDA_BASE` debe preferirse antes de queries directas complejas sobre deuda.
- `CPC` puede tener duplicados; usar `ROW_NUMBER()` al deduplicar.

## Flujo obligatorio
1. Orquestador genera `task_id` y crea `.opencode/state/[task_id].json`.
2. Context-Manager carga memoria, reglas, beads, Sentry/Prometheus si aplica.
3. Repo-Explorer lee archivos reales antes de cualquier especialista.
4. Tier 1 implementa sin aprobacion si no toca auth/DB/API/deploy.
5. Tier 2 y Tier 3 presentan plan a Javier por Telegram antes de implementar.
6. DB/auth/API activa Security-Validator.
7. DB/API/performance activa Metrics-Observer o Performance-Analyst.
8. UI visual exige screenshots o validacion visual equivalente.
9. Check-Reviewer y Simplify-Reviewer debaten cambios complejos.
10. Release-Notifier entrega resumen humano por Telegram.

## Uso de beads
- Inicio: `bd ready` y buscar issue relacionado.
- Al tomar issue: `bd update [id] --claim`.
- Al completar: `bd close [id]`.
- Si se detecta bug nuevo: `bd create "descripcion"`.

## Memoria
- Core memory: `.opencode/memory/project-state.md`, `glossary.jsonl`, `corrections.jsonl`.
- Archival memory: ChromaDB si esta disponible; fallback por keywords si no.
- Audit trail: `.opencode/TEAM_TRACE.jsonl`.
- Token tracking: `.opencode/tokens.jsonl`.
"@
Set-Note (Join-Path $opencodeDir "AGENTS.md") $projectAgentsMd

# Deterministic rules, 60 rules across safety, DB, git, quality, comms, agents, memory, runtime.
$rules = @()
function Add-Rule([string]$id, [string]$category, [string]$condition, [string]$action, [string]$severity = "block") {
  $script:rules += [ordered]@{ id = $id; category = $category; condition = $condition; action = $action; severity = $severity }
}
Add-Rule S01 safety "New code contains password/token/secret/key/apikey/bearer/credentials literal" "Stop, warn orchestrator, do not write file"
Add-Rule S02 safety "Task modifies .env or .env.*" "Require Javier confirmation"
Add-Rule S03 safety "Task touches auth/JWT/session/token files" "Invoke Security-Validator before and after change"
Add-Rule S04 safety "New code contains IP outside 192.168.1.230, 192.168.1.22, 192.168.1.191, 127.0.0.1, localhost" "Warn and require explicit verification" "warn"
Add-Rule S05 safety "New npm dependency has critical CVE" "Reject dependency and propose alternative"
Add-Rule S06 safety "Attempt to read .env, auth.json, mcp-auth.json, *.pem, *.key, *.p12" "Block read"
Add-Rule S07 safety "Deploy or destructive infra action requested" "Require explicit Javier confirmation without timeout"
Add-Rule S08 safety "Output includes raw credential value" "Redact immediately and log security incident"
Add-Rule D01 db2 "Before any DB2 SQL" "Verify table in QSYS2.SYSTABLES"
Add-Rule D02 db2 "Before any DB2 SQL references columns" "Verify every column in QSYS2.SYSCOLUMNS"
Add-Rule D03 db2 "ALTER TABLE or CREATE TABLE on DB2" "Generate rollback migration and ask Javier before execution"
Add-Rule D04 db2 "Query has no WHERE or broad filter on large table" "Performance-Analyst verifies plan before execution"
Add-Rule D05 db2 "SQL is built by string concatenation" "Reject; require parameter binding"
Add-Rule D06 db2 "DB2 target host is not 192.168.1.22" "Stop and correct host"
Add-Rule D07 db2 "Schema omitted for known DB2 table" "Use explicit JAVIER or DSEDAC schema after verification" "warn"
Add-Rule D08 db2 "Query touches CPC" "Check deduplication need with ROW_NUMBER()" "warn"
Add-Rule G01 git "Push to main/master requested" "Block unless explicit approval and tests passed"
Add-Rule G02 git "Deploy to 192.168.1.230 requested" "Require explicit Javier confirmation"
Add-Rule G03 git "Tier 2 or Tier 3 implementation" "Create feature branch first"
Add-Rule G04 git "Existing file will be modified" "Create snapshot first"
Add-Rule G05 git "Snapshot older than 48h and no active state" "Clean during startup"
Add-Rule G06 git "Commit message generated" "Use Conventional Commits with task_id"
Add-Rule G07 git "Workstreams modify disjoint file sets in Tier 3" "Use worktrees if agentree is available"
Add-Rule G08 git "Unrelated dirty worktree changes exist" "Do not revert; work around or report"
Add-Rule Q01 quality "Task finishes after Flutter or TS change" "Run flutter analyze or tsc --noEmit with 0 errors"
Add-Rule Q02 quality "New business logic added" "Coverage target >80%"
Add-Rule Q03 quality "Visual change made" "Validate 3 viewports or documented Flutter equivalent"
Add-Rule Q04 quality "New screen added" "Implement loading, empty, error, populated states"
Add-Rule Q05 quality "API or DB endpoint changed" "Measure response threshold"
Add-Rule Q06 quality "Dart model/provider changed" "Run build_runner command"
Add-Rule Q07 quality "Backend route added" "Add input validation and tests"
Add-Rule Q08 quality "Public method/class added" "Add JSDoc/DartDoc if non-obvious"
Add-Rule C01 comms "Startup notification" "Send one consolidated Telegram message"
Add-Rule C02 comms "Telegram message composed" "Use emojis, not color words in uppercase"
Add-Rule C03 comms "Internal delegation event occurs" "Do not spam Telegram"
Add-Rule C04 comms "Approval pending 10 minutes" "Send reminder; after 5 more minutes stop and rollback"
Add-Rule C05 comms "Delivery message" "Include changes, files, tests, manual verification"
Add-Rule C06 comms "Failure is degraded not blocking" "Report once in startup summary"
Add-Rule C07 comms "Javier corrects the system" "Record correction in memory"
Add-Rule C08 comms "Multiple tasks in one message" "Split, prioritize, and notify order"
Add-Rule A01 agents "Agent exceeds tier timeout" "Notify and evaluate fallback"
Add-Rule A02 agents "Same agent repeats same error 3 times" "Doom loop stop and rollback"
Add-Rule A03 agents "Orchestrator is about to implement code" "Delegate to specialist"
Add-Rule A04 agents "Repo-Explorer attempts write" "Error"
Add-Rule A05 agents "Test-Writer touches production files" "Error"
Add-Rule A06 agents "Release-Notifier touches code" "Error"
Add-Rule A07 agents "Subagent returns missing handoff schema" "Reject output and request corrected handoff"
Add-Rule A08 agents "Subagent modifies undeclared files" "Stop and rollback affected files"
Add-Rule A09 agents "Tier 2/3 complex change complete" "Run Check-Reviewer and Simplify-Reviewer debate"
Add-Rule A10 agents "Peer asks unverifiable entity question" "Delegate to Repo-Explorer or DB2-AS400 first"
Add-Rule M01 memory "Session starts" "Load project-state, corrections, glossary and interrupted states"
Add-Rule M02 memory "Task completes" "Append session summary and TEAM_TRACE"
Add-Rule M03 memory "Correction detected" "Append corrections.jsonl and rlhf-signals.jsonl"
Add-Rule M04 memory "Same correction happens 3 sessions" "Propose prompt rule update"
Add-Rule M05 memory "ChromaDB unavailable" "Fallback to keyword search and continue degraded"
Add-Rule M06 memory "User invokes /forget all" "Require explicit confirmation and backup first"
Add-Rule R01 runtime "Cursor ACP /v1/models timeout" "Mark provider degraded, continue with OpenAI and OpenCode Go"
Add-Rule R02 runtime "OpenCode Go unavailable" "Fallback to OpenAI/Cursor if available"
Add-Rule R03 runtime "All providers unavailable" "Stop startup"
Add-Rule R04 runtime "DB2 host unreachable" "Mark DB2 offline; do not invent data"
Add-Rule R05 runtime "SSH host unreachable" "Mark deploy/log tasks offline"
Add-Rule R06 runtime "Docker unavailable" "Disable sandbox and continue"
Save-JsonFile (Join-Path $opencodeDir "rules.json") ([ordered]@{ version = "2.0"; generated_at = (Get-Date).ToUniversalTime().ToString("o"); rules = $rules }) 20

function Agent-Frontmatter([string]$description, [string]$mode, [string]$model, [double]$temperature, [int]$steps, [string]$permissionYaml) {
@"
---
description: $description
mode: $mode
model: $model
temperature: $temperature
steps: $steps
hidden: true
permission:
$permissionYaml
---
"@
}

$commonPrompt = @"

REGLAS COMUNES:
- Antes de decidir, consulta las reglas aplicables de `.opencode/rules.json`.
- No menciones archivos, funciones, clases, tablas, columnas, endpoints o variables sin haberlos verificado en esta sesion.
- DB2 real: host `192.168.1.22`, DSN `GMP`, schemas `JAVIER` y `DSEDAC`.
- Backend real: SSH `192.168.1.230`, ruta `/opt/gmp-api`, puerto `3197`.
- Imagenes: `192.168.1.191`.
- GMP y Granja usan DB2/AS400. No introducir PostgreSQL ni Supabase.
- Devuelve siempre handoff JSON con: status, output, files_modified, errors, warnings, requires_followup, followup_details.
- Si no puedes verificar algo, responde status `partial` o `failure`; nunca rellenes con suposiciones.
"@

$orchPermission = @"
  edit: deny
  bash:
    `"*`": deny
    `"git status`": allow
    `"git log*`": allow
    `"git branch*`": allow
    `"bd ready*`": allow
  task:
    Repo-Explorer: allow
    Context-Manager: allow
    Web-Researcher: allow
    Architect-Planner: allow
    Flutter-UI-Specialist: allow
    Flutter-Data-Specialist: allow
    Node-Express-Specialist: allow
    DB2-AS400-Specialist: allow
    DevOps-CICD-Specialist: allow
    Test-Writer: allow
    Test-Specialist: allow
    Security-Validator: allow
    Performance-Analyst: allow
    Metrics-Observer: allow
    Check-Reviewer: allow
    Simplify-Reviewer: allow
    Code-Reviewer: allow
    Release-Notifier: allow
  read: allow
  webfetch: deny
  question: allow
"@

$orchestrator = (Agent-Frontmatter "Orquestador principal del proyecto GMP. Clasifica peticiones de Javier, crea StateGraph, carga memoria y delega siempre a subagentes especializados." "primary" "opencode-go/glm-5.1" 0.1 80 $orchPermission) + @"

Eres el CTO coordinador del proyecto GMP. Coordinas, no implementas.

PROYECTO: GMP App Mobilidad
RUTA: $ProjectRoot
STACK: Flutter/Dart, Node.js/Express, IBM DB2/AS400, Beads, Sentry, Prometheus, Redis/KPI.

PROTOCOLO INICIAL:
1. Genera task_id `YYYYMMDD-HHMMSS-gmp-[4chars]`.
2. Invoca a Context-Manager para cargar memoria, reglas, tools-manifest, probe-results, beads y state pendiente.
3. Extrae intencion estructurada: intention, entities, parameters, dependencies, side_effects, confidence.
4. Clasifica tier:
   - Tier 1: un archivo, sin DB/auth/API/deploy.
   - Tier 2: 2-5 archivos, logica acotada, DB/API posible.
   - Tier 3: feature o cambio multi-modulo.
5. Crea o actualiza `.opencode/state/[task_id].json`.
6. Registra toda invocacion en TEAM_TRACE.jsonl antes de usar Task.

PROTOCOLO DE INVOCACION:
Usa Task con handoff estructurado:
{
  "task_id": "...",
  "context": {
    "project": "gmp",
    "tier": 1,
    "memory_context": "...",
    "files_to_read_first": [],
    "files_to_modify": [],
    "entities_to_verify": []
  },
  "instructions": "...",
  "expected_output": {
    "format": "{status, output, files_modified, errors, warnings, requires_followup, followup_details}",
    "done_criteria": "..."
  },
  "constraints": []
}

ROSTER DE SUBAGENTES:
- Context-Manager: memoria, StateGraph, ChromaDB fallback, herramientas detectadas.
- Repo-Explorer: solo lectura del codebase.
- Web-Researcher: documentacion oficial y patrones actuales.
- Architect-Planner: plan Tier 3 y workstreams.
- Flutter-UI-Specialist: UI Flutter.
- Flutter-Data-Specialist: datos/providers/modelos Flutter.
- Node-Express-Specialist: backend Express en `/opt/gmp-api`.
- DB2-AS400-Specialist: DB2/AS400 en `192.168.1.22`.
- DevOps-CICD-Specialist: SSH, PM2, GitHub Actions, deploys.
- Test-Writer: TDD y tests nuevos.
- Test-Specialist: ejecucion y verificacion de tests.
- Security-Validator: seguridad y secretos.
- Performance-Analyst: rendimiento.
- Metrics-Observer: Prometheus, Sentry, Redis/KPI, Grafana.
- Check-Reviewer: riesgos y gaps bloqueantes.
- Simplify-Reviewer: complejidad y YAGNI.
- Code-Reviewer: calidad final.
- Release-Notifier: Telegram y resumen humano.

FLUJOS:
- Tier 1: Context-Manager -> Repo-Explorer -> especialista -> Test-Specialist -> Code-Reviewer -> Release-Notifier.
- Tier 2: Context-Manager -> [Repo-Explorer + DB2/Metrics si aplica] -> plan Telegram -> snapshot -> Test-Writer -> especialistas -> Security/Performance -> debate Check/Simplify -> Test-Specialist -> Release.
- Tier 3: Context-Manager -> discovery paralelo -> Architect-Planner -> aprobacion Telegram -> snapshot/worktrees -> especialistas -> debate -> tests/security/performance -> PR/release.

NUNCA:
- Implementas codigo directamente.
- Das por bueno un resultado sin handoff JSON valido.
- Inventas datos DB2.
- Usas PostgreSQL o Supabase.
- Entregas sin verificacion o sin reportar bloqueo real.
$commonPrompt
"@
Set-Note (Join-Path $agentsDir "GMP-Orchestrator.md") $orchestrator

$subPermRead = @"
  edit: deny
  bash:
    `"*`": deny
    `"rg *`": allow
    `"bd ready*`": allow
    `"git status`": allow
  read: allow
  task: deny
  webfetch: deny
"@
$subPermEditDart = @"
  edit:
    `"**/*.dart`": allow
    `"**/*.yaml`": ask
    `"*`": deny
  bash:
    `"*`": deny
    `"flutter analyze`": allow
    `"flutter test*`": allow
    `"dart format *`": allow
    `"dart run build_runner build --delete-conflicting-outputs`": allow
  read: allow
  task:
    Flutter-Data-Specialist: allow
    DB2-AS400-Specialist: allow
    Test-Writer: allow
"@
$subPermEditBackend = @"
  edit:
    `"backend/**/*.js`": allow
    `"backend/**/*.ts`": allow
    `"backend/**/*.json`": ask
    `"*`": deny
  bash:
    `"*`": deny
    `"npm test*`": allow
    `"npm run lint*`": allow
    `"node --check *`": allow
  read: allow
  task:
    DB2-AS400-Specialist: allow
    Security-Validator: allow
    Test-Writer: allow
"@
$subPermTests = @"
  edit:
    `"**/*_test.dart`": allow
    `"**/*.test.*`": allow
    `"**/*.spec.*`": allow
    `"backend/test/**`": allow
    `"test/**`": allow
    `"*`": deny
  bash:
    `"*`": deny
    `"flutter test*`": allow
    `"npm test*`": allow
    `"npx playwright*`": allow
    `"dart test*`": allow
  read: allow
  task: deny
"@
$subPermOps = @"
  edit: ask
  bash:
    `"*`": ask
    `"git status`": allow
    `"git log*`": allow
    `"bd ready*`": allow
    `"npm audit*`": allow
    `"flutter pub outdated*`": allow
  read: allow
  task: deny
"@

$agentSpecs = @(
  @{
    File="Context-Manager.md"; Model="opencode-go/glm-5.1"; Temp=0.0; Steps=35; Perm=$subPermRead;
    Desc="Gestor de memoria persistente, StateGraph, tools-manifest, reglas deterministicas y contexto entre sesiones.";
    Body="Eres Context-Manager. Cargas `.opencode/memory/project-state.md`, corrections, glossary, rules.json, probe-results y tools-manifest. Detectas state interrumpido en `.opencode/state`. Consultas ChromaDB si esta disponible y haces fallback por keywords. Guardas sesiones, correcciones y RLHF signals. Nunca editas codigo de producto."
  },
  @{
    File="Repo-Explorer.md"; Model="opencode-go/glm-5.1"; Temp=0.0; Steps=30; Perm=$subPermRead;
    Desc="Explorador de codebase solo lectura. Mapea archivos, endpoints, imports y entidades reales antes de implementar.";
    Body="Eres Repo-Explorer. Solo lees. Devuelves JSON con files_found, imports_map, entities_confirmed, entities_uncertain, risk_areas, context_summary. Usa `rg` mentalmente como patron de busqueda y confirma cada entidad leyendo su archivo."
  },
  @{
    File="Web-Researcher.md"; Model="opencode-go/kimi-k2.6"; Temp=0.2; Steps=25; Perm=$subPermRead -replace "webfetch: deny","webfetch: allow";
    Desc="Investigador de documentacion tecnica oficial y patrones actualizados.";
    Body="Eres Web-Researcher. Priorizas documentacion oficial, luego repos oficiales e issues. No tocas archivos. Si una version importa, la verificas antes de recomendar."
  },
  @{
    File="Architect-Planner.md"; Model="openai/gpt-5.5"; Temp=0.1; Steps=60; Perm=$subPermRead;
    Desc="Arquitecto senior Tier 3. Genera planes JSON con workstreams, dependencias, riesgos y aprobacion requerida.";
    Body="Eres Architect-Planner. Disenas antes de escribir. Tu salida obligatoria incluye plan_id, summary, interpretation, workstreams, db_changes, api_changes, auth_changes, visual_changes, performance_impact, security_points, risks, branch_name, requires_javier_confirmation y confirmation_reason."
  },
  @{
    File="Flutter-UI-Specialist.md"; Model="openai/gpt-5.4"; Temp=0.1; Steps=70; Perm=$subPermEditDart;
    Desc="Especialista Flutter UI: widgets, layouts, navegacion, estados visuales y validacion responsive.";
    Body="Eres Flutter-UI-Specialist. Lees archivos completos antes de editar. Para bugs repartidor usa `rutero_detail_modal.dart`, nunca `albaran_detail_page.dart`. Manejas loading/empty/error/data y validas con flutter analyze."
  },
  @{
    File="Flutter-Data-Specialist.md"; Model="openai/gpt-5.4"; Temp=0.1; Steps=70; Perm=$subPermEditDart;
    Desc="Especialista de datos Flutter: modelos, providers, repositorios, serializacion y errores de red.";
    Body="Eres Flutter-Data-Specialist. Antes de crear modelos/providers lees patrones existentes. Tras modificar modelos/providers ejecutas build_runner. Si toca DB2, consultas al DB2-AS400-Specialist."
  },
  @{
    File="Node-Express-Specialist.md"; Model="openai/gpt-5.4"; Temp=0.1; Steps=70; Perm=$subPermEditBackend;
    Desc="Especialista backend Node.js/Express de GMP. Implementa rutas, validacion, errores y logging estructurado.";
    Body="Eres Node-Express-Specialist. Backend real `/opt/gmp-api`, puerto `3197`, servidor `192.168.1.230`. Antes de tocar rutas consulta logs/Sentry si aplica. Cada endpoint nuevo valida entrada, maneja errores HTTP y tiene tests."
  },
  @{
    File="DB2-AS400-Specialist.md"; Model="openai/gpt-5.4"; Temp=0.0; Steps=50; Perm=$subPermRead;
    Desc="Especialista IBM DB2 for i / AS400. Verifica tablas y columnas reales antes de cualquier query.";
    Body="Eres DB2-AS400-Specialist. DB2 esta en `192.168.1.22`, DSN `GMP`, schemas `JAVIER` y `DSEDAC`. Antes de una query ejecutas verificacion conceptual con QSYS2.SYSTABLES y QSYS2.SYSCOLUMNS via MCP DB2. No inventas tablas. Usa binding, nunca concatenacion SQL."
  },
  @{
    File="DevOps-CICD-Specialist.md"; Model="openai/gpt-5.4"; Temp=0.1; Steps=60; Perm=$subPermOps;
    Desc="Especialista DevOps, SSH, PM2, GitHub Actions, worktrees, despliegues y rollback.";
    Body="Eres DevOps-CICD-Specialist. App server `192.168.1.230`, backend `/opt/gmp-api`, puerto `3197`, web Granja `/var/www/mari-pepa`. Deploy prod siempre requiere confirmacion. Lees workflows antes de cambiarlos."
  },
  @{
    File="Test-Writer.md"; Model="openai/gpt-5.4"; Temp=0.0; Steps=45; Perm=$subPermTests;
    Desc="Escritor de tests TDD. Crea tests antes de implementar en Tier 2/3 y no toca codigo de produccion.";
    Body="Eres Test-Writer. Solo escribes tests. Cubre happy path, error path y contratos de API cuando aplica. Si necesitas modificar produccion, devuelves failure."
  },
  @{
    File="Test-Specialist.md"; Model="openai/gpt-5.4"; Temp=0.0; Steps=55; Perm=$subPermTests;
    Desc="Especialista de verificacion. Ejecuta tests, analiza fallos y valida visualmente cambios UI.";
    Body="Eres Test-Specialist. Verificas, no implementas funcionalidad. Devuelves failing_tests, error_output y diff_context si algo falla. UI exige validacion en movil/tablet/desktop o equivalente Flutter documentado."
  },
  @{
    File="Security-Validator.md"; Model="openai/gpt-5.5"; Temp=0.0; Steps=45; Perm=$subPermRead;
    Desc="Auditor de seguridad OWASP, secretos, SQL injection, DB2 binding y dependencias.";
    Body="Eres Security-Validator. Bloqueas secretos, SQL concatenado, auth insegura y CVEs criticos en dependencias nuevas. Para DB2 revisas binding, schemas correctos y ausencia de credenciales hardcodeadas."
  },
  @{
    File="Performance-Analyst.md"; Model="openai/gpt-5.4"; Temp=0.0; Steps=40; Perm=$subPermRead;
    Desc="Analista de rendimiento de API, DB2, Flutter, bundle y queries.";
    Body="Eres Performance-Analyst. Thresholds: API simple <200ms, compleja <500ms, DB2 <500ms, Flutter frame <16ms. Si supera, devuelves failure/partial y causa medible."
  },
  @{
    File="Metrics-Observer.md"; Model="openai/gpt-5.4"; Temp=0.0; Steps=40; Perm=$subPermRead;
    Desc="Observador de Sentry, Prometheus, Redis/KPI, Grafana y metricas del sistema OpenCode.";
    Body="Eres Metrics-Observer. Consultas Sentry antes de cambios backend si esta autenticado. Lees Prometheus `/metrics`, Redis/KPI y `.opencode/metrics/current.prom`. Generas baseline y post-check."
  },
  @{
    File="Check-Reviewer.md"; Model="openai/gpt-5.5"; Temp=0.0; Steps=45; Perm=$subPermRead;
    Desc="Reviewer duro de riesgos. Evalua seguridad, tests, failure modes, efectos colaterales, rendimiento, deuda, breaking changes y reversibilidad.";
    Body="Eres Check-Reviewer. Entregas analisis en 8 puntos y marcas cada issue como bloqueante, advertencia o sugerencia. No editas codigo."
  },
  @{
    File="Simplify-Reviewer.md"; Model="openai/gpt-5.4"; Temp=0.1; Steps=35; Perm=$subPermRead;
    Desc="Reviewer de simplicidad. Detecta sobreingenieria, YAGNI, dependencias innecesarias y complejidad cognitiva.";
    Body="Eres Simplify-Reviewer. Buscas la solucion mas simple compatible con el codebase. No bloqueas por gusto: distingues bloqueante, advertencia y sugerencia."
  },
  @{
    File="Code-Reviewer.md"; Model="openai/gpt-5.4"; Temp=0.1; Steps=35; Perm=$subPermRead;
    Desc="Revisor final de calidad, naming, patrones, imports, documentacion y deuda tecnica.";
    Body="Eres Code-Reviewer. Haces revision final. Maximo dos rechazos por entregable; al tercero apruebas con advertencias documentadas si no hay riesgo bloqueante."
  },
  @{
    File="Release-Notifier.md"; Model="opencode-go/kimi-k2.6"; Temp=0.3; Steps=15; Perm=@"
  edit:
    `".opencode/telegram_pending.jsonl`": allow
    `".opencode/TEAM_TRACE.jsonl`": allow
    `"*`": deny
  bash: deny
  read: deny
  task: deny
"@;
    Desc="Notificador Telegram. Comunica inicio, aprobaciones, degradados, completado y fallos en lenguaje humano.";
    Body="Eres Release-Notifier. Enviar mensajes claros a Javier. Si Telegram falla, guardas en `.opencode/telegram_pending.jsonl`. No tocas codigo."
  }
)

foreach ($spec in $agentSpecs) {
  $content = (Agent-Frontmatter $spec.Desc "subagent" $spec.Model $spec.Temp $spec.Steps $spec.Perm) + "`n" + $spec.Body + "`n" + $commonPrompt
  Set-Note (Join-Path $agentsDir $spec.File) $content
}

# Custom tools. These are intentionally dependency-light and fail closed.
$toolFiles = @{
"state-manager.ts" = @'
import { z } from "zod"
import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

const StateSchema = z.object({
  operation: z.enum(["create", "update", "read", "complete", "list_active", "list_interrupted"]),
  task_id: z.string().optional(),
  project: z.string().default("gmp"),
  patch: z.record(z.any()).optional(),
})

const root = process.cwd()
const stateDir = path.join(root, ".opencode", "state")

async function writeAtomic(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8")
  await fs.rename(tmp, file)
}

async function readState(taskId: string) {
  try { return JSON.parse(await fs.readFile(path.join(stateDir, `${taskId}.json`), "utf8")) }
  catch { return null }
}

export default tool({
  description: "Gestiona StateGraph persistente por tarea.",
  args: StateSchema,
  async execute(args) {
    try {
      await fs.mkdir(stateDir, { recursive: true })
      if (args.operation === "list_active" || args.operation === "list_interrupted") {
        const files = (await fs.readdir(stateDir)).filter((f) => f.endsWith(".json"))
        const states = []
        for (const f of files) {
          const state = JSON.parse(await fs.readFile(path.join(stateDir, f), "utf8"))
          if (state.current_step !== "DELIVER") states.push(state)
        }
        return { success: true, states }
      }
      if (!args.task_id) return { success: false, error: "task_id requerido" }
      const file = path.join(stateDir, `${args.task_id}.json`)
      if (args.operation === "read") return { success: true, state: await readState(args.task_id) }
      if (args.operation === "create") {
        const now = new Date().toISOString()
        const state = {
          task_id: args.task_id,
          ts_created: now,
          ts_updated: now,
          current_step: "RECEIVE",
          tier: null,
          project: args.project,
          intention: {},
          plan: null,
          workstreams: [],
          file_locks: {},
          agents_active: [],
          approval_status: "not_required",
          snapshot_key: null,
          errors: [],
          rollback_triggered: false,
          context_compressed: false,
          metrics: { tokens_total: 0, ts_start: now, ts_end: null, agents_invoked: [] },
        }
        await writeAtomic(file, state)
        return { success: true, state }
      }
      const current = (await readState(args.task_id)) || {}
      const next = { ...current, ...(args.patch || {}), ts_updated: new Date().toISOString() }
      if (args.operation === "complete") {
        next.current_step = "DELIVER"
        next.metrics = { ...(next.metrics || {}), ts_end: new Date().toISOString() }
      }
      await writeAtomic(file, next)
      return { success: true, state: next }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
})
'@
"telegram-notify.ts" = @'
import { z } from "zod"
import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

export default tool({
  description: "Envia notificaciones Telegram o guarda fallback JSONL.",
  args: z.object({ project: z.string(), level: z.string(), message: z.string() }),
  async execute(args) {
    const token = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID
    const payload = { chat_id: chatId, text: `${args.level} ${args.project} - ${args.message}` }
    try {
      if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID no definidos")
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`)
      return { success: true }
    } catch (error) {
      const file = path.join(process.cwd(), ".opencode", "telegram_pending.jsonl")
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.appendFile(file, JSON.stringify({ ts: new Date().toISOString(), args, error: String(error) }) + "\n", "utf8")
      return { success: false, fallback: file, error: error instanceof Error ? error.message : String(error) }
    }
  },
})
'@
"project-context.ts" = @'
import { z } from "zod"
import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

export default tool({
  description: "Devuelve hechos operativos del proyecto y memoria basica.",
  args: z.object({ project: z.enum(["gmp", "granja"]).default("gmp") }),
  async execute(args) {
    try {
      const root = process.cwd()
      const factsPath = path.join(root, ".opencode", "memory", "project-facts.json")
      const facts = JSON.parse(await fs.readFile(factsPath, "utf8"))
      return { success: true, project: args.project, facts }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
})
'@
"memory-save.ts" = @'
import { z } from "zod"
import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

export default tool({
  description: "Guarda memoria externa estructurada en .opencode/memory.",
  args: z.object({
    kind: z.enum(["session", "correction", "lesson", "rlhf", "pattern"]),
    record: z.record(z.any()),
  }),
  async execute(args) {
    try {
      const dir = path.join(process.cwd(), ".opencode", "memory")
      await fs.mkdir(dir, { recursive: true })
      const file = args.kind === "session"
        ? path.join(dir, "sessions", `${new Date().toISOString().slice(0,10)}.jsonl`)
        : path.join(dir, `${args.kind === "rlhf" ? "rlhf-signals" : args.kind + "s"}.jsonl`)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.appendFile(file, JSON.stringify({ ts: new Date().toISOString(), ...args.record }) + "\n", "utf8")
      return { success: true, file }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
})
'@
"snapshot-create.ts" = @'
import { z } from "zod"
import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

export default tool({
  description: "Crea snapshot de archivos dentro del proyecto.",
  args: z.object({ task_id: z.string(), files: z.array(z.string()) }),
  async execute(args) {
    try {
      const root = process.cwd()
      const snapRoot = path.join(root, ".opencode", "snapshots", args.task_id)
      const copied: string[] = []
      for (const file of args.files) {
        const full = path.resolve(root, file)
        if (!full.startsWith(root)) return { success: false, error: `Ruta fuera del proyecto: ${file}` }
        const rel = path.relative(root, full)
        const dest = path.join(snapRoot, rel)
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.copyFile(full, dest)
        copied.push(rel)
      }
      return { success: true, snapshot: snapRoot, files: copied }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
})
'@
"snapshot-restore.ts" = @'
import { z } from "zod"
import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

export default tool({
  description: "Restaura archivos desde snapshot de tarea.",
  args: z.object({ task_id: z.string(), files: z.array(z.string()) }),
  async execute(args) {
    try {
      const root = process.cwd()
      const snapRoot = path.join(root, ".opencode", "snapshots", args.task_id)
      const restored: string[] = []
      for (const file of args.files) {
        const src = path.join(snapRoot, file)
        const dest = path.resolve(root, file)
        if (!dest.startsWith(root)) return { success: false, error: `Ruta fuera del proyecto: ${file}` }
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.copyFile(src, dest)
        restored.push(file)
      }
      return { success: true, restored }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
})
'@
"chroma-query.ts" = @'
import { z } from "zod"
import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

async function keywordFallback(query: string, topK: number) {
  const memDir = path.join(process.cwd(), ".opencode", "memory")
  const terms = query.toLowerCase().split(/\W+/).filter(Boolean)
  const files = await fs.readdir(memDir).catch(() => [])
  const results: any[] = []
  for (const file of files.filter((f) => /\.(md|jsonl|json)$/.test(f))) {
    const text = await fs.readFile(path.join(memDir, file), "utf8").catch(() => "")
    const score = terms.reduce((n, t) => n + (text.toLowerCase().includes(t) ? 1 : 0), 0) / Math.max(terms.length, 1)
    if (score > 0) results.push({ document: text.slice(0, 2000), metadata: { file }, score })
  }
  return results.sort((a, b) => b.score - a.score).slice(0, topK)
}

export default tool({
  description: "Consulta memoria semantica ChromaDB con fallback por keywords.",
  args: z.object({ query_text: z.string(), collections: z.array(z.string()).default(["gmp_sessions"]), top_k: z.number().default(5), min_score: z.number().default(0.7) }),
  async execute(args) {
    try {
      const heartbeat = await fetch("http://localhost:8000/api/v2/heartbeat", { signal: AbortSignal.timeout(2000) })
      if (!heartbeat.ok) throw new Error("ChromaDB heartbeat fallo")
      return { success: true, source: "chromadb", results: [], note: "ChromaDB disponible; query HTTP depende de version API instalada." }
    } catch {
      const results = await keywordFallback(args.query_text, args.top_k)
      return { success: true, source: "fallback", results: results.filter((r) => r.score >= Math.min(args.min_score, 0.2)) }
    }
  },
})
'@
"metrics-record.ts" = @'
import { z } from "zod"
import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

function labelString(labels: Record<string, string>) {
  const entries = Object.entries(labels || {})
  return entries.length ? `{${entries.map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(",")}}` : ""
}

export default tool({
  description: "Registra metricas Prometheus en .opencode/metrics/current.prom.",
  args: z.object({ metric_name: z.string(), value: z.number(), labels: z.record(z.string()).default({}), metric_type: z.enum(["counter", "gauge", "histogram"]).default("gauge") }),
  async execute(args) {
    try {
      const file = path.join(process.cwd(), ".opencode", "metrics", "current.prom")
      await fs.mkdir(path.dirname(file), { recursive: true })
      const line = `${args.metric_name}${labelString(args.labels)} ${args.value}\n`
      await fs.appendFile(file, line, "utf8")
      return { success: true, file }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },
})
'@
"debate-protocol.ts" = @'
import { z } from "zod"
import { tool } from "@opencode-ai/plugin"

const Issue = z.object({ issue: z.string(), severity: z.enum(["bloqueante", "advertencia", "sugerencia"]).default("advertencia") })

export default tool({
  description: "Resuelve debate estructurado entre Check-Reviewer y Simplify-Reviewer.",
  args: z.object({
    implementation_summary: z.string(),
    check_review_output: z.object({ issues: z.array(Issue).default([]) }).passthrough(),
    simplify_review_output: z.object({ issues: z.array(Issue).default([]) }).passthrough(),
  }),
  async execute(args) {
    const all = [...args.check_review_output.issues, ...args.simplify_review_output.issues]
    const blocking_issues = all.filter((i) => i.severity === "bloqueante")
    const warnings = all.filter((i) => i.severity === "advertencia")
    return { success: true, consensus: blocking_issues.length === 0, blocking_issues, warnings, resolution_needed: blocking_issues.length > 0 }
  },
})
'@
"sandbox-run.ts" = @'
import { z } from "zod"
import { tool } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"

const allowed = new Set(["node:20-alpine", "dart:stable", "grafana/k6:latest", "python:3.12-slim"])

export default tool({
  description: "Ejecuta comandos en Docker sandbox efimero con perfil seguro.",
  args: z.object({
    image: z.string(),
    command: z.array(z.string()),
    env_vars: z.record(z.string()).default({}),
    timeout_seconds: z.number().max(300).default(300),
  }),
  async execute(args) {
    if (!allowed.has(args.image)) return { success: false, error: `Imagen no permitida: ${args.image}` }
    return await new Promise((resolve) => {
      const dockerArgs = ["run", "--rm", "--network", "none", "--memory", "512m", "--cpus", "1", "--read-only", "--security-opt", "no-new-privileges", "--user", "1000:1000"]
      for (const [k, v] of Object.entries(args.env_vars)) dockerArgs.push("-e", `${k}=${v}`)
      dockerArgs.push(args.image, ...args.command)
      const child = spawn("docker", dockerArgs, { shell: false })
      let stdout = ""; let stderr = ""
      const timer = setTimeout(() => child.kill("SIGKILL"), args.timeout_seconds * 1000)
      child.stdout.on("data", (d) => stdout += d.toString())
      child.stderr.on("data", (d) => stderr += d.toString())
      child.on("error", (error) => { clearTimeout(timer); resolve({ success: false, error: error.message }) })
      child.on("close", (code) => { clearTimeout(timer); resolve({ success: code === 0, exit_code: code, stdout, stderr }) })
    })
  },
})
'@
}

foreach ($entry in $toolFiles.GetEnumerator()) {
  Write-Utf8NoBom (Join-Path $toolsDir $entry.Key) ($entry.Value.TrimEnd() + "`n")
}

$pluginFiles = @{
"env-protection.ts" = @'
export const EnvProtectionPlugin = async () => ({
  "tool.execute.before": async (input: any) => {
    const text = JSON.stringify(input || {})
    if (/\b(\.env|auth\.json|mcp-auth\.json|\.pem|\.key|\.p12)\b/i.test(text)) {
      throw new Error("ENV_PROTECTION_BLOCKED: lectura de secretos bloqueada")
    }
  },
})
export default EnvProtectionPlugin
'@
"context-compaction.ts" = @'
import fs from "node:fs/promises"
import path from "node:path"
export default async function ContextCompactionPlugin() {
  return {
    "context.compaction.before": async () => {
      const root = process.cwd()
      const files = ["project-state.md", "corrections.jsonl", "tools-manifest.json"]
      const memory: Record<string, string> = {}
      for (const f of files) memory[f] = await fs.readFile(path.join(root, ".opencode", "memory", f), "utf8").catch(() => "")
      return { inject: { core_memory: memory } }
    },
  }
}
'@
"task-tracer.ts" = @'
import fs from "node:fs/promises"
import path from "node:path"
async function append(event: any) {
  const file = path.join(process.cwd(), ".opencode", "TEAM_TRACE.jsonl")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n", "utf8")
}
export default async function TaskTracerPlugin() {
  return {
    "task.created": async (input: any) => append({ event: "task_created", detail: input }),
    "task.completed": async (input: any) => append({ event: "task_completed", detail: input }),
    "tool.error": async (input: any) => append({ event: "tool_error", detail: input }),
  }
}
'@
"anti-hallucination-guard.ts" = @'
export default async function AntiHallucinationGuardPlugin() {
  return {
    "tool.execute.before": async (input: any) => {
      const text = JSON.stringify(input || {})
      if (/192\.168\.(?!1\.(230|22|191)\b)\d+\.\d+/.test(text)) {
        throw new Error("S04_IP_NO_RECONOCIDA: verificar IP antes de escribir")
      }
      if (/(password=|token=|secret=|apikey=|bearer=|credentials=)/i.test(text)) {
        throw new Error("S01_SECRET_LITERAL: secreto literal bloqueado")
      }
    },
  }
}
'@
"rate-limit-handler.ts" = @'
export default async function RateLimitHandlerPlugin() {
  return {
    "tool.error": async (input: any) => {
      const text = JSON.stringify(input || {})
      if (/429|rate limit/i.test(text)) return { retry_after_seconds: 30, fallback_model: true }
      if (/timeout|503|500/i.test(text)) return { fallback_model: true }
    },
  }
}
'@
"anti-doom-loop.ts" = @'
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
const seen = new Map<string, string[]>()
export default async function AntiDoomLoopPlugin() {
  return {
    "tool.execute.after": async (input: any) => {
      const agent = input?.agent || input?.agent_context || "unknown"
      const raw = JSON.stringify({ tool: input?.tool, args: input?.args }).slice(0, 200)
      const hash = crypto.createHash("sha1").update(raw).digest("hex")
      const list = [...(seen.get(agent) || []), hash].slice(-5)
      seen.set(agent, list)
      if (list.slice(-3).length === 3 && list.slice(-3).every((x) => x === hash)) {
        const dir = path.join(process.cwd(), ".opencode", "doom-loops")
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(path.join(dir, `${Date.now()}-${agent}.json`), JSON.stringify({ agent, input }, null, 2), "utf8")
        throw new Error("DOOM_LOOP_DETECTED")
      }
    },
  }
}
'@
}
foreach ($entry in $pluginFiles.GetEnumerator()) {
  Write-Utf8NoBom (Join-Path $pluginsDir $entry.Key) ($entry.Value.TrimEnd() + "`n")
}

$commands = @{
"probe.md" = @"
---
description: Re-ejecuta probe de proveedores, MCPs y asignacion de tiers.
agent: GMP-Orchestrator
---

Ejecuta el protocolo `/probe`:
1. Lee `.opencode/probe-results.json`.
2. Verifica proveedores con `opencode models` y Cursor ACP `/v1/models`.
3. Actualiza modelos confirmados y tier_assignment.
4. Registra metricas `opencode_probe_latency_ms`.
5. Notifica un resumen unico por Telegram.
"@
"metrics.md" = @"
---
description: Muestra metricas de tokens, tareas, agentes, rollbacks y proveedores.
agent: GMP-Orchestrator
---

Lee `.opencode/metrics/current.prom`, `.opencode/TEAM_TRACE.jsonl` y `.opencode/tokens.jsonl`.
Devuelve tabla compacta con duracion por tier, tasa de exito, modelos usados, doom loops y rollbacks.
"@
"forget.md" = @"
---
description: Purga memoria persistente especifica con backup previo.
agent: Context-Manager
---

Args: session [ID] | lesson | correction | all.
Siempre crea backup en `.opencode/memory/deleted/`.
Para `all`, pide confirmacion explicita antes de borrar.
"@
"workflow.md" = @"
---
description: Explica el flujo operativo Tier 1/2/3 del equipo GMP.
agent: GMP-Orchestrator
---

Resume el StateGraph: RECEIVE, CLASSIFY, CONTEXT_LOAD, PLAN, APPROVE, SNAPSHOT, IMPLEMENT, VERIFY, REVIEW, DELIVER.
"@
"review.md" = @"
---
description: Ejecuta revision con Check-Reviewer, Simplify-Reviewer y Code-Reviewer.
agent: GMP-Orchestrator
---

Invoca reviewers con handoff estructurado. Si hay bloqueantes, no marques entrega como completada.
"@
"fix.md" = @"
---
description: Clasifica y corrige un bug siguiendo memoria, beads y verificaciones.
agent: GMP-Orchestrator
---

Carga contexto, busca issue beads relacionado, reproduce o localiza causa, delega al especialista correcto, verifica y entrega.
"@
"status.md" = @"
---
description: Estado actual de proveedores, MCPs, DB2, SSH, memoria, beads y tareas interrumpidas.
agent: Context-Manager
---

Lee probe-results, tools-manifest, state activo, memoria y beads. Devuelve estado ejecutivo.
"@
"diagnose.md" = @"
---
description: Diagnostico profundo de un modulo o fallo.
agent: GMP-Orchestrator
---

Usa Repo-Explorer, Metrics-Observer, Sentry si disponible, DB2 si aplica y DevOps para logs SSH.
"@
}
foreach ($entry in $commands.GetEnumerator()) {
  Write-Utf8NoBom (Join-Path $commandsDir $entry.Key) ($entry.Value.TrimEnd() + "`n")
}

# Metrics server.
$metricsServer = @'
const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")

const root = process.cwd()
const metricsFile = path.join(root, ".opencode", "metrics", "current.prom")
const ports = [9091, 9092, 9093]

function handler(req, res) {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end("ok\n")
    return
  }
  if (req.url === "/metrics") {
    fs.mkdirSync(path.dirname(metricsFile), { recursive: true })
    if (!fs.existsSync(metricsFile)) fs.writeFileSync(metricsFile, "# opencode metrics\n", "utf8")
    res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" })
    res.end(fs.readFileSync(metricsFile, "utf8"))
    return
  }
  res.writeHead(404)
  res.end("not found\n")
}

function listenNext(index) {
  if (index >= ports.length) process.exit(1)
  const server = http.createServer(handler)
  server.on("error", () => listenNext(index + 1))
  server.listen(ports[index], "0.0.0.0", () => {
    fs.writeFileSync(path.join(root, ".opencode", "metrics", "server-port.txt"), String(ports[index]), "utf8")
    console.log(`metrics server listening on ${ports[index]}`)
  })
}

listenNext(0)
'@
Write-Utf8NoBom (Join-Path $opencodeDir "metrics-server.js") ($metricsServer.TrimEnd() + "`n")
Write-Utf8NoBom (Join-Path $metricsDir "current.prom") "# opencode metrics`nopencode_system_ready 0`n"

# Monitoring files.
Write-Utf8NoBom (Join-Path $monitoringDir "docker-compose.yml") @'
services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - "./prometheus.yml:/etc/prometheus/prometheus.yml:ro"
      - "prometheus_data:/prometheus"
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.retention.time=30d"
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=opencode
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - "grafana_data:/var/lib/grafana"
      - "./grafana-dashboards:/etc/grafana/provisioning/dashboards"
volumes:
  prometheus_data:
  grafana_data:
'@
Write-Utf8NoBom (Join-Path $monitoringDir "prometheus.yml") @'
global:
  scrape_interval: 15s
scrape_configs:
  - job_name: opencode
    static_configs:
      - targets: ["host.docker.internal:9091"]
'@
Write-Utf8NoBom (Join-Path $monitoringDir "grafana-dashboards\opencode-dashboard.json") @'
{
  "title": "OpenCode GMP",
  "schemaVersion": 39,
  "panels": [
    {"type":"timeseries","title":"Tokens por sesion","targets":[{"expr":"opencode_tokens_total"}]},
    {"type":"timeseries","title":"Duracion de tareas","targets":[{"expr":"opencode_task_duration_seconds"}]},
    {"type":"timeseries","title":"Invocaciones por agente","targets":[{"expr":"opencode_agent_invocations_total"}]},
    {"type":"stat","title":"Proveedores activos","targets":[{"expr":"opencode_providers_available"}]},
    {"type":"timeseries","title":"Rollbacks","targets":[{"expr":"opencode_rollbacks_total"}]},
    {"type":"timeseries","title":"Latencia probe","targets":[{"expr":"opencode_probe_latency_ms"}]}
  ]
}
'@

# Probe results based on real opencode models observed in this session.
$probe = [ordered]@{
  ts = (Get-Date).ToUniversalTime().ToString("o")
  probe_version = "2.0"
  evidence = [ordered]@{
    source = "opencode models"
    opencode_version = "1.15.10"
    cursor_acp_http = "timeout on GET http://localhost:32124/v1/models, but opencode provider lists cursor-acp models"
  }
  providers = [ordered]@{
    "openai" = [ordered]@{
      status = "ok"
      models_confirmed = @("gpt-5.5","gpt-5.5-fast","gpt-5.5-pro","gpt-5.4","gpt-5.4-fast","gpt-5.4-mini","gpt-5.4-mini-fast","gpt-5.3-codex","gpt-5.2")
      models_failed = @()
    }
    "cursor-acp" = [ordered]@{
      status = "degraded_http_timeout"
      models_confirmed = @("claude-opus-4-7","gpt-5.5","composer-2.5","claude-sonnet-4-6")
      models_failed = @()
    }
    "opencode-go" = [ordered]@{
      status = "ok"
      models_confirmed = @("glm-5.1","kimi-k2.6","deepseek-v4-pro","deepseek-v4-flash","qwen3.7-max","minimax-m2.7")
      models_failed = @()
    }
  }
  tier_assignment = [ordered]@{
    tier_a_model = "openai/gpt-5.5"
    tier_b_model = "openai/gpt-5.4"
    tier_c_model = "opencode-go/glm-5.1"
    tier_a_fallback = @("cursor-acp/claude-opus-4-7","cursor-acp/gpt-5.5","cursor-acp/composer-2.5")
    tier_b_fallback = @("cursor-acp/composer-2.5","cursor-acp/claude-sonnet-4-6","opencode-go/kimi-k2.6")
    tier_c_fallback = @("opencode-go/kimi-k2.6","opencode-go/deepseek-v4-flash","openai/gpt-5.4-mini")
    note = "GMP-Orchestrator and Repo-Explorer use opencode-go/glm-5.1 because live Task delegation failed with kimi-k2.6 in prior verification."
  }
}
Save-JsonFile (Join-Path $opencodeDir "probe-results.json") $probe
Save-JsonFile (Join-Path $opencodeDir "fallback-models.json") $probe.tier_assignment

# Tools manifest: parse endpoints and workflows.
$manifest = @()
Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "backend\routes") -Filter "*.js" -ErrorAction SilentlyContinue | ForEach-Object {
  $content = Get-Content -LiteralPath $_.FullName -Raw
  $matches = [regex]::Matches($content, "router\.(get|post|put|delete|patch)\s*\(\s*['""]([^'""]+)['""]", "IgnoreCase")
  foreach ($m in $matches) {
    $manifest += [ordered]@{
      tool = "$($m.Groups[1].Value.ToUpper()) $($m.Groups[2].Value)"
      type = "endpoint"
      location = $_.FullName
      currently_configured = $true
      capabilities = @("backend route", "Express")
      should_be_assigned_to = @("Node-Express-Specialist","Security-Validator","Test-Writer")
      action_needed = "Mantener tests, validacion y contrato API"
    }
  }
}
Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "backend\scripts") -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
  $manifest += [ordered]@{
    tool = $_.Name
    type = "script"
    location = $_.FullName
    currently_configured = $true
    capabilities = @("maintenance script")
    should_be_assigned_to = @("DevOps-CICD-Specialist","Node-Express-Specialist")
    action_needed = "Leer antes de ejecutar; no asumir argumentos"
  }
}
Get-ChildItem -LiteralPath (Join-Path $ProjectRoot ".github\workflows") -File -ErrorAction SilentlyContinue | ForEach-Object {
  $manifest += [ordered]@{
    tool = $_.Name
    type = "ci"
    location = $_.FullName
    currently_configured = $true
    capabilities = @("GitHub Actions")
    should_be_assigned_to = @("DevOps-CICD-Specialist","Test-Specialist")
    action_needed = "Mantener /oc trigger y autoheal conectados"
  }
}
$manifest += [ordered]@{ tool="IBM DB2 MCP"; type="mcp"; location="192.168.1.22 DSN=GMP"; currently_configured=$true; capabilities=@("schema verification","SQL query"); should_be_assigned_to=@("DB2-AS400-Specialist"); action_needed="Verificar QSYS2 antes de queries" }
$manifest += [ordered]@{ tool="GMP SSH MCP"; type="mcp"; location="192.168.1.230 /opt/gmp-api"; currently_configured=$true; capabilities=@("logs","pm2","deploy"); should_be_assigned_to=@("DevOps-CICD-Specialist","Node-Express-Specialist","Metrics-Observer"); action_needed="Confirmacion para deploy" }
$manifest += [ordered]@{ tool="Telegram MCP"; type="mcp"; location="TELEGRAM_BOT_TOKEN/CHAT_ID"; currently_configured=$true; capabilities=@("notify","approval"); should_be_assigned_to=@("Release-Notifier","GMP-Orchestrator"); action_needed="Usar mensaje consolidado" }
$manifest += [ordered]@{ tool="ChromaDB"; type="service"; location="localhost:8000"; currently_configured=$false; capabilities=@("semantic memory"); should_be_assigned_to=@("Context-Manager"); action_needed="Instalar/arrancar ChromaDB; fallback keyword activo" }
$manifest += [ordered]@{ tool="Redis/Memurai"; type="service"; location="localhost:6379"; currently_configured=$false; capabilities=@("cache","rate limit"); should_be_assigned_to=@("Context-Manager","Metrics-Observer"); action_needed="Instalar Memurai o Docker Redis; fallback in-memory" }
Save-JsonFile (Join-Path $memoryDir "tools-manifest.json") $manifest 20

# Project opencode.json: preserve existing but force correct model and plugin/tool paths.
$projectConfigPath = Join-Path $ProjectRoot "opencode.json"
$projectConfig = Read-JsonFile $projectConfigPath
if ($null -eq $projectConfig) {
  $projectConfig = [ordered]@{ '$schema' = "https://opencode.ai/config.json" }
}
Set-JsonProperty $projectConfig "model" "opencode-go/glm-5.1"
Set-JsonProperty $projectConfig "default_agent" "GMP-Orchestrator"
if (-not ($projectConfig.PSObject.Properties.Name -contains "plugin")) { Set-JsonProperty $projectConfig "plugin" @() }
$pluginEntries = @(
  "./.opencode/plugins/env-protection.ts",
  "./.opencode/plugins/context-compaction.ts",
  "./.opencode/plugins/task-tracer.ts",
  "./.opencode/plugins/anti-hallucination-guard.ts",
  "./.opencode/plugins/rate-limit-handler.ts",
  "./.opencode/plugins/anti-doom-loop.ts"
)
$existingPlugins = @($projectConfig.plugin)
foreach ($p in $pluginEntries) {
  if ($existingPlugins -notcontains $p) { $existingPlugins += $p }
}
$projectConfig.plugin = $existingPlugins
if (-not ($projectConfig.PSObject.Properties.Name -contains "mcp")) { Set-JsonProperty $projectConfig "mcp" ([pscustomobject]@{}) }
foreach ($disabled in @("supabase","postgres")) {
  if ($projectConfig.mcp.PSObject.Properties.Name -contains $disabled) {
    $projectConfig.mcp.$disabled.enabled = $false
  }
}
Save-JsonFile $projectConfigPath $projectConfig

# OpenCode also loads .opencode/opencode.json in this repo. Keep it aligned with v2 facts.
$projectLocalConfigPath = Join-Path $opencodeDir "opencode.json"
if (Test-Path -LiteralPath $projectLocalConfigPath) {
  $projectLocalConfig = Read-JsonFile $projectLocalConfigPath
  if ($projectLocalConfig) {
    Set-JsonProperty $projectLocalConfig "model" "opencode-go/glm-5.1"
    Set-JsonProperty $projectLocalConfig "small_model" "opencode-go/kimi-k2.6"
    Set-JsonProperty $projectLocalConfig "default_agent" "GMP-Orchestrator"
    if ($projectLocalConfig.mcp) {
      foreach ($disabled in @("supabase","postgres")) {
        if ($projectLocalConfig.mcp.PSObject.Properties.Name -contains $disabled) {
          $projectLocalConfig.mcp.$disabled.enabled = $false
        }
      }
      foreach ($enabled in @("ibm-db2-mcp","gmp-deploy-ssh","telegram","beads","git","filesystem","claude-flow","guardvibe","playwright","context7")) {
        if ($projectLocalConfig.mcp.PSObject.Properties.Name -contains $enabled) {
          $projectLocalConfig.mcp.$enabled.enabled = $true
        }
      }
    }
    Save-JsonFile $projectLocalConfigPath $projectLocalConfig
  }
}

# Global config: preserve auth/providers, disable Supabase/Postgres MCP if present, set default model.
$globalConfigPath = Join-Path $GlobalConfigRoot "opencode.json"
if (Test-Path -LiteralPath $globalConfigPath) {
    $globalConfig = Read-JsonFile $globalConfigPath
  if ($globalConfig) {
    Set-JsonProperty $globalConfig "model" "opencode-go/glm-5.1"
    if ($globalConfig.mcp) {
      foreach ($disabled in @("supabase","postgres")) {
        if ($globalConfig.mcp.PSObject.Properties.Name -contains $disabled) {
          $globalConfig.mcp.$disabled.enabled = $false
        }
      }
    }
    Save-JsonFile $globalConfigPath $globalConfig
  }
}

# Startup script patch: split app server and DB2 server, add support-service checks, avoid color words in Telegram.
$startupPath = Join-Path $GlobalConfigRoot "tools\start-opencode-project.ps1"
if (Test-Path -LiteralPath $startupPath) {
  $startup = Get-Content -LiteralPath $startupPath -Raw
  $startup = $startup -replace "3335", "3197"
  $startup = $startup -replace "3334", "3197"
  $startup = $startup -replace 'DB2/AS400: 192\.168\.1\.230', 'DB2/AS400: 192.168.1.22'
  $startup = $startup -replace 'IBM_DB2_HOST\s+"192\.168\.1\.230"', 'IBM_DB2_HOST "192.168.1.22"'
  $startup = $startup -replace '\$ExpectedAgents = 14', '$ExpectedAgents = 19'
  $startup = $startup -replace 'ROJO', '🔴'
  $startup = $startup -replace 'NARANJA', '🟠'
  $startup = $startup -replace 'AZUL', '🔵'
  $startup = $startup -replace 'OK', '✅'
  if ($startup -notmatch 'GMP_DB2_HOST') {
    $envBlock = @'

  # v2 deterministic infrastructure facts
  [Environment]::SetEnvironmentVariable("GMP_APP_SERVER_HOST", "192.168.1.230", "Process")
  [Environment]::SetEnvironmentVariable("GMP_DB2_HOST", "192.168.1.22", "Process")
  [Environment]::SetEnvironmentVariable("IBM_DB2_HOST", "192.168.1.22", "Process")
  [Environment]::SetEnvironmentVariable("GMP_IMAGE_HOST", "192.168.1.191", "Process")
  [Environment]::SetEnvironmentVariable("GMP_BACKEND_PORT", "3197", "Process")
  [Environment]::SetEnvironmentVariable("ODBC_DSN", "GMP", "Process")
  [Environment]::SetEnvironmentVariable("ODBC_SCHEMA", "JAVIER", "Process")
'@
    $startup = $startup -replace '(\s+\[Environment\]::SetEnvironmentVariable\("OPENCODE_EXPERIMENTAL_LSP_TOOL", "true", "Process"\))', "`$1$envBlock"
  }
  if ($startup -notmatch 'Support services v2') {
    $support = @'

function Test-TcpPort {
  param([string]$HostName, [int]$Port)
  try {
    $client = New-Object Net.Sockets.TcpClient
    $iar = $client.BeginConnect($HostName, $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(1000, $false)
    if ($ok) { $client.EndConnect($iar) }
    $client.Close()
    return $ok
  } catch { return $false }
}

function Start-SupportServicesV2 {
  param([string]$ProjectRoot)
  $result = [ordered]@{
    chromadb = $false
    redis = $false
    metrics = $false
    docker = $false
  }
  try {
    $heartbeat = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:8000/api/v2/heartbeat" -TimeoutSec 2
    $result.chromadb = ($heartbeat.StatusCode -eq 200)
  } catch { $result.chromadb = $false }
  $result.redis = Test-TcpPort -HostName "localhost" -Port 6379
  try {
    $metricsHealth = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:9091/health" -TimeoutSec 1
    $result.metrics = ($metricsHealth.StatusCode -eq 200)
  } catch {
    $server = Join-Path $ProjectRoot ".opencode\metrics-server.js"
    if (Test-Path -LiteralPath $server) {
      Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "`"$server`"" -WorkingDirectory $ProjectRoot | Out-Null
      Start-Sleep -Seconds 1
      try {
        $metricsHealth = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:9091/health" -TimeoutSec 1
        $result.metrics = ($metricsHealth.StatusCode -eq 200)
      } catch { $result.metrics = $false }
    }
  }
  try {
    $docker = & docker info --format "{{.ServerVersion}}" 2>$null
    $result.docker = -not [string]::IsNullOrWhiteSpace($docker)
  } catch { $result.docker = $false }
  return $result
}
'@
    $startup = $startup -replace '(function Start-CursorAcpIfNeeded)', "$support`r`n`$1"
  }
  if ($startup -notmatch 'Start-SupportServicesV2 -ProjectRoot') {
    $startup = $startup -replace '(\s+Write-Host "\[9/12\].*?")', "`$1`r`n  `$supportServices = Start-SupportServicesV2 -ProjectRoot `$project.Root`r`n  Write-Host `"      ChromaDB: `$(`$supportServices.chromadb) Redis: `$(`$supportServices.redis) Metrics: `$(`$supportServices.metrics) Docker: `$(`$supportServices.docker)`""
  }
  Write-Utf8NoBom $startupPath $startup
}

# Public .cmd launchers, if present, should keep delegating to global project starter.
foreach ($cmd in @("$env:USERPROFILE\start-opencode-web-gmp.cmd", "$env:USERPROFILE\start-opencode-web-granja.cmd")) {
  if (Test-Path -LiteralPath $cmd) {
    $projectName = if ($cmd -match "granja") { "granja" } else { "gmp" }
    $cmdContent = @"
@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.config\opencode\tools\start-opencode-project.ps1" -Project $projectName
endlocal
"@
    Write-Utf8NoBom $cmd $cmdContent
  }
}

# Granja rules alignment if repo exists: DB2, no Supabase/Postgres.
if (Test-Path -LiteralPath $GranjaRoot) {
  $granjaOpenCode = Join-Path $GranjaRoot ".opencode"
  Ensure-Dir $granjaOpenCode
  $granjaAgentsMd = @"
# Granja Mari Pepa - Reglas del Equipo de Agentes

- Stack: Next.js App Router, TypeScript, Tailwind, shadcn/ui, Node.js.
- Base de datos real para este ecosistema: IBM DB2/AS400 en `192.168.1.22`, DSN `GMP`.
- Web remota: `/var/www/mari-pepa/` en servidor `192.168.1.230`.
- No introducir PostgreSQL ni Supabase en planes nuevos salvo orden explicita de Javier que cambie arquitectura.
- Reglas compartidas: leer antes de editar, snapshots, beads cuando aplique, tests antes de entregar, Telegram para aprobaciones.
"@
  Set-Note (Join-Path $granjaOpenCode "AGENTS.md") $granjaAgentsMd
}

Write-Host "OpenCode v2 system applied."
Write-Host "Agents:" (Get-ChildItem -LiteralPath $agentsDir -Filter "*.md").Count
Write-Host "Tools:" (Get-ChildItem -LiteralPath $toolsDir -Filter "*.ts").Count
Write-Host "Plugins:" (Get-ChildItem -LiteralPath $pluginsDir -Filter "*.ts").Count
Write-Host "Commands:" (Get-ChildItem -LiteralPath $commandsDir -Filter "*.md").Count
Write-Host "Rules:" $rules.Count
