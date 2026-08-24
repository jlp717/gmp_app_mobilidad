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
  description: "Crea snapshot de archivos dentro del proyecto.",
  args: {
    task_id: tool.schema.string(),
    files: tool.schema.array(tool.schema.string()).default([]),
  },
  async execute(args, context) {
    try {
      const root = path.resolve(context.worktree || context.directory)
      const snapRoot = path.join(root, ".opencode", "snapshots", args.task_id)
      const copied: string[] = []
      for (const file of args.files) {
        const full = path.resolve(root, file)
        if (!isInside(root, full)) return result({ success: false, error: `Ruta fuera del proyecto: ${file}` })
        const rel = path.relative(root, full)
        const dest = path.join(snapRoot, rel)
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.copyFile(full, dest)
        copied.push(rel)
      }
      return result({ success: true, snapshot: snapRoot, files: copied })
    } catch (error) {
      return result({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  },
})
