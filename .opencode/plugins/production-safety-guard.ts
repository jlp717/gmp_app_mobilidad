import fs from "node:fs"
import path from "node:path"

const TOKEN_FILE = path.join(process.cwd(), ".opencode", "state", "production-approval-token.json")

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

function hasCompleteEvidence(token: any) {
  const evidence = token?.evidence
  return Boolean(
    isHttpUrl(evidence?.staging_url) &&
      status(evidence?.qa_status) === "PASS" &&
      status(evidence?.appsec_status) === "PASS" &&
      status(evidence?.sre_status) === "PASS" &&
      String(evidence?.evidence_ref || "").trim(),
  )
}

function hasValidApproval() {
  try {
    const token = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"))
    return token?.approved_by === "Javier" && new Date(token.expires_at).getTime() > Date.now() && hasCompleteEvidence(token)
  } catch {
    return false
  }
}

function risky(input: any) {
  const toolName = String(input?.tool || input?.name || "").toLowerCase()
  const text = JSON.stringify(input?.args || input || {}).toLowerCase()

  if (toolName.includes("production-approval-gate")) return false
  if (toolName.includes("telegram") || toolName.includes("rag-query") || toolName.includes("voice-synthesis")) return false
  if (toolName.includes("snapshot-restore")) return true
  if (toolName.includes("github-advanced") && /"action"\s*:\s*"merge_pr"/.test(text)) return true

  const patterns = [
    /\bpm2\s+(restart|reload|stop|delete)\s+(gmp-api|\*)/,
    /\bdocker\s+(stop|rm|restart)\s+(?!.*gmp-staging)/,
    /\bsystemctl\s+(restart|stop|disable)\s+(gmp|nginx|docker|redis|chromadb)/,
    /\bgit\s+push\b.*\b(main|master|production)\b/,
    /\bdeploy\b.*\b(prod|production|mari-pepa\.com|192\.168\.1\.230)\b/,
  ]
  return patterns.some((pattern) => pattern.test(text))
}

export default async function ProductionSafetyGuardPlugin() {
  return {
    "tool.execute.before": async (input: any) => {
      if (!risky(input)) return
      if (hasValidApproval()) return
      throw new Error(
        "PRODUCTION_APPROVAL_REQUIRED: produccion exige token vigente con staging_url, QA PASS, AppSec PASS, SRE PASS, evidence_ref y confirmacion 'adelante' de Javier.",
      )
    },
  }
}
