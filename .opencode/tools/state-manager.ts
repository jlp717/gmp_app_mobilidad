import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

const operationSchema = tool.schema.enum([
  "create",
  "update",
  "read",
  "complete",
  "list_active",
  "list_interrupted",
  "snapshot",
])

function ok(data: Record<string, unknown>) {
  return { output: JSON.stringify({ success: true, ...data }, null, 2), metadata: { success: true, ...data } }
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return { output: JSON.stringify({ success: false, error: message }, null, 2), metadata: { success: false, error: message } }
}

async function writeAtomic(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8")
    await fs.rename(tmp, file)
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

async function readState(stateDir: string, taskId: string) {
  try { return JSON.parse(await fs.readFile(path.join(stateDir, `${taskId}.json`), "utf8")) }
  catch { return null }
}

export default tool({
  description:
    "Persist task StateGraph. Use operation=snapshot after each workflow node (checkpoint). Do not store secrets in state.",
  args: {
    operation: operationSchema.describe("StateGraph operation. snapshot writes StateSnapshot checkpoint."),
    task_id: tool.schema.string().optional().describe("Task id YYYYMMDD-HHMMSS-proyecto-xxxx."),
    project: tool.schema.enum(["gmp", "granja"]).default("gmp").describe("Owning project."),
    patch: tool.schema.record(tool.schema.string(), tool.schema.any()).optional().describe("Fields to merge on update."),
    node_id: tool.schema.string().optional().describe("Graph node id for snapshot labeling."),
  },
  async execute(args, context) {
    try {
      const root = path.resolve(context.worktree || context.directory)
      const stateDir = path.join(root, ".opencode", "state")
      await fs.mkdir(stateDir, { recursive: true })
      if (args.operation === "list_active" || args.operation === "list_interrupted") {
        const files = (await fs.readdir(stateDir)).filter((f) => f.endsWith(".json") && !f.includes("-parallel-"))
        const states: any[] = []
        for (const f of files) {
          try {
            const state = JSON.parse(await fs.readFile(path.join(stateDir, f), "utf8"))
            if (state.current_step !== "DELIVER" && state.task_id) states.push(state)
          } catch {
            /* skip non-state json */
          }
        }
        return ok({ states })
      }
      if (!args.task_id) return fail("task_id requerido")
      const file = path.join(stateDir, `${args.task_id}.json`)
      if (args.operation === "read") return ok({ state: await readState(stateDir, args.task_id) })
      if (args.operation === "create") {
        const now = new Date().toISOString()
        const state = {
          task_id: args.task_id,
          ts_created: now,
          ts_updated: now,
          current_step: "RECEIVE",
          tier: null,
          project: args.project,
          intention: {},
          plan: null,
          workstreams: [],
          file_locks: {},
          agents_active: [],
          telegram_thread: null,
          approval_status: "not_required",
          snapshot_key: null,
          snapshots: [],
          errors: [],
          rollback_triggered: false,
          context_compressed: false,
          metrics: { tokens_total: 0, ts_start: now, ts_end: null, agents_invoked: [] },
        }
        await writeAtomic(file, state)
        return ok({ state })
      }
      if (args.operation === "snapshot") {
        const current = (await readState(stateDir, args.task_id)) || { task_id: args.task_id, project: args.project }
        const ts = new Date().toISOString()
        const snapshotKey = `${args.task_id}-${Date.now()}`
        const snapDir = path.join(stateDir, "snapshots", args.task_id)
        await fs.mkdir(snapDir, { recursive: true })
        const snapshot = {
          snapshot_key: snapshotKey,
          ts,
          node_id: args.node_id || current.current_step || "unknown",
          state: current,
        }
        const snapFile = path.join(snapDir, `${snapshotKey}.json`)
        await writeAtomic(snapFile, snapshot)
        const next = {
          ...current,
          ...(args.patch || {}),
          snapshot_key: snapshotKey,
          ts_updated: ts,
          snapshots: [...(current.snapshots || []).slice(-19), { snapshot_key: snapshotKey, ts, node_id: snapshot.node_id }],
        }
        await writeAtomic(file, next)
        return ok({ state: next, snapshot_file: snapFile, snapshot_key: snapshotKey })
      }
      const current = (await readState(stateDir, args.task_id)) || {}
      const next = { ...current, ...(args.patch || {}), ts_updated: new Date().toISOString() }
      if (args.operation === "complete") {
        next.current_step = "DELIVER"
        next.metrics = { ...(next.metrics || {}), ts_end: new Date().toISOString() }
      }
      await writeAtomic(file, next)
      return ok({ state: next })
    } catch (error) {
      return fail(error)
    }
  },
})
