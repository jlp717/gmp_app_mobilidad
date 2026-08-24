import { tool } from "@opencode-ai/plugin"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

export default tool({
  description:
    "Pausa deliberada para preguntar a Javier: registra la duda, bloquea autonomia hasta respuesta y permite reanudar goal/task.",
  args: {
    action: tool.schema.enum(["ask", "check", "resolve"]).default("ask"),
    task_id: tool.schema.string().optional(),
    goal_id: tool.schema.string().optional(),
    questions: tool.schema.array(tool.schema.string()).optional(),
    context: tool.schema.string().optional(),
    answer_text: tool.schema.string().optional(),
    source: tool.schema.string().default("chief"),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const dir = path.join(root, ".opencode", "state", "clarifications")
    await fs.mkdir(dir, { recursive: true })
    const key = safeId(args.goal_id || args.task_id || "session")
    const file = path.join(dir, `${key}.json`)

    if (args.action === "ask") {
      const items = (args.questions || []).filter(Boolean)
      if (items.length === 0) {
        return {
          output: JSON.stringify({ status: "BLOCK", error: "questions es obligatorio para ask." }, null, 2),
          metadata: { success: false },
        }
      }
      const payload = {
        clarification_id: crypto.randomBytes(6).toString("hex"),
        task_id: args.task_id || null,
        goal_id: args.goal_id || null,
        status: "WAITING_CLARIFICATION",
        questions: items.slice(0, 3),
        context: (args.context || "").trim(),
        source: args.source,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        end_turn: true,
        rules: [
          "No delegar implementacion ni tick de goal hasta resolve.",
          "Terminar el turno tras formular las preguntas.",
          "Maximo 3 preguntas concretas con opciones si aplica.",
        ],
      }
      await writeJson(file, payload)
      if (args.goal_id) await pauseGoal(root, args.goal_id, items.join(" | "))
      return {
        output: JSON.stringify(payload, null, 2),
        metadata: { success: true, ...payload },
      }
    }

    const existing = await readJson(file)
    if (!existing) {
      return {
        output: JSON.stringify({ status: "PASS", waiting: false, reason: "no_open_clarification" }, null, 2),
        metadata: { success: true, waiting: false },
      }
    }

    if (args.action === "resolve") {
      const answer = (args.answer_text || "").trim()
      if (!answer) {
        return {
          output: JSON.stringify({ status: "BLOCK", error: "answer_text obligatorio para resolve." }, null, 2),
          metadata: { success: false },
        }
      }
      const payload = {
        ...existing,
        status: "RESOLVED",
        answer_text: answer,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        can_continue: true,
      }
      await writeJson(file, payload)
      if (existing.goal_id) await resumeGoal(root, existing.goal_id)
      return {
        output: JSON.stringify(payload, null, 2),
        metadata: { success: true, ...payload },
      }
    }

    const waiting = existing.status === "WAITING_CLARIFICATION"
    return {
      output: JSON.stringify({ ...existing, waiting, can_continue: !waiting }, null, 2),
      metadata: { success: !waiting, waiting, ...existing },
    }
  },
})

async function pauseGoal(root: string, goalId: string, reason: string) {
  const file = path.join(root, ".opencode", "state", "goals", `${goalId}.json`)
  const goal = await readJson(file)
  if (!goal) return
  goal.status = "paused"
  goal.last_error = reason
  goal.next_action = "Pausado: esperando respuesta de Javier via clarification-gate."
  goal.updated_at = new Date().toISOString()
  await writeJson(file, goal)
}

async function resumeGoal(root: string, goalId: string) {
  const file = path.join(root, ".opencode", "state", "goals", `${goalId}.json`)
  const goal = await readJson(file)
  if (!goal || goal.status !== "paused") return
  goal.status = "active"
  goal.last_error = undefined
  goal.updated_at = new Date().toISOString()
  await writeJson(file, goal)
}

async function readJson(file: string) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return null
  }
}

async function writeJson(file: string, data: unknown) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8")
  await fs.rename(tmp, file)
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120)
}
