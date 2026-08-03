import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

function result(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

export default tool({
  description: "Envia notificaciones Telegram o guarda fallback JSONL.",
  args: {
    project: tool.schema.enum(["gmp", "granja", "system"]).default("gmp"),
    level: tool.schema.enum(["info", "success", "warning", "error"]).default("info"),
    message: tool.schema.string().min(1),
  },
  async execute(args, context) {
    const token = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID
    const icon = { info: "ℹ️", success: "✅", warning: "⚠️", error: "❌" }[args.level]
    const payload = { chat_id: chatId, text: `${icon} ${args.project}: ${args.message}` }
    try {
      if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID no definidos")
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`)
      return result({ success: true })
    } catch (error) {
      const root = path.resolve(context.worktree || context.directory)
      const file = path.join(root, ".opencode", "telegram_pending.jsonl")
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.appendFile(file, JSON.stringify({ ts: new Date().toISOString(), args, error: String(error) }) + "\n", "utf8")
      return result({ success: false, fallback: file, error: error instanceof Error ? error.message : String(error) })
    }
  },
})
