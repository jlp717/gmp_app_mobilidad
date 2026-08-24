import { tool } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { loadFallbackConfig } from "../lib/provider-health-store.ts"

type Check = {
  name: string
  status: "PASS" | "WARN" | "BLOCK"
  points: number
  max_points: number
  summary: string
}

export default tool({
  description:
    "Auditoria matricula de honor del equipo: agrega readiness, roster, modelos, autonomia, workflow, Ponytail, fallback, MCPs y genera paquete para revision externa.",
  args: {
    write_packet: tool.schema.boolean().default(true),
    fail_below: tool.schema.number().default(95),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const checks: Check[] = []

    checks.push(await commandCheck("readiness-smoke", root, 18, "node", [".opencode/scripts/readiness-smoke.mjs"], /PASS:score=100/))
    checks.push(await toolCheck("agent-roster-audit", root, 14, "../tools/agent-roster-audit.ts", { fail_on_warn: false }))
    checks.push(await toolCheck("model-assignment-audit", root, 14, "../tools/model-assignment-audit.ts", { fail_on_warn: false }))
    checks.push(await toolCheck("autonomous-capability-audit", root, 14, "../tools/autonomous-capability-audit.ts", { fail_on_warn: false }))
    checks.push(await toolCheck("workflow-state-audit", root, 10, "../tools/workflow-state-audit.ts", { fail_on_warn: false }))
    checks.push(await configCheck(root))
    checks.push(await evidenceCheck(root))
    checks.push(await mobileRemoteCheck(root))

    const score = checks.reduce((sum, item) => sum + item.points, 0)
    const maxScore = checks.reduce((sum, item) => sum + item.max_points, 0)
    const percent = Math.round((score / maxScore) * 100)
    const blocks = checks.filter((item) => item.status === "BLOCK")
    const warns = checks.filter((item) => item.status === "WARN")
    const grade =
      blocks.length > 0
        ? "BLOCK"
        : percent >= 98
          ? "MATRICULA"
          : percent >= 95
            ? "SOBRESALIENTE"
            : percent >= 90
              ? "NOTABLE"
              : "WARN"
    const status = blocks.length > 0 || percent < args.fail_below ? "BLOCK" : warns.length ? "WARN" : "PASS"
    const payload = {
      status,
      grade,
      score: percent,
      generated_at: new Date().toISOString(),
      block_count: blocks.length,
      warn_count: warns.length,
      checks,
      external_review_packet: args.write_packet ? ".opencode/reports/matricula-review-packet.md" : null,
    }

    const reportDir = path.join(root, ".opencode", "reports")
    await fs.mkdir(reportDir, { recursive: true })
    await fs.writeFile(path.join(reportDir, "honors-grade-audit-latest.json"), JSON.stringify(payload, null, 2), "utf8")
    if (args.write_packet) await writeExternalPacket(root, payload)

    return { output: JSON.stringify(payload, null, 2), metadata: { success: status !== "BLOCK", ...payload } }
  },
})

function commandCheck(name: string, cwd: string, max: number, command: string, args: string[], passPattern: RegExp): Promise<Check> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: "pipe", windowsHide: true })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk) => { stdout += chunk })
    child.stderr?.on("data", (chunk) => { stderr += chunk })
    const timeout = setTimeout(() => {
      child.kill()
      resolve({ name, status: "BLOCK", points: 0, max_points: max, summary: "spawn timeout 300s" })
    }, 300_000)
    child.on("error", (error) => {
      clearTimeout(timeout)
      resolve({ name, status: "BLOCK", points: 0, max_points: max, summary: error.message })
    })
    child.on("close", (code) => {
      clearTimeout(timeout)
      const output = `${stdout}${stderr}`.trim()
      if (code === 0 && passPattern.test(output)) {
        resolve({ name, status: "PASS", points: max, max_points: max, summary: output.split(/\r?\n/).slice(-2).join(" | ") })
      } else {
        resolve({ name, status: "BLOCK", points: 0, max_points: max, summary: output.slice(0, 1000) || `exit=${code}` })
      }
    })
  })
}

async function toolCheck(name: string, root: string, max: number, rel: string, args: Record<string, unknown>): Promise<Check> {
  try {
    const mod = await import(new URL(rel, import.meta.url).href)
    const result = await mod.default.execute(args, { worktree: root, directory: root })
    const payload = JSON.parse(result.output)
    const blocks = Number(payload.block_count || 0)
    const warns = Number(payload.warn_count || 0)
    if (payload.status === "PASS" && blocks === 0 && warns === 0) {
      return { name, status: "PASS", points: max, max_points: max, summary: "PASS: 0 block, 0 warn" }
    }
    if (blocks > 0 || payload.status === "BLOCK") {
      return { name, status: "BLOCK", points: 0, max_points: max, summary: `${blocks} block, ${warns} warn` }
    }
    return { name, status: "WARN", points: Math.max(0, max - warns), max_points: max, summary: `${warns} warn` }
  } catch (error) {
    return { name, status: "BLOCK", points: 0, max_points: max, summary: error instanceof Error ? error.message : String(error) }
  }
}

