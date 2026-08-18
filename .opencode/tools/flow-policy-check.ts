import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

type Finding = {
  severity: "BLOCK" | "WARN"
  rule: string
  evidence: string
  fix: string
}

type Route = {
  task_id?: string
  intent?: string
  task_tier?: string
  confidence?: number
  signals?: string[]
  risk_flags?: string[]
  workstreams?: string[]
  required_agents?: string[]
  required_mcp?: string[]
  required_tools?: string[]
  required_skills?: string[]
  autonomous_commands?: string[]
  required_gates?: string[]
  evidence_required?: string[]
  playbook?: string
  task_type?: string
  phases?: { name?: string; gate_id?: string; executor_model?: string }[]
  cost_policy?: {
    planner_model?: string
    executor_model?: string
    critic_model?: string
    executor_cheap_allowed?: boolean
  }
  classification?: {
    workflow_tier?: string
    risk_tier?: string
    complexity_class?: string
    model_tier?: string
    autonomy_level?: string
    verification_level?: string
    confidence_action?: string
    reasons?: string[]
  }
}

const flowPolicyTool = tool({
  description: "Valida la ruta V5: playbook, roster de 12, gates y evidencias. No exige organigrama V4.",
  args: {
    route_json: tool.schema.string().default("").describe("JSON devuelto por decision-router. Si viene vacio usa la ultima decision-route del state."),
    task_id: tool.schema.string().default("").describe("task_id concreto a validar si no se pasa route_json."),
    fail_on_warn: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const routeJson = (args.route_json ?? "").trim()
    const route = routeJson ? parseRoute(routeJson) : await loadRoute(root, (args.task_id ?? "").trim())
    const findings = await validateRoute(root, route)
    const blocks = findings.filter((item) => item.severity === "BLOCK")
    const warns = findings.filter((item) => item.severity === "WARN")
    const status = blocks.length > 0 || (args.fail_on_warn && warns.length > 0) ? "BLOCK" : "PASS"
    const payload = {
      status,
      task_id: route.task_id || "unknown",
      task_tier: route.task_tier || "unknown",
      block_count: blocks.length,
      warn_count: warns.length,
      findings,
    }

    await fs.mkdir(path.join(root, ".opencode", "state"), { recursive: true })
    await fs.writeFile(path.join(root, ".opencode", "state", `flow-policy-check-${Date.now()}.json`), JSON.stringify(payload, null, 2), "utf8")
    return { output: JSON.stringify(payload, null, 2), metadata: { success: status === "PASS", ...payload } }
  },
})

