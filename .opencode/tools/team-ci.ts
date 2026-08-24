import { tool } from "@opencode-ai/plugin"
import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

type Check = { name: string; status: "PASS" | "WARN" | "BLOCK"; summary: string }

export default tool({
  description: "CI operativo del equipo: readiness, safety, modelos, workflow, gitleaks, agnix acotado y snapshot movil.",
  args: {
    include_agnix: tool.schema.boolean().default(true),
    notify_telegram: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const checks: Check[] = []

    checks.push(commandCheck("readiness", root, "node", [".opencode/scripts/readiness-smoke.mjs"]))
    checks.push(await toolCheck("model-roster", root, "../tools/model-roster-view.ts", { format: "json" }))
    checks.push(await toolCheck("mobile-safety-net", root, "../tools/mobile-safety-net.ts", { strict: false }))
    checks.push(await toolCheck("mobile-autopilot", root, "../tools/mobile-autopilot.ts", { mode: "status" }))
    checks.push(await toolCheck("continuous-improvement", root, "../tools/continuous-improvement-loop.ts", { include_radar: false, max_actions: 5 }))
    checks.push(commandCheck("gitleaks", root, "gitleaks", ["protect", "--staged", "--redact", "--no-banner"]))
    if (args.include_agnix) {
      checks.push(commandCheck("agnix-agent-config", root, "agnix", [
        "AGENTS.md",
        ".opencode/AGENTS.md",
        ".opencode/config",
        ".opencode/skills",
        ".opencode/tools",
        ".opencode/plugins",
        "--dry-run",
      ]))
    }

    const status = checks.some((c) => c.status === "BLOCK") ? "BLOCK" : checks.some((c) => c.status === "WARN") ? "WARN" : "PASS"
    const report = {
      status,
      generated_at: new Date().toISOString(),
      summary: `${status}: ${checks.filter((c) => c.status === "PASS").length} pass, ${checks.filter((c) => c.status === "WARN").length} warn, ${checks.filter((c) => c.status === "BLOCK").length} block`,
      checks,
    }
    const reportDir = path.join(root, ".opencode", "reports")
    await fs.mkdir(reportDir, { recursive: true })
    await fs.writeFile(path.join(reportDir, "team-ci-latest.json"), JSON.stringify(report, null, 2), "utf8")
    if (args.notify_telegram) await notifyTelegram(`Team CI ${report.summary}`)
    return { output: JSON.stringify(report, null, 2), metadata: { success: status !== "BLOCK", ...report } }
  },
})

function commandCheck(name: string, cwd: string, command: string, args: string[]): Check {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120_000, windowsHide: true })
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim()
  if (result.error) return { name, status: "WARN", summary: result.error.message }
  if (result.status === 0) return { name, status: "PASS", summary: output.split(/\r?\n/).slice(-3).join(" | ") || "ok" }
  const agnixNoise = name.startsWith("agnix") && output.includes("Found ")
  return { name, status: agnixNoise ? "WARN" : "BLOCK", summary: output.split(/\r?\n/).slice(0, 8).join(" | ").slice(0, 1000) }
}

async function toolCheck(name: string, root: string, rel: string, args: Record<string, unknown>): Promise<Check> {
  try {
    const mod = await import(new URL(rel, import.meta.url).href)
    const result = await mod.default.execute(args, { worktree: root })
    const payload = JSON.parse(result.output)
    const status = payload.status === "BLOCK" ? "BLOCK" : payload.status === "WARN" ? "WARN" : "PASS"
    return { name, status, summary: payload.mobile_summary || payload.summary || payload.status || "ok" }
  } catch (error) {
    return { name, status: "BLOCK", summary: error instanceof Error ? error.message : String(error) }
  }
}

async function notifyTelegram(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return false
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    body: new URLSearchParams({ chat_id: chatId, text: message }),
  })
  return res.ok
}
