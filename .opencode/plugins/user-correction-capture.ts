import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

const TRIGGERS = [
  /\baprende esto\b/i,
  /\bte corrijo\b/i,
  /\bcorrecci[oó]n\b/i,
  /\bpara la pr[oó]xima\b/i,
  /\brecuerda que\b/i,
  /\bno vuelvas a\b/i,
  /\besto est[aá] mal\b/i,
  /\bprefiero que\b/i,
  /\bcuando te diga\b/i,
  /\bno me (ha )?gustad[oa]\b/i,
  /\bhas puesto\b/i,
  /\bdebes cambiar\b/i,
  /\bno me funciona\b/i,
  /\bno deber[iÃ­]a\b/i,
  /\bme sale\b/i,
  /\bfallo al cargar\b/i,
  /\bmal hecho\b/i,
  /\bpodr[ií]amos hacer\b/i,
  /\besto no est[aá] bien hecho\b/i,
]

function normalize(text: string) {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim()
}

function extractText(input: any) {
  const candidates = [
    input?.message?.content,
    input?.message?.text,
    input?.text,
    input?.content,
    input?.event?.properties?.message?.content,
    input?.event?.properties?.message?.text,
    input?.event?.properties?.text,
  ]
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value
    if (Array.isArray(value)) {
      const joined = value.map((part) => part?.text || part?.content || "").filter(Boolean).join(" ")
      if (joined.trim()) return joined
    }
  }
  return ""
}

function isUserCorrection(text: string) {
  if (/\b(no vuelvas a|has puesto|debes cambiar|esto est[aÃ¡] mal|no me funciona|no deber[iÃ­]a|fallo al cargar)\b/i.test(text)) return true
  if (isOperationalTask(text)) return false
  return TRIGGERS.some((pattern) => pattern.test(text))
}

function isOperationalTask(text: string) {
  return /\b(ejecuta|aplica|implementa|arregla|corrige|verifica|clasifica|registra|devuelve|objetivo|ruta esperada|alcance aprobado)\b/i.test(text)
}

async function readJson(file: string) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return {}
  }
}

async function appendJsonl(file: string, record: Record<string, unknown>) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, "utf8")
}

async function saveCorrection(input: any) {
  const text = normalize(extractText(input))
  if (!text || !isUserCorrection(text)) return

  const root = process.cwd()
  const memoryDir = path.join(root, ".opencode", "memory")
  const stateDir = path.join(root, ".opencode", "state")
  const hash = crypto.createHash("sha256").update(text.toLowerCase()).digest("hex").slice(0, 16)
  const hashFile = path.join(stateDir, "user-correction-hashes.json")
  const seen = await readJson(hashFile)
  if (seen[hash]) return

  const record = {
    ts: new Date().toISOString(),
    correction_id: hash,
    correction_text: text,
    scope: "chat",
    agent: input?.agent || input?.event?.properties?.agent || "unknown",
    sessionID: input?.sessionID || input?.event?.properties?.sessionID || "unknown",
    severity: /no vuelvas|esto est[aá] mal|bloquea|grave/i.test(text) ? "blocker" : "correction",
    source: "plugin:user-correction-capture",
  }

  seen[hash] = record.ts
  await fs.mkdir(stateDir, { recursive: true })
  await fs.writeFile(hashFile, JSON.stringify(seen, null, 2), "utf8")
  await appendJsonl(path.join(memoryDir, "user-corrections.jsonl"), record)
  await appendJsonl(path.join(memoryDir, "corrections.jsonl"), record)
  await appendJsonl(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), {
    ts: record.ts,
    event: "user_correction_captured",
    correction_id: hash,
    sessionID: record.sessionID,
  })
  await fs.writeFile(path.join(stateDir, "correction-capture-last.json"), JSON.stringify(record, null, 2), "utf8")
}

export default async function UserCorrectionCapturePlugin() {
  return {
    "chat.message": async (input: any) => saveCorrection(input),
    event: async (input: any) => {
      const type = input?.event?.type
      if (type === "message.updated" || type === "message.part.updated") await saveCorrection(input)
    },
  }
}
