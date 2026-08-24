#!/usr/bin/env node
import fs from "node:fs"

const live = process.argv.includes("--live")
const writeReport = process.argv.includes("--write-report")
const routing = readText(".opencode/config/model-routing.yaml")
const candidates = [
  ...new Set(
    [...routing.matchAll(/["']([a-z0-9-]+\/[a-z0-9._-]+)["']/gi)].map((match) => match[1]),
  ),
]

const result = {
  status: "PASS",
  mode: live ? "live" : "offline_safe",
  generated_at: new Date().toISOString(),
  providers: {},
  checked_model_ids: candidates.length,
  verified_models: [],
  blocked_unverified: [],
  errors: [],
  notes: [
    "Live probes only verify catalog presence and never print credentials.",
    "Catalog presence does not promote a model; regression and routing policy still apply.",
  ],
}

if (live) {
  await probeProvider("openai", "https://api.openai.com/v1/models", process.env.OPENAI_API_KEY)
  await probeProvider(
    "opencode_go",
    process.env.OPENCODE_GO_BASE_URL
      ? `${process.env.OPENCODE_GO_BASE_URL.replace(/\/$/, "")}/models`
      : "https://opencode.ai/zen/go/v1/models",
    process.env.OPENCODE_GO_API_KEY,
  )
  await probeProvider(
    "cursor_acp",
    "http://127.0.0.1:32124/v1/models",
    process.env.CURSOR_API_KEY,
  )
} else {
  result.notes.push("Run with --live to contact provider catalogs.")
}

for (const model of candidates) {
  const [provider, modelId] = model.split("/", 2)
  const providerKey =
    provider === "opencode-go" ? "opencode_go" : provider === "cursor-acp" ? "cursor_acp" : provider
  const providerResult = result.providers[providerKey]
  if (!providerResult?.models?.includes(modelId)) {
    result.blocked_unverified.push(model)
    continue
  }
  result.verified_models.push(model)
}

if (result.blocked_unverified.length > 0 && live) result.status = "WARN"

if (writeReport) {
  fs.mkdirSync(".opencode/reports", { recursive: true })
  fs.writeFileSync(
    ".opencode/reports/provider-model-probe-latest.json",
    JSON.stringify(result, null, 2),
  )
}

console.log(JSON.stringify(result, null, 2))

async function probeProvider(provider, url, apiKey) {
  if (provider === "openai" && !apiKey) {
    const configured = candidates
      .filter((model) => model.startsWith("openai/"))
      .map((model) => model.split("/", 2)[1])
    result.providers[provider] = {
      status: "PASS",
      auth_mode: "runtime_oauth",
      catalog: "deferred_to_opencode_runtime",
      models: configured,
    }
    result.notes.push("OpenAI uses OpenCode runtime OAuth; direct REST catalog probing is skipped without an API key.")
    return
  }

  const headers = {}
  if (apiKey) headers.authorization = `Bearer ${apiKey}`

  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(12000),
    })
    if (!response.ok) {
      result.providers[provider] = { status: "BLOCKED", http_status: response.status, models: [] }
      result.errors.push(`${provider}: HTTP ${response.status}`)
      return
    }

    const body = await response.json()
    const models = (body?.data || [])
      .map((model) => model?.id)
      .filter((modelId) => typeof modelId === "string")
      .sort()
    result.providers[provider] = {
      status: "PASS",
      env_available: Boolean(apiKey),
      models,
    }
  } catch (error) {
    result.providers[provider] = { status: "BLOCKED", models: [] }
    result.errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return ""
  }
}
