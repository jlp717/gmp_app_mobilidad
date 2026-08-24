import path from "node:path"
import {
  appendFlowTrace,
  appendTrace,
  extractErrorFromEvent,
  isTrustedQuotaSignal,
  logPlugin,
  markProviderUnavailable,
  readJson,
  resolveProjectRoot,
  setPluginRoot,
} from "../lib/provider-health-store.ts"

export default async function RateLimitHandlerPlugin(ctx?: { directory?: string }) {
  setPluginRoot(ctx?.directory || process.cwd())

  return {
    event: async (input: any) => {
      const event = input?.event || input
      const eventType = String(event?.type || "")
      if (eventType !== "session.error" && eventType !== "message.updated") return

      const parsed = extractErrorFromEvent(event)
      if (!parsed) return
      let errorCode = ""
      if (parsed.message.trim().startsWith("{")) {
        try {
          const payload = JSON.parse(parsed.message)
          errorCode = String(payload?.error?.code || payload?.code || "")
        } catch {
          // ignore malformed JSON
        }
      }
      if (!isTrustedQuotaSignal(parsed.message, errorCode, parsed.statusCode)) return

      const root = resolveProjectRoot(input, event)
      const config = await readJson<any>(path.join(root, ".opencode/fallback-models.json"), {})
      const ttlMinutes = Number(config?.gmpPolicy?.providerHealthTtlMinutes || 45)

      await markProviderUnavailable(
        root,
        parsed.model || "openai/gpt-5.6-sol",
        parsed.statusCode === 429 ? "rate_limit" : "quota_or_billing",
        parsed.message,
        parsed.sessionID,
        ttlMinutes,
      )

      await appendTrace(root, {
        event: "provider_rate_limit_detected",
        sessionID: parsed.sessionID,
        message: parsed.message.slice(0, 200),
        model: parsed.model || "openai/gpt-5.6-sol",
      })
      await appendFlowTrace(root, {
        event: "provider_rate_limit_detected",
        sessionID: parsed.sessionID,
        summary: parsed.message.slice(0, 160),
        status: "warn",
      })

      await logPlugin(root, "warn", `RATE_LIMIT_DETECTED session=${parsed.sessionID}`)
    },
  }
}
