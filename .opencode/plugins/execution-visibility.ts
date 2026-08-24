import fs from "node:fs/promises"
import path from "node:path"
import { resolveProjectRoot, setPluginRoot } from "../lib/provider-health-store.ts"

type LiveEntry = {
  ts: string
  kind: "tool_start" | "tool_end" | "agent_message" | "permission" | "plugin_loaded" | "command"
  sessionID?: string
  agent?: string
  model?: string
  tool?: string
  summary?: string
  status?: string
  duration_ms?: number
}

const starts = new Map<string, number>()

function resolveRoot(input?: any) {
  return resolveProjectRoot(input)
}

function summarizeTool(tool: string, input: any) {
  const args = input?.args || input?.input || {}
  if (tool === "bash" || tool === "shell") return String(args.command || args.cmd || "").slice(0, 180)
  if (tool === "task") {
    const model = args.model?.providerID
      ? `${args.model.providerID}/${args.model.modelID}`
      : args.model || args.variant
    const base = `${args.subagent_type || "task"}: ${String(args.description || "").slice(0, 120)}`
    return model ? `${base} [model=${model}]`.slice(0, 200) : base.slice(0, 200)
  }
  if (tool === "read") return String(args.path || "").slice(0, 180)
  if (tool === "write" || tool === "edit") return String(args.path || "").slice(0, 180)
  if (tool === "grep") return String(args.pattern || "").slice(0, 120)
  if (tool === "decision-router") return String(args.request || "").slice(0, 120)
  if (tool === "rag-query") return String(args.query || "").slice(0, 120)
  if (tool === "handoff-ledger") return `${args.operation || ""} ${args.task_id || ""}`.trim()
  if (tool === "flow-trace") return String(args.mode || "summary")
  return JSON.stringify(args).slice(0, 160)
}

async function appendLive(root: string, entry: LiveEntry) {
  const dir = path.join(root, ".opencode", "state")
  await fs.mkdir(dir, { recursive: true })
  const liveFile = path.join(dir, "live-execution.jsonl")
  const traceFile = path.join(root, ".opencode", "TEAM_TRACE.jsonl")
  const flowFile = path.join(root, ".opencode", "FLOW_TRACE.jsonl")
  const line = JSON.stringify(entry) + "\n"
  await fs.appendFile(liveFile, line, "utf8")
  if (entry.kind !== "agent_message" || entry.summary !== "user_message_received") {
    const payload = JSON.stringify({ ts: entry.ts, event: "execution_visibility", ...entry }) + "\n"
    await fs.appendFile(traceFile, payload, "utf8")
    await fs.appendFile(flowFile, payload, "utf8")
  }
}

export default async function ExecutionVisibilityPlugin(ctx?: { directory?: string }) {
  setPluginRoot(ctx?.directory || process.cwd())
  const bootRoot = resolveProjectRoot({ directory: ctx?.directory })
  await appendLive(bootRoot, {
    ts: new Date().toISOString(),
    kind: "plugin_loaded",
    summary: "execution-visibility",
  })

  return {
    "chat.message": async (input: any, output: any) => {
      const root = resolveRoot(input)
      const variant = output?.message?.variant || input?.variant
      const model =
        typeof variant === "string"
          ? variant
          : input?.model?.providerID
            ? `${input.model.providerID}/${input.model.modelID}`
            : input?.model
      await appendLive(root, {
        ts: new Date().toISOString(),
        kind: "agent_message",
        sessionID: input?.sessionID,
        agent: input?.agent,
        model,
        summary: model && model !== "openai/gpt-5.6-sol" ? `routed_model=${model}` : "user_message_received",
      })
    },
    "tool.execute.before": async (input: any) => {
      const root = resolveRoot(input)
      const key = `${input?.sessionID || "unknown"}:${input?.callID || input?.tool}`
      starts.set(key, Date.now())
      await appendLive(root, {
        ts: new Date().toISOString(),
        kind: "tool_start",
        sessionID: input?.sessionID,
        agent: input?.agent,
        tool: input?.tool,
        summary: summarizeTool(input?.tool, input),
      })
    },
    "tool.execute.after": async (input: any, output: any) => {
      const root = resolveRoot(input)
      const key = `${input?.sessionID || "unknown"}:${input?.callID || input?.tool}`
      const started = starts.get(key)
      starts.delete(key)
      const failed = output?.metadata?.success === false || output?.state?.status === "error"
      await appendLive(root, {
        ts: new Date().toISOString(),
        kind: "tool_end",
        sessionID: input?.sessionID,
        agent: input?.agent,
        tool: input?.tool,
        summary: String(output?.title || summarizeTool(input?.tool, input)).slice(0, 200),
        status: failed ? "error" : String(output?.state?.status || "done"),
        duration_ms: started ? Date.now() - started : undefined,
      })
    },
    "permission.ask": async (input: any, output: any) => {
      const root = resolveRoot(input)
      await appendLive(root, {
        ts: new Date().toISOString(),
        kind: "permission",
        sessionID: input?.sessionID,
        tool: input?.permission,
        summary: JSON.stringify(input?.patterns || input?.action || "").slice(0, 160),
        status: String(output?.status || "ask"),
      })
    },
    "command.execute.before": async (input: any) => {
      const root = resolveRoot(input)
      await appendLive(root, {
        ts: new Date().toISOString(),
        kind: "command",
        sessionID: input?.sessionID,
        agent: input?.agent,
        tool: String(input?.command || input?.name || "command"),
        summary: String(input?.arguments || input?.args || "").slice(0, 180),
      })
    },
  }
}
