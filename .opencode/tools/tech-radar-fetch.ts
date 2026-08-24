import { tool } from "@opencode-ai/plugin"

const KEYWORDS = [
  "flutter", "dart", "nextjs", "next.js", "tailwind", "shadcn", "node.js", "nodejs",
  "express", "typescript", "db2", "ibm i", "as400", "opencode", "mcp", "agent", "agents",
  "coding agent", "ai coding", "codex", "copilot", "cursor", "openai", "opencode go", "composer",
  "grafana", "redis", "chromadb", "playwright", "k6", "pact", "oauth", "jwt", "sentry",
]

const STACK_QUERIES = [
  "opencode plugin MCP agent",
  "coding agent MCP tool",
  "github copilot agent instructions",
  "flutter ai tooling",
  "playwright mcp testing",
  "sentry ai agent monitoring",
  "db2 node express",
  "typescript code review agent",
]

export default tool({
  description: "Obtiene tendencias relevantes desde HN, GitHub, MCP Registry, awesome-copilot y arXiv para el stack GMP/Granja.",
  args: {
    sources: tool.schema.array(tool.schema.enum(["hn", "github_trending", "github_recent", "mcp_registry", "awesome_copilot", "arxiv"])).default(["hn", "github_trending", "github_recent", "mcp_registry", "awesome_copilot", "arxiv"]),
    max_items_per_source: tool.schema.number().int().min(1).max(30).default(10),
  },
  async execute(args) {
    const items: any[] = []
    const errors: string[] = []
    for (const source of args.sources) {
      try {
        if (source === "hn") items.push(...await fetchHn(args.max_items_per_source))
        if (source === "github_trending") items.push(...await fetchGithubTrending(args.max_items_per_source))
        if (source === "github_recent") items.push(...await fetchGithubRecent(args.max_items_per_source))
        if (source === "mcp_registry") items.push(...await fetchMcpRegistry(args.max_items_per_source))
        if (source === "awesome_copilot") items.push(...await fetchAwesomeCopilot(args.max_items_per_source))
        if (source === "arxiv") items.push(...await fetchArxiv(args.max_items_per_source))
      } catch (error) {
        errors.push(`${source}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const deduped = dedupe(items).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, args.max_items_per_source * args.sources.length)
    return { output: JSON.stringify({ items: deduped, errors }, null, 2), metadata: { success: true, count: deduped.length, errors } }
  },
})

function relevant(text: string) {
  const lower = text.toLowerCase()
  return KEYWORDS.some((keyword) => lower.includes(keyword))
}

function tags(text: string) {
  const lower = text.toLowerCase()
  return KEYWORDS.filter((keyword) => lower.includes(keyword)).slice(0, 8)
}

function scoreRepo(repo: any, text: string, sourceBoost = 0) {
  const pushedAt = Date.parse(repo.pushed_at || repo.updated_at || repo.created_at || "") || 0
  const ageDays = pushedAt ? (Date.now() - pushedAt) / 86400000 : 9999
  const recency = ageDays <= 14 ? 25 : ageDays <= 60 ? 15 : ageDays <= 180 ? 5 : 0
  const stars = Math.min(30, Math.log10(Math.max(1, Number(repo.stargazers_count || 0))) * 10)
  const relevance = tags(text).length * 8
  const quality = (repo.license ? 5 : 0) + (repo.archived ? -30 : 0) + (repo.disabled ? -30 : 0)
  return Math.round(sourceBoost + recency + stars + relevance + quality)
}

function decisionForScore(score: number, item: any) {
  if (item.archived || item.disabled) return "BLOCK: archivado o deshabilitado"
  if (score >= 70) return "EVALUAR: posible mejora del equipo; pasar por repo-intake-gate antes de instalar"
  if (score >= 45) return "OBSERVAR: guardar en radar, no instalar todavia"
  return "DESCARTAR: baja relevancia actual"
}

async function fetchJson(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { "user-agent": "gmp-tech-radar", ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { "user-agent": "gmp-tech-radar" }, signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.text()
}

async function fetchHn(limit: number) {
  const ids: number[] = await fetchJson("https://hacker-news.firebaseio.com/v0/topstories.json")
  const out: any[] = []
  for (const id of ids.slice(0, 80)) {
    const item: any = await fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)
    const text = `${item?.title || ""} ${item?.text || ""}`
    if (item?.score > 80 && relevant(text)) out.push({ source: "hn", title: item.title, url: item.url || `https://news.ycombinator.com/item?id=${id}`, summary: text.slice(0, 240), relevance_tags: tags(text), score: Math.min(95, Number(item.score || 0) / 5 + tags(text).length * 8), action: "EVALUAR: leer primero, no instalar", date: new Date((item.time || 0) * 1000).toISOString() })
    if (out.length >= limit) break
  }
  return out
}

async function fetchGithubTrending(limit: number) {
  const languages = ["dart", "typescript", "javascript", "python"]
  const out: any[] = []
  for (const language of languages) {
    const url = `https://api.github.com/search/repositories?q=language:${language}&sort=stars&order=desc&per_page=${Math.max(1, Math.ceil(limit / languages.length))}`
    const body: any = await fetchJson(url)
    for (const repo of body.items || []) pushRepo(out, repo, "github_trending", language, 0)
    if (out.length >= limit) return out.slice(0, limit)
  }
  return out.slice(0, limit)
}

async function fetchGithubRecent(limit: number) {
  const out: any[] = []
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString().slice(0, 10)
  for (const query of STACK_QUERIES) {
    const q = encodeURIComponent(`${query} pushed:>${since} stars:>30 archived:false`)
    const body: any = await fetchJson(`https://api.github.com/search/repositories?q=${q}&sort=updated&order=desc&per_page=5`)
    for (const repo of body.items || []) pushRepo(out, repo, "github_recent", query, 12)
    if (out.length >= limit) break
  }
  return dedupe(out).slice(0, limit)
}

async function fetchMcpRegistry(limit: number) {
  const out: any[] = []
  const body: any = await fetchJson("https://registry.modelcontextprotocol.io/v0/servers")
  for (const entry of body.servers || []) {
    const server = entry.server || {}
    const official = entry._meta?.["io.modelcontextprotocol.registry/official"] || {}
    if (official.isLatest === false || official.status !== "active") continue
    const text = `${server.name || ""} ${server.title || ""} ${server.description || ""} ${server.repository?.url || ""} model context protocol mcp server`
    if (relevant(text)) out.push({
      source: "mcp_registry",
      title: `${server.title || server.name}: ${server.description || ""}`.slice(0, 220),
      url: server.repository?.url || server.websiteUrl || `https://registry.modelcontextprotocol.io/v0/servers/${encodeURIComponent(server.name || "")}`,
      summary: server.description || "MCP Registry server entry",
      relevance_tags: tags(text).concat("mcp"),
      score: 55 + tags(text).length * 5,
      action: "EVALUAR: revisar servidor MCP y permisos antes de instalar",
      date: official.updatedAt || official.publishedAt || new Date().toISOString(),
    })
    if (out.length >= limit) break
  }
  return out
}

async function fetchAwesomeCopilot(limit: number) {
  const text = await fetchText("https://raw.githubusercontent.com/github/awesome-copilot/main/README.md")
  const out: any[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("github.com") || !relevant(line)) continue
    const title = line.replace(/^[\s\-*]+/, "").replace(/\[(.*?)\]\((.*?)\)/g, "$1").slice(0, 160)
    const url = line.match(/\((https:\/\/github\.com\/[^)]+)\)/)?.[1] || line.match(/https:\/\/github\.com\/\S+/)?.[0]?.replace(/[),.]+$/, "")
    if (!url) continue
    out.push({ source: "awesome_copilot", title, url, summary: "Entrada de awesome-copilot adaptable a OpenCode si pasa gate.", relevance_tags: tags(line).concat("copilot"), score: 62 + tags(line).length * 4, action: "EVALUAR: adaptar manualmente; no copiar sin revisar permisos y contrato", date: new Date().toISOString() })
    if (out.length >= limit) break
  }
  return out
}

async function fetchArxiv(limit: number) {
  const xml = await fetchText("https://export.arxiv.org/api/query?search_query=cat:cs.SE+OR+cat:cs.AI+OR+cat:cs.PL&sortBy=submittedDate&max_results=20")
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
    const entry = match[1]
    const title = clean(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "")
    const summary = clean(entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] || "")
    const url = entry.match(/<id>(.*?)<\/id>/)?.[1] || ""
    const date = entry.match(/<published>(.*?)<\/published>/)?.[1] || ""
    const score = 35 + tags(`${title} ${summary}`).length * 8
    return { source: "arxiv", title, url, summary: summary.slice(0, 300), relevance_tags: tags(`${title} ${summary}`), score, action: score >= 55 ? "LEER: posible mejora conceptual" : "DESCARTAR", date }
  }).filter((item) => relevant(`${item.title} ${item.summary}`)).slice(0, limit)
}

function pushRepo(out: any[], repo: any, source: string, query: string, boost: number) {
  const text = `${repo.full_name}: ${repo.description || ""} ${(repo.topics || []).join(" ")} ${query}`
  const score = scoreRepo(repo, text, boost)
  if (!relevant(text) && score < 45) return
  out.push({
    source,
    title: `${repo.full_name}: ${repo.description || ""}`.slice(0, 220),
    url: repo.html_url,
    summary: repo.description || "",
    relevance_tags: tags(text).concat(query).slice(0, 10),
    score,
    action: decisionForScore(score, repo),
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    pushed_at: repo.pushed_at,
    license: repo.license?.spdx_id || null,
    archived: repo.archived,
    disabled: repo.disabled,
    date: repo.pushed_at || repo.updated_at,
  })
}

function dedupe(items: any[]) {
  const seen = new Set<string>()
  const out: any[] = []
  for (const item of items) {
    const key = String(item.url || item.title).toLowerCase().replace(/\?.+$/, "")
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim()
}
