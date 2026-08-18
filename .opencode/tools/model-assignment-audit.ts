import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { loadFallbackConfig } from "../lib/provider-health-store.ts"

type Finding = {
  severity: "BLOCK" | "WARN"
  agent?: string
  rule: string
  evidence: string
  fix: string
}

const ALLOWED_AUTOMATIC_PROVIDERS = ["openai", "cursor-acp", "opencode-go"]
const CURSOR_FORBIDDEN = /^cursor-acp\/gpt/i
const ZEN_FORBIDDEN = /^opencode\//i
const BUILTIN_AGENT_FALLBACKS = new Set(["general-purpose"])

const auditTool = tool({
  description:
    "Audita asignacion de modelos por agente: sin herencia, sin Zen automatico, sin GPT via Cursor y con fallback-models sincronizado.",
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
      block_count: blocks.length,
      warn_count: warns.length,
      findings,
    }

    await fs.mkdir(path.join(root, ".opencode", "state"), { recursive: true })
    await fs.writeFile(path.join(root, ".opencode", "state", `model-assignment-audit-${Date.now()}.json`), JSON.stringify(payload, null, 2), "utf8")
    return { output: JSON.stringify(payload, null, 2), metadata: { success: status === "PASS", ...payload } }
  },
})

export default auditTool

async function audit(root: string) {
  const findings: Finding[] = []
  const agentsDir = path.join(root, ".opencode", "agents")
  const files = (await fs.readdir(agentsDir).catch(() => [])).filter((file) => file.endsWith(".md"))
  const fallback = await loadFallbackConfig(root)
  const fallbackAgents = fallback.agents || {}
  const fileTexts = new Map<string, string>()

  for (const file of files) {
    const agent = path.basename(file, ".md")
    const text = await fs.readFile(path.join(agentsDir, file), "utf8")
    fileTexts.set(agent, text)
    const model = readFrontmatterValue(text, "model")
    if (!model) {
      findings.push(block(agent, "missing_model", `${agent}.md no declara model.`, "Declarar model explicito; no heredar el global."))
      continue
    }
    validateModel(agent, model, "frontmatter", findings)

    const policy = fallbackAgents[agent]
    if (!policy) {
      findings.push(block(agent, "missing_fallback_policy", `fallback-models.json no contiene ${agent}.`, "Agregar entrada de policy/fallback para el agente."))
      continue
    }
    if (policy.primary !== model) {
      findings.push(block(agent, "primary_mismatch", `frontmatter=${model}, fallback.primary=${policy.primary}.`, "Sincronizar frontmatter y fallback-models.json."))
    }
    validateModel(agent, policy.primary, "fallback.primary", findings)
    for (const fallbackModel of policy.fallback || []) validateModel(agent, fallbackModel, "fallback", findings)
  }

  const fileAgents = new Set(files.map((file) => path.basename(file, ".md")))
  for (const agent of Object.keys(fallbackAgents)) {
    if (agent === "Granja-Orchestrator" || BUILTIN_AGENT_FALLBACKS.has(agent)) continue
    if (!fileAgents.has(agent)) {
      findings.push(warn(agent, "orphan_fallback_policy", `fallback-models.json contiene ${agent}, pero no hay agente local.`, "Eliminar entrada o crear agente si aplica."))
    }
  }

  const graphModels = await readGraphModels(path.join(root, ".opencode", "config", "agent-graph.yaml"))
  if (!graphModels.ok) {
    findings.push(block(undefined, "graph_unreadable", "No se pudo leer .opencode/config/agent-graph.yaml.", "Asegurar que el YAML del graph exista y sea legible."))
  } else if (graphModels.pairs.size === 0) {
    findings.push(block(undefined, "graph_no_nodes", "agent-graph.yaml no produce pares agent_id/model.", "Revisar la estructura de la seccion nodes."))
  } else {
    for (const [graphAgent, graphModel] of graphModels.pairs) {
      const frontmatterModel = fileTexts.has(graphAgent) ? readFrontmatterValue(fileTexts.get(graphAgent)!, "model") : ""
      const fallbackModel = fallbackAgents[graphAgent]?.primary || ""
      if ((frontmatterModel && graphModel !== frontmatterModel) || (fallbackModel && graphModel !== fallbackModel)) {
        findings.push(
          block(graphAgent, "model_graph_drift", `agent-graph.yaml=${graphModel}, frontmatter=${frontmatterModel || "(sin agente)"}, fallback.primary=${fallbackModel || "(sin policy)"}.`, "Sincronizar agent-graph.yaml con fallback-models.json o el frontmatter del agente."),
        )
      }
    }
  }

  return findings
}

async function readGraphModels(graphPath: string): Promise<{ ok: boolean; pairs: Map<string, string> }> {
  const pairs = new Map<string, string>()
  const text = await fs.readFile(graphPath, "utf8").catch(() => "")
  if (!text) return { ok: false, pairs }
  const lf = text.replace(/\r\n/g, "\n")
  let current: string | null = null
  for (const line of lf.split("\n")) {
    const agentMatch = line.match(/^\s{2}-\s+agent_id:\s*([^\s#]+)/)
    if (agentMatch) {
      current = agentMatch[1].trim()
      continue
    }
    if (current === null) continue
    const modelMatch = line.match(/^\s{4}model:\s*(\S+)/)
    if (modelMatch) {
      pairs.set(current, modelMatch[1].replace(/^["']|["']$/g, ""))
      current = null
    }
  }
  return { ok: true, pairs }
}

function readFrontmatterValue(text: string, key: string) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"))
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : ""
}

function validateModel(agent: string, model: string, source: string, findings: Finding[]) {
  const provider = model.split("/", 1)[0]
  if (!ALLOWED_AUTOMATIC_PROVIDERS.includes(provider)) {
    findings.push(block(agent, "provider_not_allowed", `${source} usa ${model}.`, "Usar openai, cursor-acp u opencode-go; opencode Zen es manual."))
  }
  if (ZEN_FORBIDDEN.test(model)) {
    findings.push(block(agent, "zen_automatic_forbidden", `${source} usa ${model}.`, "Mover modelo Zen a seleccion manual, no agente automatico."))
  }
  if (CURSOR_FORBIDDEN.test(model)) {
    findings.push(block(agent, "cursor_gpt_forbidden", `${source} usa ${model}.`, "Cursor ACP debe usar Composer/Claude/no-GPT."))
  }
}

function block(agent: string | undefined, rule: string, evidence: string, fix: string): Finding {
  return { severity: "BLOCK", agent, rule, evidence, fix }
}

function warn(agent: string | undefined, rule: string, evidence: string, fix: string): Finding {
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
