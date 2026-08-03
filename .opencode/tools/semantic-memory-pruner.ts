import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * Deterministic memory GC workflow (DEGRADE of memory-cleaner prune path).
 * Never invents deletes of user-corrections / anti_patterns / security_findings.
 */
function result(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

const PRESERVE = new Set([
  "user-corrections.jsonl",
  "anti_patterns",
  "security_findings",
  "anti-patterns.md",
  "security_findings.md",
])

async function appendAudit(root: string, entry: Record<string, unknown>) {
  const file = path.join(root, ".opencode", "state", "memory-pruning-audit.jsonl")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf8")
}

async function compressFlowTrace(root: string, maxBytes = 50 * 1024 * 1024, keepLines = 5000) {
  const candidates = [
    path.join(root, ".opencode", "state", "flow-trace.jsonl"),
    path.join(root, ".opencode", "TEAM_TRACE.jsonl"),
  ]
  const compressed: string[] = []
  for (const file of candidates) {
    try {
      const st = await fs.stat(file)
      if (st.size <= maxBytes) continue
      const raw = await fs.readFile(file, "utf8")
      const lines = raw.split(/\r?\n/)
      const keep = lines.slice(-keepLines)
      const archiveDir = path.join(root, ".opencode", "memory", "archived-traces")
      await fs.mkdir(archiveDir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      const archive = path.join(archiveDir, `${path.basename(file)}-${stamp}.bak`)
      await fs.writeFile(archive, raw, "utf8")
      await fs.writeFile(file, keep.join("\n") + "\n", "utf8")
      compressed.push(file)
    } catch {
      // missing file ok
    }
  }
  return compressed
}

export default tool({
  description:
    "Workflow: deterministic semantic memory prune/compress per semantic-memory-pruner.yaml. Prefer over memory-cleaner agent for GC. Preserves user-corrections and anti_patterns.",
  args: {
    operation: tool.schema
      .enum(["compress_flow_trace", "audit_only", "full_safe"])
      .default("full_safe")
      .describe("Deterministic prune op. full_safe = compress traces + audit; never deletes preserved files."),
    confirm: tool.schema.boolean().default(false).describe("Required true for full_safe mutations."),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory)
    if (args.operation !== "audit_only" && !args.confirm) {
      return result({
        success: false,
        code: "CRITICAL_ERROR",
        error: "semantic_memory_pruner: confirm=true required for mutating ops",
      })
    }

    const preserved: string[] = []
    const memoryDir = path.join(root, ".opencode", "memory")
    try {
      const entries = await fs.readdir(memoryDir)
      for (const name of entries) {
        if (PRESERVE.has(name) || name.includes("user-correction") || name.includes("anti_pattern")) {
          preserved.push(name)
        }
      }
    } catch {
      // memory dir optional
    }

    let compressed: string[] = []
    if (args.operation === "compress_flow_trace" || args.operation === "full_safe") {
      compressed = await compressFlowTrace(root)
    }

    const summary = {
      success: true,
      classification: "workflow",
      operation: args.operation,
      compressed_traces: compressed,
      preserved,
      agent_degraded_from: "memory-cleaner",
    }
    await appendAudit(root, summary)
    return result(summary)
  },
})
