import fs from "node:fs/promises"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

export type ProviderHealth = {
  updated_at: string
  unavailable: Record<
    string,
    {
      reason: string
      since: string
      until: string
      last_error?: string
      source_session?: string
    }
  >
}

export const HEALTH_REL = ".opencode/state/provider-health.json"
export const PLUGIN_LOG_REL = ".opencode/state/model-fallback-plugin.log"
export const TRACE_REL = ".opencode/TEAM_TRACE.jsonl"
export const FLOW_TRACE_REL = ".opencode/FLOW_TRACE.jsonl"

export const QUOTA_PATTERNS = [
  /quota/i,
  /rate\s*limit/i,
  /rate_limit/i,
  /ratelimit/i,
  /too many requests/i,
  /insufficient credit/i,
  /billing/i,
  /resource exhausted/i,
  /resource_exhausted/i,
  /exceeded.*limit/i,
  /usage limit/i,
  /tokens per min/i,
  /requests per min/i,
  /limit reached/i,
  /exceeded your current quota/i,
  /spend limit/i,
  /credit balance/i,
  /model is temporarily unavailable/i,
  /try again in/i,
  /you exceeded your/i,
  /organization.*limit/i,
  /insufficient_quota/i,
  /rate_limit_exceeded/i,
  /you have reached your/i,
  /organization has exceeded/i,
  /model is at capacity/i,
  /overloaded/i,
  /tokens per day/i,
  /requests per minute/i,
  /tokens per minute/i,
  /tpm\b/i,
  /rpm\b/i,
  /please try again later/i,
  /temporarily unavailable/i,
]

const HARD_QUOTA_PATTERNS = [
  /quota/i,
  /rate\s*limit/i,
  /rate_limit/i,
  /ratelimit/i,
  /too many requests/i,
  /insufficient credit/i,
  /billing/i,
  /resource exhausted/i,
  /resource_exhausted/i,
  /exceeded.*limit/i,
  /usage limit/i,
  /tokens per min/i,
  /requests per min/i,
  /limit reached/i,
  /exceeded your current quota/i,
  /spend limit/i,
  /credit balance/i,
  /you exceeded your/i,
  /organization.*limit/i,
  /insufficient_quota/i,
  /rate_limit_exceeded/i,
  /you have reached your/i,
  /organization has exceeded/i,
  /tokens per day/i,
  /requests per minute/i,
  /tokens per minute/i,
  /tpm\b/i,
  /rpm\b/i,
]

let pluginRoot = process.cwd()

export function setPluginRoot(root: string) {
  if (root) pluginRoot = root
}

export function resolveProjectRoot(input?: any, event?: any) {
  const fromEvent =
    event?.properties?.info?.path?.root ||
    event?.properties?.info?.path?.cwd ||
    event?.properties?.path?.root ||
    event?.properties?.path?.cwd
  const fromInput = input?.path?.root || input?.path?.cwd || input?.directory
  return String(fromEvent || fromInput || pluginRoot || process.cwd())
}

export const QUOTA_CODES = new Set([402, 429, 413, 529])

const TRUSTED_QUOTA_CODES = new Set([
  "rate_limit_exceeded",
  "insufficient_quota",
  "billing_not_active",
  "insufficient_credits",
  "quota_exceeded",
])

export function projectRoot(cwd?: string) {
  return cwd || pluginRoot || process.cwd()
}

function looksLikeSourceOrToolDump(message: string) {
  const text = message.trim()
  if (!text) return false
  if (text.length > 600 && (text.includes("\nimport ") || text.includes("\nexport "))) return true
  if (/^import\s/m.test(text) && text.includes("export ")) return true
  if (text.includes("Found ") && text.includes("matches")) return true
  if (text.includes("$schema") && text.includes("opencode")) return true
  if (text.includes('"errorCodes"') && /\b429\b/.test(text)) return true
  if (text.includes('"defaultTrigger"') && text.includes("quota")) return true
  if (text.includes('"gmpPolicy"') || text.includes("fallback-models")) return true
  if (text.includes('"status":"completed"') && text.length > 400) return true
  if (text.includes("tokens.output") && /\b429\b/.test(text)) return true
  if (/"timeout":\s*\d+/.test(text) && !/quota|rate\s*limit|insufficient/i.test(text)) return true
  if (/"status":"completed"/.test(text) && text.includes('"tool"')) return true
  return false
}

