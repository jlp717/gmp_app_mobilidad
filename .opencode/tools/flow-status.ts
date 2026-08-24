import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

async function tailJsonl(file: string, limit: number) {
  try {
    const raw = await fs.readFile(file, "utf8")
    return raw
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

function summarizeExecution(entries: Record<string, unknown>[]) {
  const starts = entries.filter((e) => e.kind === "tool_start")
  const ends = entries.filter((e) => e.kind === "tool_end")
  const commands = entries.filter((e) => e.kind === "command")
  const errors = ends.filter((e) => e.status === "error")
  const byTool: Record<string, number> = {}
  for (const entry of starts) {
    const name = String(entry.tool || "unknown")
    byTool[name] = (byTool[name] || 0) + 1
  }
  return {
    tool_starts: starts.length,
    tool_ends: ends.length,
    commands_run: commands.length,
    tool_errors: errors.length,
    tools_used: byTool,
    recent_actions: [...commands, ...ends]
      .slice(-12)
      .map((e) => ({
        ts: e.ts,
        kind: e.kind,
        tool: e.tool,
        status: e.status,
        duration_ms: e.duration_ms,
        summary: e.summary,
      })),
    recent_errors: errors.slice(-5).map((e) => ({
      tool: e.tool,
      summary: e.summary,
      sessionID: e.sessionID,
    })),
  }
}

export default tool({
  description:
    "Resumen de ejecucion reciente: herramientas, errores, fallback de modelos y salud de proveedores.",
  args: {
    limit: tool.schema.number().default(15),
    session_id: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const stateDir = path.join(root, ".opencode", "state")

    const [flowTraceState, flowTraceRoot, liveExec, teamTrace, health, routing, pluginLogRaw, flowLatestRaw, routingStatus] =
      await Promise.all([
      tailJsonl(path.join(stateDir, "flow-trace.jsonl"), args.limit * 2),
      tailJsonl(path.join(root, ".opencode", "FLOW_TRACE.jsonl"), args.limit * 2),
      tailJsonl(path.join(stateDir, "live-execution.jsonl"), args.limit),
      tailJsonl(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), args.limit),
      fs
        .readFile(path.join(stateDir, "provider-health.json"), "utf8")
        .then((raw) => JSON.parse(raw))
        .catch(() => ({ unavailable: {} })),
      fs
        .readFile(path.join(stateDir, "model-routing-live.json"), "utf8")
        .then((raw) => JSON.parse(raw))
        .catch(() => null),
      fs.readFile(path.join(stateDir, "model-fallback-plugin.log"), "utf8").catch(() => ""),
      fs.readFile(path.join(stateDir, "flow-trace-latest.json"), "utf8").catch(() => ""),
      fs
        .readFile(path.join(stateDir, "routing-status.json"), "utf8")
        .then((raw) => JSON.parse(raw))
        .catch(() => null),
    ])
    const pluginLog = pluginLogRaw
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-10)
    const flowLatest = flowLatestRaw
      ? JSON.parse(flowLatestRaw)
      : { updated_at: "", steps: [] }

    const filterSession = (row: Record<string, unknown>) => {
      if (!args.session_id) return true
      const sid = args.session_id
      return (
        row.session_id === sid ||
        row.sessionID === sid ||
        (row.detail as any)?.sessionID === sid
      )
    }

    const mergedFlow = [...flowTraceState, ...flowTraceRoot]
      .sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")))
      .filter((row, index, arr) => {
        const key = `${row.ts}:${row.kind || row.event}:${row.tool || ""}:${row.summary || ""}`
        return arr.findIndex((r) => `${r.ts}:${r.kind || r.event}:${r.tool || ""}:${r.summary || ""}` === key) === index
      })
      .slice(-args.limit)

    const filteredLive = liveExec.filter(filterSession)
    const now = Date.now()
    const activeBlocks = Object.entries(health.unavailable || {}).filter(
      ([, v]: [string, any]) => new Date(v.until).getTime() > now,
    )

    const payload = {
      status: activeBlocks.length ? "DEGRADED" : "OK",
      routing_mode:
         routingStatus?.effective_default || (activeBlocks.length ? "openai/gpt-5.6-terra" : "openai/gpt-5.6-sol"),
      provider_blocks: activeBlocks.map(([key, v]: [string, any]) => ({
        key,
        reason: v.reason,
        until: v.until,
        last_error: v.last_error,
      })),
      routing_hint: routingStatus?.effective_default || "",
      routing_summary:
        activeBlocks.length > 0
           ? `OpenAI bloqueado. Nuevo enrutado predeterminado: ${routingStatus?.effective_default || "openai/gpt-5.6-terra"}.`
           : "Sin bloqueos. Predeterminado: openai/gpt-5.6-sol.",
      last_routing: routing?.last_applied || null,
      routing_status: routingStatus,
      flow_latest: flowLatest,
      execution_summary: summarizeExecution(filteredLive),
      summary_es:
        activeBlocks.length > 0
          ? `OpenAI bloqueado hasta ${(activeBlocks[0]?.[1] as any)?.until || "?"}. Nuevo destino: ${
              routingStatus?.effective_default || "openai/gpt-5.6-sol"
            }. Sesiones en curso sin cambio.`
          : filteredLive.length > 0
            ? `${filteredLive.length} acciones recientes (${Object.keys(summarizeExecution(filteredLive).tools_used).join(", ") || "sin tools"}). Sin bloqueos.`
            : "Sin actividad en live-execution. Reinicia OpenCode tras actualizar plugins.",
      recent_tools: filteredLive.slice(-args.limit),
      recent_flow_events: mergedFlow.filter(filterSession).slice(-args.limit),
      recent_team_events: teamTrace
        .filter(filterSession)
        .filter((row) =>
          [
            "model_fallback_applied",
            "model_route",
            "task_model_override",
            "provider_unavailable_recorded",
            "provider_rate_limit_detected",
            "execution_visibility",
            "session_error_detected",
            "flow_step",
          ].includes(String(row.event || "")),
        )
        .slice(-args.limit),
      plugin_log_tail: pluginLog,
      hints: {
        fallback_log: ".opencode/state/model-fallback.log",
        plugin_log: ".opencode/state/model-fallback-plugin.log",
        flow_trace: ".opencode/state/flow-trace.jsonl",
        flow_latest: ".opencode/state/flow-trace-latest.json",
        live_execution: ".opencode/state/live-execution.jsonl",
        provider_health: ".opencode/state/provider-health.json",
        routing_status: ".opencode/state/routing-status.json",
        clear_health: "model-provider-health clear=true",
      },
    }

    return {
      output: JSON.stringify(payload, null, 2),
      metadata: { success: true, ...payload },
    }
  },
})
