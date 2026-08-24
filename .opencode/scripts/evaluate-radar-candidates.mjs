#!/usr/bin/env bun

import gate from "../tools/repo-intake-gate.ts"
import obsidian from "../tools/obsidian-capture.ts"

const urls = [
  "https://github.com/agent-sh/agnix",
  "https://github.com/infragate/capa",
  "https://github.com/ZaxbyHub/opencode-swarm",
  "https://github.com/monte-carlo-data/mc-agent-toolkit",
  "https://github.com/hashgraph-online/hol-guard",
]

const rows = []
for (const url of urls) {
  const result = await gate.execute({ url })
  const payload = JSON.parse(result.output)
  const findings = (payload.findings || []).map((item) => item.rule).join(", ") || "none"
  const row = [
    `- ${payload.status} score=${payload.score} ${payload.repo}`,
    `  url: ${payload.url}`,
    `  findings: ${findings}`,
    `  next: ${payload.recommendation}`,
  ].join("\n")
  rows.push(row)
  console.log(row)
}

await obsidian.execute({
  kind: "radar",
  title: "Candidatos agentes MCP junio 2026",
  body: rows.join("\n\n"),
})
