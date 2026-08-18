import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

type Playbook = "tiny" | "explore" | "build" | "sweep" | "secure" | "prod"

type TaskType =
  | "none"
  | "explore"
  | "research"
  | "mechanical"
  | "frontend_flutter"
  | "frontend_web"
  | "backend"
  | "db_migration"
  | "financial"
  | "secure"
  | "prod"
  | "sweep"
  | "factory"
  | "bug_loop"
  | "ship_pr"

type Phase = {
  name: string
  executor_model: "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra"
  agent: string
  gate_id: string
  blocking: boolean
  pass_criteria: string
  on_fail: string
}

type Route = {
  success: true
  task_id: string
  project: "gmp" | "granja"
  playbook: Playbook
  task_type: TaskType
  intent: string
  task_tier: "T1" | "T2" | "T3"
  confidence: number
  signals: string[]
  workstreams: string[]
  required_agents: string[]
  required_mcp: string[]
  required_tools: string[]
  required_skills: string[]
  autonomous_commands: string[]
  required_gates: string[]
  risk_flags: string[]
  stop_conditions: string[]
  decision_tree: string[]
  evidence_required: string[]
  phases: Phase[]
  cost_policy: {
    planner_model: "openai/gpt-5.6-sol"
    executor_model: "openai/gpt-5.6-sol" | "openai/gpt-5.6-terra"
    critic_model: "openai/gpt-5.6-sol"
    executor_cheap_allowed: boolean
    critic_never_cheaper_than_maker: true
  }
  classification: {
    workflow_tier: "T1" | "T2" | "T3"
    risk_tier: "R0" | "R1" | "R2" | "R3" | "R4"
    complexity_class: "C0" | "C1" | "C2" | "C3" | "C4"
    model_tier: "A" | "B" | "C" | "MANUAL_FREE"
    autonomy_level: "A0_READ_ONLY" | "A1_SAFE_DISCOVERY" | "A2_LOCAL_IMPLEMENT" | "A3_GATED_IMPLEMENT" | "A4_HUMAN_APPROVAL"
    verification_level: "V0_NONE" | "V1_EVIDENCE" | "V2_LOCAL_CHECKS" | "V3_CROSS_AGENT" | "V4_RELEASE_GATES"
    confidence_action: string
    reasons: string[]
  }
  departments: string[]
  always_on_quality: true
  telegram_policy: string
  model_policy: {
    automatic: string
    manual_zen_allowed: boolean
    manual_zen_free_models: string[]
  }
}

const ZEN_FREE_MODELS = [
  "opencode/deepseek-v4-flash-free",
  "opencode/mimo-v2.5-free",
  "opencode/minimax-m3-free",
  "opencode/nemotron-3-super-free",
  "opencode/big-pickle",
]

export default tool({
  description:
    "Router V6: playbook + task_type con fases/gates + coste planner/executor. Roster de 12.",
  args: {
    request: tool.schema.string().min(1).describe("Peticion original u optimized_prompt."),
    project: tool.schema.enum(["gmp", "granja"]).default("gmp"),
    mobile_mode: tool.schema.boolean().default(false),
    self_test: tool.schema.boolean().default(false).describe("Ejecuta escenarios internos de regresion del router sin implementar nada."),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    if (args.self_test) {
      const report = runSelfTest()
      await fs.mkdir(path.join(root, ".opencode", "state"), { recursive: true })
      const file = path.join(root, ".opencode", "state", `decision-router-self-test-${Date.now()}.json`)
      await fs.writeFile(file, JSON.stringify(report, null, 2), "utf8")
      return { output: JSON.stringify({ ...report, stored_in: file }, null, 2), metadata: { ...report, stored_in: file } }
    }
    const route = buildRoute(args.request, args.project, args.mobile_mode)
    await fs.mkdir(path.join(root, ".opencode", "state"), { recursive: true })
    const file = path.join(root, ".opencode", "state", `decision-route-${route.task_id}.json`)
    await fs.writeFile(file, JSON.stringify(route, null, 2), "utf8")
    return { output: JSON.stringify({ ...route, stored_in: file }, null, 2), metadata: { ...route, stored_in: file } }
  },
})

