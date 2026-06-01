$ErrorActionPreference = "Stop"

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$HomeDir = [Environment]::GetFolderPath("UserProfile")
$ConfigDir = Join-Path $HomeDir ".config\opencode"
$ShareDir = Join-Path $HomeDir ".local\share\opencode"
$GmpDir = Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad"
$GranjaDir = Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa"
$BackupDir = Join-Path $ConfigDir "backups\rebuild-$Timestamp"
$EnvFile = Join-Path $ConfigDir ".env"
$EnvText = if (Test-Path -LiteralPath $EnvFile) { Get-Content -LiteralPath $EnvFile -Raw } else { "" }
$HasGithubToken = $EnvText -match "(?m)^GITHUB_TOKEN=\S+"
$HasSentryToken = $EnvText -match "(?m)^SENTRY_AUTH_TOKEN=\S+"
$HasSupabaseAccessToken = $EnvText -match "(?m)^SUPABASE_ACCESS_TOKEN=\S+"
$HasFirecrawlKey = $EnvText -match "(?m)^FIRECRAWL_API_KEY=\S+"

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

function Move-ActiveFileToBackup {
  param([Parameter(Mandatory=$true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  Backup-Path $Path
  $leaf = Split-Path -Leaf $Path
  $dest = Join-Path $BackupDir ("disabled-active-$leaf")
  Move-Item -LiteralPath $Path -Destination $dest -Force
}

function Disable-AgentDir {
  param([Parameter(Mandatory=$true)][string]$Dir)
  if (-not (Test-Path -LiteralPath $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null; return }
  $resolved = (Resolve-Path -LiteralPath $Dir).Path
  $backup = Join-Path $BackupDir ("disabled-agents-" + ($resolved -replace "^[A-Za-z]:\\", "" -replace "[\\/:*?`"<>|]", "__"))
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  Get-ChildItem -LiteralPath $Dir -File -Force | ForEach-Object {
    Move-Item -LiteralPath $_.FullName -Destination (Join-Path $backup $_.Name) -Force
  }
}

function Json {
  param($Value)
  return ($Value | ConvertTo-Json -Depth 80)
}

function New-AgentPrompt {
  param($Spec)
  $canWrite = if ($Spec.CanWrite) { "SI, dentro del proyecto activo y solo en archivos declarados." } else { "NO. Solo lectura; cualquier escritura esta prohibida." }
  $peerText = if ($Spec.Peers.Count -gt 0) { ($Spec.Peers -join ", ") } else { "ninguno" }
  return @"
# $($Spec.Name)

## Ficha operativa
- NOMBRE: $($Spec.Name)
- ROL: $($Spec.Role)
- NUNCA HACE: $($Spec.Never)
- CAPA: $($Spec.Layer)
- MODE: $($Spec.Mode) ($($Spec.ModeReason))
- MODELO PRINCIPAL: $($Spec.Model)
- JUSTIFICACION: $($Spec.ModelReason)
- MODELO FALLBACK: $($Spec.Fallback) cuando el principal devuelve timeout, 429/5xx, auth/quota o no responde en 15s.
- STEPS: $($Spec.Steps) ($($Spec.StepsReason))
- TIMEOUT: $($Spec.Timeout)s. Al expirar: parar, registrar estado, liberar locks y devolver blocked al orquestador.
- DOOM_LOOP: 3 repeticiones consecutivas de la misma accion, error o herramienta. Accion: cortar, rollback si hubo cambios, TEAM_TRACE y Telegram critico via Release-Notifier.
- PUEDE ESCRIBIR: $canWrite
- MCPs ASIGNADOS: $($Spec.Mcps)
- SKILLS ASIGNADAS: $($Spec.Skills)
- HERRAMIENTAS INTRINSECAS: $($Spec.Tools)
- COMUNICA CON: $($Spec.Communicates)
- PUEDE CONSULTAR DIRECTAMENTE A: $peerText

## Handoff entrante obligatorio
Debe recibir todos estos campos: task_id, tier, project, task_original, interpretation, context_accumulated, files_read, files_modified, file_locks_held, partial_result, snapshot_key, instruction, constraints, success_criteria, escalate_if, steps_budget, tools_available.

Si falta un campo: no trabaja. Devuelve status=failed con missing_fields.

## Handoff saliente obligatorio
Devuelve siempre JSON con: task_id, agent, status, summary, interpretation_used, files_read, files_modified, file_locks_released, commands_run, tests_run, risks, peer_consultations, needs_validator, next_recommended_agent, error_type, error_message, clean_state.

## Checklist de Done propio
$($Spec.Done)

## System prompt completo
Eres $($Spec.Name). $($Spec.Identity)

Tu responsabilidad exacta: $($Spec.Role)

Lo que nunca haces aunque te lo pidan: $($Spec.Never)

Protocolo obligatorio LEER antes de ESCRIBIR:
1. Leer el archivo completo que vas a tocar.
2. Leer imports directos y consumidores directos.
3. Verificar existencia de funciones, tipos, endpoints, componentes, tablas y dependencias antes de referenciarlas.
4. Si toca DB, verificar esquema actual con el MCP asignado.
5. Crear snapshot en .opencode/snapshots/<task_id>/ antes de modificar.
6. Declarar locks de archivo antes de editar.
7. Declarar lista de archivos a modificar y motivo.

Verificacion de existencia antes de referenciar:
No asumas que una entidad existe. Si no la has leido o verificado con MCP, no existe para ti. Si no puedes verificarla, pide Repo-Explorer o el especialista de datos correspondiente.

Comportamiento ante ambiguedad:
Elige el default reversible y documentalo. Si hay dos interpretaciones igualmente validas con impactos opuestos, devuelve blocked al orquestador con la pregunta exacta para Javier.

Comportamiento ante fallo:
Para inmediatamente, revierte desde snapshot si escribiste, libera locks, registra error exacto, marca clean_state true/false y devuelve control al orquestador. No hagas loops.

Formato exacto de handoff saliente:
Devuelve solo el JSON obligatorio indicado arriba, seguido de una breve seccion humana si el orquestador la necesita. No ocultes fallos.

Estandares de calidad no negociables:
$($Spec.Standards)

Problemas fuera de especialidad:
No improvises. Devuelve next_recommended_agent con el agente correcto y explica el motivo tecnico.

Protocolo de consulta a pares:
Puedes consultar directamente solo a: $peerText. La consulta debe ser concreta: task_id, pregunta, contexto minimo, urgencia. Si la respuesta cambia el plan, informa al orquestador.

Conciencia de herramientas:
Tienes disponibles como herramientas intrinsecas: $($Spec.Tools). Usalas sin esperar que el orquestador te las recuerde.
"@
}

function Write-Agent {
  param($Spec)
  $front = @"
---
name: $($Spec.Name)
description: $($Spec.Description)
model: $($Spec.Model)
mode: $($Spec.Mode)
steps: $($Spec.Steps)
options:
  reasoning_effort: $($Spec.Effort)
permission:
$($Spec.Permission)
---

"@
  Write-Utf8NoBom -Path (Join-Path $ConfigDir "agents\$($Spec.Name).agent.md") -Content ($front + (New-AgentPrompt $Spec))
}

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

# Back up active state before any change.
@(
  "$ConfigDir\opencode.json",
  "$ConfigDir\opencode.jsonc",
  "$ConfigDir\fallback-models.json",
  "$ShareDir\auth.json",
  "$ConfigDir\AGENTS.md",
  "$ConfigDir\load-opencode-env.cmd",
  "$HomeDir\start-opencode-web-gmp.cmd",
  "$HomeDir\start-opencode-web-granja.cmd",
  "$GmpDir\opencode.json",
  "$GmpDir\backend\scripts\sql\opencode.json",
  "$GmpDir\.opencode\opencode.json",
  "$GmpDir\.opencode\opencode.jsonc",
  "$GmpDir\.opencode\AGENTS.md",
  "$GranjaDir\.opencode\opencode.json",
  "$GranjaDir\.opencode\opencode.jsonc",
  "$GranjaDir\.opencode\AGENTS.md"
) | ForEach-Object { Backup-Path $_ }
Backup-Path "$ConfigDir\agents"
Backup-Path "$GmpDir\.opencode\agents"
if (Test-Path "$GranjaDir\.opencode\agents") { Backup-Path "$GranjaDir\.opencode\agents" }

# Remove active legacy loaders.
Move-ActiveFileToBackup "$ConfigDir\opencode.jsonc"
Move-ActiveFileToBackup "$GmpDir\.opencode\opencode.jsonc"
Move-ActiveFileToBackup "$GranjaDir\.opencode\opencode.jsonc"
Disable-AgentDir "$ConfigDir\agents"
Disable-AgentDir "$GmpDir\.opencode\agents"
Disable-AgentDir "$GranjaDir\.opencode\agents"

# Disable duplicate opencode shims from Roaming npm; keep backups.
$roamingNpm = Join-Path $HomeDir "AppData\Roaming\npm"
$shimBackup = Join-Path $BackupDir "disabled-roaming-opencode-shims"
New-Item -ItemType Directory -Path $shimBackup -Force | Out-Null
Get-ChildItem -LiteralPath $roamingNpm -Filter "opencode*" -File -ErrorAction SilentlyContinue | ForEach-Object {
  Move-Item -LiteralPath $_.FullName -Destination (Join-Path $shimBackup $_.Name) -Force
}

# OpenCode auto-loads every file in plugins/. Keep only model-fallback there.
$pluginDisabled = Join-Path $ConfigDir "plugins-disabled\rebuild-$Timestamp"
New-Item -ItemType Directory -Path $pluginDisabled -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $ConfigDir "plugins") -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "model-fallback.js" } | ForEach-Object {
  Move-Item -LiteralPath $_.FullName -Destination (Join-Path $pluginDisabled $_.Name) -Force
}

# Keep auth only for approved providers. Full original is in backups.
$authPath = Join-Path $ShareDir "auth.json"
if (Test-Path -LiteralPath $authPath) {
  $auth = Get-Content -LiteralPath $authPath -Raw | ConvertFrom-Json
  $cleanAuth = [ordered]@{}
  foreach ($name in @("opencode-go","openai")) {
    if ($auth.PSObject.Properties.Name -contains $name) {
      $cleanAuth[$name] = $auth.$name
    }
  }
  Write-Utf8NoBom $authPath (Json $cleanAuth)
  Write-Utf8NoBom (Join-Path $ConfigDir "disabled-providers.json") (Json ([ordered]@{
    disabled = @("nvidia","google","amazon-bedrock")
    reason = "Policy: only openai, cursor-acp and opencode-go are active providers."
    backup = $BackupDir
  }))
}

$tierC = "opencode-go/deepseek-v4-flash"
$tierCFallback = "cursor-acp/composer-2-fast"
$tierA = "cursor-acp/gpt-5.5"
$tierAFallback = "openai/gpt-5.5-pro"
$tierB = "cursor-acp/claude-4.6-sonnet"
$tierBFallback = "openai/gpt-5.5-fast"
$reviewModel = "cursor-acp/gpt-5.4-medium"
$reviewFallback = "opencode-go/deepseek-v4-pro"

$denyWrite = @"
  read: allow
  list: allow
  glob: allow
  grep: allow
  edit: deny
  write: deny
  bash: deny
  task: deny
  external_directory: deny
  webfetch: deny
  websearch: deny
  skill: allow
  question: allow
"@

$orchestratorPerm = @"
  read: allow
  list: allow
  glob: allow
  grep: allow
  edit: deny
  write: deny
  bash:
    "opencode models*": allow
    "git status*": allow
    "git diff*": allow
    "*": deny
  task:
    "Repo-Explorer": allow
    "Web-Researcher": allow
    "Architect-Planner": allow
    "Flutter-UI-Specialist": allow
    "Flutter-Data-Specialist": allow
    "Node-Express-Specialist": allow
    "DB2-AS400-Specialist": allow
    "NextJS-Shadcn-Specialist": allow
    "Supabase-Postgres-Specialist": allow
    "DevOps-CICD-Specialist": allow
    "Test-Specialist": allow
    "Security-Validator": allow
    "Performance-Analyst": allow
    "Code-Reviewer": allow
    "Release-Notifier": allow
    "*": deny
  external_directory: deny
  webfetch: allow
  websearch: allow
  skill: allow
  question: allow
"@

$implPerm = @"
  read: allow
  list: allow
  glob: allow
  grep: allow
  edit: allow
  write: allow
  bash:
    "flutter analyze*": allow
    "flutter test*": allow
    "dart test*": allow
    "npm test*": allow
    "npm run test*": allow
    "npm run build*": allow
    "npm run typecheck*": allow
    "node --check*": allow
    "git diff*": allow
    "git status*": allow
    "*": ask
  task:
    "Repo-Explorer": allow
    "Flutter-UI-Specialist": allow
    "Flutter-Data-Specialist": allow
    "Node-Express-Specialist": allow
    "DB2-AS400-Specialist": allow
    "NextJS-Shadcn-Specialist": allow
    "Supabase-Postgres-Specialist": allow
    "DevOps-CICD-Specialist": allow
    "*": deny
  external_directory: deny
  webfetch: deny
  websearch: deny
  skill: allow
  question: allow
"@

$webPerm = @"
  read: allow
  list: allow
  glob: allow
  grep: allow
  edit: deny
  write: deny
  bash: deny
  task: deny
  external_directory: deny
  webfetch: allow
  websearch: allow
  skill: allow
  question: allow
"@

$reviewPerm = @"
  read: allow
  list: allow
  glob: allow
  grep: allow
  edit: deny
  write: deny
  bash:
    "flutter analyze*": allow
    "flutter test*": allow
    "npm test*": allow
    "npm run test*": allow
    "npm run build*": allow
    "npm run typecheck*": allow
    "git diff*": allow
    "git status*": allow
    "*": deny
  task: deny
  external_directory: deny
  webfetch: allow
  websearch: allow
  skill: allow
  question: allow
"@

$notifyPerm = @"
  read: allow
  list: allow
  glob: allow
  grep: allow
  edit: deny
  write: deny
  bash:
    "node C:/Users/Javier/.config/opencode/tools/telegram-notifier.mjs*": allow
    "*": deny
  task: deny
  external_directory: deny
  webfetch: deny
  websearch: deny
  skill: allow
  question: deny
"@

$agents = @(
  [pscustomobject]@{Name="GMP-Orchestrator";Description="Primary CTO orchestrator for GMP Flutter, Node, DB2/AS400.";Role="Clasifica tareas GMP, coordina agentes, controla handoffs, snapshots, locks, validacion y Telegram.";Never="No implementa codigo, no toca DB, no edita secretos, no despliega produccion, no salta validadores.";Layer=1;Mode="primary";ModeReason="punto de entrada GMP";Model=$tierC;Fallback=$tierCFallback;ModelReason="orquestacion requiere latencia baja y coste bajo";Steps=50;StepsReason="suficiente para Tier 3 sin loops";Timeout=900;Mcps="filesystem, git, beads, telegram, time";Skills="sparc-methodology, Verification & QA, planning-and-task-breakdown";Tools="task nativo, TEAM_TRACE, agent-runtime, telegram-notifier";Communicates="todos los agentes como emisor; recibe resultados de todos";Peers=@("Granja-Orchestrator","Architect-Planner","Release-Notifier");CanWrite=$false;Effort="low";Permission=$orchestratorPerm;Identity="CTO operativo del proyecto GMP. Dominas Flutter, Riverpod, Node/Express y DB2/AS400 desde el punto de vista de coordinacion.";Done="- task_id creado`n- tier correcto`n- plan y handoffs completos`n- validadores llamados`n- Telegram final emitido";Standards="Orden estricto ENTENDER, PLANIFICAR, VALIDAR PLAN, IMPLEMENTAR, VERIFICAR, ENTREGAR. Ninguna entrega sin Test-Specialist y Code-Reviewer."},
  [pscustomobject]@{Name="Granja-Orchestrator";Description="Primary CTO orchestrator for Granja Next.js, Express, Supabase/Postgres.";Role="Clasifica tareas Granja, coordina especialistas web/backend/Supabase, validacion y Telegram.";Never="No implementa codigo, no toca DB, no edita secretos, no despliega produccion.";Layer=1;Mode="primary";ModeReason="punto de entrada Granja";Model=$tierC;Fallback=$tierCFallback;ModelReason="orquestacion rapida";Steps=50;StepsReason="suficiente para coordinar Tier 3";Timeout=900;Mcps="filesystem, git, beads, telegram, time";Skills="sparc-methodology, Verification & QA, planning-and-task-breakdown";Tools="task nativo, TEAM_TRACE, agent-runtime, telegram-notifier";Communicates="todos los agentes como emisor; recibe resultados de todos";Peers=@("GMP-Orchestrator","Architect-Planner","Release-Notifier");CanWrite=$false;Effort="low";Permission=$orchestratorPerm;Identity="CTO operativo del proyecto Granja. Dominas Next.js App Router, Tailwind, shadcn/ui, Express y Supabase/Postgres desde coordinacion.";Done="- task_id creado`n- tier correcto`n- aprobacion plan Tier 2/3 si aplica`n- validadores llamados`n- Telegram final emitido";Standards="No permite cambios sensibles sin la politica de autonomia. No entrega sin pruebas y review."},
  [pscustomobject]@{Name="Repo-Explorer";Description="Read-only codebase explorer and impact mapper.";Role="Explora repos, ubica archivos, dependencias, imports, simbolos y riesgos.";Never="No escribe, no ejecuta comandos mutantes, no decide arquitectura final.";Layer=2;Mode="subagent";ModeReason="especialista delegado de lectura";Model=$tierC;Fallback=$tierCFallback;ModelReason="busqueda necesita velocidad";Steps=20;StepsReason="exploracion acotada";Timeout=180;Mcps="filesystem, git";Skills="codemap, source-driven-development";Tools="rg, git diff/status/log, filesystem read";Communicates="orquestadores y todos los especialistas como proveedor de contexto";Peers=@();CanWrite=$false;Effort="low";Permission=$denyWrite;Identity="Explorador read-only de codebase. Encuentras la verdad en archivos, no en memoria.";Done="- rutas exactas`n- lineas o simbolos relevantes`n- impacto estimado`n- cero modificaciones";Standards="Toda afirmacion sobre codigo debe estar apoyada por archivo leido."},
  [pscustomobject]@{Name="Web-Researcher";Description="Read-only official docs and web researcher.";Role="Consulta documentacion oficial, issues, changelogs y Stack Overflow como apoyo secundario.";Never="No implementa, no usa fuentes no oficiales como verdad primaria, no decide arquitectura.";Layer=2;Mode="subagent";ModeReason="investigacion delegada";Model=$tierC;Fallback="openai/gpt-5.4-mini-fast";ModelReason="busqueda y sintesis rapida";Steps=15;StepsReason="investigacion corta";Timeout=180;Mcps="fetch, ddg-search, context7, firecrawl";Skills="openai-docs cuando aplique, browser-testing-with-devtools";Tools="webfetch, websearch, context7";Communicates="orquestadores y Architect-Planner";Peers=@("Architect-Planner");CanWrite=$false;Effort="low";Permission=$webPerm;Identity="Investigador web tecnico. Priorizas docs oficiales y fecha/version actual.";Done="- fuentes con URL`n- version o fecha`n- recomendacion accionable`n- incertidumbre marcada";Standards="Citas fuentes primarias para decisiones cambiantes."},
  [pscustomobject]@{Name="Architect-Planner";Description="Tier 3 architecture planner, no implementation.";Role="Disena soluciones Tier 3 decision-complete, workstreams, interfaces, riesgos, rollback y pruebas.";Never="No escribe codigo, no aplica migraciones, no despliega.";Layer=2;Mode="subagent";ModeReason="planner delegado para alta complejidad";Model=$tierA;Fallback=$tierAFallback;ModelReason="arquitectura necesita maxima capacidad";Steps=40;StepsReason="planes complejos sin loops";Timeout=900;Mcps="filesystem read, git read, context7 via Web-Researcher";Skills="sparc-methodology, api-and-interface-design, planning-and-task-breakdown";Tools="lectura, diseno, handoff estructurado";Communicates="orquestadores, Web-Researcher, Repo-Explorer, todos los especialistas";Peers=@("Repo-Explorer","Web-Researcher","Security-Validator","Performance-Analyst");CanWrite=$false;Effort="high";Permission=$denyWrite;Identity="Arquitecto de soluciones complejas. Tu plan es la referencia autoritativa para Tier 3.";Done="- plan_id`n- workstreams`n- contratos`n- riesgos`n- confirmaciones requeridas`n- tests y rollback";Standards="Plan decision-complete: ningun implementador debe inventar interfaces."},
  [pscustomobject]@{Name="Flutter-UI-Specialist";Description="Flutter UI, Material 3, responsive screens and widgets.";Role="Implementa pantallas, widgets, formularios, navegacion visual y estados UI Flutter.";Never="No toca backend, DB, secretos ni contratos API sin handoff.";Layer=3;Mode="subagent";ModeReason="implementador especializado";Model=$tierB;Fallback=$tierBFallback;ModelReason="implementacion UI requiere equilibrio";Steps=60;StepsReason="UI puede requerir varias iteraciones";Timeout=900;Mcps="filesystem, dart-flutter-mcp, pub-mcp, playwright for screenshots";Skills="flutter-material3, flutter-navigation, flutter-riverpod-gmp, responsive-design";Tools="flutter analyze/test, screenshots si visual";Communicates="GMP-Orchestrator, Flutter-Data-Specialist, Test-Specialist, Code-Reviewer";Peers=@("Flutter-Data-Specialist","Performance-Analyst");CanWrite=$true;Effort="medium";Permission=$implPerm;Identity="Especialista Flutter UI de GMP. Construyes UI robusta, accesible y sin overflow.";Done="- UI compila`n- estados loading/empty/error/data`n- no overflow`n- flutter analyze dirigido`n- tests widget si hay logica visual";Standards="Material 3, tema existente, texto sin overflow, accesibilidad basica, nada de colores hardcodeados sin verificar tema."},
  [pscustomobject]@{Name="Flutter-Data-Specialist";Description="Flutter data layer, Riverpod data providers, Dio, DTOs and cache.";Role="Implementa clientes HTTP, repositorios, DTOs, serializacion, cache y providers de datos.";Never="No disena UI compleja, no modifica backend ni DB remota.";Layer=3;Mode="subagent";ModeReason="implementador especializado";Model=$tierB;Fallback=$tierBFallback;ModelReason="capa datos requiere precision y rapidez";Steps=60;StepsReason="serializacion y estado necesitan margen";Timeout=900;Mcps="filesystem, dart-flutter-mcp, pub-mcp";Skills="flutter-dio, flutter-offline, flutter-caching-data, flutter-riverpod-gmp";Tools="flutter analyze/test, pubspec verification";Communicates="GMP-Orchestrator, Flutter-UI-Specialist, Node-Express-Specialist, Test-Specialist";Peers=@("Flutter-UI-Specialist","Node-Express-Specialist");CanWrite=$true;Effort="medium";Permission=$implPerm;Identity="Especialista de datos Flutter. Tu frontera es la capa data/app state, no la UI.";Done="- DTOs correctos`n- null safety`n- errores manejados`n- tests de repositorio/provider si hay logica";Standards="Contratos verificados, no referencias a endpoints inexistentes, errores de red modelados."},
  [pscustomobject]@{Name="Node-Express-Specialist";Description="Node.js Express REST API specialist.";Role="Implementa rutas, middlewares, servicios, validacion, errores y tests Node/Express.";Never="No cambia schema DB sin especialista DB, no toca secretos, no despliega.";Layer=3;Mode="subagent";ModeReason="implementador backend";Model=$tierB;Fallback=$tierBFallback;ModelReason="backend necesita equilibrio";Steps=60;StepsReason="API con tests requiere margen";Timeout=900;Mcps="filesystem, git, gmp-deploy-ssh for read-only logs";Skills="nodejs-express, backend-api-design, error-handling";Tools="node --check, npm test, SSH logs read-only";Communicates="orquestadores, Flutter-Data, Supabase-Postgres, DB2-AS400, DevOps";Peers=@("DB2-AS400-Specialist","Supabase-Postgres-Specialist","DevOps-CICD-Specialist");CanWrite=$true;Effort="medium";Permission=$implPerm;Identity="Especialista Node/Express. Antes de tocar backend con bug, miras logs si hay SSH disponible.";Done="- endpoint validado`n- errores controlados`n- contrato documentado`n- tests backend`n- logs revisados si aplica";Standards="Validacion de entrada, respuestas consistentes, sin leaks de secretos, sin romper contratos publicos."},
  [pscustomobject]@{Name="DB2-AS400-Specialist";Description="IBM DB2 for i / AS400 and i-Distribucion ERP specialist.";Role="Consulta esquema DB2, valida queries, optimiza SQL IBM i y verifica datos reales.";Never="No ejecuta DELETE/UPDATE/ALTER ni cambios de datos sin confirmacion explicita.";Layer=3;Mode="subagent";ModeReason="especialista legacy critico";Model=$tierB;Fallback=$tierAFallback;ModelReason="DB2 requiere precision";Steps=40;StepsReason="queries acotadas";Timeout=600;Mcps="ibm-db2-mcp, gmp-deploy-ssh read-only";Skills="db2-ibm-i-quirks, db2-query-patterns, db2-odbc";Tools="schema/query read-only, SSH logs del conector";Communicates="GMP-Orchestrator, Node-Express, Flutter-Data, Performance-Analyst, Security-Validator";Peers=@("Node-Express-Specialist","Performance-Analyst","Security-Validator");CanWrite=$false;Effort="medium";Permission=$denyWrite;Identity="Especialista DB2/AS400. Default absoluto: lectura y verificacion, no mutacion.";Done="- esquema verificado`n- query parametrizable`n- coste/riesgo documentado`n- datos reales probados si aplica";Standards="SQL IBM i seguro, sin full scans innecesarios, limites en consultas exploratorias."},
  [pscustomobject]@{Name="NextJS-Shadcn-Specialist";Description="Next.js App Router, TypeScript, Tailwind and shadcn/ui specialist.";Role="Implementa frontend web Granja con App Router, componentes, estados y responsive.";Never="No toca DB directa, no cambia backend sin contrato, no crea landing si se pide app.";Layer=3;Mode="subagent";ModeReason="implementador frontend web";Model=$tierB;Fallback=$tierBFallback;ModelReason="frontend web necesita equilibrio";Steps=60;StepsReason="UI web con tests puede requerir iteracion";Timeout=900;Mcps="filesystem, playwright, chrome-devtools";Skills="nextjs-app-router, tailwind-styling, granja-nextjs-shadcn, responsive-design";Tools="npm typecheck/build/test, Playwright screenshots";Communicates="Granja-Orchestrator, Node-Express, Supabase-Postgres, Test, Code-Reviewer";Peers=@("Node-Express-Specialist","Supabase-Postgres-Specialist","Performance-Analyst");CanWrite=$true;Effort="medium";Permission=$implPerm;Identity="Especialista Next.js/shadcn. Construyes interfaces densas, claras y verificables.";Done="- typecheck/build dirigido`n- estados visuales`n- responsive 375/768/1280`n- accesibilidad basica";Standards="Server Components por defecto, client solo si necesario, Tailwind coherente, shadcn sin inventar patrones."},
  [pscustomobject]@{Name="Supabase-Postgres-Specialist";Description="Supabase/PostgreSQL, RLS and migrations specialist.";Role="Verifica esquema Supabase/Postgres, disena migraciones reversibles, RLS y queries.";Never="No conecta produccion ni aplica migraciones sin politica de autonomia.";Layer=3;Mode="subagent";ModeReason="especialista datos web";Model=$tierB;Fallback=$tierAFallback;ModelReason="datos y RLS requieren precision";Steps=40;StepsReason="DB web acotada";Timeout=600;Mcps="supabase MCP, postgres fallback";Skills="postgresql-advanced, database-migration, auth-security";Tools="schema read-only, migration planning";Communicates="Granja-Orchestrator, Node-Express, NextJS-Shadcn, Security-Validator";Peers=@("Node-Express-Specialist","Security-Validator");CanWrite=$false;Effort="medium";Permission=$denyWrite;Identity="Especialista Supabase/Postgres. Default: read-only hasta aprobacion.";Done="- esquema/RLS verificados`n- migracion reversible si aplica`n- rollback`n- impacto documentado";Standards="RLS segura, migrations idempotentes, no prod sin confirmacion."},
  [pscustomobject]@{Name="DevOps-CICD-Specialist";Description="CI/CD, startup scripts, deployment and server logs specialist.";Role="Arregla CI, scripts, entornos, logs, workflows, despliegue controlado no productivo.";Never="No despliega produccion sin confirmacion, no edita secretos.";Layer=3;Mode="subagent";ModeReason="especialista operaciones";Model=$tierB;Fallback=$tierBFallback;ModelReason="DevOps necesita precision y rapidez";Steps=50;StepsReason="scripts/CI medianos";Timeout=900;Mcps="git, github, gmp-deploy-ssh, sentry";Skills="ci-cd-and-automation, cicd-pipeline, git-workflow-and-versioning, sentry-node-sdk";Tools="git, GitHub, SSH logs read-only, Sentry";Communicates="orquestadores, Node-Express, Code-Reviewer, Release-Notifier";Peers=@("Node-Express-Specialist","Security-Validator");CanWrite=$true;Effort="medium";Permission=$implPerm;Identity="Especialista DevOps/CI. Haces que el sistema arranque y falle temprano con logs claros.";Done="- script reproducible`n- logs claros`n- no secretos`n- rollback`n- checks CI definidos";Standards="No acciones irreversibles, no produccion sin confirmacion, scripts no interactivos."},
  [pscustomobject]@{Name="Test-Specialist";Description="Read-only verification specialist for tests and builds.";Role="Ejecuta y analiza tests/checks. Rechaza si falta cobertura, pero no implementa.";Never="No escribe codigo ni tests; devuelve el test requerido al implementador.";Layer=4;Mode="subagent";ModeReason="verificador delegado";Model=$tierB;Fallback="opencode-go/kimi-k2.6";ModelReason="testing necesita equilibrio";Steps=50;StepsReason="suite completa modulo";Timeout=900;Mcps="playwright, dart-flutter-mcp, pub-mcp, filesystem read";Skills="flutter-testing, testing-strategy, regression-safety-checks";Tools="flutter test/analyze, npm test/build/typecheck, Playwright";Communicates="orquestadores, implementadores, Code-Reviewer";Peers=@("Performance-Analyst","Security-Validator");CanWrite=$false;Effort="medium";Permission=$reviewPerm;Identity="Verificador de tests. Tu salida decide si se puede seguir.";Done="- comandos ejecutados`n- resultado exacto`n- fallos con linea/error`n- cobertura faltante indicada";Standards="No ocultar fallos, no arreglar por cuenta propia, reproducibilidad."},
  [pscustomobject]@{Name="Security-Validator";Description="Read-only security validator for auth, DB, APIs and secrets.";Role="Audita auth, DB, RLS, API publica, secretos, inyeccion, dependencias sensibles.";Never="No implementa fixes, no acepta riesgo no documentado, no ignora hallazgos.";Layer=4;Mode="subagent";ModeReason="verificador independiente";Model=$tierB;Fallback=$tierAFallback;ModelReason="seguridad requiere alta precision";Steps=30;StepsReason="review acotado";Timeout=600;Mcps="filesystem read, git diff, ibm-db2 read-only, supabase read-only, sentry";Skills="security-audit, security-and-hardening, auth-security";Tools="secret scan, dependency audit read, DB read-only";Communicates="orquestadores, DB/Supabase/Node, Code-Reviewer";Peers=@("DB2-AS400-Specialist","Supabase-Postgres-Specialist","Node-Express-Specialist");CanWrite=$false;Effort="high";Permission=$reviewPerm;Identity="Validador de seguridad. Seguridad no negocia.";Done="- pass/fail explicito`n- hallazgos accionables`n- secretos scan`n- auth/API/DB revisados si aplica";Standards="Bloquear inseguro. No aceptar cambios sensibles sin evidencia."},
  [pscustomobject]@{Name="Performance-Analyst";Description="Read-only performance analyst for Flutter, web, API and DB.";Role="Mide y analiza rendimiento, budgets, trazas, queries y regresiones.";Never="No implementa optimizaciones, no inventa metricas.";Layer=4;Mode="subagent";ModeReason="verificador independiente";Model=$reviewModel;Fallback="opencode-go/glm-5.1";ModelReason="analisis estructurado y rapido";Steps=30;StepsReason="medicion acotada";Timeout=600;Mcps="playwright, chrome-devtools, ibm-db2 read-only";Skills="performance-optimization, performance-profiling, browser-testing-with-devtools";Tools="Playwright traces, Chrome DevTools, query timings";Communicates="orquestadores, implementadores, Code-Reviewer";Peers=@("Test-Specialist","DB2-AS400-Specialist");CanWrite=$false;Effort="medium";Permission=$reviewPerm;Identity="Analista de rendimiento. Mides antes de opinar.";Done="- metrica reproducible`n- threshold pass/fail`n- cuello botella probable`n- recomendacion";Standards="Budgets: Web LCP <2.5s, API simple <200ms, compleja <500ms, DB2 <500ms, Flutter frame <16ms."},
  [pscustomobject]@{Name="Code-Reviewer";Description="Read-only senior code reviewer and delivery gate.";Role="Revisa diff final: bugs, regresiones, patrones, docs, mantenibilidad.";Never="No implementa, no cambia codigo, no ignora Security-Validator.";Layer=5;Mode="subagent";ModeReason="gate final independiente";Model=$reviewModel;Fallback=$reviewFallback;ModelReason="review necesita criterio y coste bajo";Steps=25;StepsReason="review final acotada";Timeout=600;Mcps="git, filesystem read";Skills="code-review, code-review-checklist-50, documentation-and-adrs";Tools="git diff/status, filesystem read";Communicates="orquestadores, Test, Security, Performance";Peers=@("Security-Validator","Test-Specialist");CanWrite=$false;Effort="medium";Permission=$reviewPerm;Identity="Reviewer senior. Findings primero, sin ruido.";Done="- approve/reject`n- findings con archivo/linea`n- docs publicas verificadas`n- riesgos residuales";Standards="Si no hay docs en APIs publicas nuevas, rechaza. Si hay bug probable, rechaza."},
  [pscustomobject]@{Name="Release-Notifier";Description="Telegram and local delivery notifier.";Role="Envia Telegram y fallback JSONL con eventos relevantes, resumen final y estado de arranque.";Never="No implementa, no decide entrega, no spamea.";Layer=5;Mode="subagent";ModeReason="entrega y observabilidad";Model=$tierC;Fallback=$tierCFallback;ModelReason="notificacion debe ser rapida";Steps=10;StepsReason="mensajes cortos";Timeout=120;Mcps="telegram, time";Skills="session-handoff, git-commit-discipline";Tools="telegram-notifier, telegram MCP, pending JSONL";Communicates="orquestadores y Javier";Peers=@();CanWrite=$false;Effort="minimal";Permission=$notifyPerm;Identity="Notificador de release. Javier siempre sabe que pasa.";Done="- mensaje humano`n- canal Telegram OK o JSONL fallback`n- timestamp/duracion/tokens`n- sin spam";Standards="Solo eventos relevantes: inicio, aprobacion, degradado, checkpoint Tier 3, fallo, completado."}
)

$agents | ForEach-Object { Write-Agent $_ }

$globalAgentsMd = @"
# OpenCode Production Team

Sistema activo: equipo multi-agente de 17 agentes.

Reglas globales:
- Usar solo delegacion nativa `task` para que la TUI muestre subagentes.
- Orden obligatorio: ENTENDER -> PLANIFICAR -> VALIDAR PLAN -> IMPLEMENTAR -> VERIFICAR -> ENTREGAR.
- Ningun agente referencia una entidad que no haya verificado.
- Ningun especialista escribe sin snapshot y lock declarados.
- Verificadores de Capa 4 son solo lectura.
- Produccion, secretos, borrado de datos e infraestructura real requieren confirmacion explicita de Javier.
- Telegram lo gestiona Release-Notifier o el script `tools/telegram-notifier.mjs`.

Rutas de proyecto:
- GMP: C:/Users/Javier/Desktop/Repositorios/gmp_app_mobilidad
- Granja: C:/Users/Javier/Desktop/Repositorios/granja_mari_pepa
"@
Write-Utf8NoBom "$ConfigDir\AGENTS.md" $globalAgentsMd

$cursorModelNames = @(
  "auto","composer-2-fast","composer-2","composer-2.5","claude-4.6-sonnet","claude-4.6-sonnet-thinking",
  "claude-4.6-opus","claude-4.6-opus-thinking","claude-opus-4-7","claude-4.5-sonnet","claude-4-sonnet",
  "gpt-5-mini","gpt-5.4","gpt-5.4-medium","gpt-5.4-high","gpt-5.4-mini","gpt-5.5","gpt-5.3-codex",
  "gpt-5.2","gpt-5.1-codex","gemini-3-pro","gemini-3.1-pro","gemini-3-flash","grok","kimi-k2.5"
)
$cursorModels = [ordered]@{}
foreach ($m in $cursorModelNames) {
  $cursorModels[$m] = [ordered]@{ name = $m; tool_call = $true; reasoning = $true; options = @{} }
}

$mcp = [ordered]@{
  "context7" = [ordered]@{ type="remote"; url="https://mcp.context7.com/mcp"; enabled=$false; timeout=30000 }
  "filesystem" = [ordered]@{ type="local"; command=@("C:/nvm4w/nodejs/mcp-server-filesystem.cmd","C:/Users/Javier/Desktop/Repositorios"); enabled=$true; timeout=30000 }
  "ddg-search" = [ordered]@{ type="local"; command=@("C:/nvm4w/nodejs/duckduckgo-mcp-server.cmd"); enabled=$false; timeout=30000 }
  "fetch" = [ordered]@{ type="local"; command=@("C:/Users/Javier/.local/bin/uvx.exe","mcp-server-fetch"); enabled=$false; timeout=30000 }
  "git" = [ordered]@{ type="local"; command=@("C:/Users/Javier/.local/bin/uvx.exe","mcp-server-git"); enabled=$true; timeout=30000 }
  "beads" = [ordered]@{ type="local"; command=@("C:/Users/Javier/AppData/Local/Programs/Python/Python311/Scripts/beads-mcp.exe"); enabled=$true; timeout=30000 }
  "telegram" = [ordered]@{ type="local"; command=@("C:/Program Files/nodejs/node.exe","C:/Users/Javier/.config/opencode/mcp/telegram-mcp.mjs"); environment=[ordered]@{ TELEGRAM_BOT_TOKEN='${env.TELEGRAM_BOT_TOKEN}'; TELEGRAM_CHAT_ID='${env.TELEGRAM_CHAT_ID}' }; enabled=$true; timeout=30000 }
  "time" = [ordered]@{ type="local"; command=@("C:/Users/Javier/.local/bin/uvx.exe","mcp-server-time"); enabled=$true; timeout=30000 }
  "dart-flutter-mcp" = [ordered]@{ type="local"; command=@("C:/flutter/bin/dart.bat","mcp-server"); enabled=$false; timeout=30000 }
  "pub-mcp" = [ordered]@{ type="local"; command=@("C:/nvm4w/nodejs/pub-mcp.cmd","--stdio"); enabled=$false; timeout=30000 }
  "ibm-db2-mcp" = [ordered]@{ type="local"; command=@("C:/Program Files/nodejs/node.exe","C:/Users/Javier/.config/opencode/mcp/ibm-odbc-mcp.cjs"); environment=[ordered]@{ ODBC_DSN="GMP"; ODBC_UID='${env.ODBC_UID}'; ODBC_PWD='${env.ODBC_PWD}'; ODBC_SCHEMA="JAVIER" }; enabled=$false; timeout=30000 }
  "gmp-deploy-ssh" = [ordered]@{ type="local"; command=@("C:/Program Files/nodejs/node.exe","C:/Users/Javier/.config/opencode/mcp/gmp-deploy-ssh-mcp.cjs"); environment=[ordered]@{ SSH_GMP_HOST='${env.SSH_GMP_HOST}'; SSH_GMP_USER='${env.SSH_GMP_USER}'; SSH_GMP_PASSWORD='${env.SSH_GMP_PASSWORD}' }; enabled=$false; timeout=30000 }
  "playwright" = [ordered]@{ type="local"; command=@("C:/nvm4w/nodejs/playwright-mcp.cmd"); enabled=$false; timeout=30000 }
  "chrome-devtools" = [ordered]@{ type="local"; command=@("C:/nvm4w/nodejs/chrome-devtools-mcp.cmd"); enabled=$false; timeout=30000 }
  "github" = [ordered]@{ type="local"; command=@("C:/nvm4w/nodejs/mcp-server-github.cmd"); environment=[ordered]@{ GITHUB_TOKEN='${env.GITHUB_TOKEN}' }; enabled=$false; timeout=30000 }
  "firecrawl" = [ordered]@{ type="local"; command=@("C:/nvm4w/nodejs/firecrawl-mcp.cmd"); environment=[ordered]@{ FIRECRAWL_API_KEY='${env.FIRECRAWL_API_KEY}' }; enabled=$false; timeout=30000 }
  "supabase" = [ordered]@{ type="remote"; url="https://mcp.supabase.com/mcp"; headers=[ordered]@{ Authorization='Bearer ${env.SUPABASE_ACCESS_TOKEN}' }; enabled=$false; timeout=30000 }
  "sentry" = [ordered]@{ type="local"; command=@("C:/nvm4w/nodejs/npx.cmd","-y","@sentry/mcp-server"); environment=[ordered]@{ SENTRY_AUTH_TOKEN='${env.SENTRY_AUTH_TOKEN}' }; enabled=$false; timeout=30000 }
}

$globalConfig = [ordered]@{
  '$schema' = "https://opencode.ai/config.json"
  plugin = @(
    "file:///C:/Users/Javier/.config/opencode/plugin/cursor-acp.js",
    "file:///C:/Users/Javier/.config/opencode/plugins/model-fallback.js"
  )
  model = $tierC
  small_model = $tierC
  default_agent = "GMP-Orchestrator"
  instructions = @("C:/Users/Javier/.config/opencode/AGENTS.md")
  experimental = [ordered]@{ mcp_timeout = 30000 }
  watcher = [ordered]@{ ignore = @("node_modules/**",".dart_tool/**","build/**",".next/**",".swarm/**","**/*.log",".git-rewrite/**") }
  provider = [ordered]@{
    "cursor-acp" = [ordered]@{
      npm = "@ai-sdk/openai-compatible"
      name = "Cursor ACP"
      options = [ordered]@{ baseURL = "http://127.0.0.1:32124/v1"; apiKey = '${env.CURSOR_API_KEY}'; timeout = 300000; chunkTimeout = 15000 }
      models = $cursorModels
    }
  }
  mcp = $mcp
}
Write-Utf8NoBom "$ConfigDir\opencode.json" (Json $globalConfig)

$fallbackAgents = [ordered]@{}
foreach ($a in $agents) {
  $fallbackAgents[$a.Name] = [ordered]@{ primary=$a.Model; fallback=@($a.Fallback, "opencode-go/qwen3.7-max", "opencode-go/kimi-k2.6") }
}
$fallbackConfig = [ordered]@{
  '$schema' = "https://opencode.ai/fallback-models.json"
  enabled = $true
  defaultTrigger = [ordered]@{
    errorCodes = @(401,403,408,409,429,402,413,500,502,503,529)
    errorMessages = @("unauthorized","not logged in","authentication","invalid api key","quota","rate limit","too many requests","billing","capacity","overloaded","resource exhausted","timeout","timed out","model not found","provider unavailable")
    timeoutMs = 15000
  }
  retryBehavior = [ordered]@{ maxRetries=2; initialDelayMs=5000; backoffMultiplier=2; maxDelayMs=30000 }
  resetBehavior = [ordered]@{ resetAfterMinutes=30; autoReset=$true }
  agents = $fallbackAgents
  notifications = [ordered]@{ onFallback=$true; onReset=$true; fallbackFormat="[fallback] {agent}: {from} -> {to} ({reason})"; resetFormat="[fallback] {agent}: reset -> {to}" }
  logging = [ordered]@{ enabled=$true; filePath="C:/Users/Javier/.config/opencode/fallback.log"; level="info" }
}
Write-Utf8NoBom "$ConfigDir\fallback-models.json" (Json $fallbackConfig)

$telegramNotifier = @'
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
const pendingPath = path.join(home, ".config", "opencode", "telegram_pending.jsonl");

function arg(name, fallback = "") {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

function appendPending(entry) {
  fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
  fs.appendFileSync(pendingPath, JSON.stringify(entry) + "\n", "utf8");
}

async function send(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const entry = { ts: new Date().toISOString(), text, sent: false };
  if (!token || !chatId) {
    entry.error = "missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID";
    appendPending(entry);
    return entry;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true })
  });
  const body = await res.text();
  entry.status = res.status;
  if (!res.ok) {
    entry.error = body.slice(0, 500);
    appendPending(entry);
    return entry;
  }
  entry.sent = true;
  return entry;
}

const text = arg("message", process.argv.slice(2).join(" ")).trim();
if (!text) {
  console.error("telegram-notifier: missing message");
  process.exit(2);
}
const result = await send(text);
console.log(JSON.stringify(result));
process.exit(result.sent ? 0 : 1);
'@
Write-Utf8NoBom "$ConfigDir\tools\telegram-notifier.mjs" $telegramNotifier

$telegramMcp = @'
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

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
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML", disable_web_page_preview: true })
  });
  const body = await res.text();
  entry.status = res.status;
  if (!res.ok) {
    entry.error = body.slice(0, 500);
    appendPending(entry);
  } else {
    entry.sent = true;
  }
  return entry;
}

