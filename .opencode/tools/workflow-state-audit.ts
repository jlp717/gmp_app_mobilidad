import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

type Finding = {
  severity: "BLOCK" | "WARN"
  rule: string
  evidence: string
  fix: string
}

const REQUIRED_STATES = [
  "INTAKE",
  "ROUTED",
  "DISCOVERY",
  "PLAN_READY",
  "WAITING_PLAN_APPROVAL",
  "IMPLEMENTING",
  "VERIFYING",
  "STAGING",
  "WAITING_PRODUCTION_APPROVAL",
  "PRODUCTION_DEPLOY",
  "REPORTING",
  "BLOCKED",
  "DONE",
]

const FORBIDDEN_STATES = ["EXECUTING", "RECEIVE", "DELIVER"]

const REQUIRED_TOKENS = [
  "plan_before_code",
  "production-approval-gate",
  "Javier adelante",
  "flow-policy-check PASS",
  "model-assignment PASS",
  "agent-roster PASS",
  "TEAM_TRACE entry",
  "idempotency_key",
]

const auditTool = tool({
  description: "Audita maquina de estados V4: estados, transiciones, aprobacion previa al codigo y produccion.",
  args: {
    fail_on_warn: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const findings = await audit(root)
    const blocks = findings.filter((item) => item.severity === "BLOCK")
    const warns = findings.filter((item) => item.severity === "WARN")
    const status = blocks.length > 0 || (args.fail_on_warn && warns.length > 0) ? "BLOCK" : "PASS"
    const payload = { status, block_count: blocks.length, warn_count: warns.length, findings }
    await fs.mkdir(path.join(root, ".opencode", "state"), { recursive: true })
    await fs.writeFile(path.join(root, ".opencode", "state", `workflow-state-audit-${Date.now()}.json`), JSON.stringify(payload, null, 2), "utf8")
    return { output: JSON.stringify(payload, null, 2), metadata: { success: status === "PASS", ...payload } }
  },
})

export default auditTool

async function audit(root: string) {
  const findings: Finding[] = []
  const file = path.join(root, ".opencode", "config", "workflow-state-machine.yaml")
  const text = await fs.readFile(file, "utf8").catch(() => "")
  if (!text) {
    findings.push(block("missing_state_machine", "No existe .opencode/config/workflow-state-machine.yaml.", "Crear la maquina de estados V4."))
    return findings
  }

  for (const state of REQUIRED_STATES) {
    if (!new RegExp(`^\\s{4}${state}:`, "m").test(text)) {
      findings.push(block("missing_state", `Falta estado ${state}.`, "Agregar estado con allowed_actions y exit_requires."))
    }
  }

  const statesText = statesSection(text)
  for (const state of FORBIDDEN_STATES) {
    if (new RegExp(`^\\s{4}${state}:`, "m").test(statesText)) {
      findings.push(block("forbidden_state", `Estado prohibido detectado: ${state}.`, "Eliminar estado prohibido del workflow-state-machine.yaml"))
    }
  }

  for (const token of REQUIRED_TOKENS) {
    if (!text.includes(token)) {
      findings.push(block("missing_token", `Falta token operativo: ${token}.`, "Agregarlo a gates, transiciones o audit requirements."))
    }
  }

  if (!/from:\s+WAITING_PLAN_APPROVAL[\s\S]+?to:\s+IMPLEMENTING[\s\S]+?Javier approved plan/i.test(text)) {
    findings.push(block("missing_plan_approval_transition", "No se detecta transicion aprobada hacia IMPLEMENTING.", "Exigir aprobacion de Javier antes de editar codigo."))
  }
  if (!/from:\s+WAITING_PRODUCTION_APPROVAL[\s\S]+?to:\s+PRODUCTION_DEPLOY[\s\S]+?production-approval-gate token/i.test(text)) {
    findings.push(block("missing_production_approval_transition", "No se detecta transicion aprobada hacia produccion.", "Exigir adelante + production-approval-gate."))
  }
  if (!/from:\s+"\*"[\s\S]+?to:\s+BLOCKED/i.test(text)) {
    findings.push(warn("missing_global_block_transition", "No se detecta transicion global a BLOCKED.", "Agregar fallback a BLOCKED para fallos de evidencia o gates."))
  }

  return findings
}

function statesSection(text: string): string {
  const lines = text.split("\n")
  const start = lines.findIndex((line) => /^\s{2}states:\s*$/.test(line))
  if (start < 0) return ""
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() !== "") {
      const leading = lines[i].length - lines[i].trimStart().length
      if (leading < 4) {
        end = i
        break
      }
    }
  }
  return lines.slice(start, end).join("\n")
}

function block(rule: string, evidence: string, fix: string): Finding {
  return { severity: "BLOCK", rule, evidence, fix }
}

function warn(rule: string, evidence: string, fix: string): Finding {
  return { severity: "WARN", rule, evidence, fix }
}

function resolveProjectRoot(arg: string): string {
  const p = path.resolve(arg)
  if (path.basename(p) === "config" && path.basename(path.dirname(p)) === ".opencode") {
    return path.dirname(path.dirname(p))
  }
  return p
}

const isMain =
  (typeof require !== "undefined" && require.main === module) ||
  (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)

if (isMain) {
  const root = resolveProjectRoot(process.argv[2] || ".opencode/config")
  const res = await auditTool.execute({ fail_on_warn: false }, { directory: root })
  console.log(res.output)
}
