import fs from "node:fs/promises"
import path from "node:path"
import { appendFlowTrace, resolveProjectRoot, setPluginRoot } from "../lib/provider-health-store.ts"
import { randomUUID } from "node:crypto"

type FlowStep = {
  ts: string
  phase: string
  kind?: string
  agent?: string
  model?: string
  tool?: string
  summary?: string
  status?: string
  duration_ms?: number
  sessionID?: string
}

const LIVE_EXECUTION = ".opencode/state/live-execution.jsonl"

const starts = new Map<string, number>()

function summarizeTool(tool: string, input: any) {
  const args = input?.args || input?.input || {}
  if (tool === "bash" || tool === "shell") return String(args.command || "").slice(0, 240)
  if (tool === "task") {
    const model = args.model?.providerID
      ? `${args.model.providerID}/${args.model.modelID}`
      : args.model || args.variant
    const base = `${args.subagent_type || "task"}: ${args.description || args.prompt?.slice?.(0, 80) || ""}`
    return (model ? `${base} [model=${model}]` : base).slice(0, 240)
  }
  if (tool === "read" || tool === "write" || tool === "edit") return String(args.path || "").slice(0, 200)
  if (tool === "grep") return String(args.pattern || "").slice(0, 120)
  if (tool === "decision-router") return String(args.request || "").slice(0, 120)
  if (tool === "rag-query") return String(args.query || "").slice(0, 120)
  if (tool === "handoff-ledger") return `${args.operation || ""} ${args.agent || ""}`.trim().slice(0, 120)
  if (tool === "state-manager") return String(args.operation || "").slice(0, 80)
  return JSON.stringify(args).slice(0, 160)
}

function phaseForTool(tool: string) {
  if (["decision-router", "flow-policy-check", "plan-approval-gate"].includes(tool)) return "route"
  if (["handoff-ledger", "state-manager", "parallel-dispatch"].includes(tool)) return "orchestrate"
  if (["rag-query", "read", "grep", "glob", "ls"].includes(tool)) return "discovery"
  if (tool === "task") return "delegate"
  if (
    ["elite-quality-gate", "readiness-smoke", "model-provider-health", "flow-status"].includes(tool)
  )
    return "verify"
  if (["write", "edit", "bash", "shell"].includes(tool)) return "implement"
  return "execute"
}

function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  const out: Record<string, string> = {}
  for (const part of raw.split(",")) {
    const idx = part.indexOf("=")
    if (idx <= 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = v
  }
  return out
}

function toOtlpAnyValue(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null || value === "") return null
  if (typeof value === "number" && Number.isFinite(value)) return { doubleValue: value }
  if (typeof value === "boolean") return { boolValue: value }
  return { stringValue: String(value) }
}

function hexId(bytes: number) {
  return randomUUID().replace(/-/g, "").slice(0, bytes * 2)
}

/** Build OTLP/HTTP JSON ExportTraceServiceRequest from a gen_ai span record. */
export function buildOtlpTracePayload(otel: {
  ts: string
  name: string
  attributes: Record<string, unknown>
}) {
  const attrs = Object.entries(otel.attributes)
    .map(([key, value]) => {
      const any = toOtlpAnyValue(value)
      return any ? { key, value: any } : null
    })
    .filter(Boolean)

  const endTime = BigInt(Date.parse(otel.ts) || Date.now()) * 1_000_000n
  const startTime = endTime - 1_000_000n

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "gmp-opencode-agentops" } },
            { key: "deployment.environment", value: { stringValue: "local" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "flow-observability", version: "1" },
            spans: [
              {
                traceId: hexId(16),
                spanId: hexId(8),
                name: otel.name,
                kind: 1,
                startTimeUnixNano: startTime.toString(),
                endTimeUnixNano: endTime.toString(),
                attributes: attrs,
                status: {
                  code: otel.attributes["gmp.status"] === "error" ? 2 : 1,
                },
              },
            ],
          },
        ],
      },
    ],
  }
}

