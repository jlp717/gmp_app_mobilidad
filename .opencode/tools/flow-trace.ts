import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

type FlowStep = {
  ts?: string
  phase?: string
  kind?: string
  agent?: string
  model?: string
  tool?: string
  summary?: string
  status?: string
  duration_ms?: number
  sessionID?: string
  event?: string
}

async function tailJsonl(file: string, limit: number): Promise<FlowStep[]> {
  try {
    const raw = await fs.readFile(file, "utf8")
    return raw
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line) as FlowStep)
  } catch {
    return []
  }
}

function formatStep(step: FlowStep, index: number) {
  const ts = step.ts ? new Date(step.ts).toLocaleTimeString("es-ES") : "?"
  const phase = step.phase || step.event || step.kind || "step"
  const tool = step.tool ? ` [${step.tool}]` : ""
  const model = step.model ? ` (${step.model})` : ""
  const dur =
    typeof step.duration_ms === "number" ? ` ${step.duration_ms}ms` : ""
  const status = step.status ? ` ${step.status}` : ""
  const summary = String(step.summary || "").slice(0, 120)
  return `${index + 1}. ${ts} ${phase}${tool}${model}${dur}${status}${summary ? ` — ${summary}` : ""}`
}

function buildSummary(steps: FlowStep[]) {
  const phases: Record<string, number> = {}
  const tools: Record<string, number> = {}
  let errors = 0
  for (const step of steps) {
    const phase = step.phase || step.event || step.kind || "other"
    phases[phase] = (phases[phase] || 0) + 1
    if (step.tool) tools[step.tool] = (tools[step.tool] || 0) + 1
    if (step.status === "error") errors++
  }
  return { phases, tools, errors, total: steps.length }
}

export default tool({
  description:
    "Trazas legibles del flujo: fases, tools, modelos y errores recientes.",
  args: {
    limit: tool.schema.number().default(20),
    session_id: tool.schema.string().optional(),
    mode: tool.schema.enum(["summary", "full"]).default("summary"),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const stateDir = path.join(root, ".opencode", "state")

    const [flowState, flowRoot, live, team, latestRaw, healthRaw] =
      await Promise.all([
        tailJsonl(path.join(stateDir, "flow-trace.jsonl"), args.limit * 2),
        tailJsonl(path.join(root, ".opencode", "FLOW_TRACE.jsonl"), args.limit * 2),
        tailJsonl(path.join(stateDir, "live-execution.jsonl"), args.limit * 2),
        tailJsonl(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), args.limit),
        fs.readFile(path.join(stateDir, "flow-trace-latest.json"), "utf8").catch(() => ""),
        fs.readFile(path.join(stateDir, "provider-health.json"), "utf8").catch(() => ""),
      ])

    const filterSession = (row: FlowStep) => {
      if (!args.session_id) return true
      const sid = args.session_id
      return row.sessionID === sid || (row as any).session_id === sid
    }

    const merged = [...flowState, ...flowRoot, ...live]
      .filter(filterSession)
      .sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")))
      .slice(-args.limit)

    const modelEvents = team
      .filter(filterSession)
      .filter((row) =>
        [
          "model_fallback_applied",
          "model_route",
          "task_model_override",
          "provider_unavailable_recorded",
          "flow_step",
        ].includes(String(row.event || "")),
      )
      .slice(-8)

    const stats = buildSummary(merged)
    const lines = merged.map((step, i) => formatStep(step, i))

    let healthStatus = "OK"
    try {
      const health = JSON.parse(healthRaw || "{}")
      const now = Date.now()
      const blocks = Object.entries(health.unavailable || {}).filter(
        ([, v]: [string, any]) => new Date(v.until).getTime() > now,
      )
      if (blocks.length) healthStatus = "DEGRADED (OpenAI bloqueado → Composer 2.5 en sesiones nuevas)"
    } catch {
      /* ignore */
    }

    const summaryText = [
      `Estado modelos: ${healthStatus}`,
      `Pasos: ${stats.total} | Errores: ${stats.errors}`,
      `Fases: ${Object.entries(stats.phases)
        .map(([k, v]) => `${k}(${v})`)
        .join(", ") || "ninguna"}`,
      `Tools: ${Object.keys(stats.tools).join(", ") || "ninguna"}`,
      "",
      ...(modelEvents.length
        ? ["Eventos de routing:", ...modelEvents.map((e) => `  - ${e.event}: ${JSON.stringify(e).slice(0, 100)}`)]
        : []),
      "",
      "Timeline:",
      ...(lines.length ? lines : ["  (sin trazas aún — reinicia OpenCode y ejecuta una tarea)"]),
    ].join("\n")

    const payload = {
      status: healthStatus.startsWith("DEGRADED") ? "DEGRADED" : "OK",
      mode: args.mode,
      stats,
      model_events: modelEvents,
      steps: args.mode === "full" ? merged : merged.slice(-12),
      timeline_text: summaryText,
      flow_latest: latestRaw ? JSON.parse(latestRaw) : null,
    }

    return {
      output: args.mode === "summary" ? summaryText : JSON.stringify(payload, null, 2),
      metadata: { success: true, ...payload },
    }
  },
})