function looksLikeOperationalWarnPayload(message: string) {
  const text = message.trim()
  if (!text) return false
  if (/Contexto alto:/i.test(text)) return true
  if (/SchemaError|Missing key|tool_error|invalid arguments/i.test(text)) return true
  if (/^\{[\s\S]*"specialist_output"\s*:/i.test(text)) return true
  if (/^\{[\s\S]*"status"\s*:\s*"WARN"/i.test(text)) return true
  if (/WARN_(PARTIAL|DIRECT|VERIFICATION|CONTEXT)/i.test(text)) return true
  if (/plan_id|workstreams|handoff|state-manager|TEAM_TRACE/i.test(text) && text.length > 400) return true
  return false
}

export function isTrustedQuotaSignal(message: string, code?: string, statusCode?: number) {
  if (looksLikeSourceOrToolDump(message)) return false
  if (looksLikeOperationalWarnPayload(message)) return false
  if (/NOT NULL constraint failed:\s*session_message\.seq/i.test(message)) return false
  if (/session_message\.seq/i.test(message) && /NOT NULL|constraint failed/i.test(message)) return false
  if (code && TRUSTED_QUOTA_CODES.has(code)) return true
  if (statusCode && QUOTA_CODES.has(statusCode)) return true
  const trimmed = message.trim()
  if (trimmed.startsWith("{")) {
    try {
      const payload = JSON.parse(trimmed)
      const err = payload?.error || payload
      const errCode = String(err?.code || err?.type || code || "")
      const errMsg = String(err?.message || payload?.message || "")
      if (TRUSTED_QUOTA_CODES.has(errCode)) return true
      if (errMsg && QUOTA_PATTERNS.some((pattern) => pattern.test(errMsg))) return true
    } catch {
      // not JSON â€” fall through to plain-text patterns
    }
  }
  return HARD_QUOTA_PATTERNS.some((pattern) => pattern.test(message))
}

export function isQuotaError(message: string, statusCode?: number) {
  return isTrustedQuotaSignal(message, undefined, statusCode)
}

export async function cursorComposerAvailable(root: string) {
  const readiness = await readJson<any>(path.join(root, ".opencode/state/readiness-latest.json"), {})
  const cursor = readiness?.providers?.cursor
  const localAcpModels = await cursorAcpModels()
  if (localAcpModels.some((m) => /composer/i.test(m))) return true
  const hasExplicitCursorApiKey =
    (()=>{
      const aliases = [
        "CURSOR_API_KEY",
        "CURSOR_ACP_KEY",
        "CURSOR_TOKEN",
        "CURSOR_AGENT_TOKEN",
        "CURSOR_AUTH_TOKEN",
      ]
      for (const name of aliases) {
        const value = String(process.env[name] || "").trim()
        if (!value) continue
        if (value === "cursor-local-placeholder") continue
        return true
      }
      return false
    })()

  const hasCursorAgentLogin = (() => {
    const cacheMs = 60_000
    const now = Date.now()
    const cached = (globalThis as any).__opencodeCursorAuthCache
    if (cached && now < cached.expiresAt) return cached.authenticated

    let authenticated = false
    try {
      const executable =
        process.env.CURSOR_AGENT_EXECUTABLE ||
        process.env.CURSOR_AGENT_CMD ||
        "cursor-agent.cmd"
      const out = spawnSync(executable, ["status"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 8000,
      })
      const stdout = String(out.stdout || "").toLowerCase()
      const stderr = String(out.stderr || "").toLowerCase()
      const combined = `${stdout} ${stderr}`
      authenticated =
        out.status === 0 &&
        (/login successful/.test(combined) || /logged in/.test(combined))
    } catch {
      authenticated = false
    }
    ;(globalThis as any).__opencodeCursorAuthCache = {
      authenticated,
      expiresAt: now + cacheMs,
    }
    return authenticated
  })()

  if (cursor?.status === "AVAILABLE") {
    const models: string[] = cursor?.models || []
    if (!hasExplicitCursorApiKey && !hasCursorAgentLogin) return false
    return models.some((m) => /composer/i.test(m))
  }
  if (cursor?.status === "NO_MODELS") return false
  return true
}

async function cursorAcpModels() {
  try {
    const res = await fetch("http://127.0.0.1:32124/v1/models", {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return []
    const payload: any = await res.json()
    return Array.isArray(payload?.data) ? payload.data.map((item: any) => String(item?.id || "")).filter(Boolean) : []
  } catch {
    return []
  }
}

export function isOpenAiFamily(model: string) {
  return model.startsWith("openai/")
}

export function modelProvider(model: string) {
  const slash = model.indexOf("/")
  return slash > 0 ? model.slice(0, slash) : model
}

/** OpenCode acepta variant string y/o { providerID, modelID } en Task y chat. */
export function splitModelRef(model: string): { variant: string; model?: { providerID: string; modelID: string } } {
  const slash = model.indexOf("/")
  if (slash <= 0) return { variant: model }
  return {
    variant: model,
    model: { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) },
  }
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch {
    return fallback
  }
}

function sanitizeForJson(value: unknown) {
  const seen = new WeakSet<object>()
  const maxString = 8000
  const maxItems = 200
  const cleanString = (input: string) => {
    const clean = input.replace(/[\u0000-\u001F\u007F]/g, " ")
    return clean.length > maxString ? `${clean.slice(0, maxString)}... [truncated ${clean.length - maxString} chars]` : clean
  }
  const walk = (input: unknown): unknown => {
    if (typeof input === "string") return cleanString(input)
    if (typeof input === "bigint") return input.toString()
    if (!input || typeof input !== "object") return input
    if (seen.has(input)) return "[Circular]"
    seen.add(input)
    if (input instanceof Error) {
      return {
        name: cleanString(input.name),
        message: cleanString(input.message),
        stack: input.stack ? cleanString(input.stack) : undefined,
      }
    }
    if (Array.isArray(input)) {
      const out = input.slice(0, maxItems).map(walk)
      if (input.length > maxItems) out.push(`[truncated ${input.length - maxItems} items]`)
      return out
    }
    const entries = Object.entries(input).slice(0, maxItems)
    const out: Record<string, unknown> = {}
    for (const [key, item] of entries) out[cleanString(key)] = walk(item)
    const extra = Object.keys(input).length - entries.length
    if (extra > 0) out.__truncated_keys = extra
    return out
  }
  return walk(value)
}

export async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(sanitizeForJson(value), null, 2), "utf8")
}

export async function logPlugin(root: string, level: string, message: string) {
  const file = path.join(root, PLUGIN_LOG_REL)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs
    .appendFile(file, `[${new Date().toISOString()}] [${level}] ${message}\n`, "utf8")
    .catch(() => undefined)
}

/** Alias corto usado por model-fallback-forward.ts */
export async function pluginLog(root: string, message: string, level = "info") {
  return logPlugin(root, level, message)
}

export async function appendTrace(root: string, event: Record<string, unknown>) {
  const file = path.join(root, TRACE_REL)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(sanitizeForJson({ ts: new Date().toISOString(), ...event })) + "\n", "utf8")
}

