#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"

const root = process.cwd()
const args = new Set(process.argv.slice(2))

const CRITICAL_MCPS = [
  "context7",
  "ddg-search",
  "fetch",
  "time",
  "dart-flutter-mcp",
  "pub-mcp",
  "ibm-db2-mcp",
  "gmp-deploy-ssh",
  "playwright",
  "github",
  "gh_grep",
  "memory",
  "sequential-thinking",
]

const OPTIONAL_MCPS = [
  "chrome-devtools",
]

const CRITICAL_SKILLS = [
  "context-engineering",
  "context-pruning",
  "model-routing-fallbacks",
  "prompt-optimizer",
  "planning-and-task-breakdown",
  "source-driven-development",
  "gmp-mobilidad-flutter",
  "flutter-provider",
  "flutter-riverpod-gmp",
  "flutter-testing",
  "db2-safe-change",
  "db2-query-patterns",
  "db2-odbc",
  "ssh-prod-ops",
  "sre-runbooks",
  "qa-e2e-patterns",
  "rag-retrieval",
  "performance-optimization",
  "cache-strategy",
  "security-and-hardening",
  "regression-safety-checks",
  "release-evidence-gate",
  "memory-learning-loop",
]

const CRITICAL_TOOLS = [
  "decision-router",
  "flow-policy-check",
  "agent-roster-audit",
  "model-assignment-audit",
  "workflow-state-audit",
  "plan-approval-gate",
  "production-approval-gate",
  "elite-quality-gate",
  "rag-query",
  "staging-deploy",
  "parallel-dispatch",
  "team-curator-report",
  "correction-capture",
  "handoff-ledger",
  "model-provider-health",
  "model-roster-view",
  "mobile-autopilot",
  "mobile-safety-net",
  "continuous-improvement-loop",
  "obsidian-capture",
  "team-ci",
  "team-backup",
  "retro-auto",
  "mobile-briefing",
  "flow-status",
]

const CRITICAL_COMMANDS = [
  "route",
  "classify",
  "flow-check",
  "route-eval",
  "model-audit",
  "state-audit",
  "approve-plan",
  "workflow",
  "verify",
  "quality",
  "team-curator",
  "simulate",
  "retro",
  "teach",
  "flow",
  "models",
  "models-roster",
  "trace",
  "autopilot",
  "failover",
  "safety",
  "improve",
  "obsidian",
  "team-ci",
  "backup-team",
  "retro-auto",
  "briefing",
]

const CRITICAL_PLUGINS = [
  "model-fallback-forward.ts",
  "flow-observability.ts",
  "execution-visibility.ts",
  "rate-limit-handler.ts",
  "task-tracer.ts",
  "context-compaction.ts",
  "same-error-detector.ts",
  "production-safety-guard.ts",
  "user-correction-capture.ts",
]

const CRITICAL_CONFIGS = [
  ".opencode/config/autonomous-flow.yaml",
  ".opencode/config/handoff-contract.yaml",
  ".opencode/config/orchestrator-decision-tree.yaml",
  ".opencode/config/task-classification.yaml",
  ".opencode/config/workflow-state-machine.yaml",
  ".opencode/config/model-routing.yaml",
  ".opencode/config/model-update-policy.yaml",
  ".opencode/config/harness-engineering.yaml",
]

const REQUIRED_PROVIDERS = ["openai", "cursor-acp", "opencode-go", "opencode"]
const FORBIDDEN_ACTIVE_MCPS = ["postgres", "supabase"]
const OPENCODE_GO_BLOCK_HOURS = 2
const OPENCODE_GO_WARN_HOURS = 24
const CRITICAL_BINARIES = ["gitleaks", "agnix"]
const CRITICAL_CLI_CHECKS = [
  {
    name: "bd",
    command: "bd",
    args: ["ready", "--json"],
    timeout: 15000,
    fix: "Reparar bd/beads local; el MCP beads queda deshabilitado porque beads-mcp.exe no hace handshake fiable.",
  },
]