async function configCheck(root: string): Promise<Check> {
  const cfg = JSON.parse(await fs.readFile(path.join(root, "opencode.json"), "utf8"))
  const fallback = await loadFallbackConfig(root)
  const modePath = path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.USERPROFILE || "", ".config"), "opencode", ".ponytail-active")
  const ponytailMode = await fs.readFile(modePath, "utf8").then((value) => value.trim()).catch(() => "default")
  const gmp = fallback?.gmpPolicy || {}
  const policyDocumented =
    Boolean(gmp.fallbackSameSessionUnsafeDescription) ||
    (fallback?.notes || []).some((note: string) =>
      /no se cambia modelo en sesi[oó]n|sesi[oó]n establecida|freezeSessionAfterQuotaError|fallback seguro/i.test(String(note)),
    )
  const ok =
    cfg.default_agent === "chief-engineer-assistant" &&
     cfg.model === "openai/gpt-5.6-sol" &&
    (cfg.plugin || []).some((item: string) => String(item).toLowerCase().includes("ponytail")) &&
    ponytailMode !== "off" &&
    gmp.freezeSessionAfterQuotaError === true &&
    policyDocumented
  return {
    name: "golden-config",
    status: ok ? "PASS" : "BLOCK",
    points: ok ? 10 : 0,
    max_points: 10,
     summary: ok ? `Chief/GPT-5.6 Sol/fallback seguro/Ponytail OK (${ponytailMode})` : "Config dorada incompleta",
  }
}

async function evidenceCheck(root: string): Promise<Check> {
  const required = [
    ".opencode/config/autonomous-flow.yaml",
    ".opencode/config/model-routing.yaml",
    ".opencode/config/workflow-state-machine.yaml",
    ".opencode/config/handoff-contract.yaml",
    ".opencode/config/task-classification.yaml",
    ".opencode/AGENTS.md",
  ]
  const missing = []
  for (const rel of required) {
    try {
      await fs.access(path.join(root, rel))
    } catch {
      missing.push(rel)
    }
  }
  return {
    name: "evidence-sources",
    status: missing.length ? "BLOCK" : "PASS",
    points: missing.length ? 0 : 10,
    max_points: 10,
    summary: missing.length ? `Faltan: ${missing.join(", ")}` : "Fuentes operativas presentes",
  }
}

async function mobileRemoteCheck(root: string): Promise<Check> {
  const launcher = path.join(process.env.USERPROFILE || "C:/Users/Javier", "start-opencode-web-gmp.cmd")
  const webProtected = await probeWeb()
  const launcherExists = await fs.access(launcher).then(() => true).catch(() => false)
  const ok = launcherExists && webProtected
  return {
    name: "mobile-remote-readiness",
    status: ok ? "PASS" : "WARN",
    points: ok ? 10 : 6,
    max_points: 10,
    summary: `launcher=${launcherExists ? "yes" : "no"}, web_password=${webProtected ? "protected" : "unknown"}`,
  }
}

async function probeWeb() {
  try {
    const res = await fetch("http://127.0.0.1:3090", { signal: AbortSignal.timeout(5000) })
    return res.status === 401
  } catch {
    return false
  }
}

async function writeExternalPacket(root: string, payload: Record<string, unknown>) {
  const cfg = JSON.parse(await fs.readFile(path.join(root, "opencode.json"), "utf8"))
  const packet = [
    "# GMP OpenCode Team External Review Packet",
    "",
    "Objetivo: evaluar si el equipo de agentes esta configurado a nivel matricula de honor para uso remoto movil.",
    "",
    "No contiene secretos. No pedir valores de .env, tokens ni claves.",
    "",
    "## Resultado Agregado",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "",
    "## Config Resumida",
    `- default_agent: ${cfg.default_agent}`,
    `- model: ${cfg.model}`,
    `- tools: ${Object.keys(cfg.tools || {}).length}`,
    `- commands: ${Object.keys(cfg.command || {}).length}`,
    `- plugins: ${(cfg.plugin || []).length}`,
    `- mcp_enabled: ${Object.values(cfg.mcp || {}).filter((item: any) => item?.enabled !== false).length}`,
    "",
    "## Criterios de Revision Externa",
    "- Todos los agentes deben cargar, tener modelo explicito y fallback sincronizado.",
    "- El Chief debe orquestar skills/MCP/tools internamente sin exigir slash commands a Javier.",
     "- GPT-5.6 Sol debe ser primario del Chief y el fallback automatico debe cubrir cuota/rate limit.",
    "- Ponytail debe estar activo para evitar sobreingenieria.",
    "- Produccion debe estar protegida por gates QA/AppSec/SRE/approval.",
    "- El sistema debe ser usable desde movil con OpenCode Web protegido por password.",
  ].join("\n")
  await fs.writeFile(path.join(root, ".opencode", "reports", "matricula-review-packet.md"), packet, "utf8")
}
