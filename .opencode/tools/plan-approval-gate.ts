import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"

const APPROVAL_PHRASES = ["apruebo el plan", "adelante con el plan", "aprobado"]

export default tool({
  description:
    "Gate de aprobacion previa al codigo: crea/verifica aprobaciones de plan para T2/T3 antes de editar archivos.",
  args: {
    action: tool.schema.enum(["request", "check", "approve"]).default("request"),
    task_id: tool.schema.string().min(1),
    plan_summary: tool.schema.string().default(""),
    scope_files: tool.schema.array(tool.schema.string()).default([]),
    risk_tier: tool.schema.string().default("R0"),
    workflow_tier: tool.schema.string().default("T1"),
    approval_text: tool.schema.string().default(""),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const dir = path.join(root, ".opencode", "state", "approvals")
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, `${safeId(args.task_id)}.json`)
    const existing = await readJson(file)

    if (args.action === "request") {
      const requiresApproval = requiresPlanApproval(args.workflow_tier, args.risk_tier)
      const payload = {
        task_id: args.task_id,
        approval_id: existing?.approval_id || crypto.randomBytes(8).toString("hex"),
        type: "plan_before_code",
        status: requiresApproval ? "WAITING_APPROVAL" : "NOT_REQUIRED",
        created_at: existing?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        workflow_tier: args.workflow_tier,
        risk_tier: args.risk_tier,
        plan_summary: args.plan_summary,
        scope_files: args.scope_files,
        required_phrases: APPROVAL_PHRASES,
      }
      await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8")
      return { output: JSON.stringify(payload, null, 2), metadata: { success: payload.status === "NOT_REQUIRED", ...payload } }
    }

    if (!existing) {
      const payload = { task_id: args.task_id, status: "BLOCK", reason: "approval_request_missing", required_action: "create plan approval request first" }
      return { output: JSON.stringify(payload, null, 2), metadata: { success: false, ...payload } }
    }

    if (args.action === "approve") {
      const normalized = normalize(args.approval_text)
      const accepted = APPROVAL_PHRASES.some((phrase) => normalized.includes(normalize(phrase)))
      const payload = {
        ...existing,
        status: accepted ? "APPROVED" : "BLOCK",
        approved_at: accepted ? new Date().toISOString() : existing.approved_at,
        approval_text_received: args.approval_text,
        updated_at: new Date().toISOString(),
      }
      await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8")
      return { output: JSON.stringify(payload, null, 2), metadata: { success: accepted, ...payload } }
    }

    const expired = existing.expires_at && Date.parse(existing.expires_at) < Date.now()
    const payload = {
      ...existing,
      status: expired && existing.status !== "APPROVED" ? "EXPIRED" : existing.status,
      can_edit_code: existing.status === "APPROVED" && !expired,
      updated_at: new Date().toISOString(),
    }
    return { output: JSON.stringify(payload, null, 2), metadata: { success: payload.can_edit_code || payload.status === "NOT_REQUIRED", ...payload } }
  },
})

function requiresPlanApproval(workflowTier: string, riskTier: string) {
  return ["T2", "T3"].includes(workflowTier.toUpperCase()) || ["R2", "R3", "R4"].includes(riskTier.toUpperCase())
}

async function readJson(file: string) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return null
  }
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120)
}
