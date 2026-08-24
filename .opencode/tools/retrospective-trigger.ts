import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"

export default tool({
  description: "Crea una retrospectiva automatica por error repetido y avisa a Telegram si esta configurado.",
  args: {
    error_hash: tool.schema.string().min(8),
    occurrences: tool.schema.number().int().min(1),
    agents_involved: tool.schema.array(tool.schema.string()).default([]),
    error_samples: tool.schema.array(tool.schema.string()).default([]),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const id = `retro-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`
    const file = path.join(root, ".opencode", "memory", "retrospectives.md")
    await fs.mkdir(path.dirname(file), { recursive: true })
    const summary = summarize(args.error_samples)
    const entry = [
      "",
      `## Retrospectiva ${id} - ${new Date().toISOString()}`,
      `Error hash: ${args.error_hash}`,
      `Ocurrencias: ${args.occurrences}`,
      `Agentes implicados: ${args.agents_involved.join(", ") || "no especificado"}`,
      `Muestras: ${args.error_samples.map((sample) => sample.replace(/\s+/g, " ").slice(0, 220)).join(" | ") || "sin muestras"}`,
      "Causa raiz: pendiente de analisis SRE en la siguiente sesion operativa.",
      `Cambio de comportamiento: reutilizar este hash para bloquear el mismo fallo antes de repetir la accion. Resumen: ${summary}`,
      "Verificacion: confirmar que el contador del mismo error queda a cero y que el siguiente intento usa el nuevo comportamiento.",
      "",
    ].join("\n")
    await fs.appendFile(file, entry, "utf8")
    const telegramSent = await notifyTelegram(`Retrospectiva automatica completada. Error ${args.error_hash} repetido ${args.occurrences} veces. ${summary}`)
    return {
      output: JSON.stringify({ retrospective_id: id, stored_in: ".opencode/memory/retrospectives.md", telegram_sent: telegramSent }, null, 2),
      metadata: { retrospective_id: id, stored_in: file, telegram_sent: telegramSent },
    }
  },
})

function summarize(samples: string[]) {
  const first = samples[0] || "error repetido sin muestra"
  return first.replace(/\s+/g, " ").slice(0, 180)
}

async function notifyTelegram(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return false
  const body = new URLSearchParams({ chat_id: chatId, text: message })
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", body })
  return response.ok
}
