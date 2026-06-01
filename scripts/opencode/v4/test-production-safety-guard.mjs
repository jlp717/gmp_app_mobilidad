import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

const pluginModule = await import(pathToFileURL(path.resolve(".opencode/plugins/production-safety-guard.ts")).href)
const plugin = await pluginModule.default()
const riskyInput = { tool: "bash", args: { command: "ssh gmp@192.168.1.230 pm2 restart gmp-api" } }

await fs.rm(".opencode/state/production-approval-token.json", { force: true })

let blocked = false
try {
  await plugin["tool.execute.before"](riskyInput)
} catch (error) {
  blocked = String(error?.message || error).includes("PRODUCTION_APPROVAL_REQUIRED")
}
console.log(`blocked_without_token=${blocked}`)

await fs.mkdir(".opencode/state", { recursive: true })
await fs.writeFile(
  ".opencode/state/production-approval-token.json",
  JSON.stringify({ approved_by: "Javier", expires_at: new Date(Date.now() + 60_000).toISOString() }),
)

let blockedWithIncompleteToken = false
try {
  await plugin["tool.execute.before"](riskyInput)
} catch (error) {
  blockedWithIncompleteToken = String(error?.message || error).includes("PRODUCTION_APPROVAL_REQUIRED")
}
console.log(`blocked_with_incomplete_token=${blockedWithIncompleteToken}`)

await fs.writeFile(
  ".opencode/state/production-approval-token.json",
  JSON.stringify({
    approved_by: "Javier",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    evidence: {
      staging_url: "http://192.168.1.230:4001",
      qa_status: "PASS",
      appsec_status: "PASS",
      sre_status: "PASS",
      evidence_ref: "TEAM_TRACE:test",
    },
  }),
)

let allowed = true
try {
  await plugin["tool.execute.before"](riskyInput)
} catch {
  allowed = false
}
await fs.rm(".opencode/state/production-approval-token.json", { force: true })
console.log(`allowed_with_evidence_token=${allowed}`)
