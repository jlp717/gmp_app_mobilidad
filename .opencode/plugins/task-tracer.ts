import fs from "node:fs/promises"
import path from "node:path"
import {
  extractErrorFromEvent,
  loadFallbackConfig,
  recordQuotaFailure,
  resolveProjectRoot,
  setPluginRoot,
  isTrustedQuotaSignal,
} from "../lib/provider-health-store.ts"

type SessionIssue = {
  sessionID: string
  message: string
  severity: "WARN" | "BLOCK"
  kind: "context" | "error"
  code?: string
  diagnosis?: string
  action?: string
  tokens?: {
    input?: number
    total?: number
    output?: number
    reasoning?: number
  }
  dedupeKey?: string
  throttleMs?: number
}

async function recordProviderQuotaIfNeeded(issue: SessionIssue, root: string) {
  if (issue.code !== "provider_quota_or_rate_limit") return
  if (!isTrustedQuotaSignal(issue.message, issue.code)) return
  const fallback = await loadFallbackConfig(root)
  await recordQuotaFailure(
    root,
    fallback,
    issue.sessionID,
    "unknown",
    "openai/gpt-5.6-sol",
    issue.message,
    /rate\s*limit|too many requests/i.test(issue.message) ? 429 : undefined,
  )
}

async function append(root: string, event: any) {
  const file = path.join(root, ".opencode", "TEAM_TRACE.jsonl")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n", "utf8")
}

function firstLine(message: string) {
  return message.split(/\r?\n/)[0].slice(0, 500)
}

function getSessionError(props: any) {
  return String(props?.error?.data?.message || props?.error?.message || props?.error?.name || "")
}

function sessionIssue(input: any): SessionIssue | null {
  const event = input?.event || {}
  if (event?.type === "session.updated") return contextHealthIssue(event?.properties?.info)

  const extracted = extractErrorFromEvent(event)
  if (extracted) {
    const props = event?.properties || {}
    const classification = classifySessionError(props, extracted.message)
    return {
      sessionID: extracted.sessionID || props?.sessionID || "unknown",
      message: firstLine(extracted.message),
      severity: classification.severity,
      kind: classification.kind,
      code: classification.code,
      diagnosis: classification.diagnosis,
      action: classification.action,
      dedupeKey: `${extracted.sessionID || "unknown"}:${classification.code}:${firstLine(extracted.message)}`,
      throttleMs: classification.throttleMs,
    }
  }

  const props = event?.properties || {}
  const message = getSessionError(props)
  if (!message || (event?.type !== "session.error" && event?.type !== "message.updated")) return null

  const classification = classifySessionError(props, message)
  return {
    sessionID: props?.sessionID || "unknown",
    message: firstLine(message),
    severity: classification.severity,
    kind: classification.kind,
    code: classification.code,
    diagnosis: classification.diagnosis,
    action: classification.action,
    dedupeKey: `${props?.sessionID || "unknown"}:${classification.code}:${firstLine(message)}`,
    throttleMs: classification.throttleMs,
  }
}

