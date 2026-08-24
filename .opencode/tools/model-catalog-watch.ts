import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

export default tool({
  description:
    "Vigila catalogos vivos de OpenAI, Cursor ACP y OpenCode Go. Genera propuestas automaticas para modelos nuevos, pero no los promociona sin probe/regresion y consentimiento cuando el lane lo requiera.",
  args: {
    notify_telegram: tool.schema.boolean().default(false),
    check_providers: tool.schema.array(tool.schema.string()).default(["openai", "cursor-acp", "opencode-go", "opencode"]),
    compare_with_policy: tool.schema.boolean().default(true),
    policy_file: tool.schema.string().default(".opencode/config/model-update-policy.yaml"),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const catalog: Record<string, string[]> = {}
    const errors: string[] = []

    if (process.env.OPENAI_API_KEY) {
      try {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          signal: AbortSignal.timeout(12000),
        })
        const body: any = await res.json()
        catalog.openai = (body.data || []).map((m: any) => m.id).filter((id: string) => /gpt|o[0-9]|text-embedding/i.test(id)).sort()
      } catch (e) {
        errors.push(`openai: ${e instanceof Error ? e.message : String(e)}`)
      }
    } else {
      errors.push("openai: OPENAI_API_KEY no configurada")
    }

    try {
      const res = await fetch("http://127.0.0.1:32124/v1/models", { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const body: any = await res.json()
        catalog.cursor_acp = (body.data || []).map((m: any) => m.id).sort()
      } else {
        errors.push(`cursor_acp: HTTP ${res.status}`)
      }
    } catch (e) {
      errors.push(`cursor_acp: ${e instanceof Error ? e.message : String(e)}`)
    }

    try {
      const cfg = JSON.parse(await fs.readFile(path.join(root, "opencode.json"), "utf8"))
      catalog.opencode = Object.keys(cfg.provider?.opencode?.models || {})
      catalog.configured_primary = cfg.model
      catalog.configured_small = cfg.small_model
    } catch (e) {
      errors.push(`opencode.json: ${e instanceof Error ? e.message : String(e)}`)
    }

    try {
      const baseUrl = process.env.OPENCODE_GO_BASE_URL || "https://opencode.ai/zen/go/v1"
      const headers: Record<string, string> = {}
      if (process.env.OPENCODE_GO_API_KEY) {
        headers.authorization = `Bearer ${process.env.OPENCODE_GO_API_KEY}`
      }
      const res = await fetch(`${baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) {
        errors.push(`opencode_go: HTTP ${res.status}`)
      } else {
        const body: any = await res.json()
        catalog.opencode_go = (body.data || [])
          .map((model: any) => model.id)
          .filter((id: unknown): id is string => typeof id === "string")
          .sort()
      }
    } catch (e) {
      errors.push(`opencode_go: ${e instanceof Error ? e.message : String(e)}`)
    }

    const snapFile = path.join(root, ".opencode", "state", "automation", "model-catalog-snapshot.json")
    const prev = await readJson(snapFile, { catalog: {} as Record<string, string[]> })
    const novel: Record<string, string[]> = {}
    for (const [provider, models] of Object.entries(catalog)) {
      if (!Array.isArray(models)) continue
      const old = new Set(prev.catalog?.[provider] || [])
      const added = models.filter((m) => !old.has(m))
      if (added.length) novel[provider] = added
    }

    const report: Record<string, any> = {
      status: errors.length > 0 ? "WARN" : "PASS",
      generated_at: new Date().toISOString(),
      providers: Object.keys(catalog),
      novel,
      novel_count: Object.values(novel).reduce((n, arr) => n + arr.length, 0),
      catalog,
      errors,
      note: "Los modelos nuevos generan propuesta PENDING_PROBE; el routing solo cambia tras probe, regresion y aprobacion del lane.",
    }

    if (report.novel_count > 0) {
      const proposalPath = path.join(
        root,
        ".opencode",
        "proposals",
        `model-catalog-${Date.now()}.json`,
      )
      report.proposal_path = proposalPath
      await writeJson(proposalPath, {
        type: "model-catalog-update",
        status: "PENDING_PROBE",
        generated_at: report.generated_at,
        novel: report.novel,
        policy_file: ".opencode/config/model-update-policy.yaml",
        required_steps: ["provider-model-probe", "agentic-regression-testing", "plan-approval-gate"],
        auto_apply: false,
      })
    }

    await fs.mkdir(path.join(root, ".opencode", "reports"), { recursive: true })
    await writeJson(path.join(root, ".opencode", "reports", "model-catalog-latest.json"), report)
    await writeJson(snapFile, { catalog, updated_at: new Date().toISOString() })

    if (args.notify_telegram && report.novel_count > 0) {
      const lines = Object.entries(novel).flatMap(([p, ids]) => ids.slice(0, 5).map((id) => `- ${p}: ${id}`))
      await notifyTelegram(`Modelos nuevos detectados (${report.novel_count})\n${lines.join("\n")}`)
    }

    return { output: JSON.stringify(report, null, 2), metadata: { success: true, ...report } }
  },
})

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
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8")

  // Multiple sessions may publish a catalog concurrently on Windows.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rename(tmp, file)
      return
    } catch (error) {
      if (attempt === 4) {
        await fs.rm(tmp, { force: true }).catch(() => undefined)
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
}
