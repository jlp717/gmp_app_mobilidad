import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import { loadFallbackConfig } from "../lib/provider-health-store.ts"

type Finding = {
  severity: "BLOCK" | "WARN" | "INFO"
  rule: string
  evidence: string
  fix: string
}

const REQUIRED_COMMANDS = [
  "readiness",
  "safety",
  "autopilot",
  "team-ci",
  "models",
  "models-roster",
  "flow",
  "trace",
  "repo-check",
  "radar",
  "improve",
  "briefing",
  "rescue",
  "obsidian",
  "ponytail",
  "ponytail-review",
  "ponytail-audit",
  "ponytail-debt",
  "matricula",
  "goal",
  "loop",
  "loop-stop",
  "handoff",
  "goals",
  "automation",
]

const REQUIRED_TOOLS = [
  "decision-router",
  "flow-policy-check",
  "handoff-ledger",
  "elite-quality-gate",
  "readiness-smoke",
  "mobile-safety-net",
  "mobile-autopilot",
  "model-provider-health",
  "model-roster-view",
  "repo-intake-gate",
  "tech-radar-fetch",
  "continuous-improvement-loop",
  "team-ci",
  "obsidian-capture",
  "honors-grade-audit",
  "goal-loop-manager",
  "clarification-gate",
  "scheduled-automation-runner",
  "github-watchlist-sync",
  "model-catalog-watch",
  "state-manager",
  "project-context",
  "state-cleanup",
]

const CHIEF_REQUIRED_TOOLS = [
  ...REQUIRED_TOOLS,
  "rag-query",
  "correction-capture",
  "plan-approval-gate",
  "production-approval-gate",
  "mobile-ops-status",
  "flow-status",
  "flow-trace",
]

const CRITICAL_MCPS = [
  "context7",
  "fetch",
  "ddg-search",
  "memory",
  "sequential-thinking",
  "dart-flutter-mcp",
  "pub-mcp",
  "ibm-db2-mcp",
  "gmp-deploy-ssh",
  "playwright",
  "github",
  "time",
]

export default tool({
  description:
    "Audita que slash commands, tools, permisos de agentes, MCPs criticos y fallback automatico esten conectados para uso autonomo del Chief.",
  args: {
    fail_on_warn: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const findings = await audit(root)
    const blocks = findings.filter((item) => item.severity === "BLOCK")
    const warns = findings.filter((item) => item.severity === "WARN")
    const status = blocks.length > 0 || (args.fail_on_warn && warns.length > 0) ? "BLOCK" : "PASS"
    const payload = {
      status,
      generated_at: new Date().toISOString(),
      block_count: blocks.length,
      warn_count: warns.length,
      findings,
    }
    await fs.mkdir(path.join(root, ".opencode", "reports"), { recursive: true })
    await fs.writeFile(
      path.join(root, ".opencode", "reports", "autonomous-capability-audit-latest.json"),
      JSON.stringify(payload, null, 2),
      "utf8",
    )
    return { output: JSON.stringify(payload, null, 2), metadata: { success: status === "PASS", ...payload } }
  },
})