const payload = buildReport()
writeState(payload)
if (args.has("--json")) {
  console.log(JSON.stringify(payload, null, 2))
} else {
  console.log(`${payload.status}:score=${payload.score};agents=${payload.counts.agents};skills=${payload.counts.skills};mcp=${payload.mcp.configured_critical}/${CRITICAL_MCPS.length};cursor=${payload.providers.cursor.status}`)
}
process.exit(payload.status === "BLOCK" ? 1 : 0)

function buildReport() {
  const cfg = readJson(path.join(root, ".opencode", "opencode.json")) || readJson(path.join(root, "opencode.json")) || {}
  const rootCfg = readJson(path.join(root, "opencode.json")) || {}
  const fallback = readJson(path.join(root, ".opencode", "fallback-models.json")) || {}
  const preflight = readJson(path.join(root, ".opencode", "state", "preflight-last.json"))
  const issues = []

  const agents = safeList(path.join(root, ".opencode", "agents")).filter((file) => file.endsWith(".md"))
  const skills = safeList(path.join(root, ".opencode", "skills")).filter((name) => exists(path.join(root, ".opencode", "skills", name, "SKILL.md")))
  const tools = Object.assign({}, rootCfg.tools || {}, cfg.tools || {})
  const commands = Object.assign({}, rootCfg.command || {}, cfg.command || {})
  const mcps = Object.assign({}, rootCfg.mcp || {}, cfg.mcp || {})
  const plugins = [...(rootCfg.plugin || []), ...(cfg.plugin || [])]
  const providers = new Set([...(rootCfg.enabled_providers || []), ...(cfg.enabled_providers || [])])

  const missingProviders = REQUIRED_PROVIDERS.filter((provider) => !providers.has(provider))
  for (const provider of missingProviders) issues.push(block("provider_missing", `Proveedor requerido no habilitado: ${provider}.`, "Habilitarlo en opencode.json."))
  const providerHealth = scanProviderHealth()
  const openaiBlock = providerHealth.openai.active_block
  if (openaiBlock) {
    issues.push(warn("openai_quota_block", `OpenAI bloqueado hasta ${openaiBlock.until}: ${openaiBlock.last_error || openaiBlock.reason}`, "Sesiones nuevas y Task usan Composer 2.5. Sesiones en curso no cambian."))
  }
  const goCreditError = providerHealth.opencode_go.latest_credits_error
  if (goCreditError && goCreditError.age_hours <= OPENCODE_GO_BLOCK_HOURS) {
    issues.push(block("opencode_go_billing", `OpenCode Go devolvio CreditsError hace ${goCreditError.age_hours.toFixed(1)}h: ${goCreditError.message}`, "Revisar billing/workspace/API key de OpenCode Go antes de enrutar agentes automaticos a opencode-go."))
  } else if (goCreditError && goCreditError.age_hours <= OPENCODE_GO_WARN_HOURS) {
    issues.push(warn("opencode_go_recent_billing", `OpenCode Go tuvo CreditsError hace ${goCreditError.age_hours.toFixed(1)}h: ${goCreditError.message}`, "No usar OpenCode Go como primario hasta que una llamada real confirme que la cuenta ya no devuelve CreditsError."))
  }

  const odbc64 = probeOdbc64()
  if (odbc64.status === "MISSING") {
    issues.push(block("odbc64_dsn_missing", "No existe DSN ODBC 64-bit GMP en HKCU/HKLM.", "Crear GMP en ODBC Data Sources 64-bit con iSeries Access ODBC Driver y host 192.168.1.22."))
  } else if (odbc64.status === "WRONG_DRIVER") {
    issues.push(block("odbc64_wrong_driver", `DSN ODBC 64-bit GMP usa driver no esperado: ${odbc64.driver || "sin driver"}.`, "Debe apuntar a C:\\windows\\system32\\cwbodbc.dll."))
  }

  const mcpMissing = CRITICAL_MCPS.filter((name) => !mcps[name])
  const mcpDisabled = CRITICAL_MCPS.filter((name) => mcps[name]?.enabled === false)
  const optionalDisabled = OPTIONAL_MCPS.filter((name) => mcps[name]?.enabled === false)
  const forbiddenMcp = FORBIDDEN_ACTIVE_MCPS.filter((name) => mcps[name] && mcps[name].enabled !== false)
  const missingBinaries = CRITICAL_BINARIES.filter((name) => !binaryAvailable(name))
  const failedCliChecks = CRITICAL_CLI_CHECKS.map(runCliCheck).filter((item) => item.status !== "PASS")
  for (const name of mcpMissing) issues.push(block("mcp_missing", `MCP critico no configurado: ${name}.`, "Agregarlo al opencode.json activo."))
  for (const name of mcpDisabled) issues.push(block("mcp_disabled", `MCP critico deshabilitado: ${name}.`, "Habilitarlo o quitarlo del router."))
  for (const name of forbiddenMcp) issues.push(block("mcp_forbidden", `MCP prohibido activo para GMP: ${name}.`, "Deshabilitarlo; GMP usa DB2/AS400."))
  for (const name of missingBinaries) issues.push(warn("binary_missing", `Binario preventivo no encontrado en PATH: ${name}.`, "Instalarlo o revisar PATH de usuario."))
  for (const item of failedCliChecks) issues.push(block("cli_check_failed", `${item.name} fallo: ${item.message}`, item.fix))

  const missingSkills = CRITICAL_SKILLS.filter((name) => !exists(path.join(root, ".opencode", "skills", name, "SKILL.md")))
  for (const name of missingSkills) issues.push(block("skill_missing", `Skill critica no encontrada: ${name}.`, "Crear SKILL.md o corregir decision-router."))

  const missingTools = CRITICAL_TOOLS.filter((name) => tools[name] !== true)
  for (const name of missingTools) issues.push(block("tool_missing", `Tool critica no registrada: ${name}.`, "Registrar tool en ambos opencode.json."))

  const missingCommands = CRITICAL_COMMANDS.filter((name) => !commands[name])
  for (const name of missingCommands) issues.push(block("command_missing", `Comando critico no registrado: ${name}.`, "Registrar comando slash en ambos opencode.json."))

  const pluginBasenames = new Set(plugins.map((plugin) => path.basename(String(plugin))))
  const missingPlugins = CRITICAL_PLUGINS.filter((name) => !pluginBasenames.has(name))
  for (const name of missingPlugins) issues.push(block("plugin_missing", `Plugin critico no registrado: ${name}.`, "Registrar plugin en ambos opencode.json."))

  const missingConfigs = CRITICAL_CONFIGS.filter((name) => !exists(path.join(root, name)))
  for (const name of missingConfigs) issues.push(block("config_missing", `Config critica no existe: ${name}.`, "Restaurar config antes de usar Tier 2/3."))

  if (agents.length < 30) issues.push(block("agent_count", `Solo ${agents.length} agentes detectados.`, "Restaurar roster senior."))
  if (skills.length < 80) issues.push(warn("skill_count", `Solo ${skills.length} skills detectadas.`, "Revisar instalacion de skills."))
  if (!fallback.enabled) issues.push(block("fallback_disabled", "fallback-models deshabilitado.", "Reactivar fallback-models.json."))
  if (!fallback.manual_free_models?.opencode_zen?.length) issues.push(warn("opencode_zen_models", "No hay modelos OpenCode Zen manuales declarados.", "Actualizar manual_free_models."))

  const modelDistribution = modelDistributionFromAgents()
  const cursorProbe = probeCursor()
  const preflightCursorAvailable = preflight?.cursor_cli_status === "models_available"
  const cursor = cursorProbe.status === "AVAILABLE" || !preflightCursorAvailable ? cursorProbe : {
    status: "AVAILABLE_FROM_PREFLIGHT",
    message: "Cursor lista modelos en el launcher real; el shell actual no tiene el mismo acceso a credenciales.",
    models: [],
  }
  const cursorAvailable = cursor.status === "AVAILABLE" || cursor.status === "AVAILABLE_FROM_PREFLIGHT"
  const cursorPrimaryAgents = Object.entries(modelDistribution.by_agent)
    .filter(([, model]) => String(model).startsWith("cursor-acp/"))
    .map(([agent]) => agent)
  if (cursorPrimaryAgents.length > 0 && !cursorAvailable) {
    issues.push(block("cursor_primary_unavailable", `Hay ${cursorPrimaryAgents.length} agentes con Cursor primario, pero Cursor no lista modelos.`, "Moverlos a OpenAI/OpenCode Go hasta que Cursor devuelva modelos."))
  }

  const preflightAgeHours = preflight?.generated_at ? (Date.now() - Date.parse(preflight.generated_at)) / 36e5 : null
  if (!preflight) {
    issues.push(warn("preflight_missing", "No hay preflight-last.json.", "Ejecutar start-opencode-project.ps1 con Web parado para generar preflight completo."))
  } else if (preflightAgeHours !== null && preflightAgeHours > 24) {
    issues.push(warn("preflight_stale", `Preflight tiene ${preflightAgeHours.toFixed(1)} horas.`, "Ejecutar preflight completo cada dia de trabajo."))
  } else if (preflight.mcp_runtime_status && !String(preflight.mcp_runtime_status).startsWith("ok")) {
    issues.push(block("mcp_runtime", `Ultimo MCP runtime: ${preflight.mcp_runtime_status}.`, "Revisar opencode mcp list con Web parado."))
  }

  const blocks = issues.filter((item) => item.severity === "BLOCK")
  const warns = issues.filter((item) => item.severity === "WARN")
  return {
    status: blocks.length ? "BLOCK" : warns.length ? "WARN" : "PASS",
    score: Math.max(0, 100 - blocks.length * 15 - warns.length * 3),
    generated_at: new Date().toISOString(),
    counts: {
      agents: agents.length,
      skills: skills.length,
      tools: Object.keys(tools).length,
      commands: Object.keys(commands).length,
      plugins: plugins.length,
      mcp_configured: Object.keys(mcps).length,
    },
    mcp: {
      configured_critical: CRITICAL_MCPS.length - mcpMissing.length - mcpDisabled.length,
      critical_total: CRITICAL_MCPS.length,
      missing: mcpMissing,
      disabled: mcpDisabled,
      optional_disabled: optionalDisabled,
      forbidden_active: forbiddenMcp,
      runtime_from_last_preflight: preflight?.mcp_runtime_status || "missing",
    },
    skills: {
      critical_total: CRITICAL_SKILLS.length,
      missing: missingSkills,
    },
    providers: {
      enabled: [...providers],
      missing: missingProviders,
      cursor,
      opencode_go: providerHealth.opencode_go,
      openai: providerHealth.openai,
      opencode_go_agents: Object.values(modelDistribution.by_agent).filter((model) => String(model).startsWith("opencode-go/")).length,
      openai_agents: Object.values(modelDistribution.by_agent).filter((model) => String(model).startsWith("openai/")).length,
      cursor_primary_agents: cursorPrimaryAgents,
      manual_zen_models: fallback.manual_free_models?.opencode_zen || [],
    },
    db2: {
      odbc64,
    },
    plugins: {
      critical_total: CRITICAL_PLUGINS.length,
      missing: missingPlugins,
    },
    binaries: {
      critical_total: CRITICAL_BINARIES.length,
      missing: missingBinaries,
    },
    cli_checks: {
      critical_total: CRITICAL_CLI_CHECKS.length,
      failed: failedCliChecks,
    },
    configs: {
      critical_total: CRITICAL_CONFIGS.length,
      missing: missingConfigs,
    },
    model_distribution: modelDistribution.by_model,
    preflight: preflight ? {
      generated_at: preflight.generated_at,
      mcp_runtime_status: preflight.mcp_runtime_status,
      backend_health_status: preflight.backend_health_status,
      cursor_status: preflight.cursor_status,
      agent_count: preflight.agent_count,
    } : null,
    blockers: blocks,
    warnings: warns,
  }
}