export async function appendFlowTrace(root: string, event: Record<string, unknown>) {
  const payload = sanitizeForJson({ ts: new Date().toISOString(), ...event }) as Record<string, unknown>
  const line = JSON.stringify(payload) + "\n"
  const targets = [
    path.join(root, FLOW_TRACE_REL),
    path.join(root, ".opencode/state/flow-trace.jsonl"),
  ]
  for (const file of targets) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.appendFile(file, line, "utf8")
  }
  if (payload.kind === "flow_step" || payload.event === "model_route" || payload.phase) {
    const latestPath = path.join(root, ".opencode/state/flow-trace-latest.json")
    const latest = await readJson<{ updated_at: string; steps: Record<string, unknown>[] }>(
      latestPath,
      { updated_at: "", steps: [] },
    )
    latest.updated_at = payload.ts
    latest.steps = [...(latest.steps || []), payload].slice(-50)
    await writeJson(latestPath, latest)
  }
}

function extractQuotaMessageFromTraceRow(row: Record<string, unknown>) {
  const issue = row.issue as Record<string, unknown> | undefined
  const detail = row.detail as Record<string, unknown> | undefined
  const nestedEvent = detail?.event as Record<string, unknown> | undefined
  const nestedType = String(nestedEvent?.type || "")
  const props = nestedEvent?.properties as Record<string, unknown> | undefined
  const fromSessionError =
    nestedType === "session.error"
      ? String(
          (props?.error as any)?.data?.message ||
            (props?.error as any)?.message ||
            "",
        )
      : ""
  return String(row.message || issue?.message || detail?.message || fromSessionError || "")
}

