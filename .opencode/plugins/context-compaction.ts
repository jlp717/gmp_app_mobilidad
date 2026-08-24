import fs from "node:fs/promises"
import path from "node:path"

async function appendJsonl(file: string, record: Record<string, unknown>) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(record) + "\n", "utf8")
}

export default async function ContextCompactionPlugin() {
  return {
    "experimental.session.compacting": async (_input: any, output: any) => {
      const root = process.cwd()
      const files = ["project-state.md", "user-corrections.jsonl", "corrections.jsonl"]
      const lines = ["<core_memory>"]
      for (const file of files) {
        const text = await fs.readFile(path.join(root, ".opencode", "memory", file), "utf8").catch(() => "")
        if (text) lines.push(`<file name="${file}">\n${text.slice(0, 1600)}\n</file>`)
      }
      const preflight = await fs.readFile(path.join(root, ".opencode", "state", "preflight-last.json"), "utf8").catch(() => "")
      const readiness = await fs.readFile(path.join(root, ".opencode", "state", "readiness-latest.json"), "utf8").catch(() => "")
      if (preflight) lines.push(`<preflight_last>${preflight.slice(0, 1200)}</preflight_last>`)
      if (readiness) lines.push(`<readiness_latest>${readiness.slice(0, 1200)}</readiness_latest>`)
      lines.push("</core_memory>")
      output.context = output.context || []
      output.context.push(lines.join("\n"))
    },
    event: async (input: any) => {
      const type = String(input?.event?.type || "")
      if (type !== "session.compacted") return
      const root = process.cwd()
      const sessionID = String(input?.event?.properties?.sessionID || input?.sessionID || "unknown")
      const handoff = await fs.readFile(path.join(root, ".opencode", "state", "session-handoff-latest.json"), "utf8").catch(() => "")
      const goalDir = path.join(root, ".opencode", "state", "goals")
      const goalFiles = await fs.readdir(goalDir).catch(() => [])
      const activeGoals = goalFiles.filter((f) => f.endsWith(".json")).slice(0, 5)
      await appendJsonl(path.join(root, ".opencode", "memory", "compaction-snapshots.jsonl"), {
        ts: new Date().toISOString(),
        source_event: type,
        sessionID,
        agent: input?.agent || input?.event?.properties?.agent || "unknown",
        handoff_excerpt: handoff.slice(0, 800),
        active_goal_files: activeGoals,
      })
    },
  }
}