function buildRoute(request: string, project: "gmp" | "granja", mobileMode: boolean): Route {
  const text = normalize(request)
  const signals: string[] = []
  const workstreams = new Set<string>()
  const agents = new Set<string>(["Context-Manager"])
  const mcp = new Set<string>(["memory"])
  const tools = new Set<string>(["decision-router", "flow-policy-check", "handoff-ledger"])
  const skills = new Set<string>(["v5-playbook-orchestra", "progressive-context"])
  const commands = new Set<string>(["route"])
  const gates = new Set<string>(["read-files-before-edit", "rag-before-design", "code-autopilot-before-new-code"])
  const risks = new Set<string>()
  const stops = new Set<string>(["No citar archivos, endpoints, tablas o columnas sin verificacion en esta sesion."])
  const evidence = new Set<string>(["TEAM_TRACE entry", "archivos leidos", "criterios de aceptacion"])

  const isQuestion = startsWithAny(text, ["que ", "que?", "cual ", "como ", "por que ", "dime ", "explica ", "estado "])
  const isOperationalAudit = hasAny(text, ["audita", "auditar", "auditoria", "valida", "validar", "verifica", "verificar", "solo lectura", "no edites", "clasifica", "clasificar", "lista subagentes", "flujo", "cambios recientes"])
  const isCorrection = hasAny(text, ["aprende esto", "te corrijo", "para la proxima", "recuerda que", "no vuelvas a", "esto esta mal", "esto es un fallo", "es un fallo", "prefiero que", "cuando te diga", "/teach"])
  const wantsChange = hasAny(text, [
    "arregla",
    "corrige",
    "implementa",
    "crea",
    "construye",
    "anade",
    "modifica",
    "optimiza",
    "aplica",
    "ejecuta",
    "refactor",
    "deploy",
    "despliega",
    "rollback",
    "reinicia",
    "restart",
    "soluciona",
    "haz",
    "deja listo",
  ])
  const isTeamHarnessAudit = hasAny(text, [
    "multi-agente",
    "multi agent",
    "sistemas multi-agente",
    "agent inventory",
    "compliance matrix",
    "agent-graph",
    "harness engineering",
    "graph engineering",
    "loop engineering",
    "chief-protocol",
    "flow-policy-check",
    "decision-router",
    "handoff-ledger",
    "readiness-smoke",
    "honors-grade",
    "roster audit",
    "model routing",
    "equipo opencode",
    "equipo absolutamente senior",
    "mas standard",
  ])
  const scopeMetaOnly =
    isOperationalAudit ||
    hasAny(text, [
      "solo .opencode",
      "solo docs",
      ".opencode y docs",
      "sin tocar backend",
      "sin backend",
      "sin flutter",
      "sin db2",
      "sin produccion",
      "no tocar produccion",
      "meta-sistema",
      "meta sistema",
      "team config",
      "config del equipo",
    ])
  const suppressProductRouting = isTeamHarnessAudit && scopeMetaOnly
  const memoryOnlyCorrection = isCorrection && !wantsChange && !isOperationalAudit
  const isLong = request.length > 700
  const prodExplicitlyExcluded = hasAny(text, [
    "no tocar produccion",
    "sin tocar produccion",
    "ni produccion",
    "prohibido tocar produccion",
    "sin produccion",
    "no produccion",
    "no pm2",
    "sin pm2",
    "no deploy",
    "sin deploy",
    "no despliegue",
    "sin despliegue",
    "produccion queda fuera",
    "servidor productivo queda fuera",
    "fuera del alcance produccion",
    "sin production-approval-gate",
    "without production-approval-gate",
    "excluye production-approval-gate",
  ])
  const isProd =
    !memoryOnlyCorrection &&
    !suppressProductRouting &&
    hasAny(text, ["produccion", "prod", "mari-pepa.com", "192.168.1.230", "pm2", "rollback", "deploy", "desplieg"]) &&
    !prodExplicitlyExcluded
  const isDb =
    !memoryOnlyCorrection &&
    !suppressProductRouting &&
    hasAny(text, ["db2", "as400", "odbc", "dsn", "sql", "tabla", "columna", "schema", "esquema", "schema javier", "esquema javier", "dsedac", "ddl", "dml", "alter table", "query"])
  const isBackend =
    !memoryOnlyCorrection &&
    !suppressProductRouting &&
    hasAny(text, ["backend", "express", "node", "endpoint", "api", "route", "ruta", "server", "500", "odbc"])
  const isFlutter =
    !memoryOnlyCorrection &&
    !suppressProductRouting &&
    hasAny(text, ["flutter", "dart", "provider", "riverpod", "pantalla", "widget", "tab", "movil", "repartidor", "ui"])
  const isCriticalFlow =
    !memoryOnlyCorrection &&
    !suppressProductRouting &&
    hasAny(text, ["pedido", "pedidos", "cobro", "cobros", "factura", "facturas", "stock", "checkout", "auth", "login"])
  const isPerformance =
    !memoryOnlyCorrection &&
    !suppressProductRouting &&
    hasAny(text, ["rendimiento", "performance", "lento", "cache", "n+1", "400 registros", "latencia", "p95", "bottleneck"])
  const isCache = !memoryOnlyCorrection && !suppressProductRouting && hasAny(text, ["cache", "redis", "ttl", "invalidacion", "hit rate", "memoizacion"])
  const isRuntime =
    !memoryOnlyCorrection &&
    !suppressProductRouting &&
    hasAny(text, ["log", "logs", "pm2", "500", "error 500", "runtime", "produccion", "health"]) &&
    !prodExplicitlyExcluded
  const isSecurity =
    !memoryOnlyCorrection &&
    !suppressProductRouting &&
    hasAny(text, ["seguridad", "secreto", "token", "jwt", "auth", "permiso", "owasp", "vulnerabilidad"])
  const isDbMutation = !memoryOnlyCorrection && hasAny(text, ["insert ", "update ", "delete ", "merge ", "alter ", "drop ", "create table", "ddl", "dml", "indice", "index"])
  const isProdMutation = !memoryOnlyCorrection && hasAny(text, ["deploy", "desplieg", "rollback", "pm2 restart", "pm2 stop", "reinicia", "restart"]) && !prodExplicitlyExcluded
  const isSecretMutation = !memoryOnlyCorrection && hasAny(text, ["rota token", "rotar token", "cambia token", "regenera secreto", "cambia secreto", "api key"])
  const isJavierOnlyDbMutation =
    isDbMutation &&
    hasAny(text, ["javier", "schema javier", "esquema javier"]) &&
    hasAny(text, ["solo javier", "solo schema javier", "solo en schema javier", "schema javier", "esquema javier", "contra javier", "en javier", "alcance de escritura: solo schema javier"]) &&
    hasAny(text, ["no tocar dsedac", "sin tocar dsedac", "prohibido tocar dsedac", "sin dsedac", "dsedac queda sin ddl", "dsedac queda fuera", "dsedac fuera"]) &&
    !isProdMutation
  const isIrreversible = isDbMutation || isProdMutation || isSecretMutation
  const isContract = hasAny(text, ["contrato", "contract", "request", "response", "payload", "compatibilidad", "endpoint", "api"])
  const isDesign = hasAny(text, ["diseno", "ux", "ui", "visual", "pantalla", "layout", "responsive"])
  const isResearch = hasAny(text, ["internet", "documentacion", "docs", "version actual", "libreria", "framework", "mcp", "opencode zen"])
  const isVisual = hasAny(text, ["screenshot", "captura", "visual", "diseno", "responsive", "web", "navegador"])
  const isGreenfield = hasAny(text, ["desde cero", "greenfield", "nueva web", "landing", "nextjs", "next.js", "frontend nuevo"])
  const isFactory =
    hasAny(text, [
      "app completa",
      "aplicacion completa",
      "producto para cliente",
      "entregable",
      "fabrica",
      "producir en masa",
      "web seria",
      "saas",
      "nueva app",
      "app desde cero",
      "para un cliente",
      "para mi cliente",
      "para el cliente",
      "producto digital",
      "web para un",
      "app para un",
      "tienda online",
      "ecommerce",
      "negocio online",
      "agencia",
    ]) ||
    (isGreenfield && hasAny(text, ["backend", "seo", "completa", "api", "optimizacion"]))
  const isFinancial = hasAny(text, ["comision", "comisiones", "objetivos", "r1_t8cdvd", "proxenos", "inversion", "liquidacion"])
  const isGoalLoop = hasAny(text, ["hasta que", "no pares hasta", "itera hasta", "dejalo perfecto", "/goal", "/loop", "no pares", "objetivo iterativo", "loop hasta", "checklist completa"])
  const isShipPr = hasAny(text, ["pull request", "abre un pr", "abre pr", "crea un pr", "haz pr", "haz un pr", "sube el pr"])
  const isBugLoop =
    wantsChange &&
    (isGoalLoop || hasAny(text, ["hasta que", "no pares"])) &&
    hasAny(text, ["bug", "bugs", "ci verde", "test en verde", "analyze"])
  const isSessionClose = hasAny(text, ["terminamos", "cierra sesion", "cerrar sesion", "hasta luego", "/handoff", "handoff", "fin de sesion", "cerramos por hoy"])
  const isSeo = hasAny(text, ["seo", "posicionamiento", "sitemap", "open graph", "meta description", "canonical", "json-ld"])
  const isA11y = hasAny(text, ["accesib", "a11y", "wcag", "aria", "lector de pantalla"])
  const isI18n = hasAny(text, ["i18n", "l10n", "traduc", "multiidioma", "locale", "catalan", "ingles"])
  const isAnalytics = hasAny(text, ["analytics", "gtm", "ga4", "medicion", "tracking", "eventos de"])
  const isLegal = hasAny(text, ["gdpr", "rgpd", "privacidad", "cookies", "aviso legal", "lopd", "espana", "ue "])
  const isPayments = hasAny(text, ["stripe", "pago", "pagos", "billing", "suscripcion", "pasarela", "checkout"])
  const isEmail = hasAny(text, ["email", "correo", "newsletter", "smtp", "transaccional"])
  const isCms = hasAny(text, ["cms", "blog", "headless"])
  const isSearch = hasAny(text, ["buscador", "fulltext", "search"])
  const isOffline = hasAny(text, ["offline", "sin red", "sincronizacion"])
  const isPush = hasAny(text, ["push", "fcm", "notificacion push"])
  const isPdf = hasAny(text, ["pdf"])
  const isDataBi = hasAny(text, ["powerbi", "dashboard", "informe bi"])
  const isAdmin = hasAny(text, ["admin", "backoffice", "panel de"])
  const isAuth = hasAny(text, ["login", "oauth", "jwt", "sesion", "rol"])
  const isObservability = hasAny(text, ["sentry", "observab", "health", "metricas", "opentelemetry"])

  let intent = "question"
  if (memoryOnlyCorrection) intent = "user_correction_or_preference"
  else if (wantsChange && isProd) intent = "production_change_or_incident"
  else if (wantsChange && isCriticalFlow) intent = "business_critical_change"
  else if (wantsChange) intent = "implementation_change"
  else if (isProd) intent = "production_investigation"
  else if (isResearch) intent = "research"
  else if (isQuestion) intent = "read_only_question"

  if (isQuestion && !wantsChange && !isProd && !isDb) {
    signals.push("read_only_question")
    tools.add("project-context")
    commands.add("explain")
  }

  if (isFactory) {
    signals.push("product_factory")
    workstreams.add("factory")
    tools.add("goal-loop-manager")
    tools.add("clarification-gate")
    tools.add("state-manager")
    skills.add("greenfield-pipeline")
    skills.add("goal-driven-loop")
    skills.add("seo-optimization")
    skills.add("frontend-ui-engineering")
    skills.add("node-backend-patterns")
    commands.add("goal")
    gates.add("evidence-per-iteration")
    gates.add("living-spec-exists")
    gates.add("product-delivery-contract")
    gates.add("a11y-baseline")
    gates.add("observability-baseline")
    gates.add("analytics-baseline")
    gates.add("legal-privacy-baseline")
    gates.add("copy-no-placeholder")
    skills.add("living-spec")
    skills.add("accessibility-audit")
    skills.add("error-handling")
    skills.add("monitoring-stack")
    skills.add("cicd-pipeline")
    skills.add("ux-writing")
    skills.add("production-grade-checklist")
    evidence.add("product-delivery-contract PASS antes de llamar entregable")
    stops.add("Factory no mergea a main ni despliega prod sin adelante.")
  }

  if (isShipPr) {
    signals.push("ship_pull_request")
    workstreams.add("ship")
    gates.add("pr-evidence")
    stops.add("PR no es produccion. No force push a main.")
  }

  if (isGreenfield) {
    signals.push("greenfield_web_or_frontend")
    workstreams.add("greenfield")
    skills.add("greenfield-pipeline")
    skills.add("frontend-ui-engineering")
    evidence.add("spec corta: usuario, flujo, estados, fuera de alcance")
  }

  if (isFinancial) {
    signals.push("financial_commissions_or_targets")
    workstreams.add("financial")
    evidence.add("columna R1_T8CDVD vs LCCDVD verificada; invariantes de pin")
  }

  if (isGoalLoop) {
    signals.push("goal_driven_loop")
    tools.add("goal-loop-manager")
    tools.add("clarification-gate")
    tools.add("state-manager")
    skills.add("goal-driven-loop")
    skills.add("ponytail")
    skills.add("incremental-implementation")
    commands.add("goal")
    commands.add("loop")
    gates.add("evidence-per-iteration")
    gates.add("hybrid-ask-on-ambiguity")
    evidence.add("goal-loop-manager tick con evidence por iteracion")
  }

  if (isSessionClose) {
    signals.push("session_close")
    tools.add("state-manager")
    tools.add("handoff-ledger")
    skills.add("session-handoff")
    skills.add("git-commit-discipline")
    commands.add("handoff")
    evidence.add("git status y handoff-ledger summarize")
    stops.add("No commitear ni push sin peticion explicita de Javier en cierre de sesion.")
  }

  if (isCorrection && !isOperationalAudit) {
    signals.push("user_correction_or_preference")
    workstreams.add("memory")
    agents.add("Context-Manager")
    tools.add("correction-capture")
    tools.add("memory-save")
    skills.add("memory-learning-loop")
    skills.add("context-pruning")
    commands.add("teach")
    gates.add("correction-overrides-generic-memory")
    evidence.add("correction_id guardado en user-corrections.jsonl")
    stops.add("No continuar sin guardar antes la correccion explicita de Javier.")
  }

  if (isResearch) {
    signals.push("current_docs_or_web_research")
    workstreams.add("research")
    agents.add("Web-Researcher")
    mcp.add("context7")
    mcp.add("ddg-search")
    mcp.add("fetch")
    skills.add("tool-discovery-audit")
    skills.add("source-driven-development")
    commands.add("audit")
  }

  if (suppressProductRouting) {
    signals.push("team_harness_meta_scope")
    workstreams.add("team_config")
    agents.add("Architect-Planner")
    agents.add("qa-automation-lead")
    agents.delete("Technical-Verifier")
    tools.add("agent-roster-audit")
    tools.add("model-assignment-audit")
    tools.add("workflow-state-audit")
    tools.add("honors-grade-audit")
    tools.add("team-ci")
    skills.add("elite-orchestration")
    gates.add("plan-approval-before-code")
    evidence.add("docs/agent-compliance-matrix.md con file:line")
    stops.add("No expandir a backend/Flutter/DB2/produccion en auditoria meta-equipo sin nueva ruta explicita.")
  }

  if (!suppressProductRouting && isBackend) {
    signals.push("backend_api")
    workstreams.add("backend")
    agents.add("Node-Express-Specialist")
    agents.add("API-Contract-Specialist")
    skills.add("node-backend-patterns")
    skills.add("nodejs-express")
    skills.add("api-and-interface-design")
    evidence.add("endpoints verificados")
  }

  if (!suppressProductRouting && (isDb || isCriticalFlow)) {
    signals.push("db2_or_business_flow")
    workstreams.add("db2")
    agents.add("DB2-AS400-Specialist")
    agents.add("DB2-Query-Optimizer")
    mcp.add("ibm-db2-mcp")
    skills.add("db2-safe-change")
    skills.add("db2-query-patterns")
    skills.add("db2-odbc")
    commands.add("db")
    gates.add("db2-readonly-discovery-first")
    risks.add("db2_schema_or_data_dependency")
    if (isDbMutation) {
      risks.add("db2_write_or_schema_change")
      gates.add("db2-write-approval")
      gates.add("rollback-plan-required")
      gates.add("idempotency-key-required")
      evidence.add("rollback SQL o plan de reversibilidad DB2")
      if (isJavierOnlyDbMutation) {
        gates.add("javier-test-schema-only")
        gates.add("no-DSEDAC-DDL-DML")
        evidence.add("aprobacion limitada a schema JAVIER y prohibicion explicita de DSEDAC")
      } else {
        tools.add("production-approval-gate")
        gates.add("production-approval-token")
      }
    }
    stops.add("DDL/DML o escrituras DB2 requieren aprobacion explicita, rollback plan e idempotencia.")
    stops.add("DDL/DML en JAVIER puede avanzar con aprobacion de plan y gate db2-write; DSEDAC o produccion requieren production-approval-gate.")
    evidence.add("tablas y columnas verificadas con QSYS2")
  }

  if (!suppressProductRouting && isFlutter && wantsChange) {
    signals.push("flutter_mobile")
    workstreams.add("flutter")
    agents.add("Flutter-Architecture-Specialist")
    agents.add("Flutter-UI-Specialist")
    agents.add("Flutter-Data-Specialist")
    mcp.add("dart-flutter-mcp")
    mcp.add("pub-mcp")
    skills.add("gmp-mobilidad-flutter")
    skills.add("flutter-provider")
    skills.add("flutter-riverpod-gmp")
    skills.add("flutter-testing")
    evidence.add("flutter analyze/test o razon verificable si no aplica")
  }

  if (isVisual) {
    signals.push("visual_or_browser")
    workstreams.add("visual_qa")
    agents.add("Visual-Design-Specialist")
    mcp.add("playwright")
    skills.add("browser-testing-with-devtools")
    skills.add("frontend-ui-engineering")
    skills.add("accessibility-audit")
    gates.add("visual-verification")
    evidence.add("screenshot o validacion visual equivalente con Playwright; Chrome DevTools es opcional")
  }

  if (isPerformance) {
    signals.push("performance_sensitive")
    workstreams.add("performance")
    agents.add("Performance-Analyst")
    agents.add("DB2-Query-Optimizer")
    agents.add("Redis-Cache-Specialist")
    agents.add("Flutter-Performance-Specialist")
    tools.add("elite-quality-gate")
    tools.add("flow-policy-check")
    skills.add("performance-optimization")
    skills.add("performance-profiling")
    skills.add("cache-strategy")
    commands.add("perf")
    commands.add("simulate")
    gates.add("n-plus-one-blocking-gate")
    risks.add("n_plus_one_or_unbounded_work")
    evidence.add("analisis de N+1, batching, paginacion y cache")
  }

  if (isSecurity || isBackend || isDb) {
    signals.push("security_or_api_surface")
    workstreams.add("security")
    agents.add("appsec-engineer")
    skills.add("security-and-hardening")
    skills.add("security-audit")
    skills.add("auth-security")
    commands.add("security")
    gates.add("appsec-pass")
    evidence.add("AppSec PASS/WARN/BLOCK con evidencia")
  }

  if (isCache) {
    signals.push("cache_or_redis")
    workstreams.add("cache")
    agents.add("Redis-Cache-Specialist")
    mcp.add("gmp-deploy-ssh")
    skills.add("cache-strategy")
    skills.add("performance-optimization")
    commands.add("perf")
    evidence.add("redis/cache policy, hit-rate expectation and invalidation plan")
  }

  if (isDb || isCriticalFlow || isPerformance) {
    gates.add("no-n-plus-one")
    gates.add("sql-parameterization")
  }

  if (isRuntime) {
    signals.push("runtime_logs")
    workstreams.add("runtime")
    agents.add("Runtime-Log-Diagnostician")
    agents.add("sre-engineer")
    mcp.add("gmp-deploy-ssh")
    skills.add("ssh-prod-ops")
    skills.add("debugging-and-error-recovery")
    commands.add("debug")
    commands.add("health")
    evidence.add("runtime logs or health checks")
  }

  if (isContract) {
    signals.push("api_contract")
    workstreams.add("contract")
    agents.add("API-Contract-Specialist")
    skills.add("api-and-interface-design")
    skills.add("regression-safety-checks")
    commands.add("verify")
    evidence.add("request/response contract and compatibility checks")
  }

  if (isDesign) {
    signals.push("design_or_ux")
    workstreams.add("design")
    agents.add("Visual-Design-Specialist")
    agents.add("product-ux")
    skills.add("frontend-design")
    skills.add("ux-writing")
    evidence.add("UX states and visual validation")
  }

  if (isProd) {
    signals.push("production_or_server")
    workstreams.add("sre_devops")
    agents.add("sre-engineer")
    agents.add("DevOps-CICD-Specialist")
    mcp.add("gmp-deploy-ssh")
    tools.add("production-approval-gate")
    tools.add("staging-deploy")
    skills.add("sre-runbooks")
    skills.add("ssh-prod-ops")
    skills.add("incident-response-runbook")
    skills.add("ci-cd-and-automation")
    commands.add("health")
    commands.add("monitor")
    commands.add("workflow")
    gates.add("staging-first")
    gates.add("qa-pass")
    gates.add("appsec-pass")
    gates.add("sre-health-60s")
    gates.add("production-approval-token")
    risks.add("production_impact")
    if (isProdMutation) {
      risks.add("production_mutation")
      gates.add("idempotency-key-required")
      evidence.add("idempotency key o razon verificable de no reintento")
    }
    stops.add("Produccion queda bloqueada sin staging, QA PASS, AppSec PASS, SRE PASS y 'adelante'.")
    evidence.add("health check /api/health con User-Agent GMP-SRE-HealthCheck/1.0")
  }

  if (isSecretMutation) {
    risks.add("secret_or_credential_mutation")
    gates.add("secret-rotation-approval")
    stops.add("Cambios de secretos o credenciales requieren aprobacion explicita y verificacion de no exposicion.")
  }

  if (wantsChange) {
    agents.add("Architect-Planner")
    agents.add("code-autopilot")
    agents.add("qa-automation-lead")
    agents.add("Code-Reviewer")
    agents.delete("Technical-Verifier")
    agents.add("Release-Notifier")
    tools.add("elite-quality-gate")
    tools.add("state-manager")
    skills.add("planning-and-task-breakdown")
    skills.add("implementation-strategy")
    skills.add("incremental-implementation")
    skills.add("regression-safety-checks")
    skills.add("release-evidence-gate")
    skills.add("git-commit-discipline")
    skills.add("ponytail")
    if (isBackend || isFlutter || isCriticalFlow) skills.add("test-driven-development")
    commands.add("workflow")
    commands.add("verify")
    commands.add("quality")
    gates.add("qa-pass")
    gates.add("release-evidence-gate")
    evidence.add("tests ejecutados o razon concreta de no ejecutarlos")
    evidence.add("diff revisado por reviewer")
  }

  if (isCriticalFlow) {
    signals.push("business_critical")
    gates.add("regression-test-required")
    gates.add("rollback-plan-required")
    skills.add("production-grade-checklist")
    commands.add("retro")
    risks.add("business_critical_flow")
    evidence.add("plan de rollback e idempotencia")
  }

  const taskTier = chooseTier({ wantsChange, isProd, isLong, isCriticalFlow, isDb, isBackend, isFlutter, isPerformance, isSecurity, isIrreversible, isFinancial, isFactory })

  if (taskTier !== "T1") {
    agents.add("Check-Reviewer")
    agents.add("Simplify-Reviewer")
    agents.add("Technical-Verifier")
    tools.add("plan-approval-gate")
    gates.add("plan-approval-before-code")
    gates.add("telegram-plan-before-risky-work")
    gates.add("critic-before-verify")
  }

  if (taskTier === "T3") {
    agents.add("product-ux")
    agents.add("Metrics-Observer")
    gates.add("phase-by-phase-execution")
    gates.add("same-error-retrospective-on-repeat")
    commands.add("team-trace")
    commands.add("postmortem")
    evidence.add("state file actualizado por fase")
  }

  if (mobileMode) {
    skills.add("mobile-telegram-control")
    skills.add("voice-interaction")
    commands.add("voice")
  }

  const confidence = computeConfidence(signals, wantsChange)
  const classification = buildClassification({
    taskTier,
    confidence,
    wantsChange,
    isProd,
    isLong,
    isCriticalFlow,
    isDb,
    isBackend,
    isFlutter,
    isPerformance,
    isSecurity,
    isRuntime,
    isCache,
    isResearch,
    isIrreversible,
    isFinancial,
    isFactory,
  })
  const decisionTree = buildDecisionTree(classification, wantsChange, isProd, isDb, isFlutter, isBackend, isPerformance, isSecurity)
  const playbook = choosePlaybook({
    text,
    memoryOnlyCorrection,
    wantsChange,
    isProd,
    isProdMutation,
    isSecurity,
    isDb,
    isDbMutation,
    isQuestion,
    isResearch,
    isOperationalAudit,
  })
  const taskType = chooseTaskType({
    playbook,
    wantsChange,
    isResearch,
    isGreenfield,
    isFlutter,
    isDesign,
    isBackend,
    isDbMutation,
    isFinancial,
    isCriticalFlow,
    isFactory,
    isShipPr,
    isBugLoop,
  })
  const cheapAllowed = executorCheapAllowed(taskType, {
    isCriticalFlow,
    isSecurity,
    isProd,
    isDbMutation,
    isIrreversible,
    isPerformance,
    isFinancial,
  })
  const costPolicy = {
    planner_model: "openai/gpt-5.6-sol" as const,
    executor_model: cheapAllowed ? "openai/gpt-5.6-terra" as const : "openai/gpt-5.6-sol" as const,
    critic_model: "openai/gpt-5.6-sol" as const,
    executor_cheap_allowed: cheapAllowed,
    critic_never_cheaper_than_maker: true as const,
  }
  const phases = phasesFor(taskType, costPolicy.executor_model)
  for (const phase of phases) {
    if (phase.blocking && phase.gate_id) gates.add(phase.gate_id)
  }
  const standing = standingAgentsFor(playbook, {
    taskTier,
    isDb,
    isProd,
    isSecurity,
    wantsChange,
    isFlutter,
    isResearch,
    isFactory,
    isShipPr,
  })
  if (playbook === "tiny" || playbook === "explore" || playbook === "prod") {
    commands.delete("workflow")
    if (playbook === "explore" || playbook === "tiny") commands.delete("verify")
    if (playbook !== "prod") {
      gates.delete("plan-approval-before-code")
      gates.delete("critic-before-verify")
    }
    if (playbook === "explore" || playbook === "tiny") {
      gates.delete("qa-pass")
      tools.delete("plan-approval-gate")
    }
  }
  if (playbook === "explore" && isResearch) {
    gates.add("citations-required")
    stops.add("Sin URL oficial o file:line no se afirma un hecho externo.")
  }
  if (["build", "sweep", "secure"].includes(playbook)) {
    tools.add("elite-quality-gate")
    tools.add("code-quality-contract")
    skills.add("code-quality-contract")
    skills.add("ponytail")
    skills.add("production-grade-checklist")
    skills.add("test-driven-development")
    gates.add("code-quality-contract")
    if (playbook !== "secure") gates.add("spec-ears-before-code")
  }
  const departments = departmentsFor({
    playbook,
    taskType,
    wantsChange,
    isFactory,
    isSeo,
    isA11y,
    isI18n,
    isAnalytics,
    isLegal,
    isPayments,
    isEmail,
    isCms,
    isSearch,
    isOffline,
    isPush,
    isPdf,
    isDataBi,
    isAdmin,
    isAuth,
    isObservability,
    isFlutter,
    isBackend,
    isDb,
    isDesign,
    isGreenfield,
    isFinancial,
    isProd,
    isResearch,
    isPerformance,
  })
  for (const skill of skillsForDepartments(departments)) skills.add(skill)
  if (departments.includes("a11y")) gates.add("a11y-baseline")
  if (departments.includes("seo")) gates.add("seo-baseline")
  if (departments.includes("observability")) gates.add("observability-baseline")
  if (departments.includes("legal")) gates.add("legal-privacy-baseline")
  if (departments.includes("copy")) gates.add("copy-no-placeholder")
  if (departments.includes("analytics")) gates.add("analytics-baseline")
  if (departments.includes("payments")) gates.add("idempotency-key-required")
  const modelPolicy = {
    automatic:
      `Planner ${costPolicy.planner_model}. Executor ${costPolicy.executor_model}. Critic ${costPolicy.critic_model}. Chief/planner nunca baja de sol. Critic nunca mas barato que el maker.`,
    manual_zen_allowed: true,
    manual_zen_free_models: ZEN_FREE_MODELS,
  }

  return {
    success: true,
    task_id: newTaskId(project),
    project,
    playbook,
    task_type: taskType,
    intent,
    task_tier: taskTier,
    confidence,
    signals: unique([...signals]),
    workstreams: unique([...workstreams]),
    required_agents: unique(standing),
    required_mcp: unique([...mcp]),
    required_tools: unique([...tools]),
    required_skills: compactSkills(playbook, skills),
    autonomous_commands: unique([...commands]),
    required_gates: unique([...gates]),
    risk_flags: unique([...risks]),
    stop_conditions: unique([...stops]),
    decision_tree: decisionTree,
    evidence_required: unique([...evidence]),
    phases,
    cost_policy: costPolicy,
    departments,
    always_on_quality: true as const,
    classification,
    telegram_policy: mobileMode || taskTier !== "T1" ? "Informar hitos, bloqueos y aprobaciones; resumen movil maximo tres lineas." : "No enviar ruido; solo cierre o bloqueo.",
    model_policy: modelPolicy,
  }
}

