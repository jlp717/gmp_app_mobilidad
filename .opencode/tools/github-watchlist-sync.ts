import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

type RepoRef = { owner: string; repo: string; reason?: string }

export default tool({
  description:
    "Sincroniza la watchlist GitHub: releases, tags y actividad reciente. Solo lectura; propone /repo-check antes de integrar.",
  args: {
    notify_telegram: tool.schema.boolean().default(false),
    lookback_days: tool.schema.number().int().min(1).max(90).default(14),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const token = process.env.GITHUB_TOKEN
    const repos = await loadWatchlist(root)
    const since = new Date(Date.now() - args.lookback_days * 86400000).toISOString()
    const changes: any[] = []
    const errors: string[] = []

    for (const ref of repos) {
      try {
        const releases = token
          ? await github(token, `/repos/${ref.owner}/${ref.repo}/releases?per_page=${3}`)
          : []
        const recent = (releases || []).filter((r: any) => Date.parse(r.published_at || r.created_at || "") >= Date.parse(since))
        for (const rel of recent) {
          changes.push({
            type: "release",
            owner: ref.owner,
            repo: ref.repo,
            reason: ref.reason,
            title: rel.name || rel.tag_name,
            tag: rel.tag_name,
            url: rel.html_url,
            published_at: rel.published_at,
            action: "OBSERVAR: revisar changelog; /repo-check antes de integrar",
          })
        }
        if (token) {
          const meta: any = await github(token, `/repos/${ref.owner}/${ref.repo}`)
          if (meta.pushed_at && Date.parse(meta.pushed_at) >= Date.parse(since)) {
            changes.push({
              type: "activity",
              owner: ref.owner,
              repo: ref.repo,
              reason: ref.reason,
              title: `Actividad reciente en ${ref.owner}/${ref.repo}`,
              pushed_at: meta.pushed_at,
              stars: meta.stargazers_count,
              url: meta.html_url,
              action: "OBSERVAR: commits recientes; evaluar relevancia",
            })
          }
        }
      } catch (error) {
        errors.push(`${ref.owner}/${ref.repo}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const prev = await readJson(path.join(root, ".opencode", "state", "automation", "github-watchlist-last.json"), { keys: [] as string[] })
    const keys = changes.map((c) => `${c.type}:${c.owner}/${c.repo}:${c.tag || c.published_at || c.pushed_at}`)
    const novel = changes.filter((c) => !prev.keys.includes(`${c.type}:${c.owner}/${c.repo}:${c.tag || c.published_at || c.pushed_at}`))

    const report = {
      status: errors.length && !changes.length ? "WARN" : "PASS",
      generated_at: new Date().toISOString(),
      repos_checked: repos.length,
      changes_total: changes.length,
      changes_new: novel.length,
      changes: novel.slice(0, 20),
      errors,
    }

    await fs.mkdir(path.join(root, ".opencode", "reports"), { recursive: true })
    await fs.mkdir(path.join(root, ".opencode", "state", "automation"), { recursive: true })
    await writeJson(path.join(root, ".opencode", "reports", "github-watchlist-latest.json"), report)
    await writeJson(path.join(root, ".opencode", "state", "automation", "github-watchlist-last.json"), {
      keys: Array.from(new Set([...prev.keys, ...keys])).slice(-500),
      updated_at: new Date().toISOString(),
    })

    if (args.notify_telegram && novel.length > 0) {
      const lines = novel.slice(0, 5).map((c) => `- ${c.owner}/${c.repo}: ${c.title || c.type}`)
      await notifyTelegram(`GitHub watchlist (${novel.length} novedades)\n${lines.join("\n")}`)
    }

    return { output: JSON.stringify(report, null, 2), metadata: { success: true, ...report } }
  },
})

async function loadWatchlist(root: string): Promise<RepoRef[]> {
  const file = path.join(root, ".opencode", "config", "github-watchlist.yaml")
  const text = await fs.readFile(file, "utf8").catch(() => "")
  const repos: RepoRef[] = []
  const blocks = text.split(/^\s*-\s*owner:/m).slice(1)
  for (const block of blocks) {
    const owner = block.match(/^(\S+)/)?.[1]
    const repo = block.match(/repo:\s*(\S+)/)?.[1]
    const reason = block.match(/reason:\s*"(.*)"/)?.[1]
    if (owner && repo) repos.push({ owner, repo, reason })
  }
  const envRepo = process.env.GMP_REPO || (await detectGitRemote(root))
  if (envRepo?.includes("/")) {
    const [o, r] = envRepo.split("/")
    repos.push({ owner: o, repo: r, reason: "Repo GMP (env)" })
  }
  const seen = new Set<string>()
  return repos.filter((item) => {
    const key = `${item.owner}/${item.repo}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function github(token: string, route: string) {
  const res = await fetch(`https://api.github.com${route}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "gmp-github-watchlist",
    },
    signal: AbortSignal.timeout(15000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`GitHub ${res.status}`)
  return body
}

async function notifyTelegram(message: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return false
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    body: new URLSearchParams({ chat_id: chatId, text: message.slice(0, 3900) }),
  })
  return res.ok
}

async function readJson(file: string, fallback: any) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8")
  await fs.rename(tmp, file)
}

async function detectGitRemote(root: string) {
  try {
    const { spawnSync } = await import("node:child_process")
    const result = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8", timeout: 5000 })
    const url = String(result.stdout || "").trim()
    const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/i)
    if (match) return `${match[1]}/${match[2]}`
  } catch {}
  return null
}
