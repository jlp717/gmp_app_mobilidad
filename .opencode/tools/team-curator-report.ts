import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

type Issue = { severity: "BLOCK" | "WARN"; source: string; message: string; action: string }

export default tool({
  description: "Genera reporte curador del equipo: agentes, rutas, gates, modelos, metricas, errores y recomendaciones.",
  args: {
    period_days: tool.schema.number().default(7),
    send_to_telegram: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const since = Date.now() - Math.max(1, args.period_days) * 24 * 60 * 60 * 1000
    const issues: Issue[] = []

    const agents = await listAgentFiles(root)
    const latestAgentAudit = await latestJson(root, "agent-roster-audit-")
    const latestModelAudit = await latestJson(root, "model-assignment-audit-")
    const latestWorkflowAudit = await latestJson(root, "workflow-state-audit-")
    const latestReadiness = await readJson(path.join(root, ".opencode", "state", "readiness-latest.json"))
    const latestRouteEval = await latestJson(root, "decision-router-self-test-")
    const flowChecks = await recentJson(root, "flow-policy-check-", since)
    const metrics = await readMetrics(root)
    const tokenLines = await countRecentLines(path.join(root, ".opencode", "tokens.jsonl"), since)
    const traceLines = await countRecentLines(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), since)
    const repeatedErrors = await countLines(path.join(root, ".opencode", "memory", "same-error-tracker.jsonl"))
    const userCorrections = await countLines(path.join(root, ".opencode", "memory", "user-corrections.jsonl"))
    const latestCorrection = await readJson(path.join(root, ".opencode", "state", "correction-capture-last.json"))
    const handoffLedgers = await countFiles(path.join(root, ".opencode", "state", "handoffs"), ".json")
    const fallback = await readJson(path.join(root, ".opencode", "fallback-models.json"))

    if (agents.length < 30) issues.push(block("agents", `Solo ${agents.length} agentes detectados.`, "Revisar roster de especialistas."))
    if (!latestAgentAudit) issues.push(warn("agent-roster-audit", "No hay auditoria reciente de agentes.", "Ejecutar agent-roster-audit."))
    else {
      if ((latestAgentAudit.block_count || 0) > 0 || latestAgentAudit.status === "BLOCK") issues.push(block("agent-roster-audit", `BLOCK en roster: ${latestAgentAudit.block_count || 0}.`, "Corregir agentes criticos."))
      if ((latestAgentAudit.warn_count || 0) > 0) issues.push(warn("agent-roster-audit", `WARN en roster: ${latestAgentAudit.warn_count}.`, "Revisar prompts debiles."))
    }
    if (!latestModelAudit) issues.push(warn("model-assignment-audit", "No hay auditoria reciente de modelos.", "Ejecutar model-assignment-audit."))
    else {
      if ((latestModelAudit.block_count || 0) > 0 || latestModelAudit.status === "BLOCK") issues.push(block("model-assignment-audit", `BLOCK en modelos: ${latestModelAudit.block_count || 0}.`, "Corregir modelos pinneados y fallback-models."))
      if ((latestModelAudit.warn_count || 0) > 0) issues.push(warn("model-assignment-audit", `WARN en modelos: ${latestModelAudit.warn_count}.`, "Revisar advertencias de modelos."))
      if (await modelAuditOlderThanInputs(root, "model-assignment-audit-")) {
        issues.push(warn("model-assignment-audit", "Los agentes o fallback-models cambiaron despues del ultimo audit.", "Ejecutar model-assignment-audit de nuevo."))
      }
    }
    if (!latestWorkflowAudit) issues.push(warn("workflow-state-audit", "No hay auditoria reciente de estados.", "Ejecutar workflow-state-audit."))
    else {
      if ((latestWorkflowAudit.block_count || 0) > 0 || latestWorkflowAudit.status === "BLOCK") issues.push(block("workflow-state-audit", `BLOCK en estados: ${latestWorkflowAudit.block_count || 0}.`, "Corregir maquina de estados y approval gates."))
      if ((latestWorkflowAudit.warn_count || 0) > 0) issues.push(warn("workflow-state-audit", `WARN en estados: ${latestWorkflowAudit.warn_count}.`, "Revisar transiciones de estado."))
      if (await latestStateOlderThan(root, "workflow-state-audit-", ".opencode/config/workflow-state-machine.yaml")) {
        issues.push(warn("workflow-state-audit", "La maquina de estados cambio despues del ultimo audit.", "Ejecutar workflow-state-audit de nuevo."))
      }
    }
    if (!latestReadiness) issues.push(warn("readiness-smoke", "No hay smoke test de readiness reciente.", "Ejecutar /readiness."))
    else {
      if (latestReadiness.status === "BLOCK") issues.push(block("readiness-smoke", `${latestReadiness.blockers?.length || 0} bloqueos de readiness.`, "Ejecutar /readiness y corregir MCP/skills/tools/modelos."))
      if (latestReadiness.status === "WARN") issues.push(warn("readiness-smoke", `${latestReadiness.warnings?.length || 0} advertencias de readiness.`, "Revisar /readiness antes de Tier 3 o produccion."))
    }

    if (!latestRouteEval) issues.push(warn("route-eval", "No hay self-test reciente del decision-router.", "Ejecutar /route-eval semanal."))
    else if (latestRouteEval.status !== "PASS") issues.push(block("route-eval", `Route eval fallo: ${latestRouteEval.failed || "unknown"} escenarios.`, "Corregir decision-router antes de tareas Tier 2/3."))

    const flowBlocks = flowChecks.filter((item) => item.status === "BLOCK")
    if (flowBlocks.length > 0) issues.push(block("flow-policy-check", `${flowBlocks.length} rutas bloqueadas en el periodo.`, "Revisar state/flow-policy-check y corregir rutas repetidas."))

    if (!fallback?.enabled) issues.push(block("model-routing", "fallback-models no esta habilitado.", "Reparar fallback-models.json."))
    if (!fallback?.manual_free_models?.opencode_zen?.length) issues.push(warn("model-routing", "No hay modelos Zen manual/free declarados.", "Actualizar fallback-models si Javier quiere seleccion manual."))

    if (traceLines === 0) issues.push(warn("team-trace", "No hay TEAM_TRACE reciente.", "Verificar que task-tracer sigue activo."))
    if (repeatedErrors > 0) issues.push(warn("same-error", `${repeatedErrors} entradas en same-error tracker.`, "Revisar retrospectivas pendientes."))

    const score = scoreIssues(issues)
    const status = issues.some((item) => item.severity === "BLOCK") ? "BLOCK" : score >= 95 ? "PASS" : "WARN"
    const recommendations = buildRecommendations(issues)
    const report = {
      status,
      team_score: score,
      generated_at: new Date().toISOString(),
      period_days: args.period_days,
      agent_count: agents.length,
      routing_health: {
        latest_route_eval: latestRouteEval ? latestRouteEval.status : "missing",
        recent_flow_checks: flowChecks.length,
        recent_flow_blocks: flowBlocks.length,
      },
      metrics_health: {
        trace_events: traceLines,
        token_events: tokenLines,
        metrics_count: Object.keys(metrics).length,
      },
      model_health: {
        fallback_enabled: Boolean(fallback?.enabled),
        manual_zen_models: fallback?.manual_free_models?.opencode_zen || [],
        latest_model_audit: latestModelAudit ? latestModelAudit.status : "missing",
      },
      state_health: {
        latest_workflow_audit: latestWorkflowAudit ? latestWorkflowAudit.status : "missing",
        workflow_blocks: latestWorkflowAudit?.block_count || 0,
        workflow_warnings: latestWorkflowAudit?.warn_count || 0,
        readiness_status: latestReadiness?.status || "missing",
        readiness_score: latestReadiness?.score || 0,
      },
      learning_health: {
        user_corrections: userCorrections,
        latest_correction_id: latestCorrection?.correction_id || null,
        latest_correction_at: latestCorrection?.ts || null,
      },
      handoff_health: {
        ledgers_total: handoffLedgers,
        ledger_policy: "required for Tier 2/Tier 3 delegations",
      },
      blockers: issues.filter((item) => item.severity === "BLOCK"),
      warnings: issues.filter((item) => item.severity === "WARN"),
      recommended_actions: recommendations,
      telegram_sent: false,
    }

    const reportDir = path.join(root, ".opencode", "reports")
    await fs.mkdir(reportDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-")
    await fs.writeFile(path.join(reportDir, `team-curator-${stamp}.json`), JSON.stringify(report, null, 2), "utf8")
    await fs.writeFile(path.join(reportDir, `team-curator-${stamp}.md`), toMarkdown(report), "utf8")

    if (args.send_to_telegram) {
      report.telegram_sent = await sendTelegram(summary(report))
    }

    return { output: JSON.stringify(report, null, 2), metadata: { success: status !== "BLOCK", ...report } }
  },
})

