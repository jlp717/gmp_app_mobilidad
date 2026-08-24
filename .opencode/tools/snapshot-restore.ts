import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

function result(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

function isInside(root: string, target: string) {
  const rel = path.relative(root, target)
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel))
}

export default tool({
  description: "Restaura archivos desde snapshot de tarea.",
  args: {
    task_id: tool.schema.string(),
    files: tool.schema.array(tool.schema.string()).default([]),
  },
  async execute(args, context) {
    try {
      const root = path.resolve(context.worktree || context.directory)
      const snapRoot = path.join(root, ".opencode", "snapshots", args.task_id)
      const restored: string[] = []
      for (const file of args.files) {
        const src = path.join(snapRoot, file)
        const dest = path.resolve(root, file)
        if (!isInside(root, dest)) return result({ success: false, error: `Ruta fuera del proyecto: ${file}` })
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.copyFile(src, dest)
        restored.push(file)
      }
      return result({ success: true, restored })
    } catch (error) {
      return result({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  },
})
