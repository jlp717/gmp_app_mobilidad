import { tool } from "@opencode-ai/plugin"
import autopilot from "./mobile-autopilot.ts"
import safety from "./mobile-safety-net.ts"
import improve from "./continuous-improvement-loop.ts"
import obsidian from "./obsidian-capture.ts"

export default tool({
  description: "Briefing corto para Telegram/movil: estado operativo, riesgos y siguientes acciones.",
  args: {
    send_telegram: tool.schema.boolean().default(false),
    save_obsidian: tool.schema.boolean().default(true),
  },
  async execute(args, context) {
    const ctx = { worktree: context.worktree || context.directory || process.cwd() }
    const [a, s, i] = await Promise.all([
      autopilot.execute({ mode: "status" }, ctx),
      safety.execute({ strict: false, startup_phase: !(await webIsUp(ctx.worktree as string)) }, ctx),
      improve.execute({ include_radar: false, max_actions: 5 }, ctx),
    ])
    const ap = JSON.parse(a.output)
    const sp = JSON.parse(s.output)
    const ip = JSON.parse(i.output)
    const lines = [
      `Estado: ${ap.status}`,
      ...(ap.mobile_summary || []).slice(0, 6),
      `Safety: ${sp.status} - ${sp.mobile_summary}`,
      `Mejora continua: ${ip.status} - ${ip.summary}`,
      sp.findings?.length ? `Riesgo principal: ${sp.findings[0].rule} -> ${sp.findings[0].action}` : "Riesgos: sin bloqueos.",
      ip.actions?.length ? `Siguiente accion: ${ip.actions[0].priority} ${ip.actions[0].title}` : "Siguiente accion: ninguna urgente.",
    ]
    const text = lines.join("\n")
    if (args.save_obsidian) await obsidian.execute({ kind: "team", title: "Briefing movil", body: text })
    const telegram_sent = args.send_telegram ? await notifyTelegram(text) : false
    const payload = { status: sp.status === "BLOCK" ? "BLOCK" : ap.status === "READY" ? "PASS" : "WARN", telegram_sent, text }
    return { output: JSON.stringify(payload, null, 2), metadata: { success: payload.status !== "BLOCK", ...payload } }
  },
})

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

async function webIsUp(root: string) {
  try {
    const fs = await import("node:fs/promises")
    const pw = (await fs.readFile(`${root}/.opencode-runtime/opencode-web-gmp.credentials`, "utf8")).trim()
    const auth = Buffer.from(`Javier:${pw}`, "ascii").toString("base64")
    const res = await fetch("http://127.0.0.1:3090", {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(4000),
    })
    return res.ok
  } catch {
    return false
  }
}
