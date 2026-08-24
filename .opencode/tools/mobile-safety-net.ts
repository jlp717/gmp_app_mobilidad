import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"

type Finding = {
  severity: "BLOCK" | "WARN"
  rule: string
  evidence: string
  action: string
}

export default tool({
  description:
    "Safety net para operar desde movil: bloquea o advierte antes de tareas serias si hay riesgo operativo, produccion, provider, readiness, git o secretos.",
  args: {
    strict: tool.schema.boolean().default(false),
    startup_phase: tool.schema.boolean().default(false),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const stateDir = path.join(root, ".opencode", "state")
    const findings: Finding[] = []
    const [readiness, routing, providerHealth, preflight, workflowLatest] = await Promise.all([
      readJson(path.join(stateDir, "readiness-latest.json"), null),
      readJson(path.join(stateDir, "routing-status.json"), null),
      readJson(path.join(stateDir, "provider-health.json"), { unavailable: {} }),
      readJson(path.join(stateDir, "preflight-last.json"), null),
      latestStateJson(stateDir, "workflow-state-audit-"),
    ])

    const web = await webStatus(root)
    if (!web.authenticated) {
      const finding = args.startup_phase
        ? warn("web_auth_pending", `OpenCode Web aun no responde: ${web.status}`, "Normal durante arranque; post-web-startup verificara de nuevo.")
        : block("web_auth", `OpenCode Web no responde con auth: ${web.status}`, "Reiniciar start-opencode-web-gmp.cmd o esperar 30s; /rescue solo si persiste tras arranque completo.")
      findings.push(finding)
    }

    if (!readiness) {
      findings.push(block("readiness_missing", "No existe readiness-latest.json.", "Ejecutar /readiness."))
    } else if (readiness.status === "BLOCK") {
      findings.push(block("readiness_block", `Readiness BLOCK score=${readiness.score || 0}`, "Resolver bloqueos de readiness antes de Tier 2/3."))
    } else if (readiness.status === "WARN") {
      findings.push(warn("readiness_warn", `Readiness WARN score=${readiness.score || 0}`, "Revisar /readiness antes de produccion o DB/API."))
    }
    if (isStale(readiness?.generated_at, 24)) {
      findings.push(warn("readiness_stale", `Readiness antiguo: ${readiness?.generated_at || "missing"}`, "Ejecutar /readiness al iniciar jornada."))
    }

    const activeBlocks = activeProviderBlocks(providerHealth)
    if (activeBlocks.length > 0) {
      findings.push(warn("provider_degraded", activeBlocks.map((b: any) => `${b.key}:${b.reason} hasta ${b.until}`).join("; "), "Usar /autopilot para confirmar rutas efectivas antes de delegar."))
    }

    if (routing?.status === "DEGRADED") {
      findings.push(warn("routing_degraded", `Routing efectivo: ${routing.effective_default || "unknown"}`, "Aceptar fallback o limpiar con /failover clear si el proveedor volvio."))
    }

    if (preflight?.web_auth_status && preflight.web_auth_status !== "activo") {
      findings.push(block("web_password", `web_auth_status=${preflight.web_auth_status}`, "No exponer OpenCode Web en red sin password."))
    }
    if (isStale(preflight?.generated_at, 24)) {
      findings.push(warn("preflight_stale", `Preflight antiguo: ${preflight?.generated_at || "missing"}`, "Reiniciar launcher o ejecutar preflight completo."))
    }

    if (workflowLatest?.status === "BLOCK") {
      findings.push(block("workflow_state", `workflow-state-audit BLOCK=${workflowLatest.block_count || "unknown"}`, "Corregir maquina de estados/gates antes de Tier 2/3."))
    } else if (Number(workflowLatest?.block_count || 0) > 0 && workflowLatest?.status !== "PASS") {
      findings.push(warn("workflow_state_warn", `workflow-state-audit warnings=${workflowLatest.block_count || 0}`, "Revisar /state-audit si vas a Tier 2/3."))
    }

    const dirty = gitDirty(root)
    if (dirty.count > 30) {
      findings.push(warn("git_dirty_large", `${dirty.count} archivos modificados/untracked.`, "Antes de cambios amplios, resumir diff y separar scope."))
    } else if (dirty.count > 0 && args.strict) {
      findings.push(warn("git_dirty", `${dirty.count} archivos modificados/untracked.`, "Confirmar que no se pisan cambios de Javier."))
    }

    const secretHits = await secretScan(root)
    if (secretHits.length > 0) {
      findings.push(block("secret_scan", secretHits.slice(0, 5).join("; "), "Revisar y quitar posibles secretos antes de commit o deploy."))
    }

    const sameErrors = await countJsonl(path.join(root, ".opencode", "memory", "same-error-tracker.jsonl"))
    if (sameErrors > 0) {
      findings.push(warn("same_error_tracker", `${sameErrors} errores repetidos registrados.`, "Ejecutar /retro si el trabajo toca una zona relacionada."))
    }

    const blocks = findings.filter((item) => item.severity === "BLOCK")
    const warns = findings.filter((item) => item.severity === "WARN")
    const report = {
      status: blocks.length ? "BLOCK" : warns.length ? "WARN" : "PASS",
      generated_at: new Date().toISOString(),
      mobile_summary: blocks.length
        ? `BLOCK: ${blocks.length} bloqueos, ${warns.length} warnings. No iniciar Tier 2/3.`
        : warns.length
          ? `WARN: ${warns.length} warnings, sin bloqueos. Operar con cuidado.`
          : "PASS: safety net limpio para operar desde movil.",
      findings,
      quick_actions: {
        rescue: "/rescue",
        autopilot: "/autopilot",
        improve: "/improve",
        readiness: "/readiness",
        failover_openai: "/failover openai",
      },
      context: {
        web,
        readiness: readiness ? { status: readiness.status, score: readiness.score, generated_at: readiness.generated_at } : null,
        routing: routing ? { status: routing.status, effective_default: routing.effective_default } : null,
        git_dirty: dirty,
      },
    }
    await fs.mkdir(path.join(root, ".opencode", "reports"), { recursive: true })
    await fs.writeFile(path.join(root, ".opencode", "reports", "mobile-safety-net-latest.json"), JSON.stringify(report, null, 2), "utf8")
    return { output: JSON.stringify(report, null, 2), metadata: { success: blocks.length === 0, ...report } }
  },
})

