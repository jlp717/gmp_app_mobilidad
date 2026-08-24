import { tool } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import techRadar from "./tech-radar-fetch.ts"
import githubWatch from "./github-watchlist-sync.ts"
import modelWatch from "./model-catalog-watch.ts"
import dailyDigest from "./daily-digest-summary.ts"
import teamCurator from "./team-curator-report.ts"
import mobileBriefing from "./mobile-briefing.ts"
import stateCleanup from "./state-cleanup.ts"

type JobConfig = {
  enabled?: boolean
  interval_hours?: number
  min_startup_delay_seconds?: number
  preferred_hour?: number
  stale_hours?: number
  tool?: string
  args?: Record<string, unknown>
  notify_telegram?: boolean
  notify_telegram_if_new?: boolean
  notify_telegram_if_changes?: boolean
  notify_telegram_if_new_models?: boolean
  only_if_significant?: boolean
  min_score_for_notify?: number
}

export default tool({
  description:
    "Ejecuta jobs programados del equipo (radar, watchlist GitHub, modelos, digest, curator) segun automation-schedule.json y last-run.",
  args: {
    operation: tool.schema.enum(["run_due", "run_all", "status", "force"]).default("run_due"),
    job_id: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const cfg = await readJson(path.join(root, ".opencode", "config", "automation-schedule.json"), null)
    if (!cfg?.enabled) {
      return out({ status: "PASS", skipped: true, reason: "automation disabled" })
    }

    const stateFile = path.join(root, ".opencode", "state", "automation", "last-run.json")
    const state = await readJson(stateFile, { jobs: {} as Record<string, string> })
    const jobs = cfg.jobs || {}
    const now = Date.now()
    const tz = cfg.timezone || "Europe/Madrid"
    const results: any[] = []

    const due = Object.entries(jobs as Record<string, JobConfig>).filter(([id, job]) => {
      if (!job.enabled) return false
      if (args.operation === "force" && args.job_id) return id === args.job_id
      if (args.operation === "run_all") return true
      if (args.operation === "force") return true
      if (args.operation === "status") return false
      const last = Date.parse(state.jobs[id] || "1970-01-01")
      const intervalMs = (job.interval_hours || 24) * 3600000
      if (now - last < intervalMs) return false
      if (job.preferred_hour != null && !hourReached(job.preferred_hour, tz)) return false
      return true
    })

    if (args.operation === "status") {
      return out({
        status: "PASS",
        timezone: tz,
        jobs: Object.fromEntries(
          Object.entries(jobs).map(([id, job]: [string, any]) => [
            id,
            {
              enabled: job.enabled,
              last_run: state.jobs[id] || null,
              due: due.some(([d]) => d === id),
            },
          ]),
        ),
      })
    }

    for (const [id, job] of due) {
      try {
        const delay = (job.min_startup_delay_seconds || 0) * 1000
        if (delay > 0) await sleep(Math.min(delay, 5000))
        const result = await runJob(id, job, root, context)
        results.push({ job_id: id, ...result })
        state.jobs[id] = new Date().toISOString()
      } catch (error) {
        results.push({
          job_id: id,
          status: "ERROR",
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    await writeJson(stateFile, state)
    await appendJsonl(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), {
      ts: new Date().toISOString(),
      event: "scheduled_automation",
      jobs_run: results.length,
      results: results.map((r) => ({ job_id: r.job_id, status: r.status })),
    })

    return out({ status: "PASS", jobs_run: results.length, results })
  },
})

async function runJob(id: string, job: JobConfig, root: string, context: any) {
  const ctx = { worktree: root, directory: root }
  if (id === "tech_radar" || job.tool === "tech-radar-fetch") {
    const r = await techRadar.execute((job.args || {}) as any, ctx)
    const parsed = JSON.parse(r.output)
    const top = (parsed.items || []).slice(0, 5)
    await writeJson(path.join(root, ".opencode", "reports", "tech-radar-latest.json"), { ...parsed, generated_at: new Date().toISOString() })
    const notify = job.notify_telegram_if_new && top.some((i: any) => (i.score || 0) >= (job.min_score_for_notify || 45))
    if (notify) await notifyTelegram(formatRadar(top))
    return { status: "PASS", items: top.length }
  }
  if (id === "github_watchlist" || job.tool === "github-watchlist-sync") {
    const r = await githubWatch.execute({ notify_telegram: !!job.notify_telegram_if_changes, lookback_days: 14 }, ctx)
    const parsed = JSON.parse(r.output)
    return { status: parsed.status, changes_new: parsed.changes_new }
  }
  if (id === "model_catalog" || job.tool === "model-catalog-watch") {
    const r = await modelWatch.execute({ notify_telegram: !!job.notify_telegram_if_new_models }, ctx)
    const parsed = JSON.parse(r.output)
    return { status: parsed.status, novel_count: parsed.novel_count }
  }
  if (id === "daily_digest" || job.tool === "daily-digest-summary") {
    const r = await dailyDigest.execute({}, ctx)
    return { status: "PASS", summary: String(r.output).slice(0, 200) }
  }
  if (id === "team_curator" || job.tool === "team-curator-report") {
    const reportPath = path.join(root, ".opencode", "reports", "team-curator-latest.json")
    const prev = await readJson(reportPath, null)
    const staleHours = job.stale_hours || 120
    if (prev?.generated_at && Date.now() - Date.parse(prev.generated_at) < staleHours * 3600000) {
      return { status: "SKIP", reason: "curator_not_stale" }
    }
    const r = await teamCurator.execute({ send_to_telegram: false, period_days: 7 }, ctx)
    return { status: "PASS" }
  }
  if (id === "morning_briefing" || job.tool === "mobile-briefing") {
    const r = await mobileBriefing.execute(
      { send_telegram: job.args?.send_telegram !== false, save_obsidian: job.args?.save_obsidian !== false },
      ctx,
    )
    const parsed = JSON.parse(r.output)
    if (job.only_if_significant && parsed.status === "PASS" && parsed.telegram_sent === false) {
      return { status: "SKIP", reason: "no_significant_changes" }
    }
    return { status: parsed.status, telegram_sent: parsed.telegram_sent }
  }
  if (id === "state_cleanup" || job.tool === "state-cleanup") {
    const r = await stateCleanup.execute((job.args || { dry_run: false }) as any, ctx)
    const parsed = JSON.parse(r.output)
    return {
      status: parsed.status || "PASS",
      archived: parsed.archived_ephemeral,
      expired: parsed.expired_task_states,
      stale_after: parsed.stale_after,
    }
  }
  if (id === "memory_garbage_collector" || job.tool === "semantic-memory-pruner") {
    const script = path.join(root, ".opencode", "scripts", "memory", "semantic-memory-pruner.mjs")
    if (!(await exists(script))) return { status: "SKIP", reason: "semantic-memory-pruner script missing" }
    const scriptArgs = [script, "--dry-run"]
    const configFile = job.args?.config_file
    if (typeof configFile === "string") scriptArgs.push("--config", configFile)
    const result = await runNode(scriptArgs, root)
    return { status: result.status, dry_run: true, summary: result.summary }
  }
  return { status: "SKIP", reason: `unknown job ${id}` }
}

async function runNode(args: string[], cwd: string) {
  return new Promise<any>((resolve) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => child.kill(), 30000)
    child.stdout.on("data", (d) => (stdout += String(d)))
    child.stderr.on("data", (d) => (stderr += String(d)))
    child.on("close", (code) => {
      clearTimeout(timer)
      try {
        const parsed = JSON.parse(stdout || "{}")
        resolve({ status: parsed.status || (code === 0 ? "PASS" : "ERROR"), summary: parsed.summary || parsed })
      } catch {
        resolve({ status: code === 0 ? "PASS" : "ERROR", summary: (stdout || stderr).slice(0, 240) })
      }
    })
  })
}

function formatRadar(items: any[]) {
  const lines = items.map((i) => `- [${i.score}] ${i.title?.slice(0, 80)} (${i.action || "OBSERVAR"})`)
  return `Tech radar (${items.length} items)\n${lines.join("\n")}`
}

async function notifyTelegram(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return false
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    body: new URLSearchParams({ chat_id: chatId, text: message.slice(0, 3900) }),
  })
  return res.ok
}

function hourReached(preferredHour: number, tz: string) {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date()),
    )
    return hour >= preferredHour
  } catch {
    return new Date().getHours() >= preferredHour
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function out(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

async function readJson(file: string, fallback: any) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8")
  await fs.rename(tmp, file)
}

async function exists(file: string) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function appendJsonl(file: string, data: Record<string, unknown>) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, `${JSON.stringify(data)}\n`, "utf8")
}
