// task-metrics.ts - Metricas por tarea para el equipo (plugin local GMP).
// Registra en .opencode/metrics/tasks.jsonl al cerrar cada tarea: duracion, tier, resultado.
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"

export default async function TaskMetricsPlugin(ctx?: { directory?: string }) {
  const root = ctx?.directory || process.cwd()
  const metricsDir = path.join(root, ".opencode", "metrics")
  const file = path.join(metricsDir, "tasks.jsonl")
  const starts = new Map<string, number>()

  const ensure = () => { try { fs.mkdirSync(metricsDir, { recursive: true }) } catch { /* noop */ } }
  const append = (rec: Record<string, unknown>) => {
    try { ensure(); fs.appendFileSync(file, JSON.stringify(rec) + "\n") } catch { /* noop */ }
  }

  return {
    "tool.execute.after": async (input: any) => {
      const tool = String(input?.tool || "")
      if (tool === "state-manager") {
        const args = input?.args || {}
        if (args?.operation === "create" && args?.task_id) starts.set(args.task_id, Date.now())
        if (args?.operation === "complete" && args?.task_id) {
          const t0 = starts.get(args.task_id)
          append({
            ts: new Date().toISOString(),
            task_id: args.task_id,
            duration_ms: t0 ? Date.now() - t0 : null,
            project: args.project || "gmp",
            status: "complete",
            plugin: "task-metrics",
            uuid: randomUUID(),
          })
          starts.delete(args.task_id)
        }
      }
    },
    "chat.message": async (input: any) => {
      const args = input?.args || input?.input || {}
      const content = typeof args.content === "string" ? args.content : JSON.stringify(args)
      if (content && content.length < 4000) {
        append({ ts: new Date().toISOString(), kind: "chat", len: content.length, plugin: "task-metrics", uuid: randomUUID() })
      }
    },
  }
}
