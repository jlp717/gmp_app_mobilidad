// headroom-hint.ts - Activa headroom (compresion de contexto) en delegaciones largas.
// Detecta context packets grandes y sugiere comprimir con headroom-ai (skill headroom-context).
import fs from "node:fs/promises"
import path from "node:path"

export default async function HeadroomHintPlugin(ctx?: { directory?: string }) {
  const root = ctx?.directory || process.cwd()
  const THRESHOLD = 6000
  return {
    "tool.execute.before": async (input: any) => {
      const tool = String(input?.tool || "")
      if (tool !== "handoff-ledger" && tool !== "task") return
      const args = input?.args || {}
      const pkt = JSON.stringify(args?.context_packet || args?.prompt || "")
      if (pkt.length > THRESHOLD) {
        try { console.log("[headroom] context packet grande (" + pkt.length + " chars): considerar skill headroom-context para comprimir") } catch {}
      }
    }
  }
}