async function listAgentFiles(root: string) {
  return (await fs.readdir(path.join(root, ".opencode", "agents")).catch(() => [])).filter((file) => file.endsWith(".md"))
}

async function latestJson(root: string, prefix: string) {
  const stateDir = path.join(root, ".opencode", "state")
  const files = (await fs.readdir(stateDir).catch(() => [])).filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
  const stats = await Promise.all(files.map(async (file) => ({ file, stat: await fs.stat(path.join(stateDir, file)) })))
  const latest = stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]
  return latest ? readJson(path.join(stateDir, latest.file)) : null
}

async function latestStateOlderThan(root: string, prefix: string, relativeFile: string) {
  const stateDir = path.join(root, ".opencode", "state")
  const files = (await fs.readdir(stateDir).catch(() => [])).filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
  const stats = await Promise.all(files.map(async (file) => ({ file, stat: await fs.stat(path.join(stateDir, file)) })))
  const latest = stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]
  if (!latest) return true
  try {
    const target = await fs.stat(path.join(root, relativeFile))
    return target.mtimeMs > latest.stat.mtimeMs
  } catch {
    return true
  }
}

async function modelAuditOlderThanInputs(root: string, prefix: string) {
  const stateDir = path.join(root, ".opencode", "state")
  const files = (await fs.readdir(stateDir).catch(() => [])).filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
  const stats = await Promise.all(files.map(async (file) => ({ file, stat: await fs.stat(path.join(stateDir, file)) })))
  const latest = stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]
  if (!latest) return true
  const agentsDir = path.join(root, ".opencode", "agents")
  const watched = [
    path.join(root, ".opencode", "fallback-models.json"),
    ...(await fs.readdir(agentsDir).catch(() => [])).filter((file) => file.endsWith(".md")).map((file) => path.join(agentsDir, file)),
  ]
  for (const file of watched) {
    try {
      const stat = await fs.stat(file)
      if (stat.mtimeMs > latest.stat.mtimeMs) return true
    } catch {
      return true
    }
  }
  return false
}

