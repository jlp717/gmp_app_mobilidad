import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

type Summary = {
  status: "PASS" | "WARN"
  dry_run: boolean
  archived_ephemeral: number
  expired_task_states: number
  skipped_protected: number
  stale_before: number
  stale_after: number
  details: string[]
}

const PROTECTED_PREFIXES = [
  "preflight-",
  "post-startup-",
  "provider-health",
  "readiness-",
  "session-handoff",
  "session-resilience",
  "flow-trace-latest",
  "flow-status",
  "model-routing",
  "live-execution",
  "automation/",
]

const PROTECTED_EXACT = new Set([
  "preflight-last.json",
  "post-startup-latest.json",
  "readiness-latest.json",
  "provider-health.json",
  "session-handoff-latest.json",
  "flow-trace-latest.json",
  "model-routing-live.json",
])

const EPHEMERAL_PREFIXES = [
  { prefix: "decision-route-", keep: 30 },
  { prefix: "flow-policy-check-", keep: 20 },
  { prefix: "elite-quality-gate-", keep: 20 },
  { prefix: "decision-router-self-test-", keep: 5 },
]

const TERMINAL_STEPS = new Set(["DELIVER", "DONE", "CANCELLED", "EXPIRED"])

const ACTIVE_STEPS = new Set([
  "DISCOVERY",
  "PLAN_READY",
  "WAITING_PLAN_APPROVAL",
  "IMPLEMENTING",
  "VERIFYING",
  "STAGING",
  "WAITING_PRODUCTION_APPROVAL",
  "PRODUCTION_DEPLOY",
])

function isProtected(name: string) {
  if (PROTECTED_EXACT.has(name)) return true
  if (name.endsWith("-latest.json")) return true
  if (name.includes("/")) return true
  return PROTECTED_PREFIXES.some((p) => name.startsWith(p))
}

function isTaskStateFile(name: string) {
  return /^\d{8}-\d{6}-(gmp|granja)-.+\.json$/i.test(name)
}

function parseDate(value: unknown, fallback: Date) {
  if (!value) return fallback
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? new Date(parsed) : fallback
}

function isPendingTask(state: any, file: { name: string; mtime: Date }) {
  if (!state?.task_id || !state?.current_step) return false
  if (TERMINAL_STEPS.has(String(state.current_step))) return false
  const updatedAt = parseDate(state.ts_updated, file.mtime)
  const now = Date.now()
  const step = String(state.current_step)
  if (step === "RECEIVE" && now - updatedAt.getTime() > 15 * 60 * 1000) return false
  if (step.startsWith("WAITING_") && now - updatedAt.getTime() > 24 * 3600 * 1000) return false
  if (!ACTIVE_STEPS.has(step) && step !== "RECEIVE" && step !== "BLOCKED") return false
  if (now - updatedAt.getTime() > 90 * 60 * 1000) return false
  return true
}

function shouldExpireTask(state: any, file: { name: string; mtime: Date }) {
  if (!isTaskStateFile(file.name)) return false
  if (!state?.current_step || TERMINAL_STEPS.has(String(state.current_step))) return false
  const updatedAt = parseDate(state.ts_updated, file.mtime)
  const ageMs = Date.now() - updatedAt.getTime()
  const step = String(state.current_step)
  const agents = Array.isArray(state.agents_active) ? state.agents_active : []
  const streams = Array.isArray(state.workstreams) ? state.workstreams : []

  if (step === "RECEIVE" && agents.length === 0 && streams.length === 0 && ageMs > 48 * 3600 * 1000) {
    return "orphan_receive_48h"
  }
  if (step === "BLOCKED" && ageMs > 14 * 24 * 3600 * 1000) {
    return "blocked_14d"
  }
  if (ACTIVE_STEPS.has(step) && ageMs > 21 * 24 * 3600 * 1000) {
    return "active_stale_21d"
  }
  if ((step === "RECEIVE" || step === "BLOCKED") && ageMs > 7 * 24 * 3600 * 1000) {
    return "stale_7d"
  }
  return null
}