function choosePlaybook(flags: {
  text: string
  memoryOnlyCorrection: boolean
  wantsChange: boolean
  isProd: boolean
  isProdMutation: boolean
  isSecurity: boolean
  isDb: boolean
  isDbMutation: boolean
  isQuestion: boolean
  isResearch: boolean
  isOperationalAudit: boolean
}): Playbook {
  const text = flags.text
  if (flags.memoryOnlyCorrection) return "tiny"
  if (flags.isProdMutation || (flags.isProd && flags.wantsChange && hasAny(text, ["deploy", "desplieg", "pm2 restart", "rollback"]))) return "prod"
  if (flags.isSecurity && flags.wantsChange) return "secure"
  const fileSweep =
    hasAny(text, ["reorganiza", "directorio", "worktree", "sweep", "todos los archivos", "masivo"]) ||
    (hasAny(text, ["migra", "migracion"]) && !flags.isDb && !flags.isDbMutation)
  if (fileSweep) return "sweep"
  if (!flags.wantsChange) {
    if (flags.isResearch || flags.isOperationalAudit || flags.isQuestion || flags.isProd || flags.isDb) return "explore"
    return "tiny"
  }
  if (hasAny(text, ["typo", "renombra", "rename", "comentario", "un archivo"])) return "tiny"
  return "build"
}

