import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import techRadar from "./tech-radar-fetch.ts"
import { loadFallbackConfig } from "../lib/provider-health-store.ts"

type Action = {
  priority: "P0" | "P1" | "P2"
  area: string
  title: string
  evidence: string
  next_step: string
}

export default tool({
  description:
    "Loop de mejora continua del equipo: readiness, fallback, errores repetidos, radar externo y acciones priorizadas sin auto-instalar nada.",
  args: {
    include_radar: tool.schema.boolean().default(true),
    max_actions: tool.schema.number().int().min(1).max(20).default(8),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const stateDir = path.join(root, ".opencode", "state")
    const actions: Action[] = []
    const [readiness, routing, providerHealth, fallback, flowLatest, sameErrors] = await Promise.all([
      readJson(path.join(stateDir, "readiness-latest.json"), null),
      readJson(path.join(stateDir, "routing-status.json"), null),
      readJson(path.join(stateDir, "provider-health.json"), { unavailable: {} }),
      loadFallbackConfig(root),
      readJson(path.join(stateDir, "flow-trace-latest.json"), { steps: [] }),
      readJsonl(path.join(root, ".opencode", "memory", "same-error-tracker.jsonl"), 20),
    ])

    if (readiness?.status !== "PASS") {
      actions.push({
        priority: "P0",
        area: "readiness",
        title: "Readiness no esta en PASS",
        evidence: `status=${readiness?.status || "missing"} score=${readiness?.score || 0}`,
        next_step: "Ejecutar /rescue y corregir MCP/provider/tool bloqueante antes de Tier 2/3.",
      })
    }

    if (!fallback?.enabled) {
      actions.push({
        priority: "P0",
        area: "fallback",
        title: "Fallback de modelos deshabilitado",
        evidence: ".opencode/fallback-models.json enabled=false o missing",
        next_step: "Restaurar fallback-models antes de trabajar desde movil.",
      })
    }

    const activeBlocks = activeProviderBlocks(providerHealth)
    if (activeBlocks.length > 0) {
      actions.push({
        priority: "P1",
        area: "providers",
        title: "Proveedor degradado con fallback activo",
        evidence: activeBlocks.map((b: any) => `${b.key}:${b.reason} hasta ${b.until}`).join("; "),
        next_step: "Usar /autopilot para ruta efectiva; si OpenAI vuelve, /models clear=true.",
      })
    }

    if (sameErrors.length > 0) {
      actions.push({
        priority: "P1",
        area: "learning",
        title: "Hay errores repetidos pendientes",
        evidence: `${sameErrors.length} entradas recientes en same-error tracker`,
        next_step: "Ejecutar /retro sobre el error repetido antes de aceptar mas parches similares.",
      })
    }

    const recentFailures = (flowLatest?.steps || []).filter((step: any) =>
      /block|fail|error|warn/i.test(String(step.status || step.summary || step.message || "")),
    )
    if (recentFailures.length > 0) {
      actions.push({
        priority: "P1",
        area: "flow",
        title: "Flujo reciente tiene warnings/bloqueos",
        evidence: recentFailures.slice(-3).map((s: any) => String(s.summary || s.message || s.status).slice(0, 120)).join(" | "),
        next_step: "Ejecutar /trace y resolver el primer bloqueo antes de producir.",
      })
    }

    let radarItems: any[] = []
    let radarErrors: string[] = []
    if (args.include_radar) {
      try {
        const radar = await techRadar.execute({
          sources: ["github_recent", "mcp_registry", "awesome_copilot"],
          max_items_per_source: 4,
        } as any, { worktree: root } as any)
        const parsed = JSON.parse(radar.output)
        radarItems = (parsed.items || []).filter((item: any) => String(item.action || "").startsWith("EVALUAR")).slice(0, 5)
        radarErrors = parsed.errors || []
      } catch (error) {
        radarErrors = [error instanceof Error ? error.message : String(error)]
      }
      for (const item of radarItems.slice(0, 3)) {
        actions.push({
          priority: "P2",
          area: "tech-radar",
          title: `Evaluar candidato externo: ${item.title}`,
          evidence: `${item.url} score=${item.score}`,
          next_step: "Pasar por /repo-check antes de sandbox. No instalar automaticamente.",
        })
      }
    }

    const ordered = actions.sort((a, b) => rank(a.priority) - rank(b.priority)).slice(0, args.max_actions)
    const report = {
      status: ordered.some((a) => a.priority === "P0") ? "BLOCK" : ordered.length ? "WARN" : "PASS",
      generated_at: new Date().toISOString(),
      summary: ordered.length
        ? `${ordered.length} acciones: ${ordered.filter((a) => a.priority === "P0").length} P0, ${ordered.filter((a) => a.priority === "P1").length} P1, ${ordered.filter((a) => a.priority === "P2").length} P2.`
        : "Sin acciones pendientes.",
      readiness: readiness ? { status: readiness.status, score: readiness.score } : null,
      routing: routing ? { status: routing.status, effective_default: routing.effective_default } : null,
      actions: ordered,
      radar: {
        evaluated_candidates: radarItems.length,
        errors: radarErrors,
      },
      rules: [
        "No instala repos externos.",
        "No toca produccion.",
        "Cualquier MCP/plugin/skill externo requiere /repo-check y prueba en sandbox.",
      ],
    }
    await fs.mkdir(path.join(root, ".opencode", "reports"), { recursive: true })
    await fs.writeFile(path.join(root, ".opencode", "reports", "continuous-improvement-latest.json"), JSON.stringify(report, null, 2), "utf8")
    return { output: JSON.stringify(report, null, 2), metadata: { success: report.status !== "BLOCK", ...report } }
  },
})

function activeProviderBlocks(health: any) {
  const now = Date.now()
  return Object.entries(health?.unavailable || {})
    .filter(([, value]: [string, any]) => new Date(value.until).getTime() > now)
    .map(([key, value]: [string, any]) => ({ key, ...value }))
}

async function readJson(file: string, fallback: any) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

async function readJsonl(file: string, limit: number) {
  try {
    const raw = await fs.readFile(file, "utf8")
    return raw.trim().split(/\r?\n/).filter(Boolean).slice(-limit).map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return { raw: line.slice(0, 200) }
      }
    })
  } catch {
    return []
  }
}

function rank(priority: Action["priority"]) {
  return priority === "P0" ? 0 : priority === "P1" ? 1 : 2
}
