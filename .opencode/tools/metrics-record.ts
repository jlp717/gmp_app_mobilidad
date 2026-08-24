import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

function labelString(labels: Record<string, string>) {
  const entries = Object.entries(labels || {})
  return entries.length ? `{${entries.map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(",")}}` : ""
}

function result(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

export default tool({
  description: "Registra metricas Prometheus en .opencode/metrics/current.prom.",
  args: {
    metric_name: tool.schema.string().regex(/^[a-zA-Z_:][a-zA-Z0-9_:]*$/).describe("Nombre Prometheus."),
    value: tool.schema.number(),
    labels: tool.schema.record(tool.schema.string(), tool.schema.string()).default({}),
    metric_type: tool.schema.enum(["counter", "gauge", "histogram"]).default("gauge"),
  },
  async execute(args, context) {
    try {
      const root = path.resolve(context.worktree || context.directory)
      const file = path.join(root, ".opencode", "metrics", "current.prom")
      await fs.mkdir(path.dirname(file), { recursive: true })
      const existing = await fs.readFile(file, "utf8").catch(() => "")
      const typeLine = `# TYPE ${args.metric_name} ${args.metric_type}\n`
      if (!existing.includes(typeLine)) await fs.appendFile(file, typeLine, "utf8")
      const line = `${args.metric_name}${labelString(args.labels)} ${args.value}\n`
      await fs.appendFile(file, line, "utf8")
      return result({ success: true, file, line: line.trim() })
    } catch (error) {
      return result({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  },
})
