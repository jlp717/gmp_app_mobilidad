import fs from "node:fs/promises"
import path from "node:path"

async function readJson(file: string) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return null
  }
}

export default async function GoalLoopIdleHintPlugin() {
  return {
    event: async (input: any) => {
      const type = String(input?.event?.type || "")
      if (type !== "session.idle" && type !== "session.status") return
      const statusType = input?.event?.properties?.status?.type || input?.event?.properties?.status
      if (type === "session.status" && statusType !== "idle") return

      const root = process.cwd()
      const goalsDir = path.join(root, ".opencode", "state", "goals")
      const files = (await fs.readdir(goalsDir).catch(() => [])).filter((f) => f.endsWith(".json"))
      let active: any = null
      for (const file of files) {
        const goal = await readJson(path.join(goalsDir, file))
        if (goal?.status === "active") {
          if (!active || String(goal.updated_at) > String(active.updated_at)) active = goal
        }
      }
      if (!active) return

      const hint = {
        ts: new Date().toISOString(),
        goal_id: active.goal_id,
        objective: active.objective?.slice(0, 200),
        iteration: active.iteration,
        max_iterations: active.max_iterations,
        loop_mode: active.loop_mode,
        next_action: active.next_action,
        chief_instruction:
          "Si Javier envia un mensaje nuevo, lee chief-protocol.yaml: reanuda goal con goal-loop-manager resume antes de tratarlo como tarea nueva. No auto-continuar sin mensaje de Javier salvo loop recurring con intervalo vencido y peticion previa 'sin preguntarme'.",
      }
      await fs.mkdir(path.join(root, ".opencode", "state"), { recursive: true })
      await fs.writeFile(path.join(root, ".opencode", "state", "goal-continuation-hint.json"), JSON.stringify(hint, null, 2), "utf8")
    },
  }
}