function classifySessionError(props: any, message: string) {
  const raw = JSON.stringify(props || {})
  if (message.trim().startsWith("{")) {
    try {
      const payload = JSON.parse(message)
      const err = payload?.error || payload
      const code = String(err?.code || "")
      const errMsg = String(err?.message || message)
      if (
        isTrustedQuotaSignal(errMsg, code) ||
        code === "rate_limit_exceeded" ||
        code === "insufficient_quota"
      ) {
        return {
          code: "provider_quota_or_rate_limit",
          severity: "WARN" as const,
          kind: "error" as const,
          diagnosis:
            "OpenAI devolvio limite de cuota o rate limit. La sesion actual queda congelada por politica GMP.",
          action:
           "Chief y agentes criticos conservan GPT-5.6 Sol salvo failover explicito; Composer 2.5 se usa en agentes elegibles. Consulta model-provider-health o /flow.",
          throttleMs: 30_000,
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }
  if (/Input exceeds context window/i.test(message)) {
    return {
      code: "context_window_exceeded",
      severity: "BLOCK" as const,
      kind: "error" as const,
      diagnosis: "Sesion no recuperable: el historial ya supero la ventana de contexto del modelo.",
      action: "Abre una sesion nueva y pide continuar desde git status, .opencode/TEAM_TRACE.jsonl y .opencode/state/session-health/<session>.json.",
      throttleMs: 60_000,
    }
  }
  if (/undefined is not an object.*x\.model|evaluating 'x\.model'|evaluating "x\.model"/i.test(message)) {
    return {
      code: "x_model_compaction_bug",
      severity: "BLOCK" as const,
      kind: "error" as const,
      diagnosis: "Causa probable: bug de compactacion de OpenCode con variant/model inconsistente.",
      action: "No sigas esa sesion si venia de un contexto grande; abre una nueva para evitar repetir el fallo.",
      throttleMs: 60_000,
    }
  }
  if (/CreditsError|No payment method/i.test(raw) && /zen\/go\/v1\/messages|opencode-go/i.test(raw)) {
    return {
      code: "opencode_go_billing",
      severity: "BLOCK" as const,
      kind: "error" as const,
      diagnosis: "Causa probable: OpenCode Go rechaza la cuenta/workspace por billing; no es un modelo inexistente.",
      action: "Revisar billing/workspace de OpenCode Go antes de reintentar con ese proveedor.",
      throttleMs: 60_000,
    }
  }
  if (isTrustedQuotaSignal(message)) {
    return {
      code: "provider_quota_or_rate_limit",
      severity: "WARN" as const,
      kind: "error" as const,
      diagnosis:
        "OpenAI u otro proveedor devolvio limite de cuota o rate limit. La sesion actual queda congelada por politica GMP.",
      action:
         "Chief y agentes criticos conservan GPT-5.6 Sol salvo failover explicito; Composer 2.5 se usa en agentes elegibles. Consulta model-provider-health o /flow.",
      throttleMs: 30_000,
    }
  }
  if (/Upstream idle timeout exceeded/i.test(message)) {
    return {
      code: "upstream_idle_timeout",
      severity: "BLOCK" as const,
      kind: "error" as const,
      diagnosis: "Timeout del proveedor o gateway mientras la peticion estaba abierta. Suele aparecer con contexto grande, herramientas largas o respuestas demasiado extensas.",
      action: "Abre una sesion nueva o divide la tarea; si ya habia contexto alto, considera la sesion muerta.",
      throttleMs: 60_000,
    }
  }
  if (/^Aborted$|AbortError|aborted/i.test(message)) {
    return {
      code: "aborted",
      severity: "WARN" as const,
      kind: "error" as const,
      diagnosis: "La operacion fue abortada por cliente, red, proveedor o cancelacion interna.",
      action: "Si no hubo respuesta final, revisa el ultimo tool en TEAM_TRACE y continua en una sesion nueva si se repite.",
      throttleMs: 60_000,
    }
  }
  return {
    code: "session_error",
    severity: "WARN" as const,
    kind: "error" as const,
    diagnosis: "",
    action: "Revisa .opencode/TEAM_TRACE.jsonl para ver el ultimo evento antes del corte.",
    throttleMs: 60_000,
  }
}

function numeric(value: any) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function contextHealthIssue(info: any): SessionIssue | null {
  if (!info?.id || !info?.tokens) return null
  const input = numeric(info.tokens.input)
  const output = numeric(info.tokens.output)
  const reasoning = numeric(info.tokens.reasoning)
  const reportedTotal = numeric(info.tokens.total)
  const total = reportedTotal || input + output + reasoning
  const tokens = {
    input,
    total,
    output,
    reasoning,
  }
  const isCritical = tokens.input >= 120_000 || tokens.total >= 200_000
  const isWarning = tokens.input >= 80_000 || tokens.total >= 140_000
  if (!isCritical && !isWarning) return null

  const level = isCritical ? "critico" : "alto"
  return {
    sessionID: info.id,
    message: `Contexto ${level}: input=${tokens.input} total=${tokens.total}`,
    severity: isCritical ? "BLOCK" : "WARN",
    kind: "context",
    diagnosis: isCritical
      ? "La sesion esta cerca del limite; la compactacion automatica esta activa y este aviso queda solo en estado interno."
      : "La sesion esta acumulando contexto; la compactacion automatica esta activa y este aviso queda solo en estado interno.",
    action: isCritical
      ? "Si OpenCode no compacta y aparece un error real, se notificara por Telegram."
      : "Sin accion manual requerida mientras no haya error real.",
    tokens,
    dedupeKey: `${info.id}:context:${isCritical ? "critical" : "warning"}`,
    throttleMs: 30 * 60_000,
  }
}

function safeFilePart(value: string) {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 120) || "unknown"
}

async function persistSessionIssue(root: string, issue: SessionIssue) {
  const stateDir = path.join(root, ".opencode", "state", "session-health")
  await fs.mkdir(stateDir, { recursive: true })
  const file = path.join(stateDir, `${safeFilePart(issue.sessionID)}.json`)
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        updated_at: new Date().toISOString(),
        sessionID: issue.sessionID,
        code: issue.code || "",
        severity: issue.severity,
        kind: issue.kind,
        message: issue.message,
        diagnosis: issue.diagnosis || "",
        action: issue.action || "",
        tokens: issue.tokens || null,
        trace: ".opencode/TEAM_TRACE.jsonl",
      },
      null,
      2,
    ),
    "utf8",
  )
}

