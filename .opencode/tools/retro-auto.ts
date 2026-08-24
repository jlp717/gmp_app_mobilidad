import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import obsidian from "./obsidian-capture.ts"

export default tool({
  description: "Agrupa errores repetidos y genera retro accionable en memoria y Obsidian.",
  args: {
    max_groups: tool.schema.number().int().min(1).max(10).default(5),
    notify_telegram: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const file = path.join(root, ".opencode", "memory", "same-error-tracker.jsonl")
    const rows = await readJsonl(file)
    const groups = new Map<string, any[]>()
    for (const row of rows) {
      const key = String(row.hash || row.error_hash || hash(String(row.message || row.error || row.raw || "")))
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(row)
    }
    const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, args.max_groups)
    const actions = ranked.map(([key, items]) => {
      const sample = String(items.at(-1)?.message || items.at(-1)?.error || items.at(-1)?.raw || JSON.stringify(items.at(-1))).replace(/\s+/g, " ").slice(0, 220)
      return {
        hash: key,
        occurrences: items.length,
        sample,
        action: "Crear regla preventiva o test de regresion antes de repetir el mismo tipo de cambio.",
      }
    })
    const report = {
      status: actions.length ? "WARN" : "PASS",
      generated_at: new Date().toISOString(),
      total_events: rows.length,
      groups: actions,
    }
    const body = actions.length
      ? actions.map((a) => `- ${a.hash} (${a.occurrences}): ${a.sample}\n  accion: ${a.action}`).join("\n")
      : "No hay errores repetidos registrados."
    await fs.mkdir(path.join(root, ".opencode", "reports"), { recursive: true })
    await fs.writeFile(path.join(root, ".opencode", "reports", "retro-auto-latest.json"), JSON.stringify(report, null, 2), "utf8")
    await obsidian.execute({ kind: "retro", title: "Retro automatica errores repetidos", body })
    if (args.notify_telegram) await notifyTelegram(`Retro auto: ${actions.length} grupos, ${rows.length} eventos.`)
    return { output: JSON.stringify(report, null, 2), metadata: { success: true, ...report } }
  },
})

async function readJsonl(file: string) {
  try {
    const raw = await fs.readFile(file, "utf8")
    return raw.split(/\r?\n/).filter(Boolean).map((line) => {
      try { return JSON.parse(line) } catch { return { raw: line } }
    })
  } catch {
    return []
  }
}

function hash(text: string) {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 12)
}

async function notifyTelegram(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return false
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    body: new URLSearchParams({ chat_id: chatId, text: message }),
  })
  return res.ok
}
