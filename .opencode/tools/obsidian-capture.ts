import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

const DEFAULT_VAULT = "C:\\Users\\Javier\\Obsidian\\GMP-Team"

export default tool({
  description: "Guarda notas utiles del equipo en el vault local de Obsidian: decisiones, runbooks, retros, radar o inbox.",
  args: {
    title: tool.schema.string().min(1),
    body: tool.schema.string().min(1),
    kind: tool.schema.enum(["inbox", "decision", "runbook", "retro", "radar", "team"]).default("inbox"),
  },
  async execute(args) {
    const vault = process.env.OBSIDIAN_GMP_VAULT || DEFAULT_VAULT
    const folder = folderForKind(args.kind)
    const dir = path.join(vault, folder)
    await fs.mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")
    const safeTitle = args.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80)
    const file = path.join(dir, `${stamp}-${safeTitle || "nota"}.md`)
    const content = [
      "---",
      `created: ${new Date().toISOString()}`,
      `kind: ${args.kind}`,
      "source: opencode",
      "---",
      "",
      `# ${args.title}`,
      "",
      args.body.trim(),
      "",
    ].join("\n")
    await fs.writeFile(file, content, "utf8")
    return {
      output: JSON.stringify({ status: "OK", file, vault, kind: args.kind }, null, 2),
      metadata: { success: true, file, vault, kind: args.kind },
    }
  },
})

function folderForKind(kind: string) {
  if (kind === "decision") return "10_Decisions"
  if (kind === "runbook") return "20_Runbooks"
  if (kind === "retro") return "30_Retros"
  if (kind === "radar") return "40_TechRadar"
  if (kind === "team") return "50_AgentTeam"
  return "00_Inbox"
}