/** Repara health si hubo cuota registrada en TEAM_TRACE pero el fichero no se escribiÃ³ (cwd incorrecto). */
export async function syncHealthFromRecentTraces(root: string, ttlMinutes = 45) {
  const healthPath = path.join(root, HEALTH_REL)
  const existing = await readJson<ProviderHealth>(healthPath, {
    updated_at: new Date().toISOString(),
    unavailable: {},
  })
  const now = Date.now()
  if (isModelUnavailable(existing, "openai", now)) return existing

  try {
    const healthDir = path.join(root, ".opencode", "state", "session-health")
    const sessionFiles = await fs.readdir(healthDir).catch(() => [] as string[])
    for (const file of sessionFiles.sort().reverse().slice(0, 80)) {
      if (!file.endsWith(".json")) continue
      const issue = await readJson<any>(path.join(healthDir, file), null)
      if (!issue) continue
      const msg = String(issue.message || "")
      const isQuota =
        issue.code === "provider_quota_or_rate_limit" && isTrustedQuotaSignal(msg, issue.code)
      if (!isQuota) continue
      const updated = Date.parse(String(issue.updated_at || ""))
      if (Number.isFinite(updated) && now - updated > ttlMinutes * 60_000) continue
      return markProviderUnavailable(
        root,
        "openai/gpt-5.6-sol",
        /rate\s*limit|too many requests/i.test(String(issue.message || "")) ? "rate_limit" : "quota_or_billing",
        String(issue.message || "quota from session-health"),
        String(issue.sessionID || ""),
        ttlMinutes,
      )
    }
  } catch {
    // ignore
  }

  try {
    const raw = await fs.readFile(path.join(root, TRACE_REL), "utf8")
    const lines = raw.trim().split(/\r?\n/).slice(-400)
    for (let i = lines.length - 1; i >= 0; i--) {
      const row = JSON.parse(lines[i])
      const event = String(row.event || "")
      const message = String(
        row.message || row.issue?.message || row.detail?.message || "",
      )
      const sessionID = String(row.sessionID || row.issue?.sessionID || row.detail?.sessionID || "")
      const trustedQuota =
        event === "provider_unavailable_recorded" ||
        event === "provider_rate_limit_detected" ||
        row.issue?.code === "provider_quota_or_rate_limit"
      const sessionQuota =
        event === "session_error_detected" &&
        isTrustedQuotaSignal(message, String(row.issue?.code || ""))
      const legacyMessage = extractQuotaMessageFromTraceRow(row)
      const nestedType = String((row.detail as any)?.event?.type || "")
      // Legacy rate_limit_or_timeout_detected often wrapped tool dumps with "timeout":N â€” ignore those.
      const legacyQuota =
        event === "rate_limit_or_timeout_detected" &&
        (nestedType === "session.error" ||
          (nestedType === "message.updated" && isTrustedQuotaSignal(legacyMessage))) &&
        isTrustedQuotaSignal(legacyMessage)
      const quotaMessage = message || legacyMessage
      if (!trustedQuota && !sessionQuota && !legacyQuota && !isTrustedQuotaSignal(quotaMessage)) {
        continue
      }
      const ts = Date.parse(String(row.ts || ""))
      if (Number.isFinite(ts) && now - ts > ttlMinutes * 60_000) break
      return markProviderUnavailable(
        root,
        "openai/gpt-5.6-sol",
        /rate\s*limit|too many requests/i.test(quotaMessage) ? "rate_limit" : "quota_or_billing",
        quotaMessage || "quota detected in TEAM_TRACE",
        sessionID,
        ttlMinutes,
      )
    }
  } catch {
    return existing
  }
  return existing
}

export function isModelUnavailable(health: ProviderHealth, model: string, now = Date.now()) {
  const provider = modelProvider(model)
  const entry = health.unavailable[provider] || health.unavailable[model]
  return Boolean(entry && new Date(entry.until).getTime() > now)
}

