import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

function ok(data: Record<string, unknown>) {
  return { output: JSON.stringify({ success: true, ...data }, null, 2), metadata: { success: true, ...data } }
}

export default tool({
  description: "Verifica que un agente solo haya modificado archivos permitidos por su file gate.",
  args: {
    agent: tool.schema.string().describe("Agente que hizo el cambio."),
    allowed_globs: tool.schema.array(tool.schema.string()).default([]).describe("Patrones permitidos."),
    changed_files: tool.schema.array(tool.schema.string()).default([]).describe("Archivos cambiados. Si viene vacio, usa git diff --name-only cuando este disponible."),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const files = args.changed_files
    const allowed = args.allowed_globs.length > 0 ? args.allowed_globs : ["**"]
    const violations = files.filter((file) => !allowed.some((glob) => matchesGlob(file.replace(/\\/g, "/"), glob)))
    const payload = {
      agent: args.agent,
      allowed_globs: allowed,
      changed_files: files,
      violations,
      status: violations.length === 0 ? "PASS" : "BLOCK",
    }
    await fs.mkdir(path.join(root, ".opencode", "state"), { recursive: true })
    await fs.writeFile(path.join(root, ".opencode", "state", `file-gate-${Date.now()}.json`), JSON.stringify(payload, null, 2), "utf8")
    return ok(payload)
  },
})

function matchesGlob(file: string, glob: string) {
  const normalized = glob.replace(/\\/g, "/")
  if (normalized === "**" || normalized === "*") return true
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\*\\\*/g, ".*")
    .replace(/\\\*/g, "[^/]*")
  return new RegExp(`^${escaped}$`).test(file)
}
