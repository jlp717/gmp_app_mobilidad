import { tool } from "@opencode-ai/plugin"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

function result(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

function normalize(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
}

function safeSlug(text: string) {
  return normalize(text).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64)
}

async function appendJsonl(file: string, record: Record<string, unknown>) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, "utf8")
}

async function updateMarkdown(file: string, record: Record<string, unknown>) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const text = await fs.readFile(file, "utf8").catch(() => "# Correcciones de Javier\n\n")
  const lines = [
    text.trimEnd(),
    "",
    `## ${record.correction_id} - ${record.ts}`,
    `Scope: ${record.scope}`,
    `Agent: ${record.agent}`,
    `Severity: ${record.severity}`,
    "",
    String(record.correction_text),
    "",
  ]
  await fs.writeFile(file, `${lines.join("\n")}`, "utf8")
}

export default tool({
  description: "Captura una correccion explicita de Javier y la guarda como memoria prioritaria para futuras iteraciones.",
  args: {
    correction_text: tool.schema.string(),
    scope: tool.schema.string().optional(),
    agent: tool.schema.string().optional(),
    severity: tool.schema.enum(["preference", "correction", "blocker", "lesson"]).default("correction"),
    source: tool.schema.string().optional(),
    task_id: tool.schema.string().optional(),
  },
  async execute(args, context) {
    try {
      const text = normalize(args.correction_text)
      if (text.length < 8) {
        return result({ success: false, error: "correction_text demasiado corto" })
      }

      const root = path.resolve(context.worktree || context.directory || process.cwd())
      const memoryDir = path.join(root, ".opencode", "memory")
      const stateDir = path.join(root, ".opencode", "state")
      const correctionID = crypto.createHash("sha256").update(text.toLowerCase()).digest("hex").slice(0, 16)
      const now = new Date().toISOString()
      const record = {
        ts: now,
        correction_id: correctionID,
        correction_text: text,
        scope: args.scope || "global",
        agent: args.agent || "chief-engineer-assistant",
        severity: args.severity,
        source: args.source || "chat",
        task_id: args.task_id || null,
        tags: [safeSlug(args.scope || "global"), args.severity],
      }

      await appendJsonl(path.join(memoryDir, "user-corrections.jsonl"), record)
      await appendJsonl(path.join(memoryDir, "corrections.jsonl"), record)
      await updateMarkdown(path.join(memoryDir, "user-corrections.md"), record)
      await fs.mkdir(stateDir, { recursive: true })
      await fs.writeFile(path.join(stateDir, "correction-capture-last.json"), JSON.stringify(record, null, 2), "utf8")

      return result({
        success: true,
        correction_id: correctionID,
        stored_in: [
          ".opencode/memory/user-corrections.jsonl",
          ".opencode/memory/corrections.jsonl",
          ".opencode/memory/user-corrections.md",
        ],
      })
    } catch (error) {
      return result({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  },
})
