#!/usr/bin/env bun
/**
 * Valida que opencode.json, plugins, tools, Chief y launcher esten listos antes del arranque.
 */
import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const findings = []

function ok(rule) {
  findings.push({ severity: "PASS", rule })
}
function warn(rule, fix) {
  findings.push({ severity: "WARN", rule, fix })
}
function block(rule, fix) {
  findings.push({ severity: "BLOCK", rule, fix })
}

function exists(p) {
  return fs.existsSync(path.join(root, p))
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(path.join(root, p), "utf8"))
}

// opencode.json
try {
  const cfg = readJson("opencode.json")
  ok("opencode.json parses")
  if (cfg.default_agent !== "chief-engineer-assistant") block("default_agent", "Debe ser chief-engineer-assistant")
  else ok("default_agent chief")
  const requiredTools = [
    "decision-router", "flow-policy-check", "goal-loop-manager", "clarification-gate",
    "state-manager", "project-context", "state-cleanup", "handoff-ledger", "elite-quality-gate",
    "scheduled-automation-runner", "readiness-smoke", "mobile-autopilot", "mobile-safety-net",
  ]
  for (const t of requiredTools) {
    if (!cfg.tools?.[t]) block(`tool_${t}`, `Habilitar ${t} en opencode.json`)
    else if (!exists(`.opencode/tools/${t}.ts`)) block(`tool_file_${t}`, `Falta .opencode/tools/${t}.ts`)
    else ok(`tool_${t}`)
  }
  const requiredCommands = ["route", "goal", "loop", "handoff", "goals", "readiness", "rescue"]
  for (const c of requiredCommands) {
    if (!cfg.command?.[c]) warn(`command_${c}`, `Agregar /${c} en opencode.json`)
    else ok(`command_${c}`)
  }
  const plugins = (cfg.plugin || []).map(String)
  for (const p of ["session-resilience.ts", "session-lifecycle.ts", "context-compaction.ts"]) {
    if (!plugins.some((x) => x.includes(p))) warn(`plugin_${p}`, `Registrar ${p}`)
    else ok(`plugin_${p}`)
  }
} catch (e) {
  block("opencode_json", String(e))
}

// Config protocol files
for (const f of [
  ".opencode/config/chief-protocol.yaml",
  ".opencode/config/response-verification.yaml",
  ".opencode/config/learning-loop.yaml",
  ".opencode/config/goal-loops.yaml",
  ".opencode/config/hybrid-interaction.yaml",
  ".opencode/config/autonomous-flow.yaml",
  ".opencode/config/mobile-productivity.yaml",
]) {
  if (exists(f)) ok(`config ${path.basename(f)}`)
  else block(`config_missing ${f}`, `Crear ${f}`)
}

// Chief agent
const chiefPath = ".opencode/agents/chief-engineer-assistant.md"
if (exists(chiefPath)) {
  const chief = fs.readFileSync(path.join(root, chiefPath), "utf8")
  if (chief.includes("chief-protocol.yaml")) ok("chief references protocol")
  else warn("chief_protocol_ref", "Chief debe leer chief-protocol.yaml")
  if (chief.includes("prompt-optimizer")) ok("chief references prompt-optimizer")
  else warn("chief_optimizer", "Chief debe invocar prompt-optimizer")
} else {
  block("chief_missing", "Falta chief-engineer-assistant.md")
}

// Launcher Javier (canonico en %USERPROFILE%)
const userLauncher = path.join(process.env.USERPROFILE || "", "Start_OpenCode_Web_Gmp.cmd")
const userLauncherAlt = path.join(process.env.USERPROFILE || "", "start-opencode-web-gmp.cmd")
if (fs.existsSync(userLauncher) || fs.existsSync(userLauncherAlt)) ok("user launcher C:\\Users\\Javier\\*.cmd")
else block("user_launcher_missing", "Crear Start_OpenCode_Web_Gmp.cmd en %USERPROFILE%")

const gmpCmd = path.join(root, "scripts/opencode/start-opencode-web-gmp.cmd")
if (exists("scripts/opencode/start-opencode-web-gmp.cmd")) ok("repo supervisor cmd template")
else block("gmp_cmd", "Falta scripts/opencode/start-opencode-web-gmp.cmd")

// Scripts
for (const s of [".opencode/scripts/post-web-startup.mjs", ".opencode/scripts/load-env.mjs"]) {
  if (exists(s)) ok(s)
  else block(`script_${s}`, `Falta ${s}`)
}

// Skills portable ponytail
for (const s of ["ponytail", "goal-driven-loop", "session-handoff"]) {
  if (exists(`.opencode/skills/${s}/SKILL.md`)) ok(`skill ${s}`)
  else warn(`skill_${s}`, `Crear skill ${s}`)
}

const blocks = findings.filter((f) => f.severity === "BLOCK")
const warns = findings.filter((f) => f.severity === "WARN")
const status = blocks.length ? "BLOCK" : warns.length ? "WARN" : "PASS"

const payload = {
  status,
  generated_at: new Date().toISOString(),
  block_count: blocks.length,
  warn_count: warns.length,
  pass_count: findings.filter((f) => f.severity === "PASS").length,
  findings: findings.filter((f) => f.severity !== "PASS"),
}

const outDir = path.join(root, ".opencode", "state")
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, "startup-integrity-latest.json"), JSON.stringify(payload, null, 2))
fs.appendFileSync(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), JSON.stringify({ ts: payload.generated_at, event: "startup_integrity", status, block_count: blocks.length }) + "\n")

console.log(JSON.stringify(payload, null, 2))
process.exit(blocks.length ? 1 : 0)
