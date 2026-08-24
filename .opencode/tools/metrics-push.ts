import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

function result(data: Record<string, unknown>) {
  return { output: JSON.stringify({ success: true, ...data }, null, 2), metadata: { success: true, ...data } }
}

export default tool({
  description: "Registra metricas OpenCode V4 en formato Prometheus textfile.",
  args: {
    metric: tool.schema.string().describe("Nombre de metrica Prometheus."),
    value: tool.schema.number().default(1).describe("Valor numerico."),
    labels: tool.schema.record(tool.schema.string(), tool.schema.string()).default({}).describe("Etiquetas Prometheus."),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const dir = path.join(root, ".opencode", "metrics")
    await fs.mkdir(dir, { recursive: true })
    const labels = Object.entries(args.labels)
      .map(([key, value]) => `${key}="${String(value).replace(/"/g, '\\"')}"`)
      .join(",")
    const line = `${args.metric}${labels ? `{${labels}}` : ""} ${args.value} ${Date.now()}\n`
    await fs.appendFile(path.join(dir, "current.prom"), line, "utf8")
    await fs.appendFile(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), JSON.stringify({
      ts: new Date().toISOString(),
      event: "metric_push",
      metric: args.metric,
      value: args.value,
      labels: args.labels,
    }) + "\n", "utf8").catch(() => undefined)
    return result({ written_to: ".opencode/metrics/current.prom" })
  },
})
