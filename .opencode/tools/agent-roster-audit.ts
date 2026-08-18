import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

type Finding = {
  severity: "BLOCK" | "WARN"
  agent: string
  rule: string
  evidence: string
  fix: string
}

const REQUIRED_AGENTS = [
  "chief-engineer-assistant",
  "Context-Manager",
  "Repo-Explorer",
  "Architect-Planner",
  "maker",
  "Check-Reviewer",
  "Technical-Verifier",
  "qa-automation-lead",
  "appsec-engineer",
  "sre-engineer",
  "DB2-AS400-Specialist",
  "product-ux",
]

const SPECIALIST_RULES: Record<string, string[]> = {
  "chief-engineer-assistant": ["decision-router", "rag-query", "elite-quality-gate", "production-approval-gate"],
  "DB2-AS400-Specialist": ["DB2", "QSYS2", "JAVIER", "DSEDAC"],
  "DB2-Query-Optimizer": ["N+1", "batch", "paginacion", "QSYS2"],
  "Redis-Cache-Specialist": ["Redis", "TTL", "invalidacion", "hit-rate"],
  "Runtime-Log-Diagnostician": ["PM2", "logs", "health", "192.168.1.230"],
  "maker": ["N+1", "parametr", "test", "rutero_detail_modal"],
  "API-Contract-Specialist": ["contract", "request", "response", "Flutter"],
  "Flutter-Architecture-Specialist": ["Flutter", "capas", "provider", "Riverpod"],
  "Flutter-UI-Specialist": ["Flutter", "UI", "loading", "error"],
  "Flutter-Data-Specialist": ["Flutter", "provider", "API", "modelo"],
  "Flutter-Performance-Specialist": ["rebuild", "jank", "N+1", "cache"],
  "Performance-Analyst": ["N+1", "P95", "latencia", "batch"],
  "Visual-Design-Specialist": ["UX", "responsive", "accesibilidad", "screenshot"],
  "qa-automation-lead": ["Playwright", "k6", "smoke", "certificacion"],
  "appsec-engineer": ["secret", "SAST", "OWASP", "BLOCK"],
  "Technical-Verifier": ["evidencia", "verificacion", "BLOCK", "tests", "code-quality-contract"],
  "team-curator": ["team_score", "route-eval", "Telegram", "agent-roster-audit"],
}

const AMBIGUOUS_TERMS = [
  "quizas",
  "probablemente",
  "si puedes",
  "intenta",
  "maybe",
  "perhaps",
]

const auditTool = tool({
  description:
    "Audita deterministicamente el roster de agentes OpenCode: presencia, modo, especializacion, gates y evidencias obligatorias.",
  args: {
    fail_on_warn: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const agentsDir = path.join(root, ".opencode", "agents")
    const findings: Finding[] = []
    const files = await fs.readdir(agentsDir).catch(() => [])
    const agentFiles = files.filter((file) => file.endsWith(".md"))
    const byName = new Map<string, string>()

    for (const file of agentFiles) {
      byName.set(path.basename(file, ".md"), await fs.readFile(path.join(agentsDir, file), "utf8"))
    }

    for (const agent of REQUIRED_AGENTS) {
      const text = byName.get(agent)
      if (!text) {
        findings.push(block(agent, "missing_agent", "No existe archivo .opencode/agents/" + agent + ".md", "Crear el agente o corregir el nombre del roster."))
        continue
      }

      auditAgentText(agent, text, findings)

      for (const token of SPECIALIST_RULES[agent] || []) {
        if (!text.toLowerCase().includes(token.toLowerCase())) {
          findings.push(warn(agent, "specialist_keyword_missing", `Falta token operativo: ${token}`, "Reforzar el prompt del especialista con ese requisito."))
        }
      }
    }

    for (const [agent, text] of byName) {
      if (REQUIRED_AGENTS.includes(agent)) continue
      auditAgentText(agent, text, findings)
    }

    const graphAgents = await readGraphAgents(path.join(root, ".opencode", "config", "agent-graph.yaml"))
    for (const agent of graphAgents) {
      if (!REQUIRED_AGENTS.includes(agent) && !byName.has(agent)) {
        findings.push(block(agent, "roster_graph_drift", `${agent} esta en agent-graph.yaml pero no en REQUIRED_AGENTS ni en .opencode/agents/.`, "Anadir agente del graph al roster o eliminarlo del graph"))
      }
    }
    for (const agent of REQUIRED_AGENTS) {
      if (!graphAgents.has(agent)) {
        findings.push(block(agent, "roster_graph_drift", `${agent} esta en REQUIRED_AGENTS pero no en agent-graph.yaml.`, "Anadir agente del graph al roster o eliminarlo del graph"))
      }
    }

    const blocks = findings.filter((item) => item.severity === "BLOCK")
    const warns = findings.filter((item) => item.severity === "WARN")
    const status = blocks.length > 0 || (args.fail_on_warn && warns.length > 0) ? "BLOCK" : "PASS"
    const payload = {
      status,
      required_agents: REQUIRED_AGENTS.length,
      agent_files: agentFiles.length,
      block_count: blocks.length,
      warn_count: warns.length,
      findings,
    }

    await fs.mkdir(path.join(root, ".opencode", "state"), { recursive: true })
    await fs.writeFile(path.join(root, ".opencode", "state", `agent-roster-audit-${Date.now()}.json`), JSON.stringify(payload, null, 2), "utf8")

    return { output: JSON.stringify(payload, null, 2), metadata: { success: status === "PASS", ...payload } }
  },
})