function standingAgentsFor(playbook: Playbook, flags: {
  taskTier: "T1" | "T2" | "T3"
  isDb: boolean
  isProd: boolean
  isSecurity: boolean
  wantsChange: boolean
  isFlutter: boolean
  isResearch: boolean
  isFactory: boolean
  isShipPr: boolean
}): string[] {
  const standing = new Set<string>(["Context-Manager"])
  if (playbook === "tiny") {
    if (flags.wantsChange) standing.add("maker")
    return unique([...standing])
  }
  if (playbook === "explore") {
    standing.add("Repo-Explorer")
    if (flags.isDb) standing.add("DB2-AS400-Specialist")
    if (flags.isProd) standing.add("sre-engineer")
    if (flags.isResearch) {
      standing.add("Web-Researcher")
      standing.add("Technical-Verifier")
    }
    return unique([...standing])
  }
  if (playbook === "prod") {
    standing.add("sre-engineer")
    if (flags.isDb) standing.add("DB2-AS400-Specialist")
    return unique([...standing])
  }
  if (playbook === "secure") {
    standing.add("Repo-Explorer")
    standing.add("maker")
    standing.add("Check-Reviewer")
    standing.add("qa-automation-lead")
    standing.add("appsec-engineer")
    standing.add("Technical-Verifier")
    if (flags.isDb) standing.add("DB2-AS400-Specialist")
    return unique([...standing])
  }
  standing.add("maker")
  standing.add("Check-Reviewer")
  standing.add("qa-automation-lead")
  if (playbook === "sweep" || flags.taskTier === "T3") {
    standing.add("Architect-Planner")
    standing.add("Technical-Verifier")
  }
  if (flags.taskTier === "T3") standing.add("product-ux")
  if (flags.isDb) standing.add("DB2-AS400-Specialist")
  if (flags.isProd || flags.isShipPr || flags.isFactory) standing.add("sre-engineer")
  if (flags.isSecurity || flags.isFactory) standing.add("appsec-engineer")
  return unique([...standing])
}