function probeCursor() {
  const acp = probeCursorAcpModels()
  if (acp) return acp
  const cursorCmd = path.join(os.homedir(), "AppData", "Local", "cursor-agent", "cursor-agent.cmd")
  if (!exists(cursorCmd)) return { status: "MISSING", message: "cursor-agent.cmd no existe.", models: [] }
  const result = spawnSync(cursorCmd, ["models"], { encoding: "utf8", timeout: 10000, shell: true })
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim()
  if (result.error) return { status: "ERROR", message: result.error.message, models: [] }
  if (/No models available/i.test(output)) return { status: "NO_MODELS", message: "Cursor CLI responde pero no lista modelos disponibles para esta cuenta.", models: [] }
  const models = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/model/i.test(line))
  if (models.length === 0) return { status: "UNKNOWN", message: output || "Cursor no devolvio modelos.", models: [] }
  return { status: "AVAILABLE", message: `Cursor lista ${models.length} modelos.`, models }
}

function probeCursorAcpModels() {
  const result = spawnSync("curl.exe", ["-s", "--max-time", "10", "http://127.0.0.1:32124/v1/models"], {
    encoding: "utf8",
    timeout: 12000,
    windowsHide: true,
  })
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim()
  if (result.error || !output) return null
  try {
    const payload = JSON.parse(output)
    const models = Array.isArray(payload.data) ? payload.data.map((item) => item?.id).filter(Boolean) : []
    if (models.length === 0) return null
    return {
      status: "AVAILABLE",
      message: `Cursor ACP lista ${models.length} modelos.`,
      models: models.slice(0, 25),
      source: payload.source || "cursor_acp",
    }
  } catch {
    return null
  }
}

