import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import {
  cursorComposerAvailable,
  loadFallbackConfig,
  pickFallback,
  syncHealthFromRecentTraces,
} from "../lib/provider-health-store.ts"

export default tool({
  description: "Vista completa para OpenCode Web/TUI: modelo primario, efectivo y fallback de cada agente.",
  args: {
    format: tool.schema.enum(["summary", "table", "json"]).default("summary"),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const agentsDir = path.join(root, ".opencode", "agents")
    const fallback = await loadFallbackConfig(root)
    const health = await syncHealthFromRecentTraces(root, Number(fallback?.gmpPolicy?.providerHealthTtlMinutes || 45))
    const composerAvailable = await cursorComposerAvailable(root)
    const preferComposer = fallback?.gmpPolicy?.preferComposerOnOpenAIQuota !== false
    const files = (await fs.readdir(agentsDir)).filter((file) => file.endsWith(".md")).sort()
    const rows = []
    for (const file of files) {
      const agent = path.basename(file, ".md")
      const text = await fs.readFile(path.join(agentsDir, file), "utf8")
      const model = readFrontmatterValue(text, "model")
      const mode = readFrontmatterValue(text, "mode")
      const policy = fallback.agents?.[agent] || null
      const effective = policy ? pickFallback(policy, health as any, preferComposer, composerAvailable) : model
      rows.push({
        agent,
        mode,
        primary: model,
        effective,
        effort_policy: effortFor(effective),
        fallback_active: effective !== model,
        fallback_chain: policy?.fallback || [],
        group: groupFor(agent),
      })
    }
    const counts = rows.reduce((acc: Record<string, number>, row) => {
      const provider = row.primary.split("/", 1)[0] || "missing"
      acc[provider] = (acc[provider] || 0) + 1
      return acc
    }, {})
    const payload = {
      status: rows.length === 40 && rows.every((r) => r.primary && r.effective) ? "PASS" : "WARN",
      generated_at: new Date().toISOString(),
      total_agents: rows.length,
      counts_by_primary_provider: counts,
      fallback_active_count: rows.filter((r) => r.fallback_active).length,
      fallback_policy: {
        auto_retry_in_session: fallback?.gmpPolicy?.autoRetryInSession === true,
        auto_fallback_same_session: fallback?.gmpPolicy?.autoFallbackSameSession === true,
        freeze_session_on_quota: fallback?.gmpPolicy?.freezeSessionAfterQuotaError !== false,
      },
      rows,
    }
    await fs.mkdir(path.join(root, ".opencode", "reports"), { recursive: true })
    await fs.writeFile(path.join(root, ".opencode", "reports", "model-roster-latest.json"), JSON.stringify(payload, null, 2), "utf8")

    if (args.format === "json") return { output: JSON.stringify(payload, null, 2), metadata: { success: payload.status === "PASS", ...payload } }
    const table = toTable(rows)
    const summary = [
      `Model roster: ${payload.status}`,
      `Agentes: ${rows.length}`,
      `Primarios por proveedor: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ")}`,
      `Fallback activo ahora: ${payload.fallback_active_count}`,
      `Fallback automatico: same-session=${payload.fallback_policy.auto_fallback_same_session ? "si" : "no"}, retry=${payload.fallback_policy.auto_retry_in_session ? "si" : "no"}`,
      "",
      table,
    ].join("\n")
    return { output: summary, metadata: { success: payload.status === "PASS", ...payload } }
  },
})

function readFrontmatterValue(text: string, key: string) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"))
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : ""
}

function groupFor(agent: string) {
  if (/UI|Design|product-ux|NextJS/i.test(agent)) return "frontend_visual"
  if (/Node|Flutter-Data|Test|Reviewer|Simplify/i.test(agent)) return "code_tests_review"
  if (/radar|Research|Repo|Context|Metrics|memory|Release|prompt/i.test(agent)) return "low_risk_ops"
  return "critical_reasoning"
}

function effortFor(model: string) {
  if (model.startsWith("openai/")) return "dynamic reasoningEffort: medium/high"
  if (model.startsWith("cursor-acp/")) return "provider default; no unsupported thinking fields"
  if (model.startsWith("opencode-go/")) return "provider default; no verbosity/reasoningSummary"
  return "provider default"
}

function toTable(rows: any[]) {
  const header = "agent | group | primary | effective | effort"
  const sep = "--- | --- | --- | --- | ---"
  const body = rows.map((r) => `${r.agent} | ${r.group} | ${r.primary} | ${r.effective}${r.fallback_active ? " *fallback*" : ""} | ${r.effort_policy}`)
  return [header, sep, ...body].join("\n")
}
