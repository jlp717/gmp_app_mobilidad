import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

type ErrorRecord = {
  count: number
  samples: string[]
  agents: string[]
  first_seen: string
  last_seen: string
  retrospective_triggered?: string
}

function textFrom(input: any, output: any) {
  return JSON.stringify({ args: input?.args, output: output?.output || output?.metadata || output }).slice(0, 3000)
}

function hasError(text: string) {
  return /\berror\b|\bfail(ed|ure)?\b|\bexception\b|\bodbc\b|ODBC_UID|ODBC_PWD|\bundefined\b|session\.error|\b500\b|operation timed out|SchemaError|Missing key|invalid arguments/i.test(text)
}

function normalize(text: string) {
  return text
    .split(/\r?\n/)[0]
    .replace(/\d{4}-\d{2}-\d{2}[T ][0-9:.Z+-]+/g, "")
    .replace(/\b(task|session|call|trace)[-_]?[a-z0-9]+\b/gi, "")
    .replace(/[A-Z]:\\[^ ]+/g, "<path>")
    .replace(/\d+/g, "0")
    .toLowerCase()
    .replace(/[^\w\s:.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160)
}

async function load(file: string): Promise<Record<string, ErrorRecord>> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return {}
  }
}

export default async function SameErrorDetectorPlugin() {
  return {
    "tool.execute.after": async (input: any, output: any) => {
      const raw = textFrom(input, output)
      if (!hasError(raw)) return
      const normalized = normalize(raw)
      const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 24)
      const root = process.cwd()
      const memoryDir = path.join(root, ".opencode", "memory")
      const stateDir = path.join(root, ".opencode", "state")
      await fs.mkdir(memoryDir, { recursive: true })
      await fs.mkdir(stateDir, { recursive: true })
      const countsFile = path.join(stateDir, "same-error-counts.json")
      const counts = await load(countsFile)
      const now = new Date().toISOString()
      const record = counts[hash] || { count: 0, samples: [], agents: [], first_seen: now, last_seen: now }
      record.count += 1
      record.last_seen = now
      record.samples = [normalized, ...record.samples.filter((sample) => sample !== normalized)].slice(0, 5)
      record.agents = Array.from(new Set([...(record.agents || []), input?.agent || "unknown"])).slice(0, 8)
      counts[hash] = record
      await fs.writeFile(countsFile, JSON.stringify(counts, null, 2), "utf8")
      await fs.appendFile(path.join(memoryDir, "same-error-tracker.jsonl"), JSON.stringify({ ts: now, error_hash: hash, normalized, count: record.count, agent: input?.agent || "unknown" }) + "\n", "utf8")
      if (record.count >= 2 && !record.retrospective_triggered) {
        const retroId = `retro-${hash}-${Date.now()}`
        record.retrospective_triggered = retroId
        record.count = 0
        await fs.writeFile(countsFile, JSON.stringify(counts, null, 2), "utf8")
        await fs.appendFile(path.join(memoryDir, "retrospectives.md"), [
          "",
          `## Retrospectiva ${retroId} - ${now}`,
          `Error hash: ${hash}`,
          `Ocurrencias: 2 o mas en treinta dias`,
          `Causa raiz: requiere analisis de sre-engineer con las muestras registradas.`,
          `Cambio de comportamiento: bloquear repeticion del error normalizado antes de repetir la accion.`,
          `Verificacion: confirmar que same-error-counts.json queda reseteado para ${hash}.`,
          "",
        ].join("\n"), "utf8")
        await fs.appendFile(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), JSON.stringify({ ts: now, event: "retrospective_triggered", error_hash: hash, retrospective_id: retroId }) + "\n", "utf8")
      }
    },
  }
}