/** Optional OTLP/HTTP JSON export. Fail-soft when endpoint unset or POST fails. */
export async function exportOtlpFailSoft(otel: {
  ts: string
  name: string
  attributes: Record<string, unknown>
}) {
  const endpoint = String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "").trim()
  if (!endpoint) return { exported: false, reason: "OTEL_EXPORTER_OTLP_ENDPOINT unset" }

  const protocol = String(process.env.OTEL_EXPORTER_OTLP_PROTOCOL || "http/json").trim()
  if (protocol !== "http/json" && protocol !== "http/protobuf") {
    return { exported: false, reason: `unsupported protocol ${protocol}; use http/json` }
  }
  // Only http/json implemented without extra deps; protobuf requests fall back to json attempt note.
  const base = endpoint.replace(/\/+$/, "")
  const url = base.endsWith("/v1/traces") ? base : `${base}/v1/traces`
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
  }
  const body = JSON.stringify(buildOtlpTracePayload(otel))

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      return { exported: false, reason: `OTLP HTTP ${res.status}` }
    }
    return { exported: true }
  } catch (error) {
    return {
      exported: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

async function appendFlow(root: string, step: FlowStep) {
  const stateDir = path.join(root, ".opencode", "state")
  await fs.mkdir(stateDir, { recursive: true })

  const traceLine = JSON.stringify(step) + "\n"
  await fs.appendFile(path.join(root, LIVE_EXECUTION), traceLine, "utf8")
  await appendFlowTrace(root, { kind: "flow_step", ...step })

  const teamTrace = path.join(root, ".opencode", "TEAM_TRACE.jsonl")
  await fs.appendFile(
    teamTrace,
    JSON.stringify({ ts: step.ts, event: "flow_step", ...step }) + "\n",
    "utf8",
  )

  // AgentOps: map to OpenTelemetry gen_ai.* semantic conventions (file exporter)
  const otel = {
    ts: step.ts,
    name:
      step.kind === "tool_start" || step.kind === "tool_end"
        ? "gen_ai.execute_tool"
        : step.phase === "route"
          ? "gen_ai.route"
          : step.agent
            ? "gen_ai.invoke_agent"
            : "gmp.workflow.transition",
    attributes: {
      "gen_ai.operation.name": step.phase,
      "gen_ai.tool.name": step.tool,
      "gen_ai.agent.name": step.agent,
      "gen_ai.request.model": step.model,
      "gmp.summary": step.summary,
      "gmp.status": step.status,
      "gmp.duration_ms": step.duration_ms,
      "gmp.session_id": step.sessionID,
    },
  }
  await fs.appendFile(path.join(stateDir, "otel-genai.jsonl"), JSON.stringify(otel) + "\n", "utf8")

  // Optional live collector — never throws into the agent loop
  const otlp = await exportOtlpFailSoft(otel)
  if (!otlp.exported && process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    await fs
      .appendFile(
        path.join(stateDir, "otel-otlp-errors.jsonl"),
        JSON.stringify({ ts: step.ts, ...otlp }) + "\n",
        "utf8",
      )
      .catch(() => undefined)
  }
}

export default async function FlowObservabilityPlugin(ctx?: { directory?: string }) {
  setPluginRoot(ctx?.directory || process.cwd())

  return {
    "chat.message": async (input: any, output: any) => {
      const root = resolveProjectRoot(input)
      const variant = output?.message?.variant || input?.variant
      const model =
        typeof variant === "string"
          ? variant
          : input?.model?.providerID
            ? `${input.model.providerID}/${input.model.modelID}`
            : undefined
      const primary = "openai/gpt-5.6-sol"
      const fallbackActive = model && model !== primary && model.includes("composer")
      await appendFlow(root, {
        ts: new Date().toISOString(),
        phase: "intake",
        kind: "message",
        agent: input?.agent,
        model,
        summary: fallbackActive
          ? `user_message (fallback activo: ${model})`
          : model
            ? `user_message (${model})`
            : "user_message",
        status: "done",
        sessionID: input?.sessionID,
      })
    },
    "tool.execute.before": async (input: any) => {
      const root = resolveProjectRoot(input)
      const key = `${input?.sessionID || "unknown"}:${input?.callID || input?.tool}`
      starts.set(key, Date.now())
      const routedModel = String(input?.args?.model || input?.args?.variant || input?.variant || "")
      await appendFlow(root, {
        ts: new Date().toISOString(),
        phase: phaseForTool(input?.tool),
        kind: "tool_start",
        agent: input?.agent,
        model: routedModel || undefined,
        tool: input?.tool,
        summary: summarizeTool(input?.tool, input),
        status: "running",
        sessionID: input?.sessionID,
      })
    },
    "tool.execute.after": async (input: any, output: any) => {
      const root = resolveProjectRoot(input)
      const key = `${input?.sessionID || "unknown"}:${input?.callID || input?.tool}`
      const started = starts.get(key)
      starts.delete(key)
      const status =
        output?.metadata?.success === false || output?.state?.status === "error" ? "error" : "done"
      await appendFlow(root, {
        ts: new Date().toISOString(),
        phase: phaseForTool(input?.tool),
        kind: "tool_end",
        agent: input?.agent,
        tool: input?.tool,
        summary: String(output?.title || summarizeTool(input?.tool, input)).slice(0, 220),
        status,
        duration_ms: started ? Date.now() - started : undefined,
        sessionID: input?.sessionID,
      })
    },
    event: async (input: any) => {
      const event = input?.event || input
      const root = resolveProjectRoot(input, event)
      const type = String(event?.type || "")

      if (type === "session.error") {
        const msg = String(
          event?.properties?.error?.data?.message ||
            event?.properties?.error?.message ||
            "",
        ).slice(0, 160)
        await appendFlow(root, {
          ts: new Date().toISOString(),
          phase: "error",
          kind: "session_error",
          sessionID: event?.properties?.sessionID,
          summary: msg || "session.error",
          status: "error",
        })
        return
      }

      if (type === "message.part.updated") {
        const part = event?.properties?.part
        if (part?.type !== "tool" || part?.state?.status !== "error") return
        await appendFlow(root, {
          ts: new Date().toISOString(),
          phase: phaseForTool(part.tool),
          kind: "tool_error",
          tool: part.tool,
          sessionID: part.sessionID || event?.properties?.sessionID,
          summary: String(
            part.state?.error?.message || part.state?.error || part.state?.output || "",
          ).slice(0, 180),
          status: "error",
        })
      }
    },
  }
}
