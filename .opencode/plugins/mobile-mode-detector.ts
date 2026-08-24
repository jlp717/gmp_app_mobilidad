import fs from "node:fs/promises"
import path from "node:path"

function getText(input: any) {
  return String(input?.message?.content || input?.content || input?.text || "")
}

function isMobile(input: any) {
  const text = getText(input).toLowerCase()
  const keyword = (process.env.MOBILE_TRIGGER_KEYWORD || "equipo").toLowerCase()
  return process.env.OPENCODE_CLIENT_TYPE === "mobile"
    || process.env.OPENCODE_MOBILE_MODE === "true"
    || text.includes("modo movil")
    || text.includes("modo móvil")
    || text.includes("[mobile]")
    || text.includes("mobile")
    || text.includes("voice")
    || text.startsWith(`${keyword},`)
}

async function mark(input: any) {
  const sessionID = input?.sessionID || input?.session?.id || "unknown"
  const root = process.cwd()
  const stateDir = path.join(root, ".opencode", "state")
  await fs.mkdir(stateDir, { recursive: true })
  await fs.appendFile(path.join(root, ".opencode", "mobile-mode.log"), `${new Date().toISOString()} Mobile mode activado para sesion ${sessionID}\n`, "utf8")
  await fs.writeFile(path.join(stateDir, `mobile-${sessionID}.json`), JSON.stringify({
    sessionID,
    mobile_mode: true,
    voice_enabled: true,
    expires_at: new Date(Date.now() + 7200_000).toISOString(),
    prompt_injection: "MOBILE MODE ACTIVO. Respuestas concisas: maximo tres lineas en resumen. Formatear para sintesis de voz. Ofrecer detalles al final.",
  }, null, 2), "utf8")
}

export default async function MobileModeDetectorPlugin() {
  return {
    "session.start": async (input: any) => {
      if (isMobile(input)) await mark(input)
    },
    "chat.message": async (input: any) => {
      if (isMobile(input)) await mark(input)
    },
  }
}
