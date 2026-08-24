import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

const ACTIONS = ["create_issue", "update_issue", "create_pr", "review_pr", "list_prs", "get_issue", "search_issues", "add_label", "assign_reviewer", "merge_pr", "get_pr_diff"] as const

export default tool({
  description: "Operaciones GitHub avanzadas para issues, PRs, reviews, ramas e indexacion local.",
  args: {
    action: tool.schema.enum(ACTIONS),
    params: tool.schema.any().describe("Parametros especificos de la accion."),
  },
  async execute(args, context) {
    const params = args.params || {}
    const owner = params.owner || process.env.GITHUB_OWNER
    const repo = params.repo || process.env.GMP_REPO
    if (!owner || !repo) return json({ success: false, error: "GITHUB_OWNER y repo requeridos" })
    const token = process.env.GITHUB_TOKEN
    if (!token) return json({ success: false, error: "GITHUB_TOKEN no configurado" })
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const api = (route: string, init: RequestInit = {}) => github(token, route, init)
    let data: unknown
    if (args.action === "create_issue") data = await api(`/repos/${owner}/${repo}/issues`, { method: "POST", body: JSON.stringify({ title: params.title, body: params.body || "", labels: params.labels || [], assignees: params.assignees || [] }) })
    if (args.action === "update_issue") data = await api(`/repos/${owner}/${repo}/issues/${params.number}`, { method: "PATCH", body: JSON.stringify(params.update || {}) })
    if (args.action === "create_pr") data = await api(`/repos/${owner}/${repo}/pulls`, { method: "POST", body: JSON.stringify({ title: params.title, body: params.body || "", head: params.head, base: params.base || "main", draft: params.draft !== false }) })
    if (args.action === "review_pr") data = await api(`/repos/${owner}/${repo}/pulls/${params.pull_number}/reviews`, { method: "POST", body: JSON.stringify({ event: params.event || "COMMENT", body: params.body || "" }) })
    if (args.action === "list_prs") data = await api(`/repos/${owner}/${repo}/pulls?state=${encodeURIComponent(params.state || "open")}`)
    if (args.action === "get_issue") data = await api(`/repos/${owner}/${repo}/issues/${params.number}`)
    if (args.action === "search_issues") data = await api(`/search/issues?q=${encodeURIComponent(`repo:${owner}/${repo} is:open ${params.query || ""}`)}`)
    if (args.action === "add_label") data = await api(`/repos/${owner}/${repo}/issues/${params.number}/labels`, { method: "POST", body: JSON.stringify({ labels: params.labels || [] }) })
    if (args.action === "assign_reviewer") data = await api(`/repos/${owner}/${repo}/pulls/${params.pull_number}/requested_reviewers`, { method: "POST", body: JSON.stringify({ reviewers: params.reviewers || [] }) })
    if (args.action === "merge_pr") data = await api(`/repos/${owner}/${repo}/pulls/${params.pull_number}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: params.merge_method || "squash" }) })
    if (args.action === "get_pr_diff") data = await api(`/repos/${owner}/${repo}/pulls/${params.pull_number}/files`)
    await indexLocally(root, args.action, owner, repo, data)
    return json({ success: true, action: args.action, data })
  },
})

async function github(token: string, route: string, init: RequestInit) {
  const response = await fetch(`https://api.github.com${route}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...(init.headers || {}),
    },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}: ${text}`)
  return body
}

async function indexLocally(root: string, action: string, owner: string, repo: string, data: unknown) {
  if (!["get_issue", "get_pr_diff", "search_issues", "list_prs"].includes(action)) return
  const dir = path.join(root, ".opencode", "memory")
  await fs.mkdir(dir, { recursive: true })
  await fs.appendFile(path.join(dir, "github-index-cache.jsonl"), JSON.stringify({ ts: new Date().toISOString(), action, owner, repo, data }) + "\n", "utf8")
}

function json(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}
