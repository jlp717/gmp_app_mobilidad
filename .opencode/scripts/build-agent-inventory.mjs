#!/usr/bin/env node
/**
 * Builds docs/agent-inventory.yaml from .opencode/agents/*.md frontmatter
 * and .opencode/config/agent-graph.yaml node metadata.
 */
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..", "..")
const agentsDir = path.join(root, ".opencode", "agents")
const graphPath = path.join(root, ".opencode", "config", "agent-graph.yaml")
const outPath = path.join(root, "docs", "agent-inventory.yaml")

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return { raw: "", fields: {}, tools: [] }
  const raw = match[1]
  const fields = {}
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/)
    if (m && !line.startsWith("  ")) fields[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
  const tools = []
  let inTools = false
  for (const line of raw.split(/\r?\n/)) {
    if (/^tools:\s*$/.test(line)) {
      inTools = true
      continue
    }
    if (inTools) {
      const t = line.match(/^  ([^:\s]+):\s*true/)
      if (t) tools.push(t[1])
      else if (line && !line.startsWith("  ")) inTools = false
    }
  }
  return { raw, fields, tools }
}

function parseGraphNodes(yaml) {
  const nodes = new Map()
  const blocks = yaml.split(/\n  - agent_id:/)
  for (const block of blocks.slice(1)) {
    const id = block.match(/^ ([^\n]+)/)?.[1]?.trim()
    if (!id) continue
    const pick = (key) => block.match(new RegExp(`${key}:\\s*"?([^"\\n]+)"?`))?.[1]?.trim()
    nodes.set(id, {
      tier: pick("tier"),
      role: pick("role"),
      model: pick("model"),
      budget_tokens: pick("budget_tokens"),
      rate_limit: pick("rate_limit"),
    })
  }
  return nodes
}

const graphYaml = fs.readFileSync(graphPath, "utf8")
const graphNodes = parseGraphNodes(graphYaml)
const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md")).sort()

const inventory = {
  version: 1,
  generated_at: new Date().toISOString(),
  project: "gmp_app_mobilidad",
  source: {
    agents_dir: ".opencode/agents",
    graph: ".opencode/config/agent-graph.yaml",
  },
  counts: {
    agent_files: agentFiles.length,
    graph_nodes: graphNodes.size,
  },
  agents: [],
}

for (const file of agentFiles) {
  const id = path.basename(file, ".md")
  const text = fs.readFileSync(path.join(agentsDir, file), "utf8")
  const { fields, tools } = parseFrontmatter(text)
  const graph = graphNodes.get(id) || null
  inventory.agents.push({
    id,
    file: `.opencode/agents/${file}`,
    mode: fields.mode || "unknown",
    model: fields.model || graph?.model || "unassigned",
    description: fields.description || "",
    tools,
    graph: graph
      ? {
          tier: graph.tier,
          role: graph.role,
          budget_tokens: Number(graph.budget_tokens) || null,
          rate_limit: Number(graph.rate_limit) || null,
        }
      : null,
    invocation: fields.mode === "primary" ? "@mention or chief delegation" : "chief delegation or @mention",
  })
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
const header = `# Agent inventory — GMP OpenCode V4\n# Regenerate: node .opencode/scripts/build-agent-inventory.mjs\n`
const body = inventory.agents
  .map((a) => {
    const g = a.graph
    return [
      `- id: ${a.id}`,
      `  file: ${a.file}`,
      `  mode: ${a.mode}`,
      `  model: ${a.model}`,
      `  invocation: ${a.invocation}`,
      `  description: ${JSON.stringify(a.description)}`,
      `  tools_count: ${a.tools.length}`,
      g
        ? `  graph_tier: ${g.tier}\n  graph_role: ${g.role}\n  budget_tokens: ${g.budget_tokens}\n  rate_limit: ${g.rate_limit}`
        : `  graph_tier: null`,
    ].join("\n")
  })
  .join("\n")

fs.writeFileSync(
  outPath,
  `${header}\nversion: ${inventory.version}\ngenerated_at: ${inventory.generated_at}\nagent_files: ${inventory.counts.agent_files}\ngraph_nodes: ${inventory.counts.graph_nodes}\n\nagents:\n${body}\n`,
  "utf8",
)

console.log(`PASS: wrote ${outPath} (${inventory.agents.length} agents)`)
