import fs from "node:fs/promises"
import path from "node:path"

async function appendJsonl(file: string, record: Record<string, unknown>) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, JSON.stringify(record) + "\n", "utf8")
}

export default async function SessionLifecyclePlugin() {
  return {
    event: async (input: any) => {
      const type = String(input?.event?.type || "")
      if (type !== "session.created") return
      const base = process.cwd()
      const sessionID = String(input?.event?.properties?.sessionID || input?.sessionID || "unknown")
      const record = {
        ts: new Date().toISOString(),
        source_event: type,
        sessionID,
        agent: input?.agent || input?.event?.properties?.agent || "unknown",
      }
      await appendJsonl(path.join(base, ".opencode", "state", "session-lifecycle.jsonl"), record)
      const handoff = path.join(base, ".opencode", "state", "session-handoff-latest.json")
      try {
        const prior = JSON.parse(await fs.readFile(handoff, "utf8"))
        if (prior?.sessionID && prior.sessionID !== sessionID) {
          await appendJsonl(path.join(base, ".opencode", "memory", "session-resume-hints.jsonl"), {
            ts: record.ts,
            prior_session: prior.sessionID,
            new_session: sessionID,
            hint: "resume_with_flow_trace_and_stategraph",
            prior_summary: prior.summary || prior.action || "",
          })
        }
      } catch {
        // no prior handoff snapshot
      }
    },
  }
}