async function countStale(root: string) {
  const dir = path.join(root, ".opencode", "state")
  const files = await fs.readdir(dir).catch(() => [])
  let count = 0
  const active = new Set<string>()
  for (const name of files) {
    if (!name.endsWith(".json") || isProtected(name)) continue
    try {
      const full = path.join(dir, name)
      const stat = await fs.stat(full)
      const state = JSON.parse(await fs.readFile(full, "utf8"))
      if (isPendingTask(state, { name, mtime: stat.mtime })) active.add(name)
    } catch {}
  }
  for (const name of files) {
    if (!name.endsWith(".json") || isProtected(name)) continue
    if (name.startsWith("decision-route-") || name.includes("-audit-")) continue
    try {
      const state = JSON.parse(await fs.readFile(path.join(dir, name), "utf8"))
      if (
        state?.task_id &&
        state?.current_step &&
        !TERMINAL_STEPS.has(String(state.current_step)) &&
        !active.has(name)
      ) {
        count++
      }
    } catch {}
  }
  return count
}

async function archiveEphemeral(root: string, dryRun: boolean, details: string[]) {
  const dir = path.join(root, ".opencode", "state")
  const archiveRoot = path.join(dir, "archive", "ephemeral")
  let moved = 0
  for (const rule of EPHEMERAL_PREFIXES) {
    const matches = (await fs.readdir(dir).catch(() => []))
      .filter((name) => name.startsWith(rule.prefix) && name.endsWith(".json"))
    const stats = await Promise.all(
      matches.map(async (name) => ({
        name,
        mtime: (await fs.stat(path.join(dir, name))).mtimeMs,
      })),
    )
    stats.sort((a, b) => b.mtime - a.mtime)
    const toArchive = stats.slice(rule.keep)
    for (const item of toArchive) {
      const src = path.join(dir, item.name)
      const dest = path.join(archiveRoot, item.name)
      details.push(`archive ${item.name}`)
      if (!dryRun) {
        await fs.mkdir(archiveRoot, { recursive: true })
        await fs.rename(src, dest).catch(async () => {
          await fs.copyFile(src, dest)
          await fs.rm(src, { force: true })
        })
      }
      moved++
    }
  }
  return moved
}

async function expireStaleTasks(root: string, dryRun: boolean, details: string[]) {
  const dir = path.join(root, ".opencode", "state")
  const files = await fs.readdir(dir).catch(() => [])
  let expired = 0
  for (const name of files) {
    if (!name.endsWith(".json") || isProtected(name) || !isTaskStateFile(name)) continue
    const full = path.join(dir, name)
    try {
      const stat = await fs.stat(full)
      const state = JSON.parse(await fs.readFile(full, "utf8"))
      if (isPendingTask(state, { name, mtime: stat.mtime })) continue
      const reason = shouldExpireTask(state, { name, mtime: stat.mtime })
      if (!reason) continue
      details.push(`expire ${name} (${reason})`)
      if (!dryRun) {
        state.current_step = "EXPIRED"
        state.ts_updated = new Date().toISOString()
        state.expired_reason = reason
        state.expired_by = "state-cleanup"
        await fs.writeFile(full, JSON.stringify(state, null, 2), "utf8")
      }
      expired++
    } catch {}
  }
  return expired
}

export default tool({
  description:
    "Limpieza segura de .opencode/state: archiva auditorias efimeras antiguas y marca tareas huérfanas como EXPIRED sin borrar historial.",
  args: {
    dry_run: tool.schema.boolean().default(false),
    skip_expire: tool.schema.boolean().default(false),
    skip_archive: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const details: string[] = []
    const staleBefore = await countStale(root)
    let archived = 0
    let expired = 0

    if (!args.skip_archive) archived = await archiveEphemeral(root, args.dry_run, details)
    if (!args.skip_expire) expired = await expireStaleTasks(root, args.dry_run, details)

    const staleAfter = args.dry_run ? staleBefore : await countStale(root)
    const summary: Summary = {
      status: "PASS",
      dry_run: args.dry_run,
      archived_ephemeral: archived,
      expired_task_states: expired,
      skipped_protected: 0,
      stale_before: staleBefore,
      stale_after: staleAfter,
      details: details.slice(0, 40),
    }

    const outFile = path.join(root, ".opencode", "state", "state-cleanup-latest.json")
    if (!args.dry_run) {
      await fs.mkdir(path.dirname(outFile), { recursive: true })
      await fs.writeFile(outFile, JSON.stringify({ ...summary, generated_at: new Date().toISOString() }, null, 2), "utf8")
      await fs.appendFile(
        path.join(root, ".opencode", "TEAM_TRACE.jsonl"),
        `${JSON.stringify({ ts: new Date().toISOString(), event: "state_cleanup", ...summary })}\n`,
        "utf8",
      )
    }

    return {
      output: JSON.stringify(summary, null, 2),
      metadata: { success: true, ...summary },
    }
  },
})
