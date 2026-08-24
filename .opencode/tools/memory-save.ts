import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

function result(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

export default tool({
  description: "Guarda memoria externa estructurada en .opencode/memory.",
  args: {
    kind: tool.schema.enum(["session", "correction", "lesson", "rlhf", "pattern"]),
    record: tool.schema.record(tool.schema.string(), tool.schema.any()),
  },
  async execute(args, context) {
    try {
      const root = path.resolve(context.worktree || context.directory)
      const dir = path.join(root, ".opencode", "memory")
      await fs.mkdir(dir, { recursive: true })
      const file = args.kind === "session"
        ? path.join(dir, "sessions", `${new Date().toISOString().slice(0,10)}.jsonl`)
        : path.join(dir, `${args.kind === "rlhf" ? "rlhf-signals" : args.kind + "s"}.jsonl`)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.appendFile(file, JSON.stringify({ ts: new Date().toISOString(), ...args.record }) + "\n", "utf8")
      return result({ success: true, file })
    } catch (error) {
      return result({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  },
})
