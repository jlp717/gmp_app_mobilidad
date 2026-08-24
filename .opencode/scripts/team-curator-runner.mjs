#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const root = process.cwd()
const args = parseArgs(process.argv.slice(2))
const periodDays = Number(args.period || 7)
const staleHours = Number(args["if-stale-hours"] || 120)
const sendToTelegram = Boolean(args.telegram)
const REQUIRED_AGENTS = [
  "chief-engineer-assistant",
  "prompt-optimizer",
  "product-ux",
  "Architect-Planner",
  "sre-engineer",
  "appsec-engineer",
  "qa-automation-lead",
  "code-autopilot",
  "tech-radar-agent",
  "DB2-AS400-Specialist",
  "DB2-Query-Optimizer",
  "Redis-Cache-Specialist",
  "Runtime-Log-Diagnostician",
  "Node-Express-Specialist",
  "API-Contract-Specialist",
  "Flutter-Architecture-Specialist",
  "Flutter-UI-Specialist",
  "Flutter-Data-Specialist",
  "Flutter-Performance-Specialist",
  "Performance-Analyst",
  "Visual-Design-Specialist",
  "Test-Writer",
  "Test-Specialist",
  "Check-Reviewer",
  "Simplify-Reviewer",
  "Technical-Verifier",
  "truth-teller",
  "team-curator",
]
const AMBIGUOUS_TERMS = ["quizas", "probablemente", "si puedes", "intenta", "maybe", "perhaps"]
const REQUIRED_WORKFLOW_STATES = [
  "INTAKE",
  "ROUTED",
  "DISCOVERY",
  "PLAN_READY",
  "WAITING_PLAN_APPROVAL",
  "IMPLEMENTING",
  "VERIFYING",
  "STAGING",
  "WAITING_PRODUCTION_APPROVAL",
  "PRODUCTION_DEPLOY",
  "REPORTING",
  "BLOCKED",
  "DONE",
]
const REQUIRED_WORKFLOW_TOKENS = [
  "plan_before_code",
  "production-approval-gate",
  "Javier adelante",
  "flow-policy-check PASS",
  "model-assignment PASS",
  "agent-roster PASS",
  "TEAM_TRACE entry",
  "idempotency_key",
]

const reportDir = path.join(root, ".opencode", "reports")
fs.mkdirSync(reportDir, { recursive: true })

const latest = latestReport()
if (latest && Date.now() - latest.stat.mtimeMs < staleHours * 60 * 60 * 1000) {
  console.log(`fresh:${latest.file}`)
  process.exit(0)
}

const report = buildReport(periodDays)
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-")
const jsonFile = path.join(reportDir, `team-curator-${stamp}.json`)
const mdFile = path.join(reportDir, `team-curator-${stamp}.md`)

fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), "utf8")
fs.writeFileSync(mdFile, toMarkdown(report), "utf8")

if (sendToTelegram) {
  try {
    report.telegram_sent = await sendTelegram(summary(report))
    fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), "utf8")
  } catch (error) {
    report.telegram_error = error instanceof Error ? error.message : String(error)
    fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), "utf8")
  }
}

console.log(`${report.status}:score=${report.team_score};file=${path.basename(jsonFile)}`)

function parseArgs(raw) {
  const out = {}
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    if (!item.startsWith("--")) continue
    const key = item.slice(2)
    const next = raw[i + 1]
    if (!next || next.startsWith("--")) out[key] = true
    else {
      out[key] = next
      i++
    }
  }
  return out
}

