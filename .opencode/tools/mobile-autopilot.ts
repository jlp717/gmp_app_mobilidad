import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import {
  cursorComposerAvailable,
  loadFallbackConfig,
  markProviderUnavailable,
  resolveAgentPolicy,
  resolveEffectiveModel,
  syncHealthFromRecentTraces,
  writeRoutingStatus,
} from "../lib/provider-health-store.ts"

const KEY_AGENTS = [
  "chief-engineer-assistant",
  "Architect-Planner",
  "sre-engineer",
  "appsec-engineer",
  "qa-automation-lead",
  "Node-Express-Specialist",
  "Flutter-Data-Specialist",
  "Flutter-UI-Specialist",
  "tech-radar-agent",
  "team-curator",
]

export default tool({
  description:
    "Autopilot operativo para movil: comprueba Web/Cursor/readiness/modelos, prepara failover y devuelve la ruta segura de reintento.",
  args: {
    mode: tool.schema.enum(["status", "prepare", "mark-openai-down", "clear-provider-blocks", "drill"]).default("status"),
    reason: tool.schema.string().optional(),
    startup_phase: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const healthPath = path.join(root, ".opencode", "state", "provider-health.json")
    const fallback = await loadFallbackConfig(root)
    const ttlMinutes = Number(fallback?.gmpPolicy?.providerHealthTtlMinutes || 45)

    if (args.mode === "clear-provider-blocks") {
      const health = { updated_at: new Date().toISOString(), unavailable: {} }
      await writeJson(healthPath, health)
      await writeRoutingStatus(root, health as any)
    }

    if (args.mode === "mark-openai-down") {
      await markProviderUnavailable(
        root,
        "openai/gpt-5.6-sol",
        "manual_mobile_failover",
        args.reason || "Javier/mobile requested OpenAI failover",
        "mobile-autopilot",
        ttlMinutes,
      )
    }

    const [web, cursorHttp, readiness, health] = await Promise.all([
      webStatus(root),
      httpStatus("http://127.0.0.1:32124/v1/models"),
      readJson(path.join(root, ".opencode", "state", "readiness-latest.json"), null),
      syncHealthFromRecentTraces(root, ttlMinutes),
    ])
    const composerAvailable = await cursorComposerAvailable(root)
    const now = Date.now()
    const activeBlocks = Object.entries(health.unavailable || {}).filter(
      ([, value]: [string, any]) => new Date(value.until).getTime() > now,
    )
    const openaiBlocked = activeBlocks.some(([key]) => key === "openai" || key.startsWith("openai/"))
    const routes = await Promise.all(
      KEY_AGENTS.map(async (agent) => {
        const policy = resolveAgentPolicy(fallback, agent)
        const effective = await resolveEffectiveModel(fallback, health as any, agent, root)
        return {
          agent,
          primary: policy.primary,
          effective,
          fallback_active: effective !== policy.primary,
          fallback_chain: policy.fallback || [],
        }
      }),
    )
    await writeRoutingStatus(root, health as any, {
      mobile_autopilot: {
        mode: args.mode,
        composer_available: composerAvailable,
        openai_blocked: openaiBlocked,
        last_checked_at: new Date().toISOString(),
      },
    })

    const blockers: string[] = []
    let startupNote = ""
    if (!web.ok && !args.startup_phase) blockers.push(`OpenCode Web no listo: ${web.status}`)
    if (!web.ok && args.startup_phase) startupNote = "Web aun arrancando; post-web-startup verificara."
    if (!cursorHttp.ok && openaiBlocked && !args.startup_phase) blockers.push(`Cursor ACP no responde y OpenAI esta bloqueado: ${cursorHttp.status}`)
    if (readiness?.status === "BLOCK") blockers.push(`readiness BLOCK score=${readiness.score}`)
    if (!fallback?.enabled) blockers.push("fallback-models.json deshabilitado")

    const payload = {
      status: blockers.length ? "BLOCK" : openaiBlocked ? "DEGRADED_READY" : "READY",
      mode: args.mode,
      generated_at: new Date().toISOString(),
      mobile_summary: [
        ...(startupNote ? [startupNote] : []),
        `Web: ${web.ok ? "OK" : "FALLO"} (${web.status})`,
        `Cursor ACP: ${cursorHttp.ok ? "OK" : "FALLO"} (${cursorHttp.status})`,
        `Readiness: ${readiness?.status || "sin dato"}${readiness?.score ? ` score=${readiness.score}` : ""}`,
        `OpenAI bloqueado: ${openaiBlocked ? "SI" : "NO"}`,
        `Composer disponible: ${composerAvailable ? "SI" : "NO"}`,
        openaiBlocked && composerAvailable
          ? "Accion: reintenta en sesion nueva o delega subagentes; usaran Composer/fallback."
          : "Accion: GPT-5.6 Sol sigue primario; fallback preparado.",
      ],
      provider_blocks: activeBlocks.map(([key, value]: [string, any]) => ({
        key,
        reason: value.reason,
        until: value.until,
        last_error: value.last_error,
      })),
      routes,
      blockers,
      safe_commands: {
        status: "/autopilot",
        force_failover: "/failover openai",
        clear_failover: "/models clear=true",
        rescue: "/rescue",
        readiness: "/readiness",
      },
      policy: {
        no_production_mutation: true,
        no_external_install: true,
        production_still_requires_gates: true,
      },
    }
    return { output: JSON.stringify(payload, null, 2), metadata: { success: blockers.length === 0, ...payload } }
  },
})

async function webStatus(root: string) {
  const headers = await webAuthHeaders(root)
  return httpStatus("http://127.0.0.1:3090", headers)
}

async function webAuthHeaders(root: string) {
  try {
    const pw = (await fs.readFile(path.join(root, ".opencode-runtime", "opencode-web-gmp.credentials"), "utf8")).trim()
    return { Authorization: `Basic ${Buffer.from(`Javier:${pw}`, "ascii").toString("base64")}` }
  } catch {
    return {}
  }
}

async function httpStatus(url: string, headers: Record<string, string> = {}) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    return { ok: res.ok, status: res.status }
  } catch (error) {
    return { ok: false, status: String(error).slice(0, 160) }
  }
}

async function readJson(file: string, fallback: any) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8")
}
