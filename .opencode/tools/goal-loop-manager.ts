import { tool } from "@opencode-ai/plugin"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

type Criterion = {
  id: string
  text: string
  status: "pending" | "done" | "failed" | "skipped"
  evidence: string
  verified_at?: string
}

type Iteration = {
  n: number
  ts: string
  summary: string
  evidence: string[]
  checklist_delta: Record<string, string>
  blockers: string[]
}

type Goal = {
  goal_id: string
  task_id?: string
  objective: string
  acceptance_criteria: Criterion[]
  completion_promise: string
  max_iterations: number
  iteration: number
  loop_mode: "ralph" | "checklist" | "recurring"
  interval?: string | null
  status: "active" | "paused" | "done" | "cancelled" | "blocked" | "max_iterations"
  iterations: Iteration[]
  created_at: string
  updated_at: string
  next_action: string
  session_id?: string
  last_error?: string
}

function response(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

async function readJson(file: string) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return null
  }
}

async function writeJson(file: string, data: unknown) {
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

async function appendJsonl(file: string, data: Record<string, unknown>) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, `${JSON.stringify(data)}\n`, "utf8")
}

function goalsDir(root: string) {
  return path.join(root, ".opencode", "state", "goals")
}

function goalFile(root: string, goalId: string) {
  return path.join(goalsDir(root), `${goalId}.json`)
}

function makeGoalId() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)
  const suffix = crypto.randomBytes(2).toString("hex")
  return `${stamp}-goal-${suffix}`
}

function makeCriterionId(index: number) {
  return `ac${index + 1}`
}

function parseCriteria(raw: string[] | undefined, fallbackObjective: string): Criterion[] {
  const items = (raw || []).filter(Boolean)
  if (items.length === 0) {
    return [
      {
        id: "ac1",
        text: `Objetivo completado con evidencia verificable: ${fallbackObjective.slice(0, 200)}`,
        status: "pending",
        evidence: "",
      },
    ]
  }
  return items.map((text, index) => ({
    id: makeCriterionId(index),
    text,
    status: "pending" as const,
    evidence: "",
  }))
}

function pendingCriteria(goal: Goal) {
  return goal.acceptance_criteria.filter((item) => item.status === "pending")
}

function doneCriteria(goal: Goal) {
  return goal.acceptance_criteria.filter((item) => item.status === "done")
}

function buildNextAction(goal: Goal) {
  const pending = pendingCriteria(goal)
  if (goal.status !== "active") return goal.next_action
  if (pending.length === 0) {
    return `Verificar criterios y emitir completion_promise "${goal.completion_promise}" si la evidencia es solida.`
  }
  const checklist = pending.map((item) => `- [ ] ${item.id}: ${item.text}`).join("\n")
  return [
    `Iteracion ${goal.iteration + 1}/${goal.max_iterations} del objetivo.`,
    `Objetivo: ${goal.objective}`,
    `Checklist pendiente:\n${checklist}`,
    `Antes de codigo: skill ponytail (YAGNI, reuse, stdlib, menor diff).`,
    `Al cerrar la iteracion: goal-loop-manager operation=tick con summary, evidence y checklist_updates.`,
    `Si todo esta verificado: operation=complete con completion_promise "${goal.completion_promise}".`,
    `Modo: ${goal.loop_mode}. No declares DONE sin evidencia ni sin cumplir gates V4 (plan, QA, produccion).`,
  ].join("\n\n")
}

function resumePrompt(goal: Goal) {
  const last = goal.iterations.at(-1)
  return {
    goal_id: goal.goal_id,
    status: goal.status,
    iteration: goal.iteration,
    max_iterations: goal.max_iterations,
    loop_mode: goal.loop_mode,
    objective: goal.objective,
    completion_promise: goal.completion_promise,
    pending_criteria: pendingCriteria(goal),
    done_criteria: doneCriteria(goal),
    last_iteration: last || null,
    next_action: buildNextAction(goal),
    should_continue:
      goal.status === "active" &&
      goal.iteration < goal.max_iterations &&
      pendingCriteria(goal).length > 0,
    stop_reason:
      goal.status === "paused"
        ? "waiting_clarification"
        : goal.status !== "active"
          ? goal.status
          : goal.iteration >= goal.max_iterations
            ? "max_iterations"
            : pendingCriteria(goal).length === 0
              ? "all_criteria_done"
              : null,
  }
}