async function webStatus(root: string) {
  try {
    const password = (await fs.readFile(path.join(root, ".opencode-runtime", "opencode-web-gmp.credentials"), "utf8")).trim()
    const auth = Buffer.from(`Javier:${password}`, "ascii").toString("base64")
    const res = await fetch("http://127.0.0.1:3090", {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(5000),
    })
    return { authenticated: res.ok, status: res.status }
  } catch (error) {
    return { authenticated: false, status: String(error).slice(0, 160) }
  }
}

function activeProviderBlocks(health: any) {
  const now = Date.now()
  return Object.entries(health?.unavailable || {})
    .filter(([, value]: [string, any]) => new Date(value.until).getTime() > now)
    .map(([key, value]: [string, any]) => ({ key, ...value }))
}

function isStale(timestamp: string | undefined, maxHours: number) {
  if (!timestamp) return true
  const parsed = Date.parse(timestamp)
  return !Number.isFinite(parsed) || Date.now() - parsed > maxHours * 36e5
}

function gitDirty(root: string) {
  const result = spawnSync("git", ["status", "--short"], { cwd: root, encoding: "utf8", timeout: 8000 })
  const lines = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean)
  return { count: lines.length, sample: lines.slice(0, 15) }
}

async function secretScan(root: string) {
  const gitleaks = spawnSync("gitleaks", ["protect", "--staged", "--redact", "--no-banner"], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
  })
  if (gitleaks.error?.code === "ENOENT") return []
  if (gitleaks.status && gitleaks.status !== 0) {
    const output = `${gitleaks.stdout || ""} ${gitleaks.stderr || ""}`.trim()
    if (/no leaks found|0 leaks/i.test(output)) return []
    if (/leak|secret found|finding/i.test(output)) return [`gitleaks: ${output.slice(0, 500)}`]
  }

  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only"],
    { cwd: root, encoding: "utf8", timeout: 8000 },
  )
  const files = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean)
  const hits: string[] = []
  for (const file of files.slice(0, 80)) {
    if (!/\.(js|ts|dart|json|yaml|yml|env|md|ps1|cmd|cjs|mjs)$/i.test(file)) continue
    const full = path.join(root, file)
    let text = ""
    try {
      text = await fs.readFile(full, "utf8")
    } catch {
      continue
    }
    if (/(api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]{12,}/i.test(text)) {
      hits.push(file)
    }
  }
  return hits
}

async function latestStateJson(stateDir: string, prefix: string) {
  try {
    const files = (await fs.readdir(stateDir)).filter((file) => file.startsWith(prefix) && file.endsWith(".json"))
    const stats = await Promise.all(files.map(async (file) => ({ file, stat: await fs.stat(path.join(stateDir, file)) })))
    const latest = stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]
    return latest ? readJson(path.join(stateDir, latest.file), null) : null
  } catch {
    return null
  }
}

async function countJsonl(file: string) {
  try {
    const raw = await fs.readFile(file, "utf8")
    return raw.split(/\r?\n/).filter((line) => line.trim()).length
  } catch {
    return 0
  }
}

async function readJson(file: string, fallback: any) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

function block(rule: string, evidence: string, action: string): Finding {
  return { severity: "BLOCK", rule, evidence, action }
}

function warn(rule: string, evidence: string, action: string): Finding {
  return { severity: "WARN", rule, evidence, action }
}
