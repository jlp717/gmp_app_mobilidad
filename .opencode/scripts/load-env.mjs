/** Load ~/.config/opencode/.env into process.env for automation scripts. */
import fs from "node:fs"
import path from "node:path"

export async function loadEnv(projectRoot) {
  const home = process.env.USERPROFILE || process.env.HOME || ""
  const envFile = path.join(home, ".config", "opencode", ".env")
  if (!fs.existsSync(envFile)) return
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue
    const idx = line.indexOf("=")
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    if (key && process.env[key] === undefined) process.env[key] = val
  }
  const credFile = path.join(projectRoot, ".opencode-runtime", "opencode-web-gmp.credentials")
  if (fs.existsSync(credFile) && !process.env.OPENCODE_SERVER_PASSWORD) {
    process.env.OPENCODE_SERVER_PASSWORD = fs.readFileSync(credFile, "utf8").trim()
  }
}