function chooseTaskType(flags: {
  playbook: Playbook
  wantsChange: boolean
  isResearch: boolean
  isGreenfield: boolean
  isFlutter: boolean
  isDesign: boolean
  isBackend: boolean
  isDbMutation: boolean
  isFinancial: boolean
  isCriticalFlow: boolean
  isFactory: boolean
  isShipPr: boolean
  isBugLoop: boolean
}): TaskType {
  if (flags.playbook === "secure") return "secure"
  if (flags.playbook === "prod") return flags.isDbMutation ? "db_migration" : "prod"
  if (flags.playbook === "sweep") return "sweep"
  if (flags.playbook === "explore") return flags.isResearch ? "research" : "explore"
  if (flags.playbook === "tiny" && flags.wantsChange) return "mechanical"
  if (!flags.wantsChange) return "none"
  if (flags.isShipPr) return "ship_pr"
  if (flags.isBugLoop) return "bug_loop"
  if (flags.isFactory) return "factory"
  if (flags.isFinancial) return "financial"
  if (flags.isDbMutation) return "db_migration"
  if (flags.isGreenfield) return "frontend_web"
  if (flags.isFlutter || flags.isDesign) return "frontend_flutter"
  if (flags.isBackend || flags.isCriticalFlow) return "backend"
  return "none"
}

function executorCheapAllowed(taskType: TaskType, flags: {
  isCriticalFlow: boolean
  isSecurity: boolean
  isProd: boolean
  isDbMutation: boolean
  isIrreversible: boolean
  isPerformance: boolean
  isFinancial: boolean
}): boolean {
  if (["secure", "prod", "db_migration", "financial", "factory"].includes(taskType)) return false
  if (flags.isCriticalFlow || flags.isSecurity || flags.isProd || flags.isDbMutation || flags.isIrreversible || flags.isPerformance || flags.isFinancial) return false
  return ["frontend_flutter", "frontend_web", "backend", "mechanical"].includes(taskType)
}

function phase(
  name: string,
  executor_model: Phase["executor_model"],
  agent: string,
  gate_id: string,
  pass_criteria: string,
  on_fail = "reintenta",
): Phase {
  return { name, executor_model, agent, gate_id, blocking: true, pass_criteria, on_fail }
}

function phasesFor(taskType: TaskType, executor: Phase["executor_model"]): Phase[] {
  const sol = "openai/gpt-5.6-sol" as const
  if (taskType === "frontend_flutter") {
    return [
      phase("spec_ears", sol, "Architect-Planner", "ears-criteria-verifiable", "cada criterio: Cuando [evento], el sistema debe [respuesta verificable]", "detiene y pide humano"),
      phase("maker", executor, "maker", "design-tokens-or-appcolors", "0 hex fuera de AppColors; Semantics en interactivos"),
      phase("verificacion_visual", executor, "qa-automation-lead", "visual-browser-or-golden", "widget/golden o integration test en verde; flujo via Semantics"),
      phase("correccion_sistema", executor, "qa-automation-lead", "system-tests-and-a11y", "flutter test verde; flutter analyze 0 errores nuevos; 0 interactivos sin Semantics"),
      phase("optimizacion", executor, "maker", "web-vitals-or-flutter-perf", "0 N+1 en listas; select() en providers tocados; 0 trabajo pesado en build()"),
      phase("critic_diff", sol, "Check-Reviewer", "critic-ears-evidence", "cada criterio EARS con evidencia file:line", "escala a sol"),
    ]
  }
  if (taskType === "frontend_web") {
    return [
      phase("spec_ears", sol, "Architect-Planner", "ears-criteria-verifiable", "cada criterio EARS verificable", "detiene y pide humano"),
      phase("maker", executor, "maker", "design-tokens-or-appcolors", "0 color/espaciado fuera de tokens"),
      phase("verificacion_visual_navegador", executor, "qa-automation-lead", "visual-browser-or-golden", "0 diffs visuales sin revisar; flujo via a11y snapshot"),
      phase("correccion_sistema", executor, "qa-automation-lead", "system-tests-and-a11y", "suite verde; 0 axe serio/critico; 0 errores consola nuevos"),
      phase("optimizacion_web", executor, "maker", "web-vitals-or-flutter-perf", "LCP < 2.5s, INP < 200ms, CLS < 0.1; sin regresion de bundle"),
      phase("critic_diff", sol, "Check-Reviewer", "critic-ears-evidence", "cada criterio EARS con test/screenshot/metrica", "escala a sol"),
    ]
  }
  if (taskType === "backend") {
    return [
      phase("spec_ears", sol, "Architect-Planner", "ears-criteria-verifiable", "criterios EARS con status/payload/error tipado", "detiene y pide humano"),
      phase("maker", executor, "maker", "credentials-ref-only", "credentials_ref; 0 secreto literal; SQL parametrizado"),
      phase("tests_contrato", executor, "qa-automation-lead", "api-contract-coverage", "contrato validado; tests del flujo nuevo en verde"),
      phase("auditoria_secretos", sol, "appsec-engineer", "zero-plaintext-secrets", "0 secretos en texto plano", "detiene"),
      phase("critic_diff", sol, "Check-Reviewer", "critic-ears-evidence", "cada criterio EARS con test o log"),
    ]
  }
  if (taskType === "db_migration") {
    return [
      phase("spec_ears", sol, "DB2-AS400-Specialist", "ears-criteria-verifiable", "objetivos R1_T8CDVD nunca LCCDVD; QSYS2 antes de inventar columnas", "detiene"),
      phase("maker", sol, "maker", "sql-parameterized-qsys2", "0 queries no parametrizadas; QSYS2 primero", "detiene"),
      phase("verificacion_reversibilidad", sol, "Technical-Verifier", "rollback-script-exists", "script de rollback escrito ANTES de aplicar", "detiene y pide humano"),
      phase("critic_diff", sol, "Check-Reviewer", "critic-ears-evidence", "rollback + idempotencia + alcance JAVIER vs DSEDAC", "detiene"),
    ]
  }
  if (taskType === "financial") {
    return [
      phase("spec_ears", sol, "Architect-Planner", "ears-criteria-verifiable", "objetivos R1_T8CDVD; comisiones LCCDVD; no mezclar", "detiene"),
      phase("maker", sol, "maker", "commercial-column-invariant", "meses cerrados intocables; pin suma = total acordado", "detiene"),
      phase("critic_diff", sol, "Check-Reviewer", "critic-ears-evidence", "2-3 comerciales sensibles vs LY+10% R1; delta >15% injustificado = BLOCK", "detiene y pide humano"),
    ]
  }
  if (taskType === "mechanical") {
    return [phase("maker", executor, "maker", "code-quality-contract", "diff acotado al archivo pedido")]
  }
  if (taskType === "factory") {
    const terra = "openai/gpt-5.6-terra" as const
    return [
      phase("living_spec", sol, "product-ux", "living-spec-exists", "spec EARS + reglas de negocio + fuera de alcance antes de codigo", "detiene y pide humano"),
      phase("architecture", sol, "Architect-Planner", "layered-architecture", "capas; frontend no habla a DB; contratos listados", "detiene"),
      phase("backend_vertical", terra, "maker", "api-contract-coverage", "auth + validacion + errores tipados + test del endpoint critico"),
      phase("frontend_vertical", terra, "maker", "visual-browser-or-golden", "flujo critico en verde; loading/empty/error"),
      phase("seo", terra, "maker", "seo-baseline", "title unico, meta, un h1, OG; sitemap o noindex; 0 rotos en nav"),
      phase("optimization", terra, "maker", "web-vitals-or-flutter-perf", "LCP<2.5s INP<200ms CLS<0.1 o equivalente Flutter"),
      phase("a11y_copy_legal", terra, "product-ux", "a11y-baseline", "0 axe serio o Semantics; 0 lorem; privacy/cookies si web publica UE"),
      phase("observability_ci", terra, "qa-automation-lead", "observability-baseline", "health; 0 console.log; CI o razon en el PR"),
      phase("analytics_or_explicit_off", terra, "maker", "analytics-baseline", "eventos del flujo critico o no-tracking en la spec"),
      phase("secure_scan", sol, "appsec-engineer", "zero-plaintext-secrets", "0 secretos; 0 SQL concat", "detiene"),
      phase("critic_diff", sol, "Check-Reviewer", "critic-ears-evidence", "cada EARS + anti_vibe citados", "escala a sol"),
      phase("delivery_contract", sol, "Technical-Verifier", "product-delivery-contract", "code-quality-contract PASS. Sin PASS no hay entregable", "goal-loop tick"),
      phase("open_pr", sol, "sre-engineer", "pr-evidence", "PR abierto con evidencia; no merge a main", "detiene y pide humano"),
    ]
  }
  if (taskType === "bug_loop") {
    return [
      phase("reproduce", sol, "Repo-Explorer", "ears-criteria-verifiable", "fallo reproducido con comando y exit code", "detiene"),
      phase("maker", executor, "maker", "system-tests-and-a11y", "el comando que fallaba ahora exit 0"),
      phase("critic_diff", sol, "Check-Reviewer", "critic-ears-evidence", "fix acotado; regression test del fallo original"),
    ]
  }
  if (taskType === "ship_pr") {
    return [
      phase("evidence", sol, "Technical-Verifier", "code-quality-contract", "scorecard PASS o BLOCK honesto en el body del PR", "no abrir PR"),
      phase("open_pr", sol, "sre-engineer", "pr-evidence", "gh pr create con evidencia; no force a main", "detiene"),
    ]
  }
  return []
}