async function recentJson(root: string, prefix: string, since: number) {
  const stateDir = path.join(root, ".opencode", "state")
  const files = (await fs.readdir(stateDir).catch(() => [])).filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
  const out: any[] = []
  for (const file of files) {
    const full = path.join(stateDir, file)
    const stat = await fs.stat(full)
    if (stat.mtimeMs >= since) out.push(await readJson(full))
  }
  return out.filter(Boolean)
}

async function readMetrics(root: string) {
  const file = path.join(root, ".opencode", "metrics", "current.prom")
  const text = await fs.readFile(file, "utf8").catch(() => "")
  const metrics: Record<string, number> = {}
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue
    const match = line.match(/^([a-zA-Z_:][\w:]*)(?:\{[^}]*\})?\s+(-?\d+(?:\.\d+)?)/)
    if (match) metrics[match[1]] = Number(match[2])
  }
  return metrics
}

async function countRecentLines(file: string, since: number) {
  const text = await fs.readFile(file, "utf8").catch(() => "")
  let count = 0
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      const ts = Date.parse(parsed.ts || parsed.timestamp || parsed.time || parsed.created_at || "")
      if (!Number.isNaN(ts) && ts >= since) count++
      else if (Number.isNaN(ts)) count++
    } catch {
      count++
    }
  }
  return count
}

async function countLines(file: string) {
  const text = await fs.readFile(file, "utf8").catch(() => "")
  return text.split(/\r?\n/).filter((line) => line.trim()).length
}

async function countFiles(dir: string, suffix: string) {
  const files = await fs.readdir(dir).catch(() => [])
  return files.filter((file) => file.endsWith(suffix)).length
}

async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return null
  }
}

function block(source: string, message: string, action: string): Issue {
  return { severity: "BLOCK", source, message, action }
}

function warn(source: string, message: string, action: string): Issue {
  return { severity: "WARN", source, message, action }
}

function scoreIssues(issues: Issue[]) {
  let score = 100
  score -= issues.filter((item) => item.severity === "BLOCK").length * 15
  score -= issues.filter((item) => item.severity === "WARN").length * 4
  return Math.max(0, score)
}

function buildRecommendations(issues: Issue[]) {
  return issues.slice(0, 5).map((item) => `${item.severity}: ${item.source} - ${item.action}`)
}

function summary(report: any) {
  const blockers = report.blockers.length
  const warnings = report.warnings.length
  const headline = `Team Curator GMP: score ${report.team_score}/100, status ${report.status}.`
  const risk = blockers ? `${blockers} bloqueos requieren accion.` : `${warnings} advertencias, sin bloqueos.`
  const action = report.recommended_actions[0] || "Sin acciones urgentes."
  return `${headline}\n${risk}\n${action}`
}

function toMarkdown(report: any) {
  const lines = [
    `# Team Curator Report`,
    ``,
    `Generated: ${report.generated_at}`,
    `Score: ${report.team_score}/100`,
    `Status: ${report.status}`,
    ``,
    `## Blockers`,
    ...(report.blockers.length ? report.blockers.map((item: Issue) => `- ${item.source}: ${item.message} -> ${item.action}`) : ["- None"]),
    ``,
    `## Warnings`,
    ...(report.warnings.length ? report.warnings.map((item: Issue) => `- ${item.source}: ${item.message} -> ${item.action}`) : ["- None"]),
    ``,
    `## Recommended Actions`,
    ...(report.recommended_actions.length ? report.recommended_actions.map((item: string) => `- ${item}`) : ["- None"]),
  ]
  return `${lines.join("\n")}\n`
}

async function sendTelegram(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return false
  const body = new URLSearchParams({ chat_id: chatId, text: message })
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", body })
  return response.ok
}
