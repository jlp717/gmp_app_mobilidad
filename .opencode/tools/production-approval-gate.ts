import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

const TOKEN_FILE = path.join(process.cwd(), ".opencode", "state", "production-approval-token.json")

function json(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

async function readToken() {
  try {
    return JSON.parse(await fs.readFile(TOKEN_FILE, "utf8"))
  } catch {
    return null
  }
}

function isValid(token: any) {
  return Boolean(
    token?.approved_by === "Javier" &&
      token?.expires_at &&
      new Date(token.expires_at).getTime() > Date.now() &&
      evidenceIsComplete(token?.evidence),
  )
}

function status(value: unknown) {
  return String(value || "").trim().toUpperCase()
}

function isHttpUrl(value: unknown) {
  try {
    const parsed = new URL(String(value || "").trim())
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function buildEvidence(args: Record<string, unknown>) {
  return {
    staging_url: String(args.staging_url || "").trim(),
    qa_status: status(args.qa_status),
    appsec_status: status(args.appsec_status),
    sre_status: status(args.sre_status),
    evidence_ref: String(args.evidence_ref || "").trim(),
  }
}

function missingEvidence(evidence: Record<string, unknown>) {
  const missing: string[] = []
  if (!isHttpUrl(evidence.staging_url)) missing.push("staging_url")
  if (status(evidence.qa_status) !== "PASS") missing.push("qa_status=PASS")
  if (status(evidence.appsec_status) !== "PASS") missing.push("appsec_status=PASS")
  if (status(evidence.sre_status) !== "PASS") missing.push("sre_status=PASS")
  if (!String(evidence.evidence_ref || "").trim()) missing.push("evidence_ref")
  return missing
}

function evidenceIsComplete(evidence: any) {
  return Boolean(evidence && missingEvidence(evidence).length === 0)
}

export default tool({
  description: "Gestiona la aprobacion explicita de Javier antes de cualquier cambio en produccion.",
  args: {
    action: tool.schema.enum(["approve", "check", "revoke"]).describe("Accion a ejecutar."),
    confirmation_text: tool.schema.string().optional().describe("Texto de Javier. Debe ser exactamente adelante para aprobar."),
    scope: tool.schema.string().default("production").describe("Alcance aprobado."),
    task_id: tool.schema.string().optional().describe("Task id asociado al despliegue o accion."),
    staging_url: tool.schema.string().optional().describe("URL de staging verificada antes de produccion."),
    qa_status: tool.schema.string().optional().describe("Estado QA. Debe ser PASS."),
    appsec_status: tool.schema.string().optional().describe("Estado AppSec. Debe ser PASS."),
    sre_status: tool.schema.string().optional().describe("Estado SRE health check. Debe ser PASS."),
    evidence_ref: tool.schema.string().optional().describe("Referencia verificable: TEAM_TRACE, PR, release id o ruta de evidencia."),
    ttl_minutes: tool.schema.number().default(30).describe("Minutos de validez del token."),
  },
  async execute(args) {
    await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true })

    if (args.action === "revoke") {
      await fs.rm(TOKEN_FILE, { force: true })
      return json({ approved: false, revoked: true, stored_in: TOKEN_FILE })
    }

    if (args.action === "check") {
      const token = await readToken()
      return json({
        approved: isValid(token),
        token: isValid(token) ? { scope: token.scope, expires_at: token.expires_at, task_id: token.task_id, evidence: token.evidence } : null,
      })
    }

    const text = String(args.confirmation_text || "").trim().toLowerCase()
    if (text !== "adelante") {
      return json({ approved: false, error: "La aprobacion de produccion requiere que Javier escriba exactamente: adelante" })
    }

    const evidence = buildEvidence(args)
    const missing = missingEvidence(evidence)
    if (missing.length > 0) {
      return json({
        approved: false,
        error: "PRODUCTION_EVIDENCE_REQUIRED",
        message: "Produccion requiere staging verificado, QA PASS, AppSec PASS, SRE PASS y referencia de evidencia.",
        missing,
      })
    }

    const ttl = Math.max(1, Math.min(120, Number(args.ttl_minutes || 30)))
    const token = {
      approved: true,
      approved_by: "Javier",
      scope: args.scope,
      task_id: args.task_id || null,
      evidence,
      approved_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + ttl * 60_000).toISOString(),
    }
    await fs.writeFile(TOKEN_FILE, JSON.stringify(token, null, 2), "utf8")
    return json({ approved: true, scope: token.scope, expires_at: token.expires_at, evidence: token.evidence, stored_in: TOKEN_FILE })
  },
})
