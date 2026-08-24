#!/usr/bin/env bun
/**
 * Post-arranque: espera Web, refresca readiness, safety/autopilot, automatizacion y preflight.
 * Se ejecuta despues de que OpenCode Web responde — evita falsos BLOCK de /rescue.
 */
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { loadEnv } from "./load-env.mjs"

const root = process.cwd()
await loadEnv(root)

const port = Number(process.env.OPENCODE_WEB_PORT || 3090)
const maxWaitMs = 90000
const pollMs = 3000

await waitForWeb(port, maxWaitMs)

spawnSync(process.execPath, [path.join(root, ".opencode/scripts/readiness-smoke.mjs")], {
  cwd: root,
  timeout: 180000,
  stdio: "ignore",
})

const autopilot = await import("../tools/mobile-autopilot.ts")
const safety = await import("../tools/mobile-safety-net.ts")
const improve = await import("../tools/continuous-improvement-loop.ts")
const briefing = await import("../tools/mobile-briefing.ts")
const runner = await import("../tools/scheduled-automation-runner.ts")

const ctx = { worktree: root, directory: root }
const results = {}

results.autopilot = JSON.parse((await autopilot.default.execute({ mode: "status" }, ctx)).output)
results.safety = JSON.parse((await safety.default.execute({ strict: false, startup_phase: false }, ctx)).output)
results.improvement = JSON.parse((await improve.default.execute({ include_radar: true, max_actions: 6 }, ctx)).output)
results.briefing = JSON.parse((await briefing.default.execute({ send_telegram: shouldNotifyBriefing(results), save_obsidian: true }, ctx)).output)
results.automation = JSON.parse((await runner.default.execute({ operation: "run_due" }, ctx)).output)

const integrityProc = spawnSync(process.execPath, [path.join(root, ".opencode/scripts/startup-integrity-check.mjs")], {
  cwd: root,
  timeout: 120000,
  encoding: "utf8",
})
try {
  results.integrity = JSON.parse(integrityProc.stdout || "{}")
} catch {
  results.integrity = { status: "WARN", error: String(integrityProc.stderr || "").slice(0, 200) }
}

try {
  const audit = await import("../tools/autonomous-capability-audit.ts")
  results.capability_audit = JSON.parse((await audit.default.execute({ fail_on_warn: false }, ctx)).output)
} catch (error) {
  results.capability_audit = { status: "WARN", error: String(error) }
}

const cleanupMarker = path.join(root, ".opencode", "state", "state-cleanup-latest.json")
let shouldCleanup = true
try {
  const prior = JSON.parse(fs.readFileSync(cleanupMarker, "utf8"))
  const at = Date.parse(prior.generated_at || "")
  shouldCleanup = !Number.isFinite(at) || Date.now() - at > 6 * 24 * 3600 * 1000
} catch {
  shouldCleanup = true
}
if (shouldCleanup) {
  try {
    const cleanup = await import("../tools/state-cleanup.ts")
    results.state_cleanup = JSON.parse((await cleanup.default.execute({ dry_run: false }, ctx)).output)
  } catch (error) {
    results.state_cleanup = { status: "WARN", error: String(error) }
  }
}

await updatePreflight(root, results)
await appendTrace(root, results)

console.log(JSON.stringify({
  status: overallStatus(results),
  web_port: port,
  autopilot: results.autopilot.status,
  safety: results.safety.status,
  improvement: results.improvement.status,
  briefing: results.briefing.status,
  automation_jobs: results.automation.jobs_run,
}, null, 2))

function shouldNotifyBriefing(r) {
  return r.safety?.status !== "PASS" || r.improvement?.status === "WARN" || (r.automation?.jobs_run || 0) > 0
}

function overallStatus(r) {
  if (r.safety?.status === "BLOCK" || r.autopilot?.status === "BLOCK") return "BLOCK"
  if (r.safety?.status === "WARN" || r.improvement?.status === "WARN") return "WARN"
  return "PASS"
}

async function waitForWeb(port, maxWait) {
  const credFile = path.join(root, ".opencode-runtime", "opencode-web-gmp.credentials")
  const deadline = Date.now() + maxWait
  while (Date.now() < deadline) {
    try {
      const pw = fs.readFileSync(credFile, "utf8").trim()
      const auth = Buffer.from(`Javier:${pw}`, "ascii").toString("base64")
      const res = await fetch(`http://127.0.0.1:${port}`, {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) return true
    } catch {}
    await sleep(pollMs)
  }
  return false
}

async function updatePreflight(root, results) {
  const file = path.join(root, ".opencode", "state", "preflight-last.json")
  let pre = {}
  try { pre = JSON.parse(fs.readFileSync(file, "utf8")) } catch {}
  pre.post_startup_at = new Date().toISOString()
  pre.mobile_operational_snapshot_status = `ok:${JSON.stringify({
    autopilot: results.autopilot.status,
    safety: results.safety.status,
    improvement: results.improvement.status,
    briefing: results.briefing.status,
  })}`
  pre.post_startup_status = overallStatus(results)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(pre, null, 2))
  fs.writeFileSync(path.join(root, ".opencode", "state", "post-startup-latest.json"), JSON.stringify({
    generated_at: pre.post_startup_at,
    results,
    status: pre.post_startup_status,
  }, null, 2))
}

async function appendTrace(root, results) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event: "post_web_startup",
    status: overallStatus(results),
    summary: {
      autopilot: results.autopilot.status,
      safety: results.safety.status,
      automation_jobs: results.automation.jobs_run,
    },
  })
  fs.appendFileSync(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), line + "\n")
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}
