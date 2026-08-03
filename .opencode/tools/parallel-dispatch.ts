import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

function compressPacket(packet: any) {
  if (!packet || typeof packet !== "object") return packet
  if (packet.full_thread === true) {
    return {
      error: "context_isolation",
      code: "CRITICAL_ERROR",
      message: "Workers must not receive full_thread; pass compressed global_state only.",
    }
  }
  const {
    task_id,
    graph_id,
    node_id,
    intent,
    objective,
    non_goals,
    tier,
    classification,
    risk_tier,
    acceptance_criteria,
    verified_files,
    verified_runtime_facts,
    required_gates,
    stop_conditions,
    evidence_required,
    task_description,
    global_state,
  } = packet
  return {
    task_description: task_description || objective || intent || "",
    global_state: global_state || {
      task_id,
      graph_id,
      node_id,
      intent,
      objective,
      non_goals,
      tier,
      classification,
      risk_tier,
      acceptance_criteria,
      verified_files,
      verified_runtime_facts,
      required_gates,
      stop_conditions,
      evidence_required,
    },
  }
}

export default tool({
  description:
    "Prepare parallel worker dispatch. Workers get task_description + compressed global_state only (never full thread). Aggregator reconciles distilled results.",
  args: {
    task_id: tool.schema.string().describe("Task id."),
    agents: tool.schema.array(tool.schema.string()).describe("Worker agents to invoke."),
    context_packet: tool.schema.any().describe("Compressed packet; full_thread=true is rejected."),
    timeout_seconds: tool.schema.number().int().min(5).max(900).default(120),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const stateDir = path.join(root, ".opencode", "state")
    await fs.mkdir(stateDir, { recursive: true })
    const compressed = compressPacket(args.context_packet)
    if (compressed?.error === "context_isolation") {
      return {
        output: JSON.stringify({ success: false, ...compressed }, null, 2),
        metadata: { success: false, ...compressed },
      }
    }
    const dispatch = {
      task_id: args.task_id,
      created_at: new Date().toISOString(),
      mode: "parallel_dispatch_manifest",
      timeout_seconds: args.timeout_seconds,
      reconciliation: {
        aggregator: "chief-engineer-assistant",
        strategy: "merge_distilled_specialist_outputs_via_handoff_ledger",
        conflict_policy: "WARN_and_ask_javier_if_risk_ge_R2",
      },
      agents: args.agents.map((agent) => ({
        agent,
        status: "pending",
        context_packet: compressed,
      })),
    }
    const file = path.join(stateDir, `${args.task_id}-parallel-dispatch.json`)
    await fs.writeFile(file, JSON.stringify(dispatch, null, 2), "utf8")
    return {
      output: JSON.stringify({ success: true, dispatch_file: file, dispatch }, null, 2),
      metadata: { success: true, dispatch_file: file, agents: args.agents },
    }
  },
})