async function shouldRecordIssue(root: string, issue: SessionIssue) {
  const stateDir = path.join(root, ".opencode", "state")
  await fs.mkdir(stateDir, { recursive: true })
  const throttleFile = path.join(stateDir, "session-issue-recorder.json")
  const now = Date.now()
  const last = await fs.readFile(throttleFile, "utf8").then((raw: string) => JSON.parse(raw)).catch(() => ({}))
  const key = errorKey(issue)
  const throttleMs = issue.message.startsWith("Contexto ") ? 60_000 : issue.throttleMs || 60_000
  if (last[key] && now - Number(last[key]) < throttleMs) return false
  last[key] = now
  await fs.writeFile(throttleFile, JSON.stringify(last, null, 2), "utf8")
  return true
}

function errorKey(issue: SessionIssue) {
  return issue.dedupeKey || `${issue.sessionID}:${issue.message}`
}

async function notifyTelegram(root: string, error: SessionIssue) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatID = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatID) return

  const stateDir = path.join(root, ".opencode", "state")
  await fs.mkdir(stateDir, { recursive: true })
  const throttleFile = path.join(stateDir, "session-error-notifier.json")
  const now = Date.now()
  const last = await fs.readFile(throttleFile, "utf8").then((raw: string) => JSON.parse(raw)).catch(() => ({}))
  const key = errorKey(error)
  if (last[key] && now - Number(last[key]) < (error.throttleMs || 60_000)) return
  last[key] = now
  await fs.writeFile(throttleFile, JSON.stringify(last, null, 2), "utf8")

  const text = [
    `OpenCode detecto un problema de sesion (${error.severity}).`,
    `Sesion: ${error.sessionID}`,
    `Error: ${error.message}`,
    ...(error.diagnosis ? [`Diagnostico: ${error.diagnosis}`] : []),
    ...(error.action ? [`Accion: ${error.action}`] : []),
    ...(error.tokens ? [`Tokens: input=${error.tokens.input || 0} total=${error.tokens.total || 0}`] : []),
    `Estado: .opencode/state/session-health/${safeFilePart(error.sessionID)}.json`,
    "He guardado la traza en .opencode/TEAM_TRACE.jsonl.",
  ].join("\n")

  const body = new URLSearchParams({ chat_id: chatID, text })
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", body }).catch(() => undefined)
}

export default async function TaskTracerPlugin(ctx?: { directory?: string }) {
  setPluginRoot(ctx?.directory || process.cwd())

  return {
    event: async (input: any) => {
      const root = resolveProjectRoot(input, input?.event)
      const issue = sessionIssue(input)
      if (issue) {
        await persistSessionIssue(root, issue)
        if (issue.kind === "error") {
          await recordProviderQuotaIfNeeded(issue, root)
        }
        if (issue.kind === "error" && (await shouldRecordIssue(root, issue))) {
          await append(root, { event: "session_error_detected", issue })
          await notifyTelegram(root, issue)
        }
      }
    },
  }
}
