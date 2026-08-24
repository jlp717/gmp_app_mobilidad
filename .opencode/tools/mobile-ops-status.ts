import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"

async function readJson(file: string, fallback: any) {
  try { return JSON.parse(await fs.readFile(file, "utf8")) } catch { return fallback }
}

async function tailJsonl(file: string, limit: number) {
  try {
    const raw = await fs.readFile(file, "utf8")
    return raw.trim().split(/\r?\n/).filter(Boolean).slice(-limit).map((line) => {
      try { return JSON.parse(line) } catch { return { raw: line.slice(0, 300) } }
    })
  } catch { return [] }
}

async function httpStatus(url: string, headers: Record<string, string> = {}) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    const res = await fetch(url, { headers, signal: ctrl.signal })
    clearTimeout(timer)
    return { ok: res.ok, status: res.status }
  } catch (error) {
    return { ok: false, status: String(error).slice(0, 160) }
  }
}

async function webAuthHeaders(root: string) {
  try {
    const pw = (await fs.readFile(path.join(root, ".opencode-runtime", "opencode-web-gmp.credentials"), "utf8")).trim()
    const pair = `Javier:${pw}`
    return { Authorization: `Basic ${Buffer.from(pair, "ascii").toString("base64")}` }
  } catch { return {} }
}

function compactFlow(steps: any[]) {
  return steps.slice(-8).map((s) => ({
    ts: s.ts,
    phase: s.phase,
    kind: s.kind || s.event,
    tool: s.tool,
    status: s.status,
    summary: String(s.summary || s.message || "").slice(0, 180),
  }))
}

export default tool({
  description: "Estado operativo remoto para movil: Web, Cursor ACP, readiness, modelos, trazas, errores recientes y git dirty sin exponer secretos.",
  args: {
    detail: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const stateDir = path.join(root, ".opencode", "state")
    const headers = await webAuthHeaders(root)
    const [web, cursor, readiness, preflight, providerHealth, routing, flowLatest, sessionEvents, liveEvents, git, postStartup] = await Promise.all([
      httpStatus("http://127.0.0.1:3090", headers),
      httpStatus("http://127.0.0.1:32124/v1/models"),
      readJson(path.join(stateDir, "readiness-latest.json"), null),
      readJson(path.join(stateDir, "preflight-last.json"), null),
      readJson(path.join(stateDir, "provider-health.json"), { unavailable: {} }),
      readJson(path.join(stateDir, "routing-status.json"), null),
      readJson(path.join(stateDir, "flow-trace-latest.json"), { steps: [] }),
      tailJsonl(path.join(stateDir, "session-resilience.jsonl"), 5),
      tailJsonl(path.join(stateDir, "live-execution.jsonl"), 20),
      Promise.resolve(spawnSync("git", ["status", "--short"], { cwd: root, encoding: "utf8", timeout: 8000 })),
      readJson(path.join(stateDir, "post-startup-latest.json"), null),
    ])

    const now = Date.now()
    const blocks = Object.entries(providerHealth?.unavailable || {}).filter(([, v]: [string, any]) => new Date(v.until).getTime() > now)
    const dirty = String(git.stdout || "").trim().split(/\r?\n/).filter(Boolean)
    const flowSteps = compactFlow(flowLatest?.steps || [])
    const status = web.ok && cursor.ok && (readiness?.status === "PASS" || postStartup?.status === "PASS")
      ? "OK"
      : web.ok && postStartup?.status === "WARN"
        ? "WARN"
        : "DEGRADED"
    const payload = {
      status,
      mobile_summary: [
        `Web 3090: ${web.ok ? "OK" : "FALLO"} (${web.status})`,
        `Cursor ACP: ${cursor.ok ? "OK" : "FALLO"} (${cursor.status})`,
        `Readiness: ${readiness?.status || "sin dato"}${readiness?.score ? ` score=${readiness.score}` : ""}`,
         `Modelo por defecto: openai/gpt-5.6-sol`,
         `Routing efectivo: ${routing?.effective_default || "openai/gpt-5.6-sol"}`,
        `Bloqueos proveedor: ${blocks.length}`,
        `Git dirty: ${dirty.length}`,
        status === "OK" ? "Accion: puedes seguir desde el movil." : "Accion: espera 30s tras arranque; si persiste, /rescue.",
      ],
      summary: {
        web_3090: web,
        cursor_acp_32124: cursor,
        readiness: readiness ? { status: readiness.status, score: readiness.score, generated_at: readiness.generated_at } : null,
        routing_status: routing ? { status: routing.status, effective_default: routing.effective_default, updated_at: routing.updated_at } : null,
        provider_blocks: blocks.map(([key, v]: [string, any]) => ({ key, reason: v.reason, until: v.until })),
        preflight: preflight ? { generated_at: preflight.generated_at, mode: preflight.mode, cursor_acp_service_status: preflight.cursor_acp_service_status, web_restart_status: preflight.web_restart_status } : null,
        git_dirty_count: dirty.length,
      },
      recent: {
        flow_steps: flowSteps,
        session_events: sessionEvents,
        live_events: args.detail ? liveEvents : liveEvents.slice(-8),
        git_dirty_sample: dirty.slice(0, args.detail ? 40 : 12),
      },
      files: {
        readiness: ".opencode/state/readiness-latest.json",
        preflight: ".opencode/state/preflight-last.json",
        flow: ".opencode/state/flow-trace-latest.json",
        live_execution: ".opencode/state/live-execution.jsonl",
      },
    }
    return { output: JSON.stringify(payload, null, 2), metadata: { success: status === "OK", ...payload } }
  },
})