function scanProviderHealth() {
  const latest = {
    openai: { active_block: null },
    opencode_go: {
      latest_credits_error: null,
    },
  }
  const healthFile = path.join(root, ".opencode", "state", "provider-health.json")
  const health = readJson(healthFile)
  if (health?.unavailable) {
    const now = Date.now()
    for (const [key, entry] of Object.entries(health.unavailable)) {
      if (!key.startsWith("openai")) continue
      if (entry?.until && Date.parse(entry.until) > now) {
        latest.openai.active_block = { key, ...entry }
        break
      }
    }
  }
  const trace = readText(path.join(root, ".opencode", "TEAM_TRACE.jsonl"))
  if (!trace) return latest
  const lines = trace.split(/\r?\n/).filter(Boolean).slice(-8000)
  for (const line of lines) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    const raw = JSON.stringify(entry)
    if (!/CreditsError|No payment method/i.test(raw)) continue
    if (!/opencode-go|zen\/go\/v1\/messages|qwen|deepseek|kimi/i.test(raw)) continue
    const props = entry?.detail?.properties || {}
    const errorData = props?.error?.data || props?.info?.error?.data || {}
    const message = String(errorData.message || props?.error?.message || "CreditsError").split(/\r?\n/)[0].slice(0, 240)
    const ts = String(entry.ts || "")
    const parsedTs = Date.parse(ts)
    latest.opencode_go.latest_credits_error = {
      ts,
      sessionID: props?.sessionID || props?.info?.sessionID || "unknown",
      statusCode: errorData.statusCode || null,
      message,
      age_hours: Number.isFinite(parsedTs) ? Math.max(0, (Date.now() - parsedTs) / 36e5) : 9999,
    }
  }
  return latest
}