export async function markProviderUnavailable(
  root: string,
  model: string,
  reason: string,
  message: string,
  sessionID: string,
  ttlMinutes: number,
) {
  const health = await readJson<ProviderHealth>(path.join(root, HEALTH_REL), {
    updated_at: new Date().toISOString(),
    unavailable: {},
  })
  const provider = modelProvider(model)
  const until = new Date(Date.now() + ttlMinutes * 60_000).toISOString()
  health.updated_at = new Date().toISOString()
  const block = {
    reason,
    since: new Date().toISOString(),
    until,
    last_error: message.slice(0, 300),
    source_session: sessionID,
  }
  health.unavailable[provider] = block
  if (provider === "openai") {
    for (const key of [
      "openai",
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-luna",
      "openai/gpt-5.4",
      "openai/gpt-5.4-fast",
      "openai/gpt-5.4-mini",
    ]) {
      health.unavailable[key] = block
    }
  }
  await writeJson(path.join(root, HEALTH_REL), health)
  await logPlugin(
    root,
    "warn",
    `PROVIDER_BLOCKED ${provider} until=${until} reason=${reason} session=${sessionID}`,
  )
  return health
}

export function extractErrorFromEvent(event: any) {
  if (!event) return null

  const parseJsonMessage = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed.startsWith("{")) return trimmed
    try {
      const payload = JSON.parse(trimmed)
      const nested = payload?.error || payload
      return String(nested?.message || nested?.error?.message || payload?.message || raw)
    } catch {
      return raw
    }
  }

  const parseJsonErrorCode = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed.startsWith("{")) return ""
    try {
      const payload = JSON.parse(trimmed)
      const nested = payload?.error || payload
      return String(nested?.code || nested?.error?.code || payload?.code || "")
    } catch {
      return ""
    }
  }

  const fromErrorObject = (errorObj: any, sessionID: string, modelHint = "") => {
    const errorData = errorObj?.data || errorObj || {}
    const rawMessage = String(errorData.message || errorObj?.message || errorObj?.name || "")
    const message = parseJsonMessage(rawMessage)
    if (!message && !rawMessage) return null
    const code = String(
      errorData.code || errorObj?.code || parseJsonErrorCode(rawMessage) || "",
    )
    const statusCode =
      Number(errorData.status || errorObj?.status || 0) ||
      (code === "rate_limit_exceeded" ||
      code === "insufficient_quota" ||
      code === "billing_not_active"
        ? 429
        : 0) ||
      undefined
    return {
      sessionID,
      message: message || rawMessage,
      statusCode,
      model: String(errorData.model || errorObj?.model || modelHint || ""),
    }
  }

  if (event.type === "session.error") {
    const props = event.properties || {}
    return fromErrorObject(props.error, String(props.sessionID || ""))
  }

  if (event.type === "message.updated") {
    const props = event.properties || {}
    const info = props.info || {}
    const finish = String(info.finish || "")
    if (props.error) {
      return fromErrorObject(
        props.error,
        String(props.sessionID || info.sessionID || ""),
        String(info.modelID || info.variant || ""),
      )
    }
    if (info.error || finish === "error") {
      return fromErrorObject(
        info.error || props.error,
        String(props.sessionID || info.sessionID || ""),
        String(info.modelID || info.variant || ""),
      )
    }
    return null
  }

  if (event.type === "message.part.updated") {
    const props = event.properties || {}
    const part = props.part || {}
    const state = part.state || {}
    if (part.type === "tool") {
      if (state.status !== "error" && !state.error) return null
      const toolMessage = String(
        typeof state.error === "string"
          ? state.error
          : state.error?.message || state.error?.data?.message || "",
      )
      const toolCode = String(state.error?.code || state.error?.data?.code || "")
      if (!toolMessage || !isTrustedQuotaSignal(toolMessage, toolCode)) return null
      return fromErrorObject(
        state.error || { message: toolMessage },
        String(props.sessionID || part.sessionID || ""),
      )
    }
    if (part.type === "error" || state.status === "error" || state.error) {
      return fromErrorObject(
        state.error || { message: state.output },
        String(props.sessionID || part.sessionID || ""),
      )
    }
    if (part.type === "text" && typeof part.text === "string") {
      const text = part.text.trim()
      if (text.startsWith("{")) {
        const code = parseJsonErrorCode(text)
        const message = parseJsonMessage(text)
        if (isTrustedQuotaSignal(message, code)) {
          return fromErrorObject({ message: text, code }, String(props.sessionID || part.sessionID || ""))
        }
      }
    }
  }

  return null
}

export type AgentPolicy = {
  primary: string
  fallback?: string[]
}

