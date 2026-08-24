#!/usr/bin/env node
/** One-shot: rebuild provider-health.json from recent TEAM_TRACE quota events */
const fs = require("fs")
const path = require("path")

const root = process.argv[2] || path.resolve(__dirname, "../..")
const ttlMinutes = Number(process.argv[3] || 45)
const tracePath = path.join(root, ".opencode", "TEAM_TRACE.jsonl")
const healthPath = path.join(root, ".opencode", "state", "provider-health.json")

if (!fs.existsSync(tracePath)) {
  console.log("no TEAM_TRACE")
  process.exit(0)
}

const lines = fs.readFileSync(tracePath, "utf8").trim().split(/\r?\n/).slice(-500)
const now = Date.now()
let hit = null

for (let i = lines.length - 1; i >= 0; i--) {
  const row = JSON.parse(lines[i])
  const event = String(row.event || "")
  const message = String(row.message || row.issue?.message || "")
  const isQuota =
    event === "provider_unavailable_recorded" ||
    row.issue?.code === "provider_quota_or_rate_limit" ||
    /quota|rate.?limit|insufficient.?quota|exceeded your/i.test(message)
  if (!isQuota) continue
  const ts = Date.parse(String(row.ts || ""))
  if (Number.isFinite(ts) && now - ts > ttlMinutes * 60_000) break
  hit = row
  break
}

if (!hit) {
  console.log("no recent quota event in TEAM_TRACE")
  process.exit(0)
}

const until = new Date(now + ttlMinutes * 60_000).toISOString()
const block = {
  reason: /rate\s*limit|too many requests/i.test(String(hit.issue?.message || hit.message || ""))
    ? "rate_limit"
    : "quota_or_billing",
  since: new Date().toISOString(),
  until,
  last_error: String(hit.issue?.message || hit.message || "quota from TEAM_TRACE").slice(0, 300),
  source_session: String(hit.issue?.sessionID || hit.sessionID || ""),
}

const health = {
  updated_at: new Date().toISOString(),
  unavailable: {
    openai: block,
    "openai/gpt-5.5": block,
    "openai/gpt-5.5-fast": block,
    "openai/gpt-5.5-pro": block,
  },
}

fs.mkdirSync(path.dirname(healthPath), { recursive: true })
fs.writeFileSync(healthPath, JSON.stringify(health, null, 2))
console.log(`provider-health.json updated; openai blocked until ${until}`)
