import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

const INJECTION = [/ignore previous instructions/i, /disregard system/i, /\bjailbreak\b/i]
const HITL = [/deploy/i, /delete production/i, /pm2 restart gmp-api/i, /db2 write/i, /force push/i]
const BLOCK = [/drop table/i, /rm\s+-rf\s+\//i, /rotate production secret/i]

export default tool({
  description:
    "Workflow entry node: validate user intent before decision-router. Marks untrusted content, requires HITL for deploy/delete/spend, BLOCKs jailbreak/out-of-scope destruction.",
  args: {
    user_text: tool.schema.string().describe("Raw user request (untrusted)."),
    attachments_external: tool.schema.boolean().default(false).describe("True if web/doc/MCP content is attached."),
  },
  async execute(args, context) {
    const text = String(args.user_text || "")
    const risk_flags: string[] = []
    const required_gates: string[] = []
    let status: "ALLOW" | "ALLOW_WITH_HITL" | "BLOCK" = "ALLOW"

    if (args.attachments_external) {
      risk_flags.push("UNTRUSTED_EXTERNAL")
    }
    for (const re of INJECTION) {
      if (re.test(text)) {
        risk_flags.push("prompt_injection_marker")
        status = "BLOCK"
      }
    }
    for (const re of BLOCK) {
      if (re.test(text)) {
        risk_flags.push("out_of_scope_mutation")
        status = "BLOCK"
        required_gates.push("telegram-hitl", "plan-approval-gate")
      }
    }
    for (const re of HITL) {
      if (re.test(text)) {
        risk_flags.push("hitl_required")
        required_gates.push("production-approval-gate", "telegram-hitl")
        if (status === "ALLOW") status = "ALLOW_WITH_HITL"
      }
    }

    const result = {
      success: true,
      status,
      code: status === "BLOCK" ? "CRITICAL_ERROR" : undefined,
      intent_summary: text.slice(0, 240),
      risk_flags,
      required_gates: [...new Set(required_gates)],
      content_mark: args.attachments_external ? "UNTRUSTED_EXTERNAL" : "USER_TEXT",
    }

    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const outDir = path.join(root, ".opencode", "state")
    await fs.mkdir(outDir, { recursive: true })
    await fs.writeFile(
      path.join(outDir, "intent-validator-latest.json"),
      JSON.stringify({ ts: new Date().toISOString(), ...result }, null, 2),
      "utf8",
    )

    return {
      output: JSON.stringify(result, null, 2),
      metadata: result,
    }
  },
})