function latestReport() {
  const files = safeList(reportDir)
    .filter((file) => file.startsWith("team-curator-") && file.endsWith(".json"))
    .map((file) => ({ file, stat: fs.statSync(path.join(reportDir, file)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
  return files[0] || null
}

function buildReport(periodDays) {
  const since = Date.now() - Math.max(1, periodDays) * 24 * 60 * 60 * 1000
  const agents = safeList(path.join(root, ".opencode", "agents")).filter((file) => file.endsWith(".md"))
  let agentAudit = latestJson("agent-roster-audit-")
  if (!agentAudit || agentAudit.status !== "PASS" || Number(agentAudit.warn_count || 0) > 0) agentAudit = runAgentAudit()
  let modelAudit = latestJson("model-assignment-audit-")
  if (!modelAudit || modelAudit.status !== "PASS" || Number(modelAudit.warn_count || 0) > 0 || modelAuditStale()) modelAudit = runModelAssignmentAudit()
  let workflowAudit = latestJson("workflow-state-audit-")
  if (!workflowAudit || workflowAudit.status !== "PASS" || Number(workflowAudit.warn_count || 0) > 0 || stateAuditStale()) workflowAudit = runWorkflowStateAudit()
  let readiness = readJson(path.join(root, ".opencode", "state", "readiness-latest.json"))
  if (!readiness || readiness.status !== "PASS" || readinessStale()) readiness = runReadinessSmoke()
  let routeEval = latestJson("decision-router-self-test-")
  if (!routeEval || routeEval.status !== "PASS") routeEval = runRouteContractEval()
  const flowChecks = recentJson("flow-policy-check-", since)
  const metrics = readMetrics()
  const tokenEvents = countRecentLines(path.join(root, ".opencode", "tokens.jsonl"), since)
  const traceEvents = countRecentLines(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), since)
  const sameErrors = unresolvedRepeatedErrors()
  const fallback = readJson(path.join(root, ".opencode", "fallback-models.json")) || {}
  const issues = []

  if (agents.length < 30) issues.push(issue("BLOCK", "agents", `Solo ${agents.length} agentes detectados.`, "Restaurar roster senior antes de tareas complejas."))
  if (agentAudit.status === "BLOCK" || Number(agentAudit.block_count || 0) > 0) issues.push(issue("BLOCK", "agent-roster-audit", `BLOCK=${agentAudit.block_count || 0}.`, "Corregir prompts o agentes faltantes."))
  if (Number(agentAudit.warn_count || 0) > 0) issues.push(issue("WARN", "agent-roster-audit", `WARN=${agentAudit.warn_count}.`, "Revisar advertencias de claridad/evidencia."))
  if (modelAudit.status === "BLOCK" || Number(modelAudit.block_count || 0) > 0) issues.push(issue("BLOCK", "model-assignment-audit", `BLOCK=${modelAudit.block_count || 0}.`, "Corregir modelos pinneados y fallback-models."))
  if (Number(modelAudit.warn_count || 0) > 0) issues.push(issue("WARN", "model-assignment-audit", `WARN=${modelAudit.warn_count}.`, "Revisar advertencias de modelos."))
  if (workflowAudit.status === "BLOCK" || Number(workflowAudit.block_count || 0) > 0) issues.push(issue("BLOCK", "workflow-state-audit", `BLOCK=${workflowAudit.block_count || 0}.`, "Corregir maquina de estados y approval gates."))
  if (Number(workflowAudit.warn_count || 0) > 0) issues.push(issue("WARN", "workflow-state-audit", `WARN=${workflowAudit.warn_count}.`, "Revisar transiciones de estado."))
  if (readiness.status === "BLOCK") issues.push(issue("BLOCK", "readiness-smoke", `${readiness.blockers?.length || 0} bloqueos de readiness.`, "Ejecutar /readiness y corregir MCP/skills/tools/modelos."))
  if (readiness.status === "WARN") issues.push(issue("WARN", "readiness-smoke", `${readiness.warnings?.length || 0} advertencias de readiness.`, "Revisar /readiness antes de tareas Tier 3 o produccion."))

  if (routeEval.status !== "PASS") issues.push(issue("BLOCK", "route-eval", `Estado ${routeEval.status}.`, "Corregir decision-router."))

  const latestFlowPassMtime = Math.max(0, ...flowChecks.filter((item) => item.status === "PASS").map((item) => Number(item.__mtime || 0)))
  const historicalFlowBlocks = flowChecks.filter((item) => item.status === "BLOCK")
  const flowBlocks = historicalFlowBlocks.filter((item) => Number(item.__mtime || 0) > latestFlowPassMtime)
  if (flowBlocks.length > 0) issues.push(issue("BLOCK", "flow-policy", `${flowBlocks.length} bloqueos activos posteriores al ultimo PASS.`, "Revisar rutas bloqueadas."))

  if (!fallback.enabled) issues.push(issue("BLOCK", "model-routing", "fallback-models deshabilitado.", "Reactivar fallback-models."))
  if (!fallback.manual_free_models?.opencode_zen?.length) issues.push(issue("WARN", "opencode-zen", "Sin modelos Zen manuales/free declarados.", "Actualizar fallback-models."))
  if (traceEvents === 0) issues.push(issue("WARN", "team-trace", "Sin eventos TEAM_TRACE recientes.", "Verificar task-tracer."))
  if (sameErrors > 0) issues.push(issue("WARN", "same-error", `${sameErrors} errores repetidos sin retrospectiva.`, "Revisar retrospectivas."))

  const score = scoreIssues(issues)
  return {
    status: issues.some((item) => item.severity === "BLOCK") ? "BLOCK" : score >= 95 ? "PASS" : "WARN",
    team_score: score,
    generated_at: new Date().toISOString(),
    period_days: periodDays,
    agent_count: agents.length,
    routing_health: {
      latest_route_eval: routeEval?.status || "missing",
      recent_flow_checks: flowChecks.length,
      recent_flow_blocks: flowBlocks.length,
      historical_flow_blocks: historicalFlowBlocks.length,
    },
    metrics_health: {
      trace_events: traceEvents,
      token_events: tokenEvents,
      metrics_count: Object.keys(metrics).length,
    },
    model_health: {
      fallback_enabled: Boolean(fallback.enabled),
      manual_zen_models: fallback.manual_free_models?.opencode_zen || [],
      latest_model_audit: modelAudit.status,
    },
    state_health: {
      latest_workflow_audit: workflowAudit.status,
      workflow_blocks: Number(workflowAudit.block_count || 0),
      workflow_warnings: Number(workflowAudit.warn_count || 0),
      readiness_status: readiness.status,
      readiness_score: readiness.score,
    },
    blockers: issues.filter((item) => item.severity === "BLOCK"),
    warnings: issues.filter((item) => item.severity === "WARN"),
    recommended_actions: issues.slice(0, 5).map((item) => `${item.severity}: ${item.source} - ${item.action}`),
    telegram_sent: false,
  }
}

function runReadinessSmoke() {
  const script = path.join(root, ".opencode", "scripts", "readiness-smoke.mjs")
  try {
    const result = spawnSync(process.execPath, [script, "--json"], { cwd: root, encoding: "utf8", timeout: 15000 })
    return JSON.parse(result.stdout || "{}")
  } catch (error) {
    return {
      status: "WARN",
      score: 90,
      blockers: [],
      warnings: [{ severity: "WARN", rule: "readiness_runner_error", evidence: String(error), fix: "Ejecutar node .opencode/scripts/readiness-smoke.mjs --json." }],
    }
  }
}

function readinessStale() {
  const file = path.join(root, ".opencode", "state", "readiness-latest.json")
  try {
    return Date.now() - fs.statSync(file).mtimeMs > 24 * 60 * 60 * 1000
  } catch {
    return true
  }
}

function runAgentAudit() {
  const agentsDir = path.join(root, ".opencode", "agents")
  const findings = []
  const files = safeList(agentsDir).filter((file) => file.endsWith(".md"))
  const byName = new Map(files.map((file) => [path.basename(file, ".md"), readText(path.join(agentsDir, file))]))

  for (const agent of REQUIRED_AGENTS) {
    const text = byName.get(agent)
    if (!text) {
      findings.push({ severity: "BLOCK", agent, rule: "missing_agent", evidence: `Falta ${agent}.md`, fix: "Crear el agente o corregir el roster." })
      continue
    }
    auditAgentText(agent, text, findings)
  }
  for (const [agent, text] of byName) {
    if (!REQUIRED_AGENTS.includes(agent)) auditAgentText(agent, text, findings)
  }

  const blocks = findings.filter((item) => item.severity === "BLOCK")
  const warns = findings.filter((item) => item.severity === "WARN")
  const payload = {
    status: blocks.length ? "BLOCK" : "PASS",
    generated_by: "team-curator-runner",
    required_agents: REQUIRED_AGENTS.length,
    agent_files: files.length,
    block_count: blocks.length,
    warn_count: warns.length,
    findings,
  }
  writeState(`agent-roster-audit-${Date.now()}.json`, payload)
  return payload
}

function auditAgentText(agent, text, findings) {
  if (!/^\uFEFF?---[\s\S]+?---/.test(text)) findings.push({ severity: "BLOCK", agent, rule: "missing_frontmatter", evidence: "Sin frontmatter YAML.", fix: "Agregar description, mode, tools y permissions." })
  if (!/\bmode:\s*(primary|subagent|all)\b/i.test(text)) findings.push({ severity: "BLOCK", agent, rule: "invalid_mode", evidence: "No declara mode primary/subagent/all.", fix: "Declarar mode correcto." })
  if (!/(evidencia|verific|no alucin|no invent|RAG|archivo[s]? le[i]d|PASS|WARN|BLOCK)/i.test(text)) findings.push({ severity: "WARN", agent, rule: "weak_evidence_contract", evidence: "Contrato de evidencia debil.", fix: "Exigir hechos verificados y PASS/WARN/BLOCK cuando aplique." })
  if (!/(fall(a|o)|error|timeout|retry|reintento|escalar|BLOCK|WARN|NEEDS_INFO|bloque)/i.test(text)) findings.push({ severity: "WARN", agent, rule: "weak_failure_contract", evidence: "Protocolo de fallo debil.", fix: "Definir error, timeout, reintento y escalado." })
  if (!/(nunca|no haces|limites|limits|never)/i.test(text)) findings.push({ severity: "WARN", agent, rule: "weak_limits", evidence: "Limites explicitos debiles.", fix: "Definir acciones prohibidas y condiciones de parada." })
  const lower = text.toLowerCase()
  for (const term of AMBIGUOUS_TERMS) {
    if (lower.includes(term)) findings.push({ severity: "WARN", agent, rule: "ambiguous_language", evidence: `Termino ambiguo: ${term}`, fix: "Reemplazar por criterio verificable." })
  }
}

function runWorkflowStateAudit() {
  const text = readText(path.join(root, ".opencode", "config", "workflow-state-machine.yaml"))
  const findings = []
  if (!text) {
    findings.push({ severity: "BLOCK", rule: "missing_state_machine", evidence: "No existe .opencode/config/workflow-state-machine.yaml.", fix: "Crear la maquina de estados V4." })
  }
  for (const state of REQUIRED_WORKFLOW_STATES) {
    if (!new RegExp(`^\\s{4}${state}:`, "m").test(text)) {
      findings.push({ severity: "BLOCK", rule: "missing_state", evidence: `Falta estado ${state}.`, fix: "Agregar estado con allowed_actions y exit_requires." })
    }
  }
  for (const token of REQUIRED_WORKFLOW_TOKENS) {
    if (!text.includes(token)) {
      findings.push({ severity: "BLOCK", rule: "missing_token", evidence: `Falta token operativo: ${token}.`, fix: "Agregarlo a gates, transiciones o audit requirements." })
    }
  }
  if (!/from:\s+WAITING_PLAN_APPROVAL[\s\S]+?to:\s+IMPLEMENTING[\s\S]+?Javier approved plan/i.test(text)) {
    findings.push({ severity: "BLOCK", rule: "missing_plan_approval_transition", evidence: "No se detecta transicion aprobada hacia IMPLEMENTING.", fix: "Exigir aprobacion de Javier antes de editar codigo." })
  }
  if (!/from:\s+WAITING_PRODUCTION_APPROVAL[\s\S]+?to:\s+PRODUCTION_DEPLOY[\s\S]+?production-approval-gate token/i.test(text)) {
    findings.push({ severity: "BLOCK", rule: "missing_production_approval_transition", evidence: "No se detecta transicion aprobada hacia produccion.", fix: "Exigir adelante + production-approval-gate." })
  }
  if (!/from:\s+"\*"[\s\S]+?to:\s+BLOCKED/i.test(text)) {
    findings.push({ severity: "WARN", rule: "missing_global_block_transition", evidence: "No se detecta transicion global a BLOCKED.", fix: "Agregar fallback a BLOCKED para fallos de evidencia o gates." })
  }
  const blocks = findings.filter((item) => item.severity === "BLOCK")
  const warns = findings.filter((item) => item.severity === "WARN")
  const payload = {
    status: blocks.length ? "BLOCK" : "PASS",
    generated_by: "team-curator-runner",
    block_count: blocks.length,
    warn_count: warns.length,
    findings,
  }
  writeState(`workflow-state-audit-${Date.now()}.json`, payload)
  return payload
}

function runRouteContractEval() {
  const source = readText(path.join(root, ".opencode", "tools", "decision-router.ts"))
  const required = [
    "self_test",
    "simple_read_only",
    "db2_business_flow",
    "performance_cache",
    "flutter_ui_change",
    "production_discovery",
    "irreversible_db2_mutation",
    "db2-write-approval",
    "production-approval-token",
    "n-plus-one-blocking-gate",
    "ibm-db2-mcp",
    "gmp-deploy-ssh",
    "dart-flutter-mcp",
  ]
  const results = required.map((token) => ({
    name: token,
    status: source.includes(token) ? "PASS" : "FAIL",
  }))
  const failed = results.filter((item) => item.status === "FAIL")
  const payload = {
    status: failed.length ? "FAIL" : "PASS",
    generated_by: "team-curator-runner-static-contract",
    static_contract_check: true,
    total: results.length,
    failed: failed.length,
    results,
  }
  writeState(`decision-router-self-test-${Date.now()}.json`, payload)
  return payload
}

function runModelAssignmentAudit() {
  const findings = []
  const agentsDir = path.join(root, ".opencode", "agents")
  const fallback = readJson(path.join(root, ".opencode", "fallback-models.json")) || {}
  const fallbackAgents = fallback.agents || {}
  const files = safeList(agentsDir).filter((file) => file.endsWith(".md"))

  for (const file of files) {
    const agent = path.basename(file, ".md")
    const text = readText(path.join(agentsDir, file))
    const model = frontmatterValue(text, "model")
    if (!model) {
      findings.push({ severity: "BLOCK", agent, rule: "missing_model", evidence: `${agent}.md no declara model.`, fix: "Declarar model explicito." })
      continue
    }
    validateModel(agent, model, "frontmatter", findings)
    const policy = fallbackAgents[agent]
    if (!policy) {
      findings.push({ severity: "BLOCK", agent, rule: "missing_fallback_policy", evidence: `Sin fallback policy para ${agent}.`, fix: "Agregar entrada en fallback-models.json." })
      continue
    }
    if (policy.primary !== model) findings.push({ severity: "BLOCK", agent, rule: "primary_mismatch", evidence: `frontmatter=${model}, policy=${policy.primary}.`, fix: "Sincronizar frontmatter y fallback-models." })
    validateModel(agent, policy.primary, "fallback.primary", findings)
    for (const fallbackModel of policy.fallback || []) validateModel(agent, fallbackModel, "fallback", findings)
  }

  const blocks = findings.filter((item) => item.severity === "BLOCK")
  const warns = findings.filter((item) => item.severity === "WARN")
  const payload = {
    status: blocks.length ? "BLOCK" : "PASS",
    generated_by: "team-curator-runner",
    block_count: blocks.length,
    warn_count: warns.length,
    findings,
  }
  writeState(`model-assignment-audit-${Date.now()}.json`, payload)
  return payload
}

function frontmatterValue(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"))
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : ""
}

function validateModel(agent, model, source, findings) {
  if (!/^(openai|cursor-acp|opencode-go)\//.test(model)) findings.push({ severity: "BLOCK", agent, rule: "provider_not_allowed", evidence: `${source} usa ${model}.`, fix: "Usar openai, cursor-acp u opencode-go." })
  if (/^opencode\//i.test(model)) findings.push({ severity: "BLOCK", agent, rule: "zen_automatic_forbidden", evidence: `${source} usa ${model}.`, fix: "OpenCode Zen solo manual." })
  if (/^cursor-acp\/gpt/i.test(model)) findings.push({ severity: "BLOCK", agent, rule: "cursor_gpt_forbidden", evidence: `${source} usa ${model}.`, fix: "Cursor ACP debe usar Composer/Claude/no-GPT." })
}

function writeState(file, payload) {
  const stateDir = path.join(root, ".opencode", "state")
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(path.join(stateDir, file), JSON.stringify(payload, null, 2), "utf8")
}

function safeList(dir) {
  try { return fs.readdirSync(dir) } catch { return [] }
}

function latestJson(prefix) {
  const stateDir = path.join(root, ".opencode", "state")
  const files = safeList(stateDir)
    .filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
    .map((file) => ({ file, stat: fs.statSync(path.join(stateDir, file)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
  return files[0] ? readJson(path.join(stateDir, files[0].file)) : null
}

function stateAuditStale() {
  const latestAudit = latestStateStat("workflow-state-audit-")
  if (!latestAudit) return true
  const stateMachine = path.join(root, ".opencode", "config", "workflow-state-machine.yaml")
  try {
    return fs.statSync(stateMachine).mtimeMs > latestAudit.stat.mtimeMs
  } catch {
    return true
  }
}

function modelAuditStale() {
  const latestAudit = latestStateStat("model-assignment-audit-")
  if (!latestAudit) return true
  const watched = [
    path.join(root, ".opencode", "fallback-models.json"),
    ...safeList(path.join(root, ".opencode", "agents")).filter((file) => file.endsWith(".md")).map((file) => path.join(root, ".opencode", "agents", file)),
  ]
  return watched.some((file) => {
    try {
      return fs.statSync(file).mtimeMs > latestAudit.stat.mtimeMs
    } catch {
      return true
    }
  })
}

function latestStateStat(prefix) {
  const stateDir = path.join(root, ".opencode", "state")
  const files = safeList(stateDir)
    .filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
    .map((file) => ({ file, stat: fs.statSync(path.join(stateDir, file)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
  return files[0] || null
}

function recentJson(prefix, since) {
  const stateDir = path.join(root, ".opencode", "state")
  return safeList(stateDir)
    .filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
    .map((file) => path.join(stateDir, file))
    .filter((file) => fs.statSync(file).mtimeMs >= since)
    .map((file) => {
      const payload = readJson(file)
      if (payload) payload.__mtime = fs.statSync(file).mtimeMs
      return payload
    })
    .filter(Boolean)
}

function readMetrics() {
  const text = readText(path.join(root, ".opencode", "metrics", "current.prom"))
  const metrics = {}
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue
    const match = line.match(/^([a-zA-Z_:][\w:]*)(?:\{[^}]*\})?\s+(-?\d+(?:\.\d+)?)/)
    if (match) metrics[match[1]] = Number(match[2])
  }
  return metrics
}

function readText(file) {
  try { return fs.readFileSync(file, "utf8") } catch { return "" }
}

function readJson(file) {
  try { return JSON.parse(readText(file)) } catch { return null }
}

function unresolvedRepeatedErrors() {
  const counts = readJson(path.join(root, ".opencode", "state", "same-error-counts.json")) || {}
  return Object.values(counts).filter((item) => Number(item?.count || 0) >= 2 && !item?.retrospective_triggered).length
}
function countLines(file) {
  return readText(file).split(/\r?\n/).filter((line) => line.trim()).length
}

function countRecentLines(file, since) {
  let count = 0
  for (const line of readText(file).split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      const ts = Date.parse(parsed.ts || parsed.timestamp || parsed.time || parsed.created_at || "")
      if (Number.isNaN(ts) || ts >= since) count++
    } catch {
      count++
    }
  }
  return count
}

function issue(severity, source, message, action) {
  return { severity, source, message, action }
}

function scoreIssues(issues) {
  return Math.max(0, 100 - issues.filter((item) => item.severity === "BLOCK").length * 15 - issues.filter((item) => item.severity === "WARN").length * 4)
}

function summary(report) {
  const risk = report.blockers.length ? `${report.blockers.length} bloqueos requieren accion.` : `${report.warnings.length} advertencias, sin bloqueos.`
  const action = report.recommended_actions[0] || "Sin acciones urgentes."
  return `Team Curator GMP: score ${report.team_score}/100, status ${report.status}.\n${risk}\n${action}`
}

function toMarkdown(report) {
  return [
    "# Team Curator Report",
    "",
    `Generated: ${report.generated_at}`,
    `Score: ${report.team_score}/100`,
    `Status: ${report.status}`,
    "",
    "## Blockers",
    ...(report.blockers.length ? report.blockers.map((item) => `- ${item.source}: ${item.message} -> ${item.action}`) : ["- None"]),
    "",
    "## Warnings",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item.source}: ${item.message} -> ${item.action}`) : ["- None"]),
    "",
    "## Recommended Actions",
    ...(report.recommended_actions.length ? report.recommended_actions.map((item) => `- ${item}`) : ["- None"]),
    "",
  ].join("\n")
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return false
  const body = new URLSearchParams({ chat_id: chatId, text: message })
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", body })
  return response.ok
}