function probeOdbc64() {
  if (process.platform !== "win32") return { status: "NOT_WINDOWS", message: "ODBC registry probe skipped outside Windows." }
  const candidates = [
    { scope: "User", key: "HKCU\\SOFTWARE\\ODBC\\ODBC.INI\\GMP" },
    { scope: "System", key: "HKLM\\SOFTWARE\\ODBC\\ODBC.INI\\GMP" },
  ]
  const found = []
  for (const candidate of candidates) {
    const driver = regValue(candidate.key, "Driver")
    const system = regValue(candidate.key, "System")
    if (driver.exists || system.exists) found.push({ scope: candidate.scope, driver: driver.value, system: system.value })
  }
  if (found.length === 0) return { status: "MISSING", checked_scopes: candidates.map((item) => item.scope) }
  const usable = found.find((item) => /\\system32\\cwbodbc\.dll$/i.test(String(item.driver || "")))
  if (!usable) return { status: "WRONG_DRIVER", found, driver: found[0]?.driver || "" }
  return { status: "AVAILABLE", ...usable, found }
}

function regValue(key, name) {
  const result = spawnSync("reg", ["query", key, "/v", name], {
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true,
  })
  const output = `${result.stdout || ""}${result.stderr || ""}`
  if (result.status !== 0) return { exists: false, value: "" }
  const match = output.match(new RegExp(`\\s${escapeRegExp(name)}\\s+REG_\\w+\\s+(.+)`, "i"))
  return { exists: Boolean(match), value: match ? match[1].trim() : "" }
}