function runSelfTest() {
  const scenarios = [
    {
      name: "simple_read_only",
      request: "Dime que hace este repositorio sin cambiar nada",
      expect: { task_tier: "T1", risk_tier: "R1", model_tier: "C", playbook: "explore", agents: ["Context-Manager", "Repo-Explorer"] },
    },
    {
      name: "db2_business_flow",
      request: "Revisa por que el endpoint de pedidos no trae columnas correctas desde DB2",
      expect: { task_tier: "T3", risk_tier: "R3", model_tier: "A", playbook: "explore", agents: ["DB2-AS400-Specialist"], mcp: ["ibm-db2-mcp"], gates: ["no-n-plus-one", "sql-parameterization"] },
    },
    {
      name: "performance_cache",
      request: "Optimiza el listado de clientes porque hace 400 llamadas y va lento, revisa Redis cache",
      expect: { task_tier: "T3", risk_tier: "R3", model_tier: "A", playbook: "build", agents: ["maker"], gates: ["n-plus-one-blocking-gate", "no-n-plus-one", "sql-parameterization", "code-quality-contract"] },
    },
    {
      name: "flutter_ui_change",
      request: "Arregla la pantalla Flutter de repartidor, el tab se descuadra en movil",
      expect: { playbook: "build", task_type: "frontend_flutter", executor_model: "openai/gpt-5.6-terra", phases: ["spec_ears", "verificacion_visual", "critic_diff"], agents: ["maker", "Check-Reviewer"], mcp: ["dart-flutter-mcp", "pub-mcp"], gates: ["ears-criteria-verifiable", "design-tokens-or-appcolors", "visual-browser-or-golden"] },
    },
    {
      name: "production_discovery",
      request: "Equipo, dime el estado de produccion y mira logs de PM2 sin tocar nada",
      expect: { task_tier: "T3", risk_tier: "R3", model_tier: "A", playbook: "explore", agents: ["sre-engineer"], mcp: ["gmp-deploy-ssh"] },
    },
    {
      name: "irreversible_db2_mutation",
      request: "Haz un ALTER TABLE en DB2 para anadir columna notas y despliega a produccion",
      expect: { task_tier: "T3", risk_tier: "R4", model_tier: "A", task_type: "db_migration", executor_model: "openai/gpt-5.6-sol", gates: ["db2-write-approval", "production-approval-token", "rollback-plan-required", "rollback-script-exists"], tools: ["production-approval-gate"] },
    },
    {
      name: "javier_only_db2_mutation",
      request: "Aplica este ALTER TABLE solo en schema JAVIER, con rollback, sin tocar DSEDAC ni produccion",
      expect: { task_tier: "T3", risk_tier: "R4", model_tier: "A", gates: ["db2-write-approval", "javier-test-schema-only", "no-DSEDAC-DDL-DML", "rollback-plan-required"] },
      reject: { gates: ["production-approval-token"], tools: ["production-approval-gate"] },
    },
    {
      name: "javier_only_aligned_prompt",
      request: "Ejecuta la alineacion aditiva de pedidos/cobros del schema JAVIER. Alcance de escritura: solo schema JAVIER. DSEDAC queda sin DDL y sin DML.",
      expect: { task_tier: "T3", risk_tier: "R4", model_tier: "A", gates: ["db2-write-approval", "javier-test-schema-only", "no-DSEDAC-DDL-DML", "rollback-plan-required"] },
      reject: { gates: ["production-approval-token"], tools: ["production-approval-gate"] },
    },
    {
      name: "user_correction_capture",
      request: "Aprende esto: cuando diga Granja la ruta remota correcta es /var/www/mari-pepa",
      expect: { task_tier: "T1", risk_tier: "R1", model_tier: "C", playbook: "tiny", agents: ["Context-Manager"], tools: ["correction-capture"] },
    },
    {
      name: "typo_tiny",
      request: "Corrige el typo en un archivo de comentarios",
      expect: { playbook: "tiny", task_type: "mechanical", executor_model: "openai/gpt-5.6-terra", agents: ["maker"] },
    },
    {
      name: "secure_vuln_fix",
      request: "Arregla la vulnerabilidad XSS y el SQL injection del endpoint de auth",
      expect: { playbook: "secure", task_type: "secure", executor_model: "openai/gpt-5.6-sol", agents: ["maker", "appsec-engineer", "Check-Reviewer", "Technical-Verifier"] },
    },
    {
      name: "prod_whitelist_deploy",
      request: "Despliega a produccion con git pull origin test y pm2 restart",
      expect: { playbook: "prod", task_type: "prod", executor_model: "openai/gpt-5.6-sol", agents: ["sre-engineer"] },
    },
    {
      name: "web_research_parallel",
      request: "Busca en internet la documentacion oficial de Flutter Riverpod version actual. No edites nada.",
      expect: { playbook: "explore", agents: ["Web-Researcher", "Technical-Verifier"], gates: ["citations-required"] },
    },
    {
      name: "operational_audit_mentions_corrections",
      request: "Solo lectura. Audita cambios recientes de Facturas/Objectives DB2/performance, valida el flujo y el aprendizaje de correcciones de Javier. No edites archivos.",
      expect: { task_tier: "T3", risk_tier: "R3", model_tier: "A", tools: ["flow-policy-check"] },
      reject: { tools: ["correction-capture"] },
    },
    {
      name: "frontend_web_landing",
      request: "Crea una landing Next.js desde cero con la pagina de inicio",
      expect: { playbook: "build", task_type: "frontend_web", executor_model: "openai/gpt-5.6-terra", phases: ["verificacion_visual_navegador", "optimizacion_web", "critic_diff"], gates: ["web-vitals-or-flutter-perf", "system-tests-and-a11y"] },
    },
    {
      name: "financial_commissions_stay_sol",
      request: "Aplica el recalculo de comisiones de agosto usando R1_T8CDVD. No toques LCCDVD.",
      expect: { playbook: "build", task_type: "financial", executor_model: "openai/gpt-5.6-sol", gates: ["commercial-column-invariant", "critic-ears-evidence"] },
    },
    {
      name: "factory_client_app",
      request: "Crea una app completa desde cero para un cliente: frontend, backend, SEO y optimizacion. Entregable profesional, no vibecode.",
      expect: {
        playbook: "build",
        task_type: "factory",
        executor_model: "openai/gpt-5.6-sol",
        phases: ["living_spec", "seo", "a11y_copy_legal", "observability_ci", "secure_scan", "delivery_contract", "open_pr"],
        gates: ["living-spec-exists", "product-delivery-contract", "seo-baseline", "a11y-baseline", "observability-baseline", "pr-evidence"],
        tools: ["goal-loop-manager"],
        agents: ["maker", "product-ux", "appsec-engineer", "Check-Reviewer"],
        departments: ["quality", "seo", "a11y", "legal", "observability"],
      },
      reject: { gates: ["production-approval-token"], tools: ["production-approval-gate"] },
    },
    {
      name: "bug_loop_until_green",
      request: "Arregla los bugs y no pares hasta que flutter test este en verde",
      expect: { playbook: "build", task_type: "bug_loop", tools: ["goal-loop-manager"], phases: ["reproduce", "maker", "critic_diff"] },
    },
    {
      name: "ship_pr_not_prod",
      request: "Crea un pull request con el diff actual. No lo merges a main.",
      expect: { playbook: "build", task_type: "ship_pr", gates: ["pr-evidence"], agents: ["sre-engineer"] },
      reject: { gates: ["production-approval-token"] },
    },
    {
      name: "agency_restaurant_web",
      request: "Hazme una web para un restaurante en Espana, entregable profesional",
      expect: {
        playbook: "build",
        task_type: "factory",
        departments: ["quality", "seo", "a11y", "legal", "copy"],
        gates: ["a11y-baseline", "legal-privacy-baseline", "product-delivery-contract"],
      },
      reject: { gates: ["production-approval-token"] },
    },
    {
      name: "saas_payments_i18n",
      request: "Crea un SaaS con Stripe, i18n y analytics para un cliente",
      expect: {
        playbook: "build",
        task_type: "factory",
        departments: ["payments", "i18n", "analytics", "quality"],
        gates: ["idempotency-key-required", "analytics-baseline"],
      },
    },
    {
      name: "quality_always_on_without_asking",
      request: "Arregla el endpoint de pedidos que no trae el total",
      expect: {
        playbook: "build",
        task_type: "backend",
        departments: ["quality", "qa", "architecture"],
        skills: ["code-quality-contract", "ponytail"],
        gates: ["code-quality-contract"],
      },
    },
  ]

  const results = scenarios.map((scenario) => {
    const route = buildRoute(scenario.request, "gmp", scenario.request.toLowerCase().startsWith("equipo,"))
    const failures: string[] = []
    if (scenario.expect.task_type && route.task_type !== scenario.expect.task_type) failures.push(`task_type expected ${scenario.expect.task_type} got ${route.task_type}`)
    if (scenario.expect.executor_model && route.cost_policy.executor_model !== scenario.expect.executor_model) failures.push(`executor_model expected ${scenario.expect.executor_model} got ${route.cost_policy.executor_model}`)
    for (const phaseName of scenario.expect.phases || []) if (!route.phases.some((item) => item.name === phaseName)) failures.push(`missing phase ${phaseName}`)
    if (route.cost_policy.planner_model !== "openai/gpt-5.6-sol") failures.push("planner_model must stay sol")
    if (route.cost_policy.critic_model !== "openai/gpt-5.6-sol") failures.push("critic_model must stay sol")
    const rank = { "openai/gpt-5.6-luna": 1, "openai/gpt-5.6-terra": 2, "openai/gpt-5.6-sol": 3 } as const
    if (rank[route.cost_policy.critic_model] < rank[route.cost_policy.executor_model]) failures.push("critic cheaper than executor")
    if (scenario.expect.task_tier && route.task_tier !== scenario.expect.task_tier) failures.push(`task_tier expected ${scenario.expect.task_tier} got ${route.task_tier}`)
    if (scenario.expect.risk_tier && route.classification.risk_tier !== scenario.expect.risk_tier) failures.push(`risk_tier expected ${scenario.expect.risk_tier} got ${route.classification.risk_tier}`)
    if (scenario.expect.model_tier && route.classification.model_tier !== scenario.expect.model_tier) failures.push(`model_tier expected ${scenario.expect.model_tier} got ${route.classification.model_tier}`)
    for (const agent of scenario.expect.agents || []) if (!route.required_agents.includes(agent)) failures.push(`missing agent ${agent}`)
    for (const server of scenario.expect.mcp || []) if (!route.required_mcp.includes(server)) failures.push(`missing mcp ${server}`)
    for (const gate of scenario.expect.gates || []) if (!route.required_gates.includes(gate)) failures.push(`missing gate ${gate}`)
    for (const item of scenario.expect.tools || []) if (!route.required_tools.includes(item)) failures.push(`missing tool ${item}`)
    for (const desk of scenario.expect.departments || []) if (!route.departments.includes(desk)) failures.push(`missing department ${desk}`)
    for (const skill of scenario.expect.skills || []) if (!route.required_skills.includes(skill)) failures.push(`missing skill ${skill}`)
    for (const gate of scenario.reject?.gates || []) if (route.required_gates.includes(gate)) failures.push(`rejected gate present ${gate}`)
    for (const item of scenario.reject?.tools || []) if (route.required_tools.includes(item)) failures.push(`rejected tool present ${item}`)
    return {
      name: scenario.name,
      status: failures.length === 0 ? "PASS" : "FAIL",
      failures,
      actual: {
        playbook: route.playbook,
        task_tier: route.task_tier,
        classification: route.classification,
        required_agents: route.required_agents,
        required_mcp: route.required_mcp,
        required_gates: route.required_gates,
        required_tools: route.required_tools,
      },
    }
  })
  const failed = results.filter((item) => item.status === "FAIL")
  return { status: failed.length === 0 ? "PASS" : "FAIL", total: results.length, failed: failed.length, results }
}

