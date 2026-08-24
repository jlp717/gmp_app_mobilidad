// status canonicos PASS|WARN|BLOCK|NEEDS_INFO; alias legacy DONE|PARTIAL|BLOCKED|FAILED normalizados.
import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

const CONTEXT_REQUIRED = [
  "task_id",
  "intent",
  "objective",
  "tier",
  "classification",
  "required_agents",
  "required_mcp",
  "required_tools",
  "required_skills",
  "required_gates",
  "stop_conditions",
  "evidence_required",
]

const OUTPUT_REQUIRED = ["status", "summary", "evidence", "risks", "next_step"]
const OUTPUT_STATUS = new Set(["PASS", "WARN", "BLOCK", "NEEDS_INFO"])
const LEGACY_STATUS_ALIAS = { DONE: "PASS", PARTIAL: "WARN", BLOCKED: "BLOCK", FAILED: "BLOCK" }

function response(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

async function readJson(file: string) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch (error) {
    try {
      await fs.access(file)
    } catch {
      return null
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON in ${file}: ${message}`)
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8")
    await fs.rename(tmp, file)
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

async function appendJsonl(file: string, data: Record<string, unknown>) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, `${JSON.stringify(data)}\n`, "utf8")
}

async function patchTaskState(root: string, taskId: string, patch: Record<string, unknown>) {
  const file = path.join(root, ".opencode", "state", `${taskId}.json`)
  const current = (await readJson(file)) || {
    task_id: taskId,
    ts_created: new Date().toISOString(),
    project: "gmp",
    metrics: { agents_invoked: [] },
  }
  const next = {
    ...current,
    ...patch,
    ts_updated: new Date().toISOString(),
  }
  await writeJson(file, next)
}

function missingFields(value: Record<string, unknown>, required: string[]) {
  return required.filter((field) => value[field] === undefined || value[field] === null || value[field] === "")
}

function normalizeStatus(value: unknown) {
  const text = String(value || "").toUpperCase()
  if (OUTPUT_STATUS.has(text)) return text
  const alias = LEGACY_STATUS_ALIAS[text as keyof typeof LEGACY_STATUS_ALIAS]
  return alias || "INVALID"
}

function summarizeLedger(ledger: any, state?: any) {
  const handoffs = Object.values(ledger.handoffs || {}) as any[]
  const outputs = Object.values(ledger.outputs || {}) as any[]
  const stateAgents = Array.isArray(state?.agents_active) ? state.agents_active.map(String) : []
  const pendingFromLedger = handoffs.filter((item) => !ledger.outputs?.[item.agent]).map((item) => item.agent)
  const pendingFromState = handoffs.length === 0 && stateAgents.length > 0 ? stateAgents : []
  return {
    task_id: ledger.task_id,
    phase: ledger.phase,
    handoff_count: handoffs.length,
    output_count: outputs.length,
    pending_agents: Array.from(new Set([...pendingFromLedger, ...pendingFromState])),
    blocked_agents: outputs.filter((item) => item.status === "BLOCK").map((item) => item.agent),
    needs_info_agents: outputs.filter((item) => item.status === "NEEDS_INFO").map((item) => item.agent),
    warn_agents: outputs.filter((item) => item.status === "WARN").map((item) => item.agent),
    state_step: state?.current_step || null,
    stale_or_empty_ledger: handoffs.length === 0 && stateAgents.length > 0,
  }
}

function allowsNoDelegation(ledger: any) {
  return ledger.phase === "NO_DELEGATION"
}

function nonEmptyText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
}

export default tool({
  description: "Pizarra compartida de handoffs entre Chief y subagentes: registra paquetes, outputs, evidencias y rechazos.",
  args: {
    operation: tool.schema.enum(["open", "record_handoff", "record_output", "summarize", "close"]),
    task_id: tool.schema.string(),
    agent: tool.schema.string().optional(),
    phase: tool.schema.string().optional(),
    context_packet: tool.schema.record(tool.schema.string(), tool.schema.any()).optional(),
    specialist_output: tool.schema.record(tool.schema.string(), tool.schema.any()).optional(),
  },
  async execute(args, context) {
    try {
      const root = path.resolve(context.worktree || context.directory || process.cwd())
      const ledgerDir = path.join(root, ".opencode", "state", "handoffs")
      const file = path.join(ledgerDir, `${args.task_id}.json`)
      const now = new Date().toISOString()
      const ledger = (await readJson(file)) || {
        task_id: args.task_id,
        created_at: now,
        updated_at: now,
        phase: "INTAKE",
        handoffs: {},
        outputs: {},
        events: [],
      }
      const state = await readJson(path.join(root, ".opencode", "state", `${args.task_id}.json`))

      if (args.operation === "open") {
        ledger.phase = args.phase || ledger.phase || "INTAKE"
        ledger.events.push({ ts: now, operation: "open", phase: ledger.phase })
        await patchTaskState(root, args.task_id, {
          current_step: ledger.phase === "INTAKE" ? "ROUTED" : ledger.phase,
          approval_status: "not_required",
        })
      }

      if (args.operation === "record_handoff") {
        if (!args.agent) return response({ success: false, status: "BLOCK", error: "agent requerido" })
        const packet = args.context_packet || {}
        const missing = missingFields(packet, CONTEXT_REQUIRED)
        const status = missing.length ? "BLOCK" : "PASS"
        const event = { ts: now, operation: "record_handoff", agent: args.agent, status, missing_fields: missing }
        ledger.handoffs[args.agent] = { ...event, context_packet: packet }
        ledger.events.push(event)
        await patchTaskState(root, args.task_id, {
          current_step: args.phase || "DISCOVERY",
          agents_active: Array.from(new Set([...(Object.keys(ledger.handoffs || {})), args.agent])),
        })
        if (status === "BLOCK") {
          await writeJson(file, { ...ledger, updated_at: now })
          return response({ success: false, status, missing_fields: missing, ledger_file: file })
        }
      }

      if (args.operation === "record_output") {
        if (!args.agent) return response({ success: false, status: "BLOCK", error: "agent requerido" })
        if (!ledger.handoffs?.[args.agent] && !allowsNoDelegation(ledger)) {
          const event = {
            ts: now,
            operation: "record_output",
            agent: args.agent,
            status: "BLOCK",
            error: "record_output_without_handoff",
          }
          ledger.events.push(event)
          await writeJson(file, { ...ledger, updated_at: now })
          await patchTaskState(root, args.task_id, {
            current_step: "BLOCKED",
            errors: [{ ts: now, source: "handoff-ledger", agent: args.agent, error: "record_output_without_handoff" }],
          })
          await appendJsonl(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), { ts: now, event: "handoff_output_rejected", task_id: args.task_id, agent: args.agent, error: "record_output_without_handoff" })
          return response({ success: false, status: "BLOCK", error: "record_output_without_handoff", ledger_file: file })
        }
        const output = args.specialist_output || {}
        const missing = missingFields(output, OUTPUT_REQUIRED)
        const normalizedStatus = normalizeStatus(output.status)
        const evidence = output.evidence && typeof output.evidence === "object" ? output.evidence as Record<string, unknown> : {}
        const evidenceMissing = missingFields(evidence, ["files_read", "commands_or_mcp_used", "tests_or_reason_not_run"])
        const emptyOutput = !nonEmptyText(output.summary) || (Array.isArray(evidence.files_read) && evidence.files_read.length === 0 && Array.isArray(evidence.commands_or_mcp_used) && evidence.commands_or_mcp_used.length === 0)
        const status = missing.length || normalizedStatus === "INVALID" || evidenceMissing.length || emptyOutput ? "BLOCK" : normalizedStatus
        const event = {
          ts: now,
          operation: "record_output",
          agent: args.agent,
          status,
          output_status: normalizedStatus,
          missing_fields: missing,
          evidence_missing: evidenceMissing,
          empty_output: emptyOutput,
        }
        ledger.outputs[args.agent] = { ...event, specialist_output: output }
        ledger.events.push(event)
        if (status === "BLOCK") {
          await writeJson(file, { ...ledger, updated_at: now })
          await patchTaskState(root, args.task_id, {
            current_step: "BLOCKED",
            errors: [{ ts: now, source: "handoff-ledger", agent: args.agent, missing, evidenceMissing, empty_output: emptyOutput }],
          })
          await appendJsonl(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), { ts: now, event: "handoff_output_rejected", task_id: args.task_id, agent: args.agent, missing, evidenceMissing, empty_output: emptyOutput })
          return response({ success: false, status, missing_fields: missing, evidence_missing: evidenceMissing, empty_output: emptyOutput, ledger_file: file })
        }
        await patchTaskState(root, args.task_id, {
          current_step: "VERIFYING",
          agents_active: Object.keys(ledger.handoffs || {}).filter((agent) => !ledger.outputs?.[agent]),
        })
      }

      if (args.operation === "summarize") {
        const summary = summarizeLedger(ledger, state)
        const emptyLedger = summary.handoff_count === 0 && !allowsNoDelegation(ledger)
        const status = summary.pending_agents.length || summary.blocked_agents.length || emptyLedger ? "BLOCK" : "PASS"
        ledger.events.push({ ts: now, operation: "summarize", status, summary })
        await writeJson(file, { ...ledger, updated_at: now })
        await patchTaskState(root, args.task_id, {
          current_step: status === "PASS" ? "REPORTING" : "BLOCKED",
          agents_active: summary.pending_agents,
        })
        await appendJsonl(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), { ts: now, event: "handoff_ledger", task_id: args.task_id, operation: args.operation, status, phase: ledger.phase, summary })
        return response({ success: status === "PASS", status, ledger_file: file, summary, empty_ledger: emptyLedger })
      }

      if (args.operation === "close") {
        const summary = summarizeLedger(ledger, state)
        const emptyLedger = summary.handoff_count === 0 && !allowsNoDelegation(ledger)
        if (summary.pending_agents.length || summary.blocked_agents.length || emptyLedger) {
          const status = "BLOCK"
          ledger.events.push({ ts: now, operation: "close_rejected", status, summary })
          await writeJson(file, { ...ledger, updated_at: now })
          await patchTaskState(root, args.task_id, {
            current_step: "BLOCKED",
            agents_active: summary.pending_agents,
          })
          await appendJsonl(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), { ts: now, event: "handoff_close_rejected", task_id: args.task_id, status, summary })
          return response({ success: false, status, ledger_file: file, summary })
        }
        ledger.phase = args.phase || "DONE"
        ledger.events.push({ ts: now, operation: "close", summary })
        await patchTaskState(root, args.task_id, {
          current_step: "DONE",
          agents_active: [],
          metrics: { ts_end: now },
        })
      }

      ledger.updated_at = now
      await writeJson(file, ledger)
      await appendJsonl(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), { ts: now, event: "handoff_ledger", task_id: args.task_id, operation: args.operation, agent: args.agent || null, phase: ledger.phase })
      return response({ success: true, status: "PASS", ledger_file: file, summary: summarizeLedger(ledger, state) })
    } catch (error) {
      return response({ success: false, status: "BLOCK", error: error instanceof Error ? error.message : String(error) })
    }
  },
})