async function loadConfig(root: string) {
  const project = await readJson(path.join(root, ".opencode", "config", "goal-loops.yaml"))
  const home = process.env.USERPROFILE || process.env.HOME || ""
  const globalDefaults = home
    ? await readJson(path.join(home, ".config", "opencode", "goal-loops-defaults.yaml"))
    : null
  return {
    max_iterations_default:
      project?.goal_loops?.defaults?.max_iterations ??
      globalDefaults?.goal_loops?.defaults?.max_iterations ??
      20,
    max_iterations_hard_cap:
      project?.goal_loops?.safety?.max_iterations_hard_cap ??
      globalDefaults?.goal_loops?.safety?.max_iterations_hard_cap ??
      50,
    completion_promise_default:
      project?.goal_loops?.defaults?.completion_promise ??
      globalDefaults?.goal_loops?.defaults?.completion_promise ??
      "GOAL_DONE",
    respect_v4_gates: project?.goal_loops?.integration?.respect_v4_gates ?? true,
    persist_trace: project?.goal_loops?.integration?.persist_team_trace ?? true,
  }
}

export default tool({
  description:
    "Gestiona loops orientados a objetivo (estilo Claude /goal + /loop + Ralph): checklist persistente, iteraciones hasta completion_promise o max_iterations, y modo recurrente.",
  args: {
    operation: tool.schema.enum([
      "create",
      "tick",
      "verify",
      "resume",
      "status",
      "complete",
      "cancel",
      "list",
      "pause",
    ]),
    goal_id: tool.schema.string().optional(),
    objective: tool.schema.string().optional(),
    acceptance_criteria: tool.schema.array(tool.schema.string()).optional(),
    completion_promise: tool.schema.string().optional(),
    max_iterations: tool.schema.number().int().min(1).max(100).optional(),
    loop_mode: tool.schema.enum(["ralph", "checklist", "recurring"]).optional(),
    interval: tool.schema.string().optional(),
    task_id: tool.schema.string().optional(),
    session_id: tool.schema.string().optional(),
    iteration_summary: tool.schema.string().optional(),
    evidence: tool.schema.array(tool.schema.string()).optional(),
    checklist_updates: tool.schema
      .array(
        tool.schema.object({
          id: tool.schema.string(),
          status: tool.schema.enum(["pending", "done", "failed", "skipped"]),
          evidence: tool.schema.string().optional(),
        }),
      )
      .optional(),
    blockers: tool.schema.array(tool.schema.string()).optional(),
    completion_output: tool.schema.string().optional(),
    reason: tool.schema.string().optional(),
    pause_reason: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const cfg = await loadConfig(root)
    const dir = goalsDir(root)

    if (args.operation === "list") {
      await fs.mkdir(dir, { recursive: true })
      const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json"))
      const goals = []
      for (const file of files) {
        const goal = (await readJson(path.join(dir, file))) as Goal | null
        if (!goal) continue
        goals.push({
          goal_id: goal.goal_id,
          status: goal.status,
          objective: goal.objective.slice(0, 120),
          iteration: goal.iteration,
          max_iterations: goal.max_iterations,
          pending: pendingCriteria(goal).length,
          loop_mode: goal.loop_mode,
          updated_at: goal.updated_at,
        })
      }
      goals.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      return response({ status: "PASS", goals })
    }

    if (args.operation === "create") {
      if (!args.objective?.trim()) {
        return response({ status: "BLOCK", error: "objective es obligatorio para create." })
      }
      const maxIterations = Math.min(
        args.max_iterations || cfg.max_iterations_default,
        cfg.max_iterations_hard_cap,
      )
      const goal: Goal = {
        goal_id: makeGoalId(),
        task_id: args.task_id,
        objective: args.objective.trim(),
        acceptance_criteria: parseCriteria(args.acceptance_criteria, args.objective.trim()),
        completion_promise: (args.completion_promise || cfg.completion_promise_default).trim(),
        max_iterations: maxIterations,
        iteration: 0,
        loop_mode: args.loop_mode || "ralph",
        interval: args.interval || null,
        status: "active",
        iterations: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        next_action: "",
        session_id: args.session_id,
      }
      goal.next_action = buildNextAction(goal)
      await writeJson(goalFile(root, goal.goal_id), goal)
      if (cfg.persist_trace) {
        await appendJsonl(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), {
          ts: new Date().toISOString(),
          event: "goal_loop_created",
          goal_id: goal.goal_id,
          loop_mode: goal.loop_mode,
          max_iterations: goal.max_iterations,
          criteria_count: goal.acceptance_criteria.length,
        })
      }
      return response({
        status: "PASS",
        goal_id: goal.goal_id,
        loop_mode: goal.loop_mode,
        max_iterations: goal.max_iterations,
        acceptance_criteria: goal.acceptance_criteria,
        completion_promise: goal.completion_promise,
        next_action: goal.next_action,
        rules: [
          "Itera con operation=tick al cerrar cada paso.",
          "Usa operation=resume para recuperar el prompt de la siguiente iteracion.",
          "No declares complete sin evidencia verificable.",
          cfg.respect_v4_gates
            ? "Los gates V4 (plan, QA, AppSec, produccion) siguen obligatorios."
            : "Gates V4 desactivados en config (no recomendado).",
        ],
      })
    }

    if (!args.goal_id) {
      return response({ status: "BLOCK", error: "goal_id es obligatorio para esta operacion." })
    }

    const file = goalFile(root, args.goal_id)
    const goal = (await readJson(file)) as Goal | null
    if (!goal) {
      return response({ status: "BLOCK", error: `goal no encontrado: ${args.goal_id}` })
    }

    if (args.operation === "status") {
      return response({ status: "PASS", goal, resume: resumePrompt(goal) })
    }

    if (args.operation === "resume") {
      return response({ status: "PASS", ...resumePrompt(goal) })
    }

    if (args.operation === "verify") {
      const pending = pendingCriteria(goal)
      const done = doneCriteria(goal)
      const ready =
        pending.length === 0 &&
        done.length > 0 &&
        !done.some((item) => item.status === "failed")
      return response({
        status: ready ? "PASS" : "WARN",
        goal_id: goal.goal_id,
        ready_to_complete: ready,
        pending_criteria: pending,
        done_criteria: done,
        iteration: goal.iteration,
        max_iterations: goal.max_iterations,
        recommendation: ready
          ? `Emitir completion_promise "${goal.completion_promise}" y operation=complete.`
          : "Seguir iterando con operation=tick hasta cubrir criterios pendientes.",
      })
    }

    if (args.operation === "cancel") {
      goal.status = "cancelled"
      goal.last_error = args.reason || "cancelled_by_user"
      goal.updated_at = new Date().toISOString()
      goal.next_action = "Loop cancelado."
      await writeJson(file, goal)
      return response({ status: "PASS", goal_id: goal.goal_id, status_goal: goal.status })
    }

    if (args.operation === "pause") {
      if (!args.pause_reason?.trim()) {
        return response({ status: "BLOCK", error: "pause_reason es obligatorio para pause." })
      }
      goal.status = "paused"
      goal.last_error = args.pause_reason.trim()
      goal.next_action = "Pausado: esperando respuesta o aprobacion de Javier. Usar clarification-gate o resume tras resolver."
      goal.updated_at = new Date().toISOString()
      await writeJson(file, goal)
      return response({
        status: "PASS",
        goal_id: goal.goal_id,
        status_goal: "paused",
        pause_reason: goal.last_error,
        end_turn: true,
        rules: ["No hacer tick ni delegar implementacion hasta que Javier responda o apruebe."],
      })
    }

    if (args.operation === "complete") {
      const verify = pendingCriteria(goal)
      if (verify.length > 0) {
        return response({
          status: "BLOCK",
          error: "Aun hay criterios pendientes.",
          pending_criteria: verify,
        })
      }
      const promise = (args.completion_output || "").trim()
      if (promise && promise !== goal.completion_promise) {
        return response({
          status: "BLOCK",
          error: `completion_output debe ser exactamente "${goal.completion_promise}".`,
          received: promise,
        })
      }
      goal.status = "done"
      goal.updated_at = new Date().toISOString()
      goal.next_action = "Objetivo completado."
      await writeJson(file, goal)
      if (cfg.persist_trace) {
        await appendJsonl(path.join(root, ".opencode", "TEAM_TRACE.jsonl"), {
          ts: new Date().toISOString(),
          event: "goal_loop_completed",
          goal_id: goal.goal_id,
          iterations: goal.iteration,
          criteria_done: doneCriteria(goal).length,
        })
      }
      return response({
        status: "PASS",
        goal_id: goal.goal_id,
        status_goal: "done",
        iterations: goal.iteration,
        completion_promise: goal.completion_promise,
      })
    }

    if (args.operation === "tick") {
      if (goal.status === "paused") {
        return response({
          status: "BLOCK",
          error: "goal pausado; esperando respuesta de Javier.",
          goal_id: goal.goal_id,
          pause_reason: goal.last_error,
          end_turn: true,
        })
      }
      if (goal.status !== "active") {
        return response({
          status: "BLOCK",
          error: `goal no activo (${goal.status}).`,
          goal_id: goal.goal_id,
        })
      }
      if (goal.iteration >= goal.max_iterations) {
        goal.status = "max_iterations"
        goal.updated_at = new Date().toISOString()
        goal.last_error = "CRITICAL_ERROR:max_iterations"
        await writeJson(file, goal)
        return response({
          status: "BLOCK",
          code: "CRITICAL_ERROR",
          error: "CRITICAL_ERROR: max_iterations alcanzado (no silent hang).",
          goal_id: goal.goal_id,
          goal_status: "max_iterations",
          should_continue: false,
          pending_criteria: pendingCriteria(goal),
        })
      }

      const updates = args.checklist_updates || []
      for (const update of updates) {
        const criterion = goal.acceptance_criteria.find((item) => item.id === update.id)
        if (!criterion) continue
        criterion.status = update.status
        if (update.evidence) criterion.evidence = update.evidence
        if (update.status === "done") criterion.verified_at = new Date().toISOString()
      }

      goal.iteration += 1
      const iteration: Iteration = {
        n: goal.iteration,
        ts: new Date().toISOString(),
        summary: (args.iteration_summary || "").trim() || `Iteracion ${goal.iteration}`,
        evidence: args.evidence || [],
        checklist_delta: Object.fromEntries(updates.map((item) => [item.id, item.status])),
        blockers: args.blockers || [],
      }
      goal.iterations.push(iteration)

      if ((args.blockers || []).length > 0) {
        goal.status = "blocked"
        goal.last_error = args.blockers?.join("; ")
        goal.next_action = `Resolver bloqueos: ${goal.last_error}`
      } else if (pendingCriteria(goal).length === 0) {
        goal.next_action = `Criterios cubiertos. Verificar evidencia y operation=complete con "${goal.completion_promise}".`
      } else if (goal.iteration >= goal.max_iterations) {
        goal.status = "max_iterations"
        goal.last_error = "CRITICAL_ERROR:max_iterations"
        goal.next_action = "CRITICAL_ERROR: limite de iteraciones alcanzado; no reintentar en silencio."
      } else {
        goal.next_action = buildNextAction(goal)
      }

      goal.updated_at = new Date().toISOString()
      await writeJson(file, goal)

      const resume = resumePrompt(goal)
      return response({
        status: goal.status === "blocked" ? "WARN" : "PASS",
        goal_id: goal.goal_id,
        iteration: goal.iteration,
        goal_status: goal.status,
        pending_criteria: pendingCriteria(goal),
        done_criteria: doneCriteria(goal),
        should_continue: resume.should_continue,
        next_action: goal.next_action,
        resume,
      })
    }

    return response({ status: "BLOCK", error: `operacion no soportada: ${args.operation}` })
  },
})