async function audit(root: string) {
  const findings: Finding[] = []
  const cfg = await readJson(path.join(root, "opencode.json"))
  const fallback = await loadFallbackConfig(root)
  const tools = new Set(Object.keys(cfg.tools || {}))
  const commands = new Set(Object.keys(cfg.command || {}))
  const mcp = cfg.mcp || {}
  const toolFiles = new Set(
    (await fs.readdir(path.join(root, ".opencode", "tools")).catch(() => []))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => file.replace(/\.ts$/, "")),
  )
  const commandFiles = new Set(
    (await fs.readdir(path.join(root, ".opencode", "commands")).catch(() => []))
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.replace(/\.md$/, "")),
  )

  for (const name of REQUIRED_TOOLS) {
    if (!tools.has(name)) findings.push(block("missing_global_tool", `${name} no esta en opencode.json.tools.`, `Habilitar ${name}.`))
    if (!toolFiles.has(name)) findings.push(block("missing_tool_file", `.opencode/tools/${name}.ts no existe.`, `Crear tool ${name}.`))
  }
  for (const name of REQUIRED_COMMANDS) {
    if (!commands.has(name)) findings.push(block("missing_json_command", `/${name} no esta en opencode.json.command.`, `Agregar comando ${name}.`))
    if (!commandFiles.has(name)) findings.push(block("missing_md_command", `.opencode/commands/${name}.md no existe.`, `Crear command file para /${name}.`))
  }
  for (const [name, value] of Object.entries<any>(mcp)) {
    if (CRITICAL_MCPS.includes(name) && value?.enabled !== true) {
      findings.push(block("critical_mcp_disabled", `${name} esta disabled o ausente.`, `Habilitar MCP ${name} o documentar alternativa.`))
    }
  }

  const chief = await fs.readFile(path.join(root, ".opencode", "agents", "chief-engineer-assistant.md"), "utf8")
  const chiefTools = parseFrontmatterMap(chief, "tools")
  const chiefPerms = parseFrontmatterMap(chief, "permission")
  for (const name of CHIEF_REQUIRED_TOOLS) {
    if (!chiefTools.has(name)) findings.push(block("chief_missing_tool", `Chief no declara tool ${name}.`, `Agregar ${name}: true al Chief.`))
    if (!chiefPerms.has(name)) findings.push(block("chief_missing_permission", `Chief no permite ${name}.`, `Agregar ${name}: allow al Chief.`))
  }

  const gmp = fallback.gmpPolicy || {}
  if (gmp.freezeSessionAfterQuotaError !== true) {
    findings.push(
      block(
        "fallback_same_session_unsafe",
        `freezeSessionAfterQuotaError=${gmp.freezeSessionAfterQuotaError}.`,
        "Mantener freezeSessionAfterQuotaError=true para no cambiar el modelo en una sesion establecida del Chief.",
      ),
    )
  } else if (gmp.autoRetryInSession === false && gmp.autoFallbackSameSession === false) {
    findings.push(
      info(
        "fallback_same_session_unsafe",
        `autoRetryInSession=false, autoFallbackSameSession=false, freezeSessionAfterQuotaError=true.`,
        "Política de seguridad deliberada: no se cambia modelo en sesión establecida. Fallback disponible para nuevas sesiones.",
      ),
    )
  } else if (gmp.autoRetryInSession !== false || gmp.autoFallbackSameSession !== false) {
    findings.push(
      block(
        "fallback_same_session_unsafe",
        `autoRetryInSession=${gmp.autoRetryInSession}, autoFallbackSameSession=${gmp.autoFallbackSameSession}, freezeSessionAfterQuotaError=${gmp.freezeSessionAfterQuotaError}.`,
        "Mantener autoRetryInSession=false y autoFallbackSameSession=false, o documentar la excepcion, para no cambiar el modelo en una sesion establecida del Chief.",
      ),
    )
  }

  if (cfg.default_agent !== "chief-engineer-assistant") {
    findings.push(block("default_agent_not_chief", `default_agent=${cfg.default_agent}.`, "Restaurar chief-engineer-assistant."))
  }
  if (cfg.model !== "openai/gpt-5.6-sol") {
    findings.push(block("global_model_not_gpt56_sol", `model=${cfg.model}.`, "Configurar openai/gpt-5.6-sol como modelo global del Chief."))
  }

  const plugins = (cfg.plugin || []).map((item: unknown) => String(item))
  if (!plugins.some((item: string) => item.toLowerCase().includes("ponytail"))) {
    findings.push(block("ponytail_plugin_missing", "opencode.json no carga el plugin Ponytail.", "Agregar plugin Ponytail a opencode.json.plugin."))
  }
  for (const skill of ["ponytail", "ponytail-review", "ponytail-audit", "ponytail-debt"]) {
    const skillPath = path.join(root, ".opencode", "skills", skill, "SKILL.md")
    try {
      await fs.access(skillPath)
    } catch {
      findings.push(warn("ponytail_skill_missing", `${skillPath} no existe.`, `Instalar skill portable ${skill} en .opencode/skills/`))
    }
  }
  const modePath = path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.USERPROFILE || "", ".config"), "opencode", ".ponytail-active")
  const mode = await fs.readFile(modePath, "utf8").then((value) => value.trim().toLowerCase()).catch(() => "default")
  if (mode === "off") {
    findings.push(block("ponytail_disabled", `${modePath} contiene off.`, "Ejecutar /ponytail full o escribir full en .ponytail-active."))
  }

  return findings
}

async function readJson(file: string) {
  return JSON.parse(await fs.readFile(file, "utf8"))
}

function parseFrontmatterMap(text: string, key: string) {
  const map = new Set<string>()
  const match = text.match(new RegExp(`^${key}:\\s*\\r?\\n([\\s\\S]*?)(?:^[A-Za-z_-]+:|^---)`, "m"))
  if (!match) return map
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^\s+([A-Za-z0-9_-]+):\s*(true|allow)/)
    if (item) map.add(item[1])
  }
  return map
}

function block(rule: string, evidence: string, fix: string): Finding {
  return { severity: "BLOCK", rule, evidence, fix }
}

function warn(rule: string, evidence: string, fix: string): Finding {
  return { severity: "WARN", rule, evidence, fix }
}

function info(rule: string, evidence: string, fix: string): Finding {
  return { severity: "INFO", rule, evidence, fix }
}