function chooseTier(flags: Record<string, boolean>): "T1" | "T2" | "T3" {
  if (flags.isProd || flags.isLong || flags.isIrreversible || flags.isDb || flags.isCriticalFlow || flags.isFinancial || flags.isFactory || (flags.isPerformance && flags.wantsChange) || (flags.isSecurity && flags.wantsChange)) {
    return "T3"
  }
  if (flags.wantsChange) return "T2"
  return "T1"
}

function buildClassification(flags: {
  taskTier: "T1" | "T2" | "T3"
  confidence: number
  wantsChange: boolean
  isProd: boolean
  isLong: boolean
  isCriticalFlow: boolean
  isDb: boolean
  isBackend: boolean
  isFlutter: boolean
  isPerformance: boolean
  isSecurity: boolean
  isRuntime: boolean
  isCache: boolean
  isResearch: boolean
  isIrreversible: boolean
  isFinancial: boolean
  isFactory: boolean
}): Route["classification"] {
  const reasons: string[] = []
  let risk: Route["classification"]["risk_tier"] = "R0"
  if (flags.wantsChange) risk = "R2"
  if (flags.isDb || flags.isCriticalFlow || flags.isPerformance || flags.isSecurity || flags.isRuntime || flags.isProd || flags.isFinancial || flags.isFactory) risk = "R3"
  if (flags.isIrreversible || (flags.isProd && flags.wantsChange)) risk = "R4"
  if (!flags.wantsChange && !flags.isDb && !flags.isProd && !flags.isRuntime && !flags.isSecurity) risk = flags.isResearch ? "R1" : "R0"
  const freezeReadRisk = !flags.wantsChange && (flags.isResearch || risk === "R0" || risk === "R1")
  if (!freezeReadRisk) {
    if (flags.confidence < 0.82 && risk === "R0") risk = "R1"
    else if (flags.confidence < 0.82 && risk === "R1") risk = "R2"
    else if (flags.confidence < 0.82 && risk === "R2") risk = "R3"
  } else if (flags.confidence < 0.82 && risk === "R0") {
    risk = "R1"
  }

  if (flags.isProd) reasons.push("production_or_server")
  if (flags.isFinancial) reasons.push("financial_commissions_or_targets")
  if (flags.isFactory) reasons.push("product_factory_client_ready")
  if (flags.isDb) reasons.push("db2_real_data")
  if (flags.isCriticalFlow) reasons.push("business_critical_flow")
  if (flags.isPerformance || flags.isCache) reasons.push("performance_or_cache_sensitive")
  if (flags.isSecurity) reasons.push("security_or_auth_surface")
  if (flags.isRuntime) reasons.push("runtime_logs_or_health")
  if (flags.isLong) reasons.push("large_or_mixed_prompt")
  if (flags.confidence < 0.82) reasons.push("low_routing_confidence")
  if (reasons.length === 0) reasons.push(flags.wantsChange ? "local_reversible_change" : "read_only_low_risk")

  const complexity: Route["classification"]["complexity_class"] =
    flags.isLong ? "C4" :
    flags.isProd || flags.isDb || flags.isCriticalFlow ? "C3" :
    flags.isBackend || flags.isFlutter || flags.isPerformance ? "C2" :
    flags.wantsChange || flags.isResearch ? "C1" : "C0"

  const modelTier: Route["classification"]["model_tier"] =
    risk === "R4" || risk === "R3" || complexity === "C4" || flags.isSecurity ? "A" :
    flags.taskTier === "T2" || complexity === "C2" ? "B" :
    flags.taskTier === "T1" ? "C" : "B"

  const autonomy: Route["classification"]["autonomy_level"] =
    risk === "R4" ? "A4_HUMAN_APPROVAL" :
    risk === "R3" ? "A3_GATED_IMPLEMENT" :
    flags.wantsChange ? "A2_LOCAL_IMPLEMENT" :
    risk === "R1" ? "A1_SAFE_DISCOVERY" : "A0_READ_ONLY"

  const verification: Route["classification"]["verification_level"] =
    risk === "R4" ? "V4_RELEASE_GATES" :
    risk === "R3" ? "V3_CROSS_AGENT" :
    flags.wantsChange ? "V2_LOCAL_CHECKS" :
    risk === "R0" ? "V1_EVIDENCE" : "V1_EVIDENCE"

  return {
    workflow_tier: flags.taskTier,
    risk_tier: risk,
    complexity_class: complexity,
    model_tier: modelTier,
    autonomy_level: autonomy,
    verification_level: verification,
    confidence_action: flags.confidence < 0.82 ? "clarify_or_safe_discovery_before_execution" : "proceed_with_declared_gates",
    reasons,
  }
}