export default auditTool

async function readGraphAgents(graphPath: string) {
  const agents = new Set<string>()
  const text = await fs.readFile(graphPath, "utf8").catch(() => "")
  const lf = text.replace(/\r\n/g, "\n")
  const sections = ["nodes", "layer2_hidden", "on_demand"].map((name) => sectionText(lf, name)).join("\n")
  const reAgentId = /^\s{2,}-\s+agent_id:\s*([^\s#]+)/gm
  let m: RegExpExecArray | null
  while ((m = reAgentId.exec(sections))) agents.add(m[1].trim())
  const rePlain = /^\s{4}-\s+([^\s#]+)$/gm
  while ((m = rePlain.exec(sections))) {
    const name = m[1].trim()
    if (!name.includes("agent_id")) agents.add(name)
  }
  return agents
}

function sectionText(text: string, name: string): string {
  const lines = text.split("\n")
  const start = lines.findIndex((line) => new RegExp(`^${name}:\\s*$`).test(line))
  if (start < 0) return ""
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() !== "" && !/^\s/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join("\n")
}

function auditAgentText(agent: string, text: string, findings: Finding[]) {
  if (!/^\uFEFF?---[\s\S]+?---/.test(text)) {
    findings.push(block(agent, "missing_frontmatter", "El agente no tiene frontmatter YAML.", "Agregar description, mode, steps, tools y permissions."))
  }
  if (!/\bmode:\s*(primary|subagent|all)\b/i.test(text)) {
    findings.push(block(agent, "invalid_mode", "No declara mode primary/subagent/all.", "Declarar mode segun OpenCode docs."))
  }
  if (!/\b(description|## Identidad|# .+)\b/i.test(text)) {
    findings.push(warn(agent, "weak_identity", "No se detecto identidad/descripci\u00f3n clara.", "A\u00f1adir rol, responsabilidad, limites y formato de salida."))
  }
  if (!/(evidencia|verific|no alucin|no invent|RAG|archivo[s]? le[i]d|PASS|WARN|BLOCK)/i.test(text)) {
    findings.push(warn(agent, "weak_evidence_contract", "No se detecto contrato explicito de evidencia.", "Exigir archivos leidos, hechos verificados y salida PASS/WARN/BLOCK cuando aplique."))
  }
  if (!/(fall(a|o)|error|timeout|retry|reintento|escalar|BLOCK|WARN|NEEDS_INFO|bloque)/i.test(text)) {
    findings.push(warn(agent, "weak_failure_contract", "No se detecto protocolo de fallo.", "Definir que hacer ante error, timeout, evidencia insuficiente y reintento."))
  }
  if (!/(nunca|no haces|limites|limits|never)/i.test(text)) {
    findings.push(warn(agent, "weak_limits", "No se detectan limites explicitos.", "Definir acciones prohibidas y condiciones de parada."))
  }
  const lower = text.toLowerCase()
  for (const term of AMBIGUOUS_TERMS) {
    if (lower.includes(term)) {
      findings.push(warn(agent, "ambiguous_language", `Termino ambiguo detectado: ${term}`, "Reemplazar por criterio verificable o condicion exacta."))
    }
  }
}

function block(agent: string, rule: string, evidence: string, fix: string): Finding {
  return { severity: "BLOCK", agent, rule, evidence, fix }
}

function warn(agent: string, rule: string, evidence: string, fix: string): Finding {
  return { severity: "WARN", agent, rule, evidence, fix }
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
