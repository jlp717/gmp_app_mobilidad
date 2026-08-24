import path from "node:path"
import {
  appendFlowTrace,
  appendTrace,
  cursorComposerAvailable,
  extractErrorFromEvent,
  isModelUnavailable,
  isOpenAiFamily,
  isTrustedQuotaSignal,
  loadFallbackConfig,
  pickFallback,
  pluginLog,
  readJson,
  recordQuotaFailure,
  resolveAgentPolicy,
  resolveEffectiveModel,
  resolveProjectRoot,
  setPluginRoot,
  splitModelRef,
  syncHealthFromRecentTraces,
  normalizeAgentName,
  modelProvider,
  writeJson,
  writeRoutingStatus,
} from "../lib/provider-health-store.ts"

type SessionBinding = {
  agent: string
  model: string
  locked: boolean
  created_at: string
}

type Difficulty = "medium" | "high"

const CRITICAL_OPENAI_AGENTS = new Set([
  "chief-engineer-assistant",
  "chief-engineer-assitant",
  "GMP-Orchestrator",
  "Architect-Planner",
  "sre-engineer",
  "appsec-engineer",
  "qa-automation-lead",
  "code-autopilot",
  "DB2-AS400-Specialist",
  "DB2-Query-Optimizer",
  "Redis-Cache-Specialist",
  "Runtime-Log-Diagnostician",
  "API-Contract-Specialist",
  "Flutter-Architecture-Specialist",
  "Flutter-Performance-Specialist",
  "Performance-Analyst",
  "Technical-Verifier",
  "Check-Reviewer",
  "truth-teller",
  "team-curator",
  "Security-Validator",
  "DevOps-CICD-Specialist",
])

function modelFromOutput(output: any) {
  const message = output?.message || {}
  const model = message.model || output?.model
  if (model?.providerID && model?.modelID) return String(model.providerID) + '/' + String(model.modelID)
  const variant = String(message.variant || output?.variant || '')
  return variant.includes('/') ? variant : ''
}

function modelIsBlocked(model: string, health: any) {
  if (!model) return true
  const now = Date.now()
  if (isOpenAiFamily(model) && isModelUnavailable(health, 'openai', now)) return true
  return isModelUnavailable(health, model, now) || isModelUnavailable(health, modelProvider(model), now)
}

function compactInputText(value: any, depth = 0): string {
  if (value == null || depth > 4) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map((item) => compactInputText(item, depth + 1)).join(" ")
  if (typeof value === "object") {
    const keys = ["text", "content", "message", "prompt", "description", "body", "input", "args"]
    return keys.map((key) => compactInputText(value[key], depth + 1)).join(" ")
  }
  return ""
}

function inferDifficulty(input: any, agentName: string): Difficulty {
  const text = `${agentName} ${compactInputText(input)}`.toLowerCase()
  const highRisk =
    /\b(tier\s*[23]|t[23]|r[34]|produccion|production|deploy|rollback|db2|as400|seguridad|security|auth|permisos|credenciales|secret|facturas?|pedidos?|cobros?|stock|checkout|arquitectura|architecture|performance|rendimiento|incidente|pm2|ssh|migraci[oó]n|ddl|dml|sre|appsec|qa|regresi[oó]n|rollback|perfecto|sin errores|todo listo)\b/i
  const lowRisk =
    /\b(estado|status|listar|lista|lee|leer|resumen|resume|explica|documenta|docs|radar|investiga|busca|informe|briefing|digest)\b/i

  if (highRisk.test(text)) return "high"
  if (text.length < 900 && lowRisk.test(text)) return "medium"
  if (text.length > 2500) return "high"
  return "high"
}

function applyReasoningEffort(output: any, model: string, effort: Difficulty) {
  if (!isOpenAiFamily(model)) return
  output.message = output.message || {}
  output.message.options = {
    ...(output.message.options || {}),
    reasoningEffort: effort,
  }
}

