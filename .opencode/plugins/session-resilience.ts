import fs from "node:fs/promises"
import path from "node:path"

function msg(input: any) {
  const p = input?.event?.properties || {}
  return String(p?.error?.data?.message || p?.error?.message || p?.message || p?.status || "").slice(0, 500)
}

function category(text: string) {
  if (/ODBC_UID|ODBC_PWD|ODBC|DB2/i.test(text)) return "db2_env_or_odbc"
  if (/ssh|plink|undefined/i.test(text)) return "ssh_or_undefined"
  if (/quota|rate.?limit|billing|credit/i.test(text)) return "provider_quota"
  return "session_resilience"
}

async function appendJsonl(file: string, record: Record<string, unknown>) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(record) + "\n", "utf8")
}

export default async function SessionResiliencePlugin() {
  return {
    event: async (input: any) => {
      const type = String(input?.event?.type || "")
      if (!["session.error", "session.compacted", "session.deleted", "session.idle", "session.status"].includes(type)) return
      const text = msg(input)
      const base = process.cwd()
      const record = { ts: new Date().toISOString(), source_event: type, sessionID: String(input?.event?.properties?.sessionID || input?.sessionID || "unknown"), agent: input?.agent || input?.event?.properties?.agent || "unknown", category: category(text), summary: text || type }
      await appendJsonl(path.join(base, ".opencode", "state", "session-resilience.jsonl"), record)
      await appendJsonl(path.join(base, ".opencode", "TEAM_TRACE.jsonl"), { ...record, event: "session_resilience_event" })
      if (["session.error", "session.compacted", "session.deleted"].includes(type)) await fs.writeFile(path.join(base, ".opencode", "state", "session-handoff-latest.json"), JSON.stringify({ ...record, action: "resume_with_flow_trace_and_stategraph" }, null, 2), "utf8")
    },
  }
}
