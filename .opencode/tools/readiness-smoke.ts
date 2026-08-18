import { tool } from "@opencode-ai/plugin"
import { spawnSync } from "node:child_process"
import path from "node:path"

export default tool({
  description: "Smoke test barato del equipo: proveedores, Cursor, MCP configurados, skills, tools, comandos y ultimo preflight.",
  args: {
    json: tool.schema.boolean().default(true),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const script = path.join(root, ".opencode", "scripts", "readiness-smoke.mjs")
    const result = spawnSync(process.execPath, [script, ...(args.json ? ["--json"] : [])], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
    })
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim()
    let metadata: Record<string, unknown> = { success: result.status === 0 }
    try {
      const parsed = JSON.parse(result.stdout || "{}")
      metadata = { success: parsed.status !== "BLOCK", ...parsed }
    } catch {
      metadata = { success: result.status === 0, status: result.status, output }
    }
    return { output, metadata }
  },
})