function buildDecisionTree(classification: Route["classification"], wantsChange: boolean, prod: boolean, db: boolean, flutter: boolean, backend: boolean, perf: boolean, security: boolean) {
  const steps = [
    `0. Clasificar: workflow=${classification.workflow_tier}, risk=${classification.risk_tier}, model=${classification.model_tier}, autonomy=${classification.autonomy_level}, verification=${classification.verification_level}.`,
    "1. Optimizar prompt y ejecutar decision-router.",
    "2. Ejecutar flow-policy-check; si BLOCK, corregir ruta o parar.",
    "3. Cargar RAG, memoria y archivos reales antes de afirmar hechos.",
  ]
  if (!wantsChange) steps.push("4. Responder en modo lectura con evidencia; no editar.")
  if (wantsChange) steps.push("4. Crear plan, Code-Autopilot y context packet por workstream.")
  if (db) steps.push("5. Verificar DB2 en solo lectura: tablas, columnas, cardinalidad y SQL seguro.")
  if (backend) steps.push("6. Backend: localizar rutas/servicios reales, implementar con validacion, timeouts y errores tipados.")
  if (flutter) steps.push("7. Flutter: actualizar UI/data segun capa, build_runner si toca modelos/providers.")
  if (perf) steps.push("8. Performance: bloquear N+1, for-await de registros y queries sin paginacion.")
  if (security) steps.push("9. AppSec: secretos, auth, permisos, dependencias y superficie OWASP.")
  if (classification.workflow_tier !== "T1") steps.push("10. QA: unit/regression/E2E/smoke segun alcance y elite-quality-gate.")
  if (prod) steps.push("11. Staging primero, SRE health 60s, token production-approval-gate y solo entonces produccion.")
  steps.push("12. Release evidence, Telegram y memoria/retrospectiva si hubo error repetido.")
  return steps
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function hasAny(text: string, needles: string[]) {
  return needles.some((needle) => text.includes(normalize(needle)))
}

function startsWithAny(text: string, needles: string[]) {
  return needles.some((needle) => text.trim().startsWith(normalize(needle)))
}

function unique<T>(items: T[]) {
  return [...new Set(items)]
}

function departmentsFor(flags: {
  playbook: Playbook
  taskType: TaskType
  wantsChange: boolean
  isFactory: boolean
  isSeo: boolean
  isA11y: boolean
  isI18n: boolean
  isAnalytics: boolean
  isLegal: boolean
  isPayments: boolean
  isEmail: boolean
  isCms: boolean
  isSearch: boolean
  isOffline: boolean
  isPush: boolean
  isPdf: boolean
  isDataBi: boolean
  isAdmin: boolean
  isAuth: boolean
  isObservability: boolean
  isFlutter: boolean
  isBackend: boolean
  isDb: boolean
  isDesign: boolean
  isGreenfield: boolean
  isFinancial: boolean
  isProd: boolean
  isResearch: boolean
  isPerformance: boolean
}): string[] {
  const desks = new Set<string>()
  if (["build", "sweep", "secure"].includes(flags.playbook)) {
    for (const desk of ["quality", "architecture", "qa", "security_baseline", "git"]) desks.add(desk)
  }
  if (flags.isFactory || flags.taskType === "factory") {
    for (const desk of [
      "product",
      "architecture",
      "design",
      "backend",
      "frontend",
      "a11y",
      "seo",
      "performance",
      "security",
      "qa",
      "observability",
      "ci",
      "copy",
      "legal",
      "analytics",
      "docs",
      "growth",
    ]) desks.add(desk)
  }
  if (flags.isResearch) desks.add("research")
  if (flags.isProd) desks.add("sre")
  if (flags.isFinancial) desks.add("financial")
  if (flags.isDb) desks.add("database")
  if (flags.isBackend) desks.add("backend")
  if (flags.isFlutter || flags.isGreenfield) desks.add("frontend")
  if (flags.isDesign) desks.add("design")
  if (flags.isSeo) desks.add("seo")
  if (flags.isA11y) desks.add("a11y")
  if (flags.isI18n) desks.add("i18n")
  if (flags.isAnalytics) desks.add("analytics")
  if (flags.isLegal) desks.add("legal")
  if (flags.isPayments) desks.add("payments")
  if (flags.isEmail) desks.add("email")
  if (flags.isCms) desks.add("cms")
  if (flags.isSearch) desks.add("search")
  if (flags.isOffline) desks.add("offline")
  if (flags.isPush) desks.add("push")
  if (flags.isPdf) desks.add("pdf")
  if (flags.isDataBi) desks.add("data_bi")
  if (flags.isAdmin) desks.add("admin")
  if (flags.isAuth) desks.add("auth")
  if (flags.isObservability) desks.add("observability")
  if (flags.isPerformance) desks.add("performance")
  if (flags.playbook === "secure") desks.add("security")
  return unique([...desks])
}

const DEPARTMENT_SKILLS: Record<string, string[]> = {
  quality: ["code-quality-contract", "ponytail", "production-grade-checklist", "best-practices"],
  architecture: ["living-spec", "spec-driven-development", "planning-and-task-breakdown"],
  qa: ["test-driven-development", "qa-checklist", "regression-safety-checks"],
  security_baseline: ["security-and-hardening", "auth-security"],
  security: ["security-and-hardening", "security-audit", "auth-security"],
  git: ["git-commit-discipline", "release-evidence-gate"],
  product: ["living-spec", "product-design-docs", "idea-refine"],
  design: ["frontend-design", "ux-writing", "polish", "responsive-design"],
  frontend: ["frontend-ui-engineering", "gmp-mobilidad-flutter", "flutter-riverpod-gmp", "nextjs-app-router"],
  backend: ["node-backend-patterns", "api-spec-first", "jwt-refresh-flow"],
  database: ["db2-safe-change", "db2-query-patterns"],
  a11y: ["accessibility-audit", "addy-accessibility-checklist"],
  seo: ["seo-optimization"],
  performance: ["performance-optimization", "cache-strategy"],
  observability: ["monitoring-stack", "error-handling"],
  ci: ["cicd-pipeline", "release-evidence-gate"],
  copy: ["ux-writing"],
  legal: ["production-grade-checklist"],
  analytics: ["team-metrics"],
  docs: ["docs-sync", "documentation-and-adrs"],
  growth: ["shipping-and-launch", "seo-optimization"],
  payments: ["auth-security", "api-spec-first"],
  i18n: ["i18n-l10n"],
  email: ["error-handling"],
  cms: ["docs-sync", "ux-writing"],
  search: ["rag-retrieval"],
  offline: ["flutter-offline"],
  push: ["push-notifications"],
  pdf: ["pdf-generation"],
  data_bi: ["powerbi-specialist"],
  admin: ["frontend-ui-engineering", "node-backend-patterns"],
  auth: ["auth-security", "jwt-refresh-flow"],
  research: ["source-driven-development"],
  sre: ["sre-runbooks", "ssh-prod-ops", "incident-response-runbook"],
  financial: ["db2-query-patterns", "db2-safe-change"],
}

function skillsForDepartments(departments: string[]): string[] {
  const skills: string[] = []
  for (const desk of departments) {
    for (const skill of DEPARTMENT_SKILLS[desk] || []) skills.push(skill)
  }
  return unique(skills)
}

function compactSkills(playbook: Playbook, skills: Set<string>): string[] {
  const allow = new Set([
    "v5-playbook-orchestra",
    "progressive-context",
    "code-quality-contract",
    "ponytail",
    "production-grade-checklist",
    "best-practices",
    "living-spec",
    "spec-driven-development",
    "planning-and-task-breakdown",
    "test-driven-development",
    "qa-checklist",
    "regression-safety-checks",
    "db2-safe-change",
    "db2-query-patterns",
    "ssh-prod-ops",
    "sre-runbooks",
    "incident-response-runbook",
    "performance-optimization",
    "cache-strategy",
    "goal-driven-loop",
    "memory-learning-loop",
    "security-and-hardening",
    "security-audit",
    "auth-security",
    "gmp-mobilidad-flutter",
    "flutter-riverpod-gmp",
    "node-backend-patterns",
    "greenfield-pipeline",
    "frontend-ui-engineering",
    "frontend-design",
    "seo-optimization",
    "git-worktrees",
    "release-evidence-gate",
    "git-commit-discipline",
    "openspec-explore",
    "accessibility-audit",
    "addy-accessibility-checklist",
    "error-handling",
    "monitoring-stack",
    "cicd-pipeline",
    "ux-writing",
    "i18n-l10n",
    "api-spec-first",
    "jwt-refresh-flow",
    "nextjs-app-router",
    "responsive-design",
    "polish",
    "docs-sync",
    "documentation-and-adrs",
    "shipping-and-launch",
    "idea-refine",
    "product-design-docs",
    "flutter-offline",
    "push-notifications",
    "pdf-generation",
    "powerbi-specialist",
    "rag-retrieval",
    "source-driven-development",
    "team-metrics",
  ])
  const kept = [...skills].filter((skill) => allow.has(skill))
  const pinned = ["v5-playbook-orchestra", "progressive-context"]
  if (["build", "sweep", "secure"].includes(playbook)) {
    pinned.push("code-quality-contract", "ponytail", "production-grade-checklist")
  }
  if (playbook === "sweep") pinned.push("git-worktrees")
  const rest = kept.filter((skill) => !pinned.includes(skill))
  return unique([...pinned, ...rest]).slice(0, 18)
}

function computeConfidence(signals: string[], wantsChange: boolean) {
  const base = wantsChange ? 0.78 : 0.72
  return Math.min(0.96, Number((base + Math.min(signals.length, 6) * 0.03).toFixed(2)))
}

function newTaskId(project: "gmp" | "granja") {
  const now = new Date()
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .replace("T", "-")
  return `${stamp}-${project}-${Math.random().toString(36).slice(2, 6)}`
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  const report = runSelfTest()
  const root = process.cwd()
  await fs.mkdir(path.join(root, ".opencode", "state"), { recursive: true })
  const samples = [
    ["build", "Arregla la pantalla Flutter de repartidor, el tab se descuadra en movil"],
    ["explore", "Dime que hace este repositorio sin cambiar nada"],
    ["secure", "Arregla la vulnerabilidad XSS y el SQL injection del endpoint de auth"],
    ["prod", "Despliega a produccion con git pull origin test y pm2 restart"],
    ["research", "Busca en internet la documentacion oficial de Flutter Riverpod version actual. No edites nada."],
    ["frontend", "Arregla la pantalla Flutter de repartidor, el tab se descuadra en movil"],
    ["financial", "Aplica el recalculo de comisiones de agosto usando R1_T8CDVD. No toques LCCDVD."],
    ["factory", "Crea una app completa desde cero para un cliente: frontend, backend, SEO y optimizacion. Entregable profesional, no vibecode."],
    ["agency", "Hazme una web para un restaurante en Espana, entregable profesional"],
  ]
  for (const [name, request] of samples) {
    const route = buildRoute(request, "gmp", false)
    await fs.writeFile(path.join(root, ".opencode", "state", `decision-route-v5-${name}.json`), JSON.stringify(route, null, 2), "utf8")
  }
  console.log(JSON.stringify({ status: report.status, total: report.total, failed: report.failed, failures: report.results.filter((item) => item.status === "FAIL") }, null, 2))
  process.exit(report.status === "PASS" ? 0 : 1)
}