function modelDistributionFromAgents() {
  const byAgent = {}
  const byModel = {}
  for (const file of safeList(path.join(root, ".opencode", "agents")).filter((name) => name.endsWith(".md"))) {
    const text = readText(path.join(root, ".opencode", "agents", file))
    const match = text.match(/^model:\s*(.+)$/m)
    const model = match ? match[1].trim().replace(/^["']|["']$/g, "") : "<missing>"
    byAgent[path.basename(file, ".md")] = model
    byModel[model] = (byModel[model] || 0) + 1
  }
  return { by_agent: byAgent, by_model: byModel }
}

function writeState(report) {
  const stateDir = path.join(root, ".opencode", "state")
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(path.join(stateDir, "readiness-latest.json"), JSON.stringify(report, null, 2), "utf8")
  fs.writeFileSync(path.join(stateDir, `readiness-smoke-${Date.now()}.json`), JSON.stringify(report, null, 2), "utf8")
}

function block(rule, evidence, fix) {
  return { severity: "BLOCK", rule, evidence, fix }
}

function warn(rule, evidence, fix) {
  return { severity: "WARN", rule, evidence, fix }
}

function safeList(dir) {
  try { return fs.readdirSync(dir) } catch { return [] }
}

function exists(file) {
  try { fs.accessSync(file); return true } catch { return false }
}

function readText(file) {
  try { return fs.readFileSync(file, "utf8") } catch { return "" }
}

function readJson(file) {
  try { return JSON.parse(readText(file)) } catch { return null }
}

function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "command"
  const args = process.platform === "win32" ? [command] : ["-v", command]
  const result = spawnSync(probe, args, {
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true,
  })
  return result.status === 0
}

function binaryAvailable(name) {
  if (commandExists(name)) return true
  if (name === "agnix") {
    const localBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "agnix.cmd" : "agnix")
    if (exists(localBin)) return true
    const npx = spawnSync("npx", ["agnix", "--version"], {
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
      shell: process.platform === "win32",
      cwd: root,
    })
    return npx.status === 0
  }
  return false
}

function runCliCheck(check) {
  const result = spawnSync(check.command, check.args, {
    encoding: "utf8",
    timeout: check.timeout,
    windowsHide: true,
    shell: process.platform === "win32",
  })
  const message = `${result.stdout || ""}${result.stderr || ""}`.trim().slice(0, 240)
  if (result.error) return { status: "BLOCK", name: check.name, message: result.error.message, fix: check.fix }
  if (result.status !== 0) return { status: "BLOCK", name: check.name, message: message || `exit=${result.status}`, fix: check.fix }
  return { status: "PASS", name: check.name, message: message || "ok", fix: check.fix }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
