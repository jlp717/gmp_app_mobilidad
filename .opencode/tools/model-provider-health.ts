import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import {
  cursorComposerAvailable,
  loadFallbackConfig,
  pickFallback,
  resolveAgentPolicy,
  syncHealthFromRecentTraces,
  writeRoutingStatus,
} from "../lib/provider-health-store.ts"

type ProviderHealth = {
  updated_at: string
  unavailable: Record<
    string,
    {
      reason: string
      since: string
      until: string
      last_error?: string
      source_session?: string
    }
  >
}

type AgentPolicy = { primary: string; fallback?: string[] }

async function pickEffectiveModel(
  policy: AgentPolicy,
  health: ProviderHealth,
  preferComposer: boolean,
  root: string,
) {
  const composerAvailable = await cursorComposerAvailable(root)
  return pickFallback(policy, health, preferComposer, composerAvailable)
}


export default tool({
  description:
    "Muestra salud de proveedores/modelos para fallback: cuota, rate limit y modelo efectivo por agente.",
  args: {
    agent: tool.schema.string().optional(),
    clear: tool.schema.boolean().default(false),
    mark_openai_quota: tool.schema
      .boolean()
      .default(false)
      .describe("Marca OpenAI como no disponible 45 min (sesiones nuevas usaran Composer 2.5). No toca sesiones en curso."),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const healthPath = path.join(root, ".opencode/state/provider-health.json")

    if (args.clear) {
      const cleared = { updated_at: new Date().toISOString(), unavailable: {} }
      await fs.writeFile(healthPath, JSON.stringify(cleared, null, 2), "utf8")
      await writeRoutingStatus(root, cleared)
      return {
        output: "provider-health cleared",
        metadata: { success: true, cleared: true },
      }
    }

    if (args.mark_openai_quota) {
      const composerAvailable = await cursorComposerAvailable(root)
      const fallback = await loadFallbackConfig(root)
      const ttlMinutes = Number(fallback?.gmpPolicy?.providerHealthTtlMinutes || 45)
      const until = new Date(Date.now() + ttlMinutes * 60_000).toISOString()
      const block = {
        reason: "quota_or_billing",
        since: new Date().toISOString(),
        until,
        last_error: "manual_mark_openai_quota_exhausted",
        source_session: "manual",
      }
      const unavailable: ProviderHealth["unavailable"] = {
        openai: block,
            "openai/gpt-5.6-sol": block,
            "openai/gpt-5.6-terra": block,
            "openai/gpt-5.6-luna": block,
        "openai/gpt-5.4": block,
      }
      const health = { updated_at: new Date().toISOString(), unavailable }
      await fs.mkdir(path.dirname(healthPath), { recursive: true })
      await fs.writeFile(healthPath, JSON.stringify(health, null, 2), "utf8")
      await writeRoutingStatus(root, health)
      return {
        output: JSON.stringify(
          {
            success: true,
            marked: "openai",
            until,
            next_model: composerAvailable ? "cursor-acp/composer-2.5" : "openai/gpt-5.6-terra",
            note: composerAvailable
              ? "Sesiones en curso no cambian. Sesiones nuevas y subagentes Task usaran Composer."
              : "Sesiones en curso no cambian. Composer no autentificado, se mantiene OpenAI.",
          },
          null,
          2,
        ),
        metadata: { success: true, marked: true, until },
      }
    }

    const fallback = await loadFallbackConfig(root)
    const health = (await syncHealthFromRecentTraces(
      root,
      Number(fallback?.gmpPolicy?.providerHealthTtlMinutes || 45),
    )) as ProviderHealth
    const now = Date.now()

    const activeBlocks = Object.entries(health.unavailable || {}).filter(
      ([, v]) => new Date(v.until).getTime() > now,
    )

    let effectiveModel: string | null = null
    const preferComposer = fallback?.gmpPolicy?.preferComposerOnOpenAIQuota !== false
    if (args.agent) {
      const policy = resolveAgentPolicy(fallback, args.agent)
      effectiveModel = await pickEffectiveModel(policy, health, preferComposer, root)
    } else if (activeBlocks.some(([k]) => k === "openai" || k.startsWith("openai/"))) {
      const composerAvailable = await cursorComposerAvailable(root)
      effectiveModel = composerAvailable ? "cursor-acp/composer-2.5" : "openai/gpt-5.6-terra"
    }

    const payload = {
      status: activeBlocks.length ? "DEGRADED" : "OK",
      updated_at: health.updated_at,
      active_blocks: activeBlocks.map(([key, v]) => ({
        key,
        reason: v.reason,
        until: v.until,
        last_error: v.last_error,
      })),
      agent: args.agent || null,
      effective_model: effectiveModel,
      policy: args.agent ? resolveAgentPolicy(fallback, args.agent) : null,
      gmp_policy: fallback?.gmpPolicy || null,
      commands: {
        mark_quota: "model-provider-health mark_openai_quota=true",
        clear: "model-provider-health clear=true",
        flow: "flow-status limit=15",
        trace: "flow-trace mode=summary",
      },
      routing_status_file: ".opencode/state/routing-status.json",
      hint:
        activeBlocks.length > 0
          ? "OpenAI bloqueado temporalmente. Abre sesion nueva: el equipo usara cursor-acp/composer-2.5 automaticamente. Las conversaciones en curso no cambian."
           : "Sin bloqueos activos. GPT-5.6 Sol sigue siendo primario.",
      summary_es:
        activeBlocks.length > 0
          ? `OpenAI bloqueado hasta ${activeBlocks[0]?.[1]?.until || "?"}. Sesiones nuevas -> ${
               effectiveModel || "openai/gpt-5.6-terra"
            }.`
           : "Sin bloqueos. Primario: GPT-5.6 Sol.",
    }

    await writeRoutingStatus(root, health, {
      effective_model: effectiveModel,
      agent: args.agent || null,
    })

    return {
      output: JSON.stringify(payload, null, 2),
      metadata: { success: true, ...payload },
    }
  },
})
