import { tool } from "@opencode-ai/plugin"

const STACK = ["flutter", "dart", "nextjs", "next.js", "node", "express", "typescript", "db2", "ibm", "as400", "mcp", "opencode", "playwright", "sentry", "redis", "prometheus", "agent", "coding"]

export default tool({
  description: "Evalua un repo encontrado en Twitter/GitHub antes de integrarlo: mantenimiento, seguridad, licencia, relevancia y accion segura.",
  args: {
    url: tool.schema.string().min(1),
  },
  async execute(args) {
    const repo = parseGithubRepo(args.url)
    if (!repo) return result({ status: "BLOCK", reason: "Solo se aceptan URLs GitHub de repos concretos owner/repo.", url: args.url })
    const api = `https://api.github.com/repos/${repo.owner}/${repo.name}`
    const data: any = await fetchJson(api)
    const readme = await fetchText(`https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${data.default_branch || "main"}/README.md`).catch(() => "")
    const packageJson = await fetchText(`https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${data.default_branch || "main"}/package.json`).catch(() => "")
    const text = `${data.full_name} ${data.description || ""} ${(data.topics || []).join(" ")} ${readme.slice(0, 4000)} ${packageJson.slice(0, 2000)}`.toLowerCase()
    const findings = [] as any[]
    const pushedDays = data.pushed_at ? Math.round((Date.now() - Date.parse(data.pushed_at)) / 86400000) : 9999
    const relevance = STACK.filter((k) => text.includes(k))

    if (data.archived) findings.push(block("archived", "El repositorio esta archivado."))
    if (data.disabled) findings.push(block("disabled", "El repositorio esta deshabilitado."))
    if (!data.license) findings.push(warn("missing_license", "No hay licencia detectada por GitHub."))
    if (pushedDays > 365) findings.push(warn("stale", `Ultimo push hace ${pushedDays} dias.`))
    if (Number(data.stargazers_count || 0) < 30) findings.push(warn("low_adoption", `Pocas estrellas (${data.stargazers_count || 0}).`))
    if (relevance.length === 0) findings.push(warn("low_stack_relevance", "No detecto relacion clara con GMP/OpenCode/Flutter/Node/MCP."))
    if (/postinstall|curl\s+.*sh|wget\s+.*sh|eval\(|child_process|exec\(/i.test(packageJson + readme)) findings.push(warn("install_script_or_exec", "Detecta scripts/exec; revisar manualmente antes de instalar."))
    if (/token|api[_-]?key|secret|credential/i.test(readme)) findings.push(warn("credentials_surface", "README menciona tokens/credenciales; revisar permisos y secretos."))

    const blocks = findings.filter((f) => f.severity === "BLOCK")
    const warns = findings.filter((f) => f.severity === "WARN")
    const score = Math.max(0, 100 - blocks.length * 40 - warns.length * 8 + Math.min(20, relevance.length * 4))
    const status = blocks.length ? "BLOCK" : score >= 80 ? "PASS" : "WARN"
    return result({
      status,
      score,
      repo: data.full_name,
      url: data.html_url,
      description: data.description,
      stars: data.stargazers_count,
      forks: data.forks_count,
      open_issues: data.open_issues_count,
      pushed_at: data.pushed_at,
      license: data.license?.spdx_id || null,
      default_branch: data.default_branch,
      relevance,
      findings,
      recommendation: recommendation(status, score, findings),
      next_safe_step: "Si interesa, crear una tarea de evaluacion: leer README, revisar permisos/scripts, probar en sandbox, y solo despues integrar como skill/MCP/plugin.",
    })
  },
})

function parseGithubRepo(url: string) {
  const match = url.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i)
  if (!match) return null
  return { owner: match[1], name: match[2].replace(/\.git$/, "") }
}

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { "user-agent": "gmp-repo-intake-gate" }, signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`)
  return res.json()
}

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { "user-agent": "gmp-repo-intake-gate" }, signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

function block(rule: string, evidence: string) { return { severity: "BLOCK", rule, evidence, fix: "No integrar." } }
function warn(rule: string, evidence: string) { return { severity: "WARN", rule, evidence, fix: "Revisar manualmente antes de instalar." } }
function recommendation(status: string, score: number, findings: any[]) {
  if (status === "BLOCK") return "NO instalar ni integrar."
  if (status === "PASS") return "Candidato valido para prueba aislada; no instalar en el equipo sin sandbox y diff revisado."
  return `Mantener en observacion o evaluar manualmente; score ${score}, warnings ${findings.length}.`
}
function result(data: any) { return { output: JSON.stringify(data, null, 2), metadata: { success: data.status !== "BLOCK", ...data } } }