export type FallbackConfig = {
  enabled?: boolean
  gmpPolicy?: {
    autoRetryInSession?: boolean
    touchInProgressSessions?: boolean
    preferComposerOnOpenAIQuota?: boolean
    composerToolFallbackEnabled?: boolean
    providerHealthTtlMinutes?: number
    freezeSessionAfterQuotaError?: boolean
    autoFallbackSameSession?: boolean
    autoFallbackOnProviderError?: boolean
    autoPrepareNextAttempt?: boolean
    lockAfterFirstAssistantReply?: boolean
    respectManualModelSelection?: boolean
    preserveManualModelUnlessProviderBlocked?: boolean
    preserveEstablishedCriticalSessions?: boolean
    allowCriticalCrossProviderFallback?: boolean
    defaultReasoningVariant?: string
  }
  agents?: Record<string, AgentPolicy>
}

export async function loadFallbackConfig(root: string) {
  const projectConfig = path.join(root, ".opencode/fallback-models.json")
  try {
    await fs.access(projectConfig)
    return readJson<FallbackConfig>(projectConfig, {})
  } catch {
    return readJson<FallbackConfig>(
      path.join(os.homedir(), ".config", "opencode", "fallback-models.json"),
      {},
    )
  }
}

export async function loadProviderHealth(root: string, ttlMinutes = 45) {
  const health = await readJson<ProviderHealth>(path.join(root, HEALTH_REL), {
    updated_at: new Date().toISOString(),
    unavailable: {},
  })
  return syncHealthFromRecentTraces(root, ttlMinutes)
}

export function normalizeAgentName(agentName: string) {
  const aliases: Record<string, string> = {
    generalPurpose: "general-purpose",
    "general-purpose": "general-purpose",
  }
  return aliases[agentName] || agentName
}

export function resolveAgentPolicy(config: FallbackConfig, agentName: string): AgentPolicy {
  const normalized = normalizeAgentName(agentName)
  return (
    config.agents?.[normalized] ||
    config.agents?.[agentName] ||
    config.agents?.["general-purpose"] || {
      primary: "openai/gpt-5.6-sol",
      fallback: ["openai/gpt-5.6-terra", "openai/gpt-5.6-luna"],
    }
  )
}

function isCriticalAgentNoAutoFallback(config: FallbackConfig, agentName: string) {
  const blocked = config.gmpPolicy?.criticalAgentsNoAutoFallback || []
  return blocked.includes(normalizeAgentName(agentName)) || blocked.includes(agentName)
}

export function pickFallback(
  agent: AgentPolicy,
  health: ProviderHealth,
  preferComposer: boolean,
  composerAvailable = true,
) {
  const candidates = [agent.primary, ...(agent.fallback || [])]
  const now = Date.now()
  const openaiUnavailable = isModelUnavailable(health, "openai", now)

  if (preferComposer && openaiUnavailable && composerAvailable) {
    const composer = (agent.fallback || []).find((m) => m.includes("composer"))
    if (composer && !isModelUnavailable(health, composer, now)) return composer
  }

  for (const model of candidates) {
    if (openaiUnavailable && isOpenAiFamily(model)) continue
    if ((!preferComposer || !composerAvailable) && model.includes("composer")) continue
    if (!isModelUnavailable(health, model, now)) return model
  }

  const composer = (agent.fallback || []).find((m) => m.includes("composer"))
  if (openaiUnavailable && composer && preferComposer && composerAvailable) return composer
  return preferComposer && composerAvailable ? composer || agent.primary : agent.primary
}

export async function resolveEffectiveModel(
  config: FallbackConfig,
  health: ProviderHealth,
  agentName: string,
  root: string,
) {
  const policy = resolveAgentPolicy(config, agentName)
  const preferComposer = config.gmpPolicy?.preferComposerOnOpenAIQuota !== false
  const composerAvailable =
    config.gmpPolicy?.composerToolFallbackEnabled === true && (await cursorComposerAvailable(root))
  return pickFallback(policy, health, preferComposer, composerAvailable)
}