export default async function ModelFallbackForwardPlugin(ctx?: { directory?: string }) {
  setPluginRoot(ctx?.directory || process.cwd())
  const bootRoot = resolveProjectRoot(undefined, undefined)
  await pluginLog(bootRoot, `plugin_loaded root=${bootRoot}`)
  const bootHealth = await syncHealthFromRecentTraces(bootRoot).catch(() => ({
    updated_at: new Date().toISOString(),
    unavailable: {},
  }))
  await writeRoutingStatus(bootRoot, bootHealth as any).catch(() => undefined)

  const sessionBindings = new Map<string, SessionBinding>()
  const sessionAgentMap = new Map<string, string>()
  const sessionHadAssistant = new Set<string>()
  const quotaFrozenSessions = new Set<string>()

  async function applyRoute(
    root: string,
    agentName: string,
    sessionID: string,
    output: any,
    existing?: SessionBinding,
    routeInput?: any,
  ) {
    const config = await loadFallbackConfig(root)
    if (config.enabled === false) return

    const policy = resolveAgentPolicy(config, agentName)
    const gmp = config.gmpPolicy || {}
    const preferComposer = gmp.preferComposerOnOpenAIQuota !== false
    const health = await syncHealthFromRecentTraces(
      root,
      Number(gmp.providerHealthTtlMinutes || 45),
    )
    const composerAvailable =
      gmp.composerToolFallbackEnabled === true && (await cursorComposerAvailable(root))
    const lockAfterAssistant = gmp.lockAfterFirstAssistantReply !== false

    output.message = output.message || {}

    const manualSelection = modelFromOutput(output)
    const respectManual = gmp.respectManualModelSelection !== false

    const autoFallbackSameSession =
      gmp.autoFallbackSameSession === true || gmp.autoRetryInSession === true

    if (sessionID && quotaFrozenSessions.has(sessionID) && !autoFallbackSameSession) {
      if (existing) output.message.variant = existing.model
      return
    }

    const isEstablishedSession = Boolean(sessionID && sessionHadAssistant.has(sessionID))
    const manualSelectionAllowed =
      respectManual && manualSelection && !modelIsBlocked(manualSelection, health)

    const existingBlocked = existing?.model ? modelIsBlocked(existing.model, health) : false
    const preserveCriticalEstablished =
      gmp.preserveEstablishedCriticalSessions !== false &&
      isEstablishedSession &&
      CRITICAL_OPENAI_AGENTS.has(agentName) &&
      isOpenAiFamily(policy.primary)

    if (preserveCriticalEstablished && !manualSelectionAllowed) {
      const preserved = existing?.model || policy.primary
      sessionBindings.set(sessionID, {
        agent: agentName,
        model: preserved,
        locked: true,
        created_at: existing?.created_at || new Date().toISOString(),
      })
      const effort = inferDifficulty(routeInput || output, agentName)
      applyReasoningEffort(output, preserved, effort)
      await appendFlowTrace(root, {
        event: "model_route_preserved",
        agent: agentName,
        sessionID,
        model: preserved,
        primary: policy.primary,
        established: true,
        openai_blocked: Boolean(health.unavailable?.openai),
        reason: "critical_established_session_no_silent_cross_provider_fallback",
      })
      await pluginLog(
        root,
        `PRESERVE_CRITICAL_SESSION agent=${agentName} session=${sessionID} model=${preserved} openai_blocked=${health.unavailable?.openai ? "yes" : "no"}`,
      )
      return
    }

    if (
      existing?.locked &&
      gmp.touchInProgressSessions === false &&
      isEstablishedSession &&
      !existingBlocked
    ) {
      const preserved = manualSelectionAllowed && manualSelection !== existing.model ? manualSelection : existing.model
      sessionBindings.set(sessionID, {
        agent: agentName,
        model: preserved,
        locked: true,
        created_at: existing.created_at || new Date().toISOString(),
      })
      if (preserved !== policy.primary) {
        const modelRef = splitModelRef(preserved)
        output.message.variant = modelRef.variant
        if (modelRef.model) output.message.model = modelRef.model
        if ("variant" in output) output.variant = modelRef.variant
      }
      const effort = inferDifficulty(routeInput || output, agentName)
      applyReasoningEffort(output, preserved, effort)
      return
    }

    let selected =
      manualSelectionAllowed
        ? manualSelection
        : isEstablishedSession && existing?.model && lockAfterAssistant && !existingBlocked
          ? existing.model
          : pickFallback(policy, health, preferComposer, composerAvailable)

    if (
      !manualSelectionAllowed &&
      config.gmpPolicy?.allowCriticalCrossProviderFallback !== true &&
      CRITICAL_OPENAI_AGENTS.has(agentName) &&
      isOpenAiFamily(policy.primary) &&
      !isOpenAiFamily(selected)
    ) {
      await appendFlowTrace(root, {
        event: "model_route_cross_provider_blocked",
        agent: agentName,
        sessionID: sessionID || "new",
        candidate: selected,
        model: policy.primary,
        openai_blocked: Boolean(health.unavailable?.openai),
        reason: "critical_agent_requires_openai_or_explicit_failover",
      })
      await pluginLog(
        root,
        `ROUTE_BLOCKED_CRITICAL_FALLBACK agent=${agentName} session=${sessionID || "new"} candidate=${selected} forced=${policy.primary} openai_blocked=${health.unavailable?.openai ? "yes" : "no"}`,
      )
      selected = policy.primary
    }

    if (sessionID) {
      sessionBindings.set(sessionID, {
        agent: agentName,
        model: selected,
        locked: true,
        created_at: existing?.created_at || new Date().toISOString(),
      })
      sessionAgentMap.set(sessionID, agentName)
    }

    const shouldPatchModel = selected !== policy.primary || manualSelectionAllowed
    if (shouldPatchModel) {
      const modelRef = splitModelRef(selected)
      output.message.variant = modelRef.variant
      if (modelRef.model) output.message.model = modelRef.model
      if ("variant" in output) output.variant = modelRef.variant
    }

    const effort = inferDifficulty(routeInput || output, agentName)
    applyReasoningEffort(output, selected, effort)

    await appendFlowTrace(root, {
      event: "model_route",
      agent: agentName,
      sessionID: sessionID || "new",
      model: selected,
      reasoning_effort: isOpenAiFamily(selected) ? effort : "provider_default",
      primary: policy.primary,
      established: isEstablishedSession,
      openai_blocked: Boolean(health.unavailable?.openai),
    })

    await pluginLog(
      root,
      `ROUTE agent=${agentName} session=${sessionID || "new"} model=${selected} primary=${policy.primary} established=${isEstablishedSession} openai_blocked=${health.unavailable?.openai ? "yes" : "no"}`,
    )

    const routingEvent = {
      event: "model_fallback_applied",
      agent: agentName,
      sessionID,
      from: policy.primary,
      to: selected,
      scope: isEstablishedSession ? "established_session_preserved" : "new_session_or_first_message",
    }
    if (selected !== policy.primary) {
      await appendTrace(root, routingEvent)
      await appendFlowTrace(root, { kind: "model_route", ...routingEvent })
      const liveFile = path.join(root, ".opencode", "state", "model-routing-live.json")
      const live = await readJson<Record<string, unknown>>(liveFile, {})
      await writeJson(liveFile, {
        ...live,
        updated_at: new Date().toISOString(),
        last_applied: { agent: agentName, sessionID, from: policy.primary, to: selected },
      })
      await writeRoutingStatus(root, health, {
        last_applied: { agent: agentName, sessionID, from: policy.primary, to: selected },
      })
    }
  }

  return {
    "chat.message": async (input: any, output: any) => {
      const root = resolveProjectRoot(input)
      const agentName = String(input?.agent || "")
      if (!agentName) return
      const sessionID = String(input?.sessionID || "")
      const existing = sessionID ? sessionBindings.get(sessionID) : undefined
      await applyRoute(root, agentName, sessionID, output, existing, input)
      const routedModel = String(output?.message?.variant || "")
      if (routedModel) {
        await appendFlowTrace(root, {
          kind: "flow_step",
          phase: "route",
          agent: agentName,
          model: routedModel,
          sessionID,
          summary: routedModel.includes("composer") ? "fallback_composer_active" : routedModel.includes("/") ? "manual_or_fallback_model" : "primary_model",
          status: "done",
        })
      }
    },

    "tool.execute.before": async (input: any, output: any) => {
      const root = resolveProjectRoot(input)
      const tool = String(input?.tool || "")
      if (tool !== "task") return

      const config = await loadFallbackConfig(root)
      if (config.enabled === false) return

      const rawArgs = ((output?.args ?? input?.args) || {}) as Record<string, unknown>
      const subagent = normalizeAgentName(String(rawArgs.subagent_type || rawArgs.agent || ""))
      const health = await syncHealthFromRecentTraces(
        root,
        Number(config.gmpPolicy?.providerHealthTtlMinutes || 45),
      )
      const effective = subagent
        ? await resolveEffectiveModel(config, health, subagent, root)
        : null
      if (!effective) return

      const policy = resolveAgentPolicy(config, subagent)
      if (effective === policy.primary) return
      if (
        config.gmpPolicy?.allowCriticalCrossProviderFallback !== true &&
        CRITICAL_OPENAI_AGENTS.has(subagent) &&
        isOpenAiFamily(policy.primary) &&
        !isOpenAiFamily(effective)
      ) {
        await appendFlowTrace(root, {
          event: "task_model_override_skipped",
          agent: subagent,
          sessionID: input?.sessionID,
          primary: policy.primary,
          candidate: effective,
          status: "skipped",
          reason: "critical_agent_requires_openai_or_explicit_failover",
        })
        await pluginLog(
          root,
          `TASK_OVERRIDE_SKIPPED_CRITICAL agent=${subagent} parent=${input?.sessionID || "unknown"} primary=${policy.primary} candidate=${effective}`,
        )
        return
      }

      const modelRef = splitModelRef(effective)
      const patched = { ...rawArgs, variant: modelRef.variant }
      if (modelRef.model) patched.model = modelRef.model
      if (output && typeof output === "object") output.args = patched
      if (input?.args && typeof input.args === "object") {
        Object.assign(input.args, patched)
      }
      if (input && typeof input === "object") {
        ;(input as Record<string, unknown>).variant = modelRef.variant
        if (modelRef.model) (input as Record<string, unknown>).model = modelRef.model
      }
      if (output && typeof output === "object") {
        ;(output as Record<string, unknown>).variant = modelRef.variant
        if (modelRef.model) (output as Record<string, unknown>).model = modelRef.model
      }

      await appendTrace(root, {
        event: "task_model_override",
        agent: subagent,
        parent_session: input?.sessionID,
        from: policy.primary,
        to: effective,
        reason: "config_approved_noncritical_cursor_fallback",
      })
      await appendFlowTrace(root, {
        event: "task_model_override",
        agent: subagent,
        sessionID: input?.sessionID,
        summary: `${policy.primary} -> ${effective}`,
        status: "ok",
      })
      await pluginLog(
        root,
        `TASK_OVERRIDE agent=${subagent} parent=${input?.sessionID || "unknown"} model=${effective}`,
      )
    },

    "tool.execute.after": async (input: any, output: any) => {
      const root = resolveProjectRoot(input)
      const tool = String(input?.tool || "")
      if (tool !== "task") return

      const config = await loadFallbackConfig(root)
      if (config.enabled === false) return

      const failed =
        output?.metadata?.success === false ||
        output?.state?.status === "error" ||
        String(output?.title || "").toLowerCase().includes("error")
      if (!failed) return

      const raw = String(
        output?.state?.error?.message ||
          output?.state?.error?.data?.message ||
          (typeof output?.state?.error === "string" ? output.state.error : "") ||
          output?.state?.output ||
          output?.title ||
          "",
      )
      const errCode = String(
        output?.state?.error?.code || output?.state?.error?.data?.code || "",
      )
      if (!isTrustedQuotaSignal(raw, errCode)) return

      const subagent = String(input?.args?.subagent_type || input?.args?.agent || "")
      await recordQuotaFailure(
        root,
        config,
        String(input?.sessionID || ""),
        subagent,
         "openai/gpt-5.6-sol",
        raw.slice(0, 300),
        /rate\s*limit|too many requests/i.test(raw) ? 429 : undefined,
      )
      await pluginLog(root, `TASK_QUOTA_RECORDED agent=${subagent} session=${input?.sessionID || ""}`)
    },

    event: async (input: any) => {
      const event = input?.event || input
      const root = resolveProjectRoot(input, event)
      const config = await loadFallbackConfig(root)
      if (config.enabled === false) return

      if (event?.type === "session.created") {
        const sessionID = String(event.properties?.info?.id || "")
        if (sessionID) {
          sessionAgentMap.delete(sessionID)
          const health = await syncHealthFromRecentTraces(
            root,
            Number(config.gmpPolicy?.providerHealthTtlMinutes || 45),
          )
          if (isModelUnavailable(health, "openai", Date.now())) {
            const defaultAgent = String(config.agents?.["chief-engineer-assistant"]?.primary ? "chief-engineer-assistant" : "")
            const policy = defaultAgent ? resolveAgentPolicy(config, defaultAgent) : null
            const next = policy
              ? pickFallback(
                  policy,
                  health,
                  config.gmpPolicy?.preferComposerOnOpenAIQuota !== false,
                  config.gmpPolicy?.composerToolFallbackEnabled === true &&
                    (await cursorComposerAvailable(root)),
                )
               : "openai/gpt-5.6-sol"
            await appendFlowTrace(root, {
              event: "new_session_routing_hint",
              sessionID,
              model: next,
               message: "OpenAI bloqueado: las sesiones criticas mantienen GPT-5.6 Sol salvo failover explicito; Composer queda para agentes elegibles.",
            })
            await pluginLog(root, `session_created ${sessionID} openai_blocked next=${next}`)
          } else {
            await pluginLog(root, `session_created ${sessionID}`)
          }
        }
        return
      }

      if (event?.type === "message.updated") {
        const info = event.properties?.info
        if (info?.sessionID && info?.agent && info?.role === "user") {
          sessionAgentMap.set(String(info.sessionID), String(info.agent))
        }
        if (info?.sessionID && info?.role === "assistant") {
          sessionHadAssistant.add(String(info.sessionID))
        }
      }

      if (event?.type === "session.deleted") {
        const sessionID = String(event.properties?.info?.id || "")
        if (sessionID) {
          sessionBindings.delete(sessionID)
          sessionAgentMap.delete(sessionID)
          sessionHadAssistant.delete(sessionID)
          quotaFrozenSessions.delete(sessionID)
        }
        return
      }

      const parsed = extractErrorFromEvent(event)
      if (!parsed) return
      let errorCode = ""
      if (parsed.message.trim().startsWith("{")) {
        try {
          const payload = JSON.parse(parsed.message)
          errorCode = String(payload?.error?.code || payload?.code || "")
        } catch {
          // ignore malformed JSON
        }
      }
      if (!isTrustedQuotaSignal(parsed.message, errorCode, parsed.statusCode)) return

      const sessionID = parsed.sessionID
      const agentName = sessionAgentMap.get(sessionID) || ""
      const policy = resolveAgentPolicy(config, agentName)
      const failedModel = parsed.model || policy.primary

      const autoFallbackSameSession =
        config.gmpPolicy?.autoFallbackSameSession === true ||
        config.gmpPolicy?.autoRetryInSession === true

      if (
        sessionID &&
        config.gmpPolicy?.freezeSessionAfterQuotaError !== false &&
        !autoFallbackSameSession
      ) {
        quotaFrozenSessions.add(sessionID)
      }

      const nextHint = await recordQuotaFailure(
        root,
        config,
        sessionID,
        agentName,
        failedModel,
        parsed.message,
        parsed.statusCode,
      )

      if (sessionID && autoFallbackSameSession && nextHint) {
        sessionBindings.set(sessionID, {
          agent: agentName || "chief-engineer-assistant",
          model: nextHint,
          locked: true,
          created_at: new Date().toISOString(),
        })
        quotaFrozenSessions.delete(sessionID)
        await appendFlowTrace(root, {
          event: "same_session_auto_fallback_prepared",
          agent: agentName || "unknown",
          sessionID,
          failed_model: failedModel,
          next_model: nextHint,
          status: "ready_for_next_attempt",
        })
        await pluginLog(
          root,
          `SAME_SESSION_FALLBACK_READY agent=${agentName || "unknown"} session=${sessionID} next=${nextHint}`,
        )
      }
    },
  }
}