const server = new Server({ name: "telegram-notifier", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "send_telegram",
    description: "Send a human-readable Telegram notification. Falls back to telegram_pending.jsonl.",
    inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] }
  }]
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "send_telegram") throw new Error("Unknown tool");
  const message = String(req.params.arguments?.message || "");
  const result = await sendTelegram(message);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});
await server.connect(new StdioServerTransport());
'@
Write-Utf8NoBom "$ConfigDir\mcp\telegram-mcp.mjs" $telegramMcp

$runtime = @'
import fs from "node:fs";
import path from "node:path";

const [,, cmd, ...args] = process.argv;
function parseArgs(argv) {
  const options = new Map();
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq > 2) {
      options.set(arg.slice(0, eq), arg.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      options.set(arg, next);
      i += 1;
    } else {
      options.set(arg, "true");
    }
  }
  return { options, positionals };
}
const parsed = parseArgs(args);
function value(flags, fallback = "") {
  for (const flag of flags) {
    if (parsed.options.has(flag)) return parsed.options.get(flag);
  }
  return fallback;
}
function ensure(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }
function jsonLine(file, obj) { ensure(file); fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n", "utf8"); }

if (cmd === "trace") {
  const project = value(["--project"], process.cwd());
  const file = path.join(project, ".opencode", "TEAM_TRACE.jsonl");
  jsonLine(file, { task_id: value(["--task_id", "--task"]), event: value(["--event"]), agent: value(["--agent"]), detail: value(["--detail"]), files_touched: [] });
  process.exit(0);
}

if (cmd === "lock") {
  const project = value(["--project"], process.cwd());
  const file = value(["--file"]);
  const task = value(["--task_id", "--task"]);
  if (!file || !task) throw new Error("lock requires --file and --task");
  const lockRoot = path.join(project, ".opencode", "locks");
  fs.mkdirSync(lockRoot, { recursive: true });
  const lock = path.join(lockRoot, Buffer.from(path.resolve(file)).toString("base64url") + ".lock");
  try {
    fs.writeFileSync(lock, JSON.stringify({ task, file: path.resolve(file), ts: new Date().toISOString() }), { flag: "wx" });
    console.log(JSON.stringify({ ok: true, lock }));
  } catch {
    console.log(JSON.stringify({ ok: false, lock, reason: "already_locked" }));
    process.exit(3);
  }
  process.exit(0);
}

if (cmd === "unlock") {
  const project = value(["--project"], process.cwd());
  const file = value(["--file"]);
  const lock = path.join(project, ".opencode", "locks", Buffer.from(path.resolve(file)).toString("base64url") + ".lock");
  if (fs.existsSync(lock)) fs.unlinkSync(lock);
  console.log(JSON.stringify({ ok: true }));
  process.exit(0);
}

if (cmd === "snapshot") {
  const project = value(["--project"], process.cwd());
  const task = value(["--task_id", "--task"]);
  const files = parsed.positionals;
  if (!task) throw new Error("snapshot requires --task");
  const root = path.join(project, ".opencode", "snapshots", task);
  fs.mkdirSync(root, { recursive: true });
  for (const f of files) {
    const abs = path.resolve(f);
    if (!fs.existsSync(abs)) continue;
    const rel = path.relative(project, abs);
    if (rel.startsWith("..")) throw new Error(`refusing snapshot outside project: ${abs}`);
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
  }
  console.log(JSON.stringify({ ok: true, snapshot: root, files }));
  process.exit(0);
}

console.error("agent-runtime commands: trace, lock, unlock, snapshot");
process.exit(2);
'@
Write-Utf8NoBom "$ConfigDir\tools\agent-runtime.mjs" $runtime

$envLoader = @'
@echo off
set "OPENCODE_ENV_FILE=%USERPROFILE%\.config\opencode\.env"
if not exist "%OPENCODE_ENV_FILE%" exit /b 0
for /f "usebackq eol=# tokens=1,* delims==" %%e in ("%OPENCODE_ENV_FILE%") do (
  if /I not "%%e"=="OPENAI_API_KEY" if not "%%e"=="" set "%%e=%%f"
)
set "OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=32768"
exit /b 0
'@
Write-Utf8NoBom "$ConfigDir\load-opencode-env.cmd" $envLoader

$startPs = @'
param(
  [Parameter(Mandatory=$true)][ValidateSet("gmp","granja")][string]$Project
)
$ErrorActionPreference = "Stop"
$HomeDir = [Environment]::GetFolderPath("UserProfile")
$ConfigDir = Join-Path $HomeDir ".config\opencode"
$envFile = Join-Path $ConfigDir ".env"

function Load-Env {
  if (-not (Test-Path -LiteralPath $envFile)) { return }
  Get-Content -LiteralPath $envFile | ForEach-Object {
    if ($_ -match "^\s*#" -or $_ -notmatch "=") { return }
    $parts = $_ -split "=", 2
    $name = $parts[0].Trim()
    if (-not $name -or $name -ieq "OPENAI_API_KEY") { return }
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

Load-Env
$env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = "32768"
$env:PATH = "C:\nvm4w\nodejs;C:\Program Files\nodejs;C:\Users\Javier\AppData\Local\cursor-agent;" + $env:PATH

if ($Project -eq "gmp") {
  $ProjectName = "GMP"
  $ProjectDir = Join-Path $HomeDir "Desktop\Repositorios\gmp_app_mobilidad"
  $Port = 3090
  $OtherPort = 3091
} else {
  $ProjectName = "GRANJA"
  $ProjectDir = Join-Path $HomeDir "Desktop\Repositorios\granja_mari_pepa"
  $Port = 3091
  $OtherPort = 3090
}
if (-not (Test-Path -LiteralPath $ProjectDir)) {
  Send-Tg "ROJO [$ProjectName] Ruta de proyecto no existe: $ProjectDir"
  throw "Ruta de proyecto no existe: $ProjectDir"
}
Set-Location -LiteralPath $ProjectDir
New-Item -ItemType Directory -Path ".opencode" -Force | Out-Null
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

try { Send-Tg "AZUL [$ProjectName] Verificacion Telegram OK. Proveedores: $($providers.Count)/3." } catch {}

if (Test-Path ".gitignore") {
  $gi = Get-Content ".gitignore" -Raw
  if ($gi -notmatch "(?m)^\.swarm/\s*$") { Add-Content ".gitignore" "`n.swarm/" }
}
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

Write-Host "OK [$ProjectName] listo - Proveedores: $($providers.Count)/3 activos ($($providers -join ', '))"
Send-Tg "OK [$ProjectName] Sistema listo. Proveedores: $($providers.Count)/3 ($($providers -join ', ')). Escribeme lo que necesitas."

$logFile = Join-Path $ProjectDir "output.log"
& "C:\nvm4w\nodejs\opencode.cmd" web --port $Port --hostname 0.0.0.0 --cors "http://localhost:$Port" --cors "http://100.107.11.80:$Port" --cors "app://opencode.ai" *>> $logFile
$exit = $LASTEXITCODE
try { & "C:\Program Files\nodejs\node.exe" (Join-Path $ConfigDir "tools\session-summarizer.mjs") --project=$Project 2>$null } catch {}
exit $exit
'@
Write-Utf8NoBom "$ConfigDir\tools\start-opencode-project.ps1" $startPs

$cmdGmp = '@echo off
title OpenCode Web - GMP
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.config\opencode\tools\start-opencode-project.ps1" -Project gmp
exit /b %ERRORLEVEL%
'
$cmdGranja = '@echo off
title OpenCode Web - Granja
powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.config\opencode\tools\start-opencode-project.ps1" -Project granja
exit /b %ERRORLEVEL%
'
Write-Utf8NoBom "$HomeDir\start-opencode-web-gmp.cmd" $cmdGmp
Write-Utf8NoBom "$HomeDir\start-opencode-web-granja.cmd" $cmdGranja

$projectInstructions = @"
# Project Agent Instructions

Usar el equipo global de 17 agentes. No usar agentes legacy.

Reglas del proyecto activo:
- No modificar archivos fuera de la ruta del proyecto activo.
- Crear snapshots en .opencode/snapshots/<task_id>/ antes de editar.
- Registrar eventos relevantes en .opencode/TEAM_TRACE.jsonl.
- Usar Release-Notifier para Telegram.
- Verificadores de Capa 4 son solo lectura.
"@
Write-Utf8NoBom "$GmpDir\.opencode\AGENTS.md" $projectInstructions
Write-Utf8NoBom "$GranjaDir\.opencode\AGENTS.md" $projectInstructions

$gmpProjectConfig = [ordered]@{
  '$schema' = "https://opencode.ai/config.json"
  model = $tierC
  default_agent = "GMP-Orchestrator"
  instructions = @("./.opencode/AGENTS.md")
  server = [ordered]@{ cors = @("http://localhost:3090","http://100.107.11.80:3090","app://opencode.ai") }
  experimental = [ordered]@{ mcp_timeout = 30000 }
  mcp = [ordered]@{
    "filesystem"=[ordered]@{enabled=$true}; "git"=[ordered]@{enabled=$true}; "beads"=[ordered]@{enabled=$true}; "telegram"=[ordered]@{enabled=$true}; "time"=[ordered]@{enabled=$true};
    "dart-flutter-mcp"=[ordered]@{enabled=$true}; "pub-mcp"=[ordered]@{enabled=$true}; "ibm-db2-mcp"=[ordered]@{enabled=$true}; "gmp-deploy-ssh"=[ordered]@{enabled=$true};
    "playwright"=[ordered]@{enabled=$true}; "ddg-search"=[ordered]@{enabled=$true}; "fetch"=[ordered]@{enabled=$true}; "context7"=[ordered]@{enabled=$true}; "github"=[ordered]@{enabled=$HasGithubToken}; "sentry"=[ordered]@{enabled=$HasSentryToken}
  }
}
$granjaProjectConfig = [ordered]@{
  '$schema' = "https://opencode.ai/config.json"
  model = $tierC
  default_agent = "Granja-Orchestrator"
  instructions = @("./.opencode/AGENTS.md")
  server = [ordered]@{ cors = @("http://localhost:3091","http://100.107.11.80:3091","app://opencode.ai") }
  experimental = [ordered]@{ mcp_timeout = 30000 }
  mcp = [ordered]@{
    "filesystem"=[ordered]@{enabled=$true}; "git"=[ordered]@{enabled=$true}; "beads"=[ordered]@{enabled=$true}; "telegram"=[ordered]@{enabled=$true}; "time"=[ordered]@{enabled=$true};
    "playwright"=[ordered]@{enabled=$true}; "chrome-devtools"=[ordered]@{enabled=$true}; "ddg-search"=[ordered]@{enabled=$true}; "fetch"=[ordered]@{enabled=$true}; "context7"=[ordered]@{enabled=$true};
    "github"=[ordered]@{enabled=$HasGithubToken}; "firecrawl"=[ordered]@{enabled=$HasFirecrawlKey}; "supabase"=[ordered]@{enabled=$HasSupabaseAccessToken}; "sentry"=[ordered]@{enabled=$HasSentryToken}; "ibm-db2-mcp"=[ordered]@{enabled=$true}; "gmp-deploy-ssh"=[ordered]@{enabled=$true}
  }
}
Write-Utf8NoBom "$GmpDir\.opencode\opencode.json" (Json $gmpProjectConfig)
Write-Utf8NoBom "$GranjaDir\.opencode\opencode.json" (Json $granjaProjectConfig)
Write-Utf8NoBom "$GmpDir\opencode.json" (Json ([ordered]@{'$schema'="https://opencode.ai/config.json"}))
Write-Utf8NoBom "$GmpDir\backend\scripts\sql\opencode.json" (Json ([ordered]@{'$schema'="https://opencode.ai/config.json"}))

$inventory = @"
# Multi-Agent System Inventory

Generated: $Timestamp

## Providers
- openai: OAuth in auth.json. Verified models before rebuild: openai/gpt-5.2, gpt-5.3-codex, gpt-5.4, gpt-5.5, gpt-5.5-pro.
- cursor-acp: localhost:32124/v1/models. Verified compact OpenCode models include cursor-acp/auto, composer-2-fast, claude-4.6-sonnet, gpt-5.5.
- opencode-go: API key in auth.json. Verified models include deepseek-v4-flash, deepseek-v4-pro, glm-5.1, kimi-k2.6, qwen3.7-max.
- nvidia/google/amazon-bedrock: disabled from active auth.json; original credentials remain only in timestamped backup.

## Active MCP assignments
- filesystem: Repo-Explorer and all specialists according to permissions.
- git: orquestadores, DevOps-CICD-Specialist, Code-Reviewer.
- beads: GMP-Orchestrator, Granja-Orchestrator.
- telegram: Release-Notifier and startup scripts.
- ibm-db2-mcp: DB2-AS400-Specialist.
- gmp-deploy-ssh: DB2-AS400, Node-Express, DevOps for read-only logs and controlled ops.
- dart-flutter-mcp/pub-mcp: Flutter specialists and Test-Specialist.
- playwright/chrome-devtools: Test-Specialist, Performance-Analyst, NextJS-Shadcn.
- fetch/ddg-search/context7: Web-Researcher.
- firecrawl: defined but disabled until FIRECRAWL_API_KEY is present.
- github: defined but disabled until GITHUB_TOKEN is present.
- supabase: defined but disabled until SUPABASE_ACCESS_TOKEN is present.
- sentry: defined but disabled until SENTRY_AUTH_TOKEN is present.

## Skills
Flutter/Riverpod skills go to Flutter specialists. GitHub/Sentry skills go to DevOps and Code-Reviewer. Verification/QA, security and performance skills go to Capa 4. SPARC/planning skills go to orquestadores and Architect-Planner. Caveman is not used in critical prompts.

## Backups
Original files copied/moved to: $BackupDir
"@
Write-Utf8NoBom "$ConfigDir\MULTI_AGENT_SYSTEM.md" $inventory

# Ensure swarm runtime state is ignored and removed from the index if tracked.
$gitignore = Join-Path $GmpDir ".gitignore"
if (Test-Path -LiteralPath $gitignore) {
  $content = Get-Content -LiteralPath $gitignore -Raw
  if ($content -notmatch "(?m)^\.swarm/\s*$") {
    Add-Content -LiteralPath $gitignore -Value "`n.swarm/"
  }
}
Push-Location $GmpDir
try {
  $tracked = git ls-files .swarm
  if ($tracked) { git rm -r --cached -- .swarm | Out-Null }
} catch {}
Pop-Location

Write-Host "Rebuild complete. Backups: $BackupDir"