export async function writeRoutingStatus(
  root: string,
  health: ProviderHealth,
  extra?: Record<string, unknown>,
) {
  const now = Date.now()
  const config = await loadFallbackConfig(root)
  const composerToolFallbackEnabled = config.gmpPolicy?.composerToolFallbackEnabled === true
  const composerAvailable = composerToolFallbackEnabled && (await cursorComposerAvailable(root))
  const blocks = Object.entries(health.unavailable || {}).filter(
    ([, v]) => new Date(v.until).getTime() > now,
  )
  const openaiBlocked = blocks.some(([k]) => k === "openai" || k.startsWith("openai/"))
  const canUseComposer = openaiBlocked && composerAvailable
  const status = {
    updated_at: new Date().toISOString(),
    status: openaiBlocked ? "DEGRADED" : "OK",
    openai_blocked: openaiBlocked,
    active_blocks: blocks.map(([key, v]) => ({
      key,
      reason: v.reason,
      until: v.until,
      last_error: v.last_error,
    })),
    effective_default: "openai/gpt-5.6-sol",
    non_critical_fallback: canUseComposer ? "cursor-acp/composer-2.5" : undefined,
    composer_tool_fallback_enabled: composerToolFallbackEnabled,
    policy:
      canUseComposer
         ? "OpenAI aparece bloqueado: Chief y agentes criticos conservan GPT-5.6 Sol salvo failover explicito; agentes no criticos pueden usar Composer 2.5 porque paso el tool-smoke."
        : openaiBlocked
           ? "OpenAI aparece bloqueado; los agentes elegibles usan Composer 2.5 y los criticos conservan la familia OpenAI."
           : "OpenAI GPT-5.6 Sol permanece como primario. Composer 2.5 queda disponible para fallback elegible.",
    commands: {
      health: "model-provider-health",
      flow: "flow-status limit=15",
      trace: "flow-trace mode=summary",
      mark_quota: "model-provider-health mark_openai_quota=true",
      clear: "model-provider-health clear=true",
    },
    ...extra,
  }
  await writeJson(path.join(root, ".opencode/state/routing-status.json"), status)
  return status
}

export async function recordQuotaFailure(
  root: string,
  config: FallbackConfig,
  sessionID: string,
  agentName: string,
  failedModel: string,
  message: string,
  statusCode?: number,
) {
  const gmp = config.gmpPolicy || {}
  const ttlMinutes = Number(gmp.providerHealthTtlMinutes || 45)

  await markProviderUnavailable(
    root,
    failedModel,
    statusCode === 429 ? "rate_limit" : "quota_or_billing",
    message,
    sessionID,
    ttlMinutes,
  )

  const composerFallbackAllowed =
    Boolean(agentName) &&
    !isCriticalAgentNoAutoFallback(config, agentName) &&
    gmp.preferComposerOnOpenAIQuota !== false &&
    gmp.composerToolFallbackEnabled === true &&
    (await cursorComposerAvailable(root))
  const policy = agentName ? resolveAgentPolicy(config, agentName) : undefined
  const nextHint = policy
    ? composerFallbackAllowed
      ? (policy.fallback || []).find((m) => m.includes("composer")) || policy.fallback?.[0]
      : (policy.fallback || []).find((m) => !m.includes("composer") && !isOpenAiFamily(m)) ||
        (policy.fallback || []).find((m) => !m.includes("composer")) ||
        policy.primary
    : composerFallbackAllowed
      ? "cursor-acp/composer-2.5"
       : "openai/gpt-5.6-terra"

  await appendTrace(root, {
    event: "provider_unavailable_recorded",
    agent: agentName || "unknown",
    sessionID,
    model: failedModel,
    message: message.slice(0, 200),
    action:
      gmp.autoFallbackSameSession === true || gmp.autoRetryInSession === true
        ? "auto_fallback_next_attempt_same_session_and_subagents"
        : "future_sessions_and_subagents_only",
    auto_retry: gmp.autoRetryInSession === true,
    auto_fallback_same_session: gmp.autoFallbackSameSession === true,
    next_model_hint: nextHint,
  })
  await appendFlowTrace(root, {
    event: "provider_unavailable",
    agent: agentName || "unknown",
    sessionID,
    model: failedModel,
    next_model_hint: nextHint,
    message: message.slice(0, 160),
  })
  await logPlugin(
    root,
    "warn",
    `quota_detected agent=${agentName || "unknown"} session=${sessionID} model=${failedModel} next=${nextHint}`,
  )
  const health = await readJson<ProviderHealth>(path.join(root, HEALTH_REL), {
    updated_at: new Date().toISOString(),
    unavailable: {},
  })
  await writeRoutingStatus(root, health, { last_quota_session: sessionID, next_model_hint: nextHint })
  return nextHint
}

export default async function ProviderHealthStorePlugin() {
  return {}
}