function parseRoute(value: string): Route {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== "object") throw new Error("route_json no es objeto")
    return parsed
  } catch (error) {
    throw new Error(`FLOW_POLICY_INVALID_JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function loadRoute(root: string, taskId: string): Promise<Route> {
  const stateDir = path.join(root, ".opencode", "state")
  const files: string[] = await fs.readdir(stateDir).catch((): string[] => [])
  const candidates = files.filter((file: string) => file.startsWith("decision-route-") && file.endsWith(".json"))
  if (taskId) {
    const exact = candidates.find((file: string) => file.includes(taskId))
    if (!exact) throw new Error(`FLOW_POLICY_ROUTE_NOT_FOUND: ${taskId}`)
    return parseRoute(await fs.readFile(path.join(stateDir, exact), "utf8"))
  }
  const stats = await Promise.all(candidates.map(async (file: string) => ({ file, stat: await fs.stat(path.join(stateDir, file)) })))
  const latest = stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]
  if (!latest) throw new Error("FLOW_POLICY_NO_ROUTE: ejecuta decision-router antes de flow-policy-check")
  return parseRoute(await fs.readFile(path.join(stateDir, latest.file), "utf8"))
}

async function loadTaskScope(root: string, taskId: string) {
  if (!taskId) return ""
  const stateDir = path.join(root, ".opencode", "state")
  const stateText = await fs.readFile(path.join(stateDir, `${taskId}.json`), "utf8").catch(() => "")
  const approvalText = await fs.readFile(path.join(stateDir, "approvals", `${taskId}.json`), "utf8").catch(() => "")
  return `${stateText}\n${approvalText}`.toLowerCase()
}

function hasJavierOnlyDbMutationScope(route: Route, taskScope: string) {
  const gates = set(route.required_gates)
  const risks = set(route.risk_flags)
  const combined = `${route.intent || ""} ${(route.signals || []).join(" ")} ${(route.risk_flags || []).join(" ")} ${taskScope}`.toLowerCase()
  const db2Mutation = risks.has("db2_write_or_schema_change")
  const javierOnly =
    gates.has("javier-test-schema-only") ||
    (combined.includes("javier") &&
      (combined.includes("solo") || combined.includes("limited") || combined.includes("limitada") || combined.includes("schema javier") || combined.includes("esquema javier")) &&
      (combined.includes("no tocar dsedac") || combined.includes("prohibido tocar dsedac") || combined.includes("no-dsedac") || combined.includes("sin dsedac")))
  const productionMutation = risks.has("production_mutation") && !combined.includes("prohibido") && !combined.includes("no production")
  return db2Mutation && javierOnly && !productionMutation
}

async function validateRoute(root: string, route: Route) {
  const findings: Finding[] = []
  const agents = set(route.required_agents)
  const mcp = set(route.required_mcp)
  const tools = set(route.required_tools)
  const skills = set(route.required_skills)
  const commands = set(route.autonomous_commands)
  const gates = set(route.required_gates)
  const risks = set(route.risk_flags)
  const signals = set(route.signals)
  const streams = set(route.workstreams)
  const evidenceRequired = (route.evidence_required || []).map((item) => String(item).trim()).filter(Boolean)
  const taskScope = await loadTaskScope(root, route.task_id || "")
  const javierOnlyDbMutation = hasJavierOnlyDbMutationScope(route, taskScope)
  const tier = String(route.task_tier || "").toUpperCase()
  const intent = String(route.intent || "")
  const execution = commands.has("workflow") || commands.has("verify") || /change|implementation|critical/i.test(intent)

  requireAny(findings, "route_core", route.task_id, "La ruta no tiene task_id.", "Ejecutar decision-router y no continuar con rutas anonimas.")
  requireAny(findings, "route_core", route.task_tier, "La ruta no tiene task_tier.", "Ejecutar decision-router y clasificar T1/T2/T3.")
  requireSet(findings, tools, "decision-router", "route_core", "Toda ruta debe declarar decision-router.", "Volver a generar la ruta.")
  requireSet(findings, tools, "handoff-ledger", "route_core", "Toda ruta debe declarar handoff-ledger.", "Agregar pizarra de handoffs al flujo.")
  requireSet(findings, skills, "v5-playbook-orchestra", "route_core", "Toda ruta debe cargar v5-playbook-orchestra.", "Cargar skill de playbooks V5.")
  await checkRequiredConfig(root, findings)
  await checkFlowPolicyFile(root, findings, route, risks, intent, commands)
  validateClassification(route, findings, javierOnlyDbMutation)
  checkCostAndPhases(route, findings, gates)

  if ((tier === "T2" || tier === "T3") && evidenceRequired.length === 0) {
    findings.push(block(
      "tier23_evidence_required",
      `Tier ${tier} sin evidence_required concreto.`,
      "Regenerar la ruta con evidencia obligatoria: archivos leidos, handoffs, comandos/MCP, tests o motivo verificable."
    ))
  }

  if ((tier === "T2" || tier === "T3") && execution && !["explore", "tiny", "prod"].includes(String(route.playbook || ""))) {
    for (const agent of ["maker", "qa-automation-lead", "Check-Reviewer"]) {
      requireSet(findings, agents, agent, "tier23_agent", `Tier ${tier} sin ${agent}.`, "Regenerar ruta o escalar a Chief.")
    }
    if (tier === "T3" && route.playbook !== "secure") {
      for (const agent of ["Architect-Planner", "Technical-Verifier"]) {
        requireSet(findings, agents, agent, "tier23_agent", `Tier ${tier} sin ${agent}.`, "T3 exige planner y verifier independientes.")
      }
    }
    if (route.playbook === "secure") {
      requireSet(findings, agents, "appsec-engineer", "secure_agent", "SECURE sin appsec-engineer.", "AppSec audita el diff; no escribe el parche.")
      requireSet(findings, agents, "Technical-Verifier", "secure_agent", "SECURE sin Technical-Verifier.", "Cerrar SECURE con evidencia, no con el juicio del maker.")
    }
    requireSet(findings, gates, "plan-approval-before-code", "tier23_gate", `Tier ${tier} sin gate plan-approval-before-code.`, "Pedir aprobacion de plan antes de editar codigo.")
    for (const gate of ["qa-pass", "release-evidence-gate"]) {
      requireSet(findings, gates, gate, "tier23_gate", `Tier ${tier} sin gate ${gate}.`, "Agregar QA/evidence antes de cerrar.")
    }
    requireSet(findings, tools, "plan-approval-gate", "tier23_tool", `Tier ${tier} sin plan-approval-gate.`, "Pedir aprobacion de plan antes de editar codigo.")
    requireSet(findings, tools, "elite-quality-gate", "tier23_tool", `Tier ${tier} sin elite-quality-gate.`, "Agregar gate de calidad determinista.")
    requireSet(findings, tools, "code-quality-contract", "tier23_tool", `Tier ${tier} sin code-quality-contract.`, "Pasar el filtro Politec+elite antes de cerrar.")
    requireSet(findings, tools, "handoff-ledger", "tier23_tool", `Tier ${tier} sin handoff-ledger.`, "Registrar context packets y outputs de subagentes.")
    requireSet(findings, commands, "verify", "tier23_command", `Tier ${tier} no activa verify.`, "Agregar verify a autonomous_commands.")
    requireSet(findings, gates, "critic-before-verify", "critic_gate", `Tier ${tier} sin gate critic-before-verify.`, "Insertar step critic entre execute y verify.")
    requireSet(findings, gates, "code-quality-contract", "tier23_gate", `Tier ${tier} sin gate code-quality-contract.`, "No cerrar sin scorecard PASS.")
  }

  const db2 = hasAny(signals, ["db2_or_business_flow"]) || hasAny(streams, ["db2"]) || hasAny(risks, ["db2_schema_or_data_dependency"])
  if (db2) {
    for (const agent of ["DB2-AS400-Specialist"]) {
      requireSet(findings, agents, agent, "db2_agent", `Ruta DB2 sin ${agent}.`, "DB2 requiere verificacion de schema y optimizacion set-based.")
    }
    requireSet(findings, mcp, "ibm-db2-mcp", "db2_mcp", "Ruta DB2 sin MCP ibm-db2-mcp.", "Agregar ibm-db2-mcp.")
    for (const gate of ["db2-readonly-discovery-first", "no-n-plus-one", "sql-parameterization"]) {
      requireSet(findings, gates, gate, "db2_gate", `Ruta DB2 sin gate ${gate}.`, "Agregar gate DB2 antes de implementar.")
    }
    for (const skill of ["db2-safe-change", "db2-query-patterns"]) {
      requireSet(findings, skills, skill, "db2_skill", `Ruta DB2 sin skill ${skill}.`, "Cargar skill DB2 obligatoria.")
    }
    if (risks.has("db2_write_or_schema_change")) {
      for (const gate of ["db2-write-approval", "rollback-plan-required"]) {
        requireSet(findings, gates, gate, "db2_mutation_gate", `Mutacion DB2 sin gate ${gate}.`, "Bloquear DB2 write/DDL hasta aprobacion y rollback.")
      }
      requireSet(findings, gates, "idempotency-key-required", "db2_mutation_gate", "Mutacion DB2 sin idempotency-key-required.", "Exigir idempotency key o razon verificable de no reintento antes de escribir.")
      if (javierOnlyDbMutation) {
        requireSet(findings, gates, "no-DSEDAC-DDL-DML", "db2_test_gate", "Mutacion DB2 limitada a JAVIER sin gate no-DSEDAC-DDL-DML.", "Declarar explicitamente que DSEDAC queda fuera del alcance.")
        requireSet(findings, gates, "plan-approval-before-code", "db2_test_gate", "Mutacion DB2 limitada a JAVIER sin aprobacion de plan.", "Pedir aprobacion del plan antes de ejecutar DDL/DML en test.")
      } else {
        requireSet(findings, gates, "production-approval-token", "db2_mutation_gate", "Mutacion DB2 no limitada a JAVIER sin production-approval-token.", "Bloquear DB2 write/DDL hasta approval gate de produccion.")
        requireSet(findings, tools, "production-approval-gate", "db2_mutation_tool", "Mutacion DB2 no limitada a JAVIER sin production-approval-gate.", "Usar approval gate para cambios irreversibles.")
      }
    }
  }

  const runtime = hasAny(signals, ["runtime_logs"]) || hasAny(streams, ["runtime"])
  if (runtime) {
    for (const agent of ["sre-engineer"]) {
      requireSet(findings, agents, agent, "runtime_agent", `Ruta runtime/logs sin ${agent}.`, "Runtime requiere SRE.")
    }
    requireSet(findings, mcp, "gmp-deploy-ssh", "runtime_mcp", "Ruta runtime/logs sin MCP gmp-deploy-ssh.", "Agregar MCP SSH para logs y health checks.")
    requireSet(findings, skills, "ssh-prod-ops", "runtime_skill", "Ruta runtime/logs sin skill ssh-prod-ops.", "Cargar skill de operaciones SSH.")
  }

  const prod = !javierOnlyDbMutation && (hasAny(signals, ["production_or_server"]) || hasAny(risks, ["production_impact"]))
  const prodMutation = prod && intent !== "production_investigation"
  if (prod) {
    for (const agent of ["sre-engineer"]) {
      requireSet(findings, agents, agent, "prod_agent", `Ruta produccion/runtime sin ${agent}.`, "Produccion requiere SRE.")
    }
    requireSet(findings, mcp, "gmp-deploy-ssh", "prod_mcp", "Ruta produccion sin MCP gmp-deploy-ssh.", "Agregar MCP SSH.")
    if (prodMutation) {
      for (const gate of ["staging-first", "qa-pass", "appsec-pass", "sre-health-60s", "production-approval-token"]) {
        requireSet(findings, gates, gate, "prod_gate", `Ruta produccion sin gate ${gate}.`, "Bloquear produccion hasta completar gates.")
      }
      requireSet(findings, gates, "idempotency-key-required", "prod_gate", "Ruta produccion sin idempotency-key-required.", "Exigir idempotency key o razon verificable de no reintento antes de mutar sistemas externos.")
      for (const item of ["production-approval-gate", "staging-deploy"]) {
        requireSet(findings, tools, item, "prod_tool", `Ruta produccion sin tool ${item}.`, "Agregar tool de staging/aprobacion.")
      }
    }
  }

  const perf = hasAny(signals, ["performance_sensitive", "cache_or_redis"]) || hasAny(streams, ["performance", "cache"])
  if (perf && !["explore", "tiny"].includes(String(route.playbook || ""))) {
    for (const agent of ["maker"]) {
      requireSet(findings, agents, agent, "perf_agent", `Ruta performance/cache sin ${agent}.`, "Un maker aplica el fix; el critic valida N+1.")
    }
    requireSet(findings, gates, "n-plus-one-blocking-gate", "perf_gate", "Ruta performance sin gate N+1.", "Bloquear bucles DB/API/IO.")
    requireSet(findings, skills, "performance-optimization", "perf_skill", "Ruta performance sin skill performance-optimization.", "Cargar checklist de rendimiento.")
  }

  const flutter = hasAny(signals, ["flutter_mobile"]) || hasAny(streams, ["flutter"])
  if (flutter && !["explore", "tiny"].includes(String(route.playbook || ""))) {
    for (const agent of ["maker"]) {
      requireSet(findings, agents, agent, "flutter_agent", `Ruta Flutter sin ${agent}.`, "Un maker carga skills Flutter. No spawnear 4 especialistas.")
    }
    for (const item of ["dart-flutter-mcp", "pub-mcp"]) {
      requireSet(findings, mcp, item, "flutter_mcp", `Ruta Flutter sin MCP ${item}.`, "Agregar MCP Flutter/pub.")
    }
  }

  const security = hasAny(signals, ["security_or_api_surface"]) || hasAny(streams, ["security"])
  if (security) {
    requireSet(findings, agents, "appsec-engineer", "security_agent", "Ruta seguridad/API sin appsec-engineer.", "Agregar AppSec antes de release.")
    requireSet(findings, gates, "appsec-pass", "security_gate", "Ruta seguridad/API sin appsec-pass.", "Exigir veredicto AppSec.")
    if (risks.has("secret_or_credential_mutation")) {
      requireSet(findings, gates, "secret-rotation-approval", "secret_gate", "Cambio de secreto sin secret-rotation-approval.", "Bloquear hasta aprobacion y plan de rotacion.")
    }
  }

  if (signals.has("goal_driven_loop")) {
    requireSet(findings, tools, "goal-loop-manager", "goal_loop_tool", "Ruta goal-loop sin goal-loop-manager.", "Crear o reanudar goal antes de iterar.")
    requireSet(findings, tools, "clarification-gate", "goal_loop_tool", "Ruta goal-loop sin clarification-gate.", "Pausar y preguntar ante ambiguedad.")
    requireSet(findings, skills, "goal-driven-loop", "goal_loop_skill", "Ruta goal-loop sin skill goal-driven-loop.", "Cargar skill de loops.")
    requireSet(findings, skills, "ponytail", "goal_loop_skill", "Ruta goal-loop sin ponytail en implementacion.", "Aplicar YAGNI y menor diff en cada iteracion.")
    requireSet(findings, gates, "evidence-per-iteration", "goal_loop_gate", "Goal-loop sin evidence-per-iteration.", "Exigir evidence en cada tick.")
    requireSet(findings, gates, "hybrid-ask-on-ambiguity", "goal_loop_gate", "Goal-loop sin hybrid-ask-on-ambiguity.", "No adivinar; pausar y preguntar.")
  }

  await checkSkillFiles(root, skills, findings)
  await checkCommandFiles(root, commands, findings)
  await checkMcpConfig(root, mcp, findings)
  return findings
}

function checkCostAndPhases(route: Route, findings: Finding[], gates: Set<string>) {
  const cost = route.cost_policy
  if (!cost) {
    if (["build", "sweep", "secure", "prod"].includes(String(route.playbook || ""))) {
      findings.push(block("cost_policy_missing", "Ruta de cambio sin cost_policy.", "Regenerar con decision-router V6 (planner sol, critic >= executor)."))
    }
    return
  }
  const rank: Record<string, number> = { "openai/gpt-5.6-luna": 1, "openai/gpt-5.6-terra": 2, "openai/gpt-5.6-sol": 3 }
  if (cost.planner_model !== "openai/gpt-5.6-sol") {
    findings.push(block("planner_downgrade", `planner_model=${cost.planner_model}.`, "Chief/planner nunca baja de sol."))
  }
  if ((rank[cost.critic_model || ""] || 0) < (rank[cost.executor_model || ""] || 0)) {
    findings.push(block("critic_cheaper_than_maker", `critic=${cost.critic_model} executor=${cost.executor_model}.`, "Critic nunca mas barato que el worker que produjo el output."))
  }
  const high = ["secure", "prod", "db_migration", "financial", "factory"]
  if (high.includes(String(route.task_type || "")) && (cost.executor_model || "").includes("terra")) {
    findings.push(block("executor_too_cheap", `task_type=${route.task_type} con executor terra.`, "SECURE/PROD/DB/financiero/factory se quedan en sol por defecto."))
  }
  const frontend = String(route.task_type || "").startsWith("frontend")
  if (frontend) {
    for (const gate of ["ears-criteria-verifiable", "design-tokens-or-appcolors", "visual-browser-or-golden", "system-tests-and-a11y", "web-vitals-or-flutter-perf", "critic-ears-evidence"]) {
      requireSet(findings, gates, gate, "frontend_phase_gate", `Frontend sin gate ${gate}.`, "Seguir task-playbooks.yaml. Un gate no verificable no es gate.")
    }
  }
  if (String(route.task_type || "") === "factory") {
    for (const gate of ["living-spec-exists", "layered-architecture", "product-delivery-contract", "seo-baseline", "a11y-baseline", "observability-baseline", "pr-evidence", "zero-plaintext-secrets"]) {
      requireSet(findings, gates, gate, "factory_phase_gate", `Factory sin gate ${gate}.`, "Entregable a cliente exige product-delivery-contract.yaml.")
    }
  }
}

function validateClassification(route: Route, findings: Finding[], javierOnlyDbMutation = false) {
  const classification = route.classification
  if (!classification) {
    findings.push(block("classification_missing", "La ruta no contiene classification.", "Regenerar con decision-router actualizado."))
    return
  }
  const workflow = String(classification.workflow_tier || "")
  const risk = String(classification.risk_tier || "")
  const model = String(classification.model_tier || "")
  const autonomy = String(classification.autonomy_level || "")
  const verification = String(classification.verification_level || "")

  requireAny(findings, "classification_core", workflow, "classification.workflow_tier vacio.", "Regenerar ruta.")
  requireAny(findings, "classification_core", risk, "classification.risk_tier vacio.", "Regenerar ruta.")
  requireAny(findings, "classification_core", model, "classification.model_tier vacio.", "Regenerar ruta.")
  requireAny(findings, "classification_core", autonomy, "classification.autonomy_level vacio.", "Regenerar ruta.")
  requireAny(findings, "classification_core", verification, "classification.verification_level vacio.", "Regenerar ruta.")

  if (workflow && route.task_tier && workflow !== route.task_tier) {
    findings.push(block("classification_mismatch", `workflow_tier ${workflow} no coincide con task_tier ${route.task_tier}.`, "Regenerar ruta con una sola fuente de verdad."))
  }

  if (risk === "R4") {
    if (route.task_tier !== "T3") findings.push(block("r4_policy", "R4 debe ser T3.", "Escalar a Tier 3."))
    if (model !== "A") findings.push(block("r4_policy", "R4 debe usar model_tier A.", "Usar modelo maximo para decision critica."))
    if (autonomy !== "A4_HUMAN_APPROVAL") findings.push(block("r4_policy", "R4 requiere A4_HUMAN_APPROVAL.", "Pausar antes de mutacion irreversible."))
    const allowedVerification = javierOnlyDbMutation ? ["V3_CROSS_AGENT", "V4_RELEASE_GATES"] : ["V4_RELEASE_GATES"]
    if (!allowedVerification.includes(verification)) {
      findings.push(block("r4_policy", "R4 requiere V4_RELEASE_GATES, salvo DB2 limitado a JAVIER donde V3_CROSS_AGENT es aceptable.", "Exigir QA/AppSec/SRE/staging/aprobacion segun alcance."))
    }
  }

  if (risk === "R3") {
    if (route.task_tier !== "T3") findings.push(block("r3_policy", "R3 debe ser T3 para fases auditables.", "Escalar a Tier 3."))
    if (model !== "A") findings.push(block("r3_policy", "R3 debe usar model_tier A.", "Usar modelo maximo para DB2/negocio/rendimiento/seguridad."))
    if (autonomy !== "A3_GATED_IMPLEMENT") findings.push(block("r3_policy", "R3 requiere A3_GATED_IMPLEMENT.", "Mantener gates antes de cambiar."))
    if (!["V3_CROSS_AGENT", "V4_RELEASE_GATES"].includes(verification)) {
      findings.push(block("r3_policy", "R3 requiere V3 o V4.", "Agregar QA/reviewer/AppSec/Performance segun dominio."))
    }
  }

  if (risk === "R2") {
    if (!["A", "B"].includes(model)) findings.push(block("r2_policy", "R2 no debe ejecutarse con modelo C automatico.", "Usar modelo B o A para cambios locales."))
    if (autonomy !== "A2_LOCAL_IMPLEMENT") findings.push(block("r2_policy", "R2 requiere A2_LOCAL_IMPLEMENT.", "Permitir solo cambios locales reversibles."))
    if (!["V2_LOCAL_CHECKS", "V3_CROSS_AGENT", "V4_RELEASE_GATES"].includes(verification)) {
      findings.push(block("r2_policy", "R2 requiere V2 o superior.", "Agregar checks locales."))
    }
  }

  if ((risk === "R0" || risk === "R1") && model === "MANUAL_FREE") {
    findings.push(warn("manual_free_model", "MANUAL_FREE solo es aceptable si Javier lo selecciona manualmente.", "No enrutar automaticamente a Zen free en cambios."))
  }

  if (typeof route.confidence === "number" && route.confidence < 0.82 && classification.confidence_action !== "clarify_or_safe_discovery_before_execution") {
    findings.push(block("low_confidence_policy", `confidence ${route.confidence} sin accion de clarificacion/discovery.`, "Pedir aclaracion o discovery seguro antes de ejecutar."))
  }
}

function set(values?: string[]) {
  return new Set((values || []).map((value) => String(value)))
}

function hasAny(values: Set<string>, names: string[]) {
  return names.some((name) => values.has(name))
}

function requireAny(findings: Finding[], rule: string, value: unknown, evidence: string, fix: string) {
  if (!value) findings.push(block(rule, evidence, fix))
}

function requireSet(findings: Finding[], values: Set<string>, expected: string, rule: string, evidence: string, fix: string) {
  if (!values.has(expected)) findings.push(block(rule, evidence, fix))
}

function block(rule: string, evidence: string, fix: string): Finding {
  return { severity: "BLOCK", rule, evidence, fix }
}

function warn(rule: string, evidence: string, fix: string): Finding {
  return { severity: "WARN", rule, evidence, fix }
}

async function checkSkillFiles(root: string, skills: Set<string>, findings: Finding[]) {
  for (const skill of skills) {
    const file = path.join(root, ".opencode", "skills", skill, "SKILL.md")
    try {
      const text = await fs.readFile(file, "utf8")
      if (!/^---[\s\S]*?---/.test(text)) {
        findings.push(warn("skill_frontmatter", `Skill ${skill} no tiene frontmatter YAML.`, "Corregir SKILL.md para que OpenCode lo descubra bien."))
      }
    } catch {
      findings.push(block("skill_missing", `Skill requerida no existe: ${skill}.`, "Crear skill o regenerar ruta sin esa dependencia."))
    }
  }
}

async function checkCommandFiles(root: string, commands: Set<string>, findings: Finding[]) {
  for (const command of commands) {
    const file = path.join(root, ".opencode", "commands", `${command}.md`)
    try {
      await fs.access(file)
    } catch {
      const cfg = await readJson(path.join(root, ".opencode", "opencode.json"))
      const rootCfg = await readJson(path.join(root, "opencode.json"))
      if (!cfg?.command?.[command] && !rootCfg?.command?.[command]) {
        findings.push(warn("command_missing", `Comando autonomo no registrado: ${command}.`, "Crear .opencode/commands o entrada command en opencode.json."))
      }
    }
  }
}

async function checkMcpConfig(root: string, mcp: Set<string>, findings: Finding[]) {
  const cfg = (await readJson(path.join(root, ".opencode", "opencode.json"))) || (await readJson(path.join(root, "opencode.json")))
  for (const server of mcp) {
    if (!cfg?.mcp?.[server]) {
      findings.push(block("mcp_missing_config", `MCP requerido no esta configurado: ${server}.`, "Agregar MCP al opencode.json activo."))
    } else if (cfg.mcp[server].enabled === false) {
      findings.push(block("mcp_disabled", `MCP requerido deshabilitado: ${server}.`, "Habilitar MCP o regenerar ruta."))
    }
  }
}

async function checkRequiredConfig(root: string, findings: Finding[]) {
  const required = [
    ".opencode/config/autonomous-flow.yaml",
    ".opencode/config/handoff-contract.yaml",
    ".opencode/config/task-classification.yaml",
    ".opencode/config/orchestrator-decision-tree.yaml",
    ".opencode/config/playbooks.yaml",
    ".opencode/config/code-quality-contract.yaml",
    ".opencode/config/capability-catalog.yaml",
    ".opencode/config/guardrails.yaml",
    ".opencode/config/delegation-contract.yaml",
    ".opencode/config/session.yaml",
    ".opencode/config/task-playbooks.yaml",
    ".opencode/config/agency-capability-map.yaml",
    ".opencode/config/product-delivery-contract.yaml",
    ".opencode/config/secrets-policy.yaml",
    ".opencode/config/connections.yaml",
    ".opencode/memory/FIELD-GUIDE.md",
    ".opencode/config/flow-policy.yaml",
    ".opencode/rules/learned.yaml",
  ]
  for (const relative of required) {
    try {
      await fs.access(path.join(root, relative))
    } catch {
      findings.push(block("required_config_missing", `Config requerida no existe: ${relative}.`, "Restaurar config V4 antes de ejecutar."))
    }
  }
}

async function checkFlowPolicyFile(root: string, findings: Finding[], route: Route, risks: Set<string>, intent: string, commands: Set<string>) {
  const rel = ".opencode/config/flow-policy.yaml"
  let text = ""
  try {
    text = await fs.readFile(path.join(root, rel), "utf8")
  } catch {
    findings.push(block("flow_policy_missing", `Fuente canonica ausente: ${rel}.`, "Restaurar flow-policy.yaml. El tool no es la unica fuente."))
    return
  }
  if (!text.includes("git pull origin test") || !text.includes("pm2 restart gmp-api")) {
    findings.push(block("deploy_whitelist_missing", "flow-policy.yaml no declara whitelist de deploy.", "Alinear con learned.yaml#deploy."))
  }
  enforceCriticOrder(findings, route, extractYamlStringList(text, "critic_agents"))
  const combined = `${intent} ${(route.autonomous_commands || []).join(" ")} ${(route.risk_flags || []).join(" ")}`.toLowerCase()
  const deployish = risks.has("production_mutation") || /deploy|pm2/.test(combined) || commands.has("deploy")
  if (deployish) {
    if (/pm2\s+(set|save|start|reload)/.test(combined) || /\.env/.test(combined)) {
      findings.push(block(
        "deploy_whitelist",
        "Ruta de deploy fuera de whitelist (pm2 set/save/start/reload o .env).",
        "Solo git pull origin test + pm2 restart gmp-api, o confirmacion explicita de Javier."
      ))
    }
  }
}

async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return null
  }
}

function extractYamlStringList(text: string, key: string): string[] {
  const block = text.match(new RegExp(`${key}:\\s*\\n((?:\\s+-\\s+[^\\n]+\\n)+)`))
  if (!block) return []
  return [...block[1].matchAll(/-\s+(\S+)/g)].map((item) => item[1])
}

function enforceCriticOrder(findings: Finding[], route: Route, loaded: string[]) {
  const tier = String(route.task_tier || "").toUpperCase()
  if (tier !== "T2" && tier !== "T3") return
  if (route.playbook === "explore" || route.playbook === "tiny" || route.playbook === "prod") return
  const criticAgents = loaded.length > 0 ? loaded : ["Check-Reviewer"]
  const agentList = (route.required_agents || []).map((item) => String(item))
  const criticIdx = agentList.findIndex((agent) => criticAgents.includes(agent))
  const verifierIdx = agentList.findIndex((agent) => agent === "Technical-Verifier")
  if (criticIdx < 0) {
    findings.push(block(
      "critic_required",
      `Tier ${tier} sin critic en required_agents (${criticAgents.join("|")}). No basta un substring en otro campo.`,
      "Insertar Check-Reviewer en required_agents ANTES de Technical-Verifier."
    ))
    return
  }
  if (verifierIdx >= 0 && criticIdx > verifierIdx) {
    findings.push(block(
      "critic_order",
      `critic (${agentList[criticIdx]}) aparece despues de Technical-Verifier en required_agents.`,
      "Orden: maker, critic, verifier. Mover el critic antes del verifier."
    ))
  }
}

export default flowPolicyTool

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
  const root = process.cwd()
  const fileArg = process.argv[2]
  const route_json = fileArg ? await fs.readFile(path.resolve(fileArg), "utf8") : ""
  const res = await flowPolicyTool.execute({ route_json, task_id: "", fail_on_warn: false }, { directory: root, worktree: root })
  console.log(res.output)
  process.exit(JSON.parse(res.output).status === "PASS" ? 0 : 1)
}
