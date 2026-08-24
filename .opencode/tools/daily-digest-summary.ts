import { tool } from "@opencode-ai/plugin"
import { spawnSync } from "node:child_process"
import fsSync from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

type StateSummary = {
  pending_state_count?: number
  stale_state_count?: number
  db2_status?: string
  backend_status?: string
  backend_health_status?: string
  image_status?: string
  metrics_status?: string
  memory_count?: number
  skill_count?: number
  trace_rotation_status?: string
  generated_at?: string
}

function response(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

async function readJson(file: string) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return null
  }
}

async function readRecentTrace(root: string, limit = 8) {
  const file = path.join(root, ".opencode", "TEAM_TRACE.jsonl")
  const text = await fs.readFile(file, "utf8").catch(() => "")
  const lines = text.split(/\r?\n/).filter(Boolean).slice(-limit)
  return lines.map((line) => {
    try {
      const parsed = JSON.parse(line)
      return {
        ts: parsed.ts || parsed.timestamp || "sin fecha",
        event: parsed.event || "sin evento",
        task_id: parsed.task_id || parsed.detail?.task_id || "sin task_id",
      }
    } catch {
      return { ts: "sin fecha", event: line.slice(0, 120), task_id: "sin task_id" }
    }
  })
}

function gitStatus(root: string) {
  const gitExe = process.platform === "win32" && fsSync.existsSync("C:\\Program Files\\Git\\cmd\\git.exe")
    ? "C:\\Program Files\\Git\\cmd\\git.exe"
    : "git"
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  const tracked = spawnSync(gitExe, ["status", "--short", "--untracked-files=no"], {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: 3000,
  })
  if (tracked.error) return [`sin datos git: ${tracked.error.message}`]
  const trackedLines = `${tracked.stdout || ""}${tracked.stderr || ""}`.split(/\r?\n/).filter(Boolean)
  const untracked = spawnSync(gitExe, ["ls-files", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: 3000,
  })
  const untrackedCount = untracked.error ? "sin datos" : `${(`${untracked.stdout || ""}`.split(/\r?\n/).filter(Boolean).length)}`
  const lines = trackedLines.length ? trackedLines.slice(0, 25) : ["sin cambios tracked"]
  lines.push(`untracked_count=${untrackedCount}`)
  return lines
}

function clean(value: unknown, fallback = "sin datos recientes") {
  if (value === undefined || value === null || value === "" || value === "N/A") return fallback
  return value
}

export default tool({
  description: "Genera Daily Digest local determinista con preflight, readiness, traza reciente y git status. No usa DB2/SSH ni Telegram.",
  args: {
    include_git: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    try {
      const root = path.resolve(context.worktree || context.directory || process.cwd())
      const preflight = (await readJson(path.join(root, ".opencode", "state", "preflight-last.json"))) as StateSummary | null
      const readiness = await readJson(path.join(root, ".opencode", "state", "readiness-latest.json"))
      const trace = await readRecentTrace(root)
      const git = args.include_git ? gitStatus(root) : ["omitido por rendimiento en digest movil; usar /status git para detalle"]
      const summaryLines = [
        `Estado: ${readiness?.status || "sin datos recientes: readiness-latest.json no disponible"}`,
        `DB2: ${clean(preflight?.db2_status)} | Backend: ${clean(preflight?.backend_status)} | Imagenes: ${clean(preflight?.image_status)}`,
        `Tareas activas reales: ${preflight?.pending_state_count ?? 0} | Estados antiguos/bloqueados no activos: ${preflight?.stale_state_count ?? 0}`,
        `Metricas: ${clean(preflight?.metrics_status)} | Memoria: ${preflight?.memory_count ?? 0} | Skills: ${preflight?.skill_count ?? 0}`,
        `Trazas: ${clean(preflight?.trace_rotation_status)} | Git: ${git[0] === "sin cambios locales" ? "sin cambios locales" : `${git.length} entradas`}`,
      ]

      return response({
        success: true,
        status: "PASS",
        generated_at: new Date().toISOString(),
        source: "daily-digest-summary",
        summary: summaryLines,
        preflight: {
          generated_at: preflight?.generated_at || "sin datos recientes",
          pending_state_count: preflight?.pending_state_count ?? 0,
          stale_state_count: preflight?.stale_state_count ?? 0,
          db2_status: clean(preflight?.db2_status),
          backend_status: clean(preflight?.backend_status),
          backend_health_status: clean(preflight?.backend_health_status),
          image_status: clean(preflight?.image_status),
          metrics_status: clean(preflight?.metrics_status),
          trace_rotation_status: clean(preflight?.trace_rotation_status),
        },
        readiness: readiness || "sin datos recientes: readiness-latest.json no disponible",
        recent_trace: trace.length ? trace : ["sin datos recientes: TEAM_TRACE.jsonl vacio tras rotacion"],
        git_status: git,
      })
    } catch (error) {
      return response({
        success: false,
        status: "BLOCK",
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },
})
