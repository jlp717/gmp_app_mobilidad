import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

const INCLUDE = [
  "opencode.json",
  ".opencode/AGENTS.md",
  ".opencode/config",
  ".opencode/agents",
  ".opencode/skills",
  ".opencode/tools",
  ".opencode/plugins",
  ".opencode/scripts",
  ".opencode/fallback-models.json",
]

export default tool({
  description: "Crea un backup local restaurable de la configuracion del equipo OpenCode.",
  args: {
    label: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-")
    const safeLabel = (args.label || "team").replace(/[^\w.-]+/g, "-").slice(0, 40)
    const backupRoot = path.join(root, ".opencode", "backups", `${stamp}-${safeLabel}`)
    const copied: string[] = []
    for (const rel of INCLUDE) {
      const src = path.join(root, rel)
      if (!(await exists(src))) continue
      await copyRecursive(src, path.join(backupRoot, rel))
      copied.push(rel)
    }
    const manifest = { created_at: new Date().toISOString(), backup: backupRoot, copied }
    await fs.writeFile(path.join(backupRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8")
    await fs.writeFile(path.join(root, ".opencode", "backups", "latest.txt"), backupRoot, "utf8")
    return { output: JSON.stringify({ status: "OK", ...manifest }, null, 2), metadata: { success: true, ...manifest } }
  },
})

async function copyRecursive(src: string, dest: string) {
  const stat = await fs.stat(src)
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true })
    for (const item of await fs.readdir(src)) await copyRecursive(path.join(src, item), path.join(dest, item))
  } else {
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.copyFile(src, dest)
  }
}

async function exists(file: string) {
  try { await fs.access(file); return true } catch { return false }
}
