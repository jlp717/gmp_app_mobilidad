import { tool } from "@opencode-ai/plugin"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

type RagResult = {
  collection: string
  text: string
  distance: number
  metadata: Record<string, unknown>
}

const DEFAULT_COLLECTIONS = [
  "codebase",
  "documentation",
  "github_issues",
  "github_prs",
  "conversations",
  "user_corrections",
  "lessons",
  "anti_patterns",
  "tech_radar",
  "security_findings",
]

export default tool({
  description: "Consulta RAG V4 sobre codigo, docs, GitHub, conversaciones, lecciones y hallazgos.",
  args: {
    query: tool.schema.string().min(1).describe("Consulta en lenguaje natural."),
    collections: tool.schema.array(tool.schema.string()).default(DEFAULT_COLLECTIONS),
    top_k: tool.schema.number().int().min(1).max(20).default(5),
    similarity_threshold: tool.schema.number().min(0).max(10).optional(),
  },
  async execute(args, context) {
    const started = Date.now()
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const threshold = args.similarity_threshold ?? Number(process.env.RAG_SIMILARITY_THRESHOLD || "1.2")
    const results: RagResult[] = []
    const errors: string[] = []
    for (const collection of args.collections) {
      try {
        const queried = await queryChroma(collection, args.query, args.top_k)
        results.push(...queried.filter((item) => item.distance < threshold))
      } catch (error) {
        errors.push(`${collection}: ${error instanceof Error ? error.message : String(error)}`)
        const fallback = await keywordFallback(root, collection, args.query, args.top_k)
        results.push(...fallback.filter((item) => item.distance < threshold))
      }
    }
    const ordered = results
      .sort((a, b) => priority(a.collection) - priority(b.collection) || a.distance - b.distance)
      .slice(0, args.top_k)
    return {
      output: JSON.stringify({
        results: ordered,
        total_results: ordered.length,
        query_time_ms: Date.now() - started,
        warnings: errors,
      }, null, 2),
      metadata: { success: true, total_results: ordered.length, query_time_ms: Date.now() - started, warnings: errors },
    }
  },
})

function priority(collection: string) {
  if (collection === "user_corrections" || collection === "lessons" || collection === "anti_patterns" || collection === "security_findings") return 0
  return 1
}

async function queryChroma(collection: string, query: string, topK: number): Promise<RagResult[]> {
  const base = (process.env.CHROMADB_URL || "http://localhost:8000").replace(/\/$/, "")
  const payload = JSON.stringify({ query_embeddings: [simpleEmbedding(query)], n_results: topK })
  const endpoints = [
    `${base}/api/v2/collections/${encodeURIComponent(collection)}/query`,
    `${base}/api/v2/tenants/default_tenant/databases/default_database/collections/${encodeURIComponent(collection)}/query`,
    `${base}/api/v1/collections/${encodeURIComponent(collection)}/query`,
  ]
  const messages: string[] = []
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: payload, signal: AbortSignal.timeout(2500) })
      if (!response.ok) {
        messages.push(`${response.status} ${endpoint}`)
        continue
      }
      const body: any = await response.json()
      const docs = body.documents?.[0] || body.documents || []
      const metas = body.metadatas?.[0] || body.metadatas || []
      const distances = body.distances?.[0] || body.distances || []
      return docs.map((text: string, index: number) => ({
        collection,
        text,
        distance: typeof distances[index] === "number" ? distances[index] : 0,
        metadata: metas[index] || {},
      }))
    } catch (error) {
      messages.push(error instanceof Error ? error.message : String(error))
    }
  }
  await ensureCollection(base, collection).catch(() => undefined)
  throw new Error(messages.join("; "))
}

function simpleEmbedding(text: string, dims = 64) {
  const vec = Array.from({ length: dims }, () => 0)
  for (const word of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    const digest = crypto.createHash("sha256").update(word).digest()
    const idx = digest.readUInt16BE(0) % dims
    vec[idx] += digest[2] % 2 === 0 ? 1 : -1
  }
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1
  return vec.map((value) => value / norm)
}

async function ensureCollection(base: string, collection: string) {
  const payload = JSON.stringify({ name: collection })
  await fetch(`${base}/api/v1/collections`, { method: "POST", headers: { "content-type": "application/json" }, body: payload, signal: AbortSignal.timeout(1000) })
}

async function keywordFallback(root: string, collection: string, query: string, topK: number): Promise<RagResult[]> {
  const dirs = [path.join(root, ".opencode", "memory"), path.join(root, ".opencode", "knowledge"), path.join(root, "docs")]
  const terms = query.toLowerCase().split(/\W+/).filter(Boolean)
  const found: RagResult[] = []
  for (const dir of dirs) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.filter((e) => e.isFile() && /\.(md|json|jsonl|logfmt|yaml|yml)$/i.test(e.name))) {
      const file = path.join(dir, entry.name)
      const text = await fs.readFile(file, "utf8").catch(() => "")
      const lower = text.toLowerCase()
      const hits = terms.reduce((count, term) => count + (lower.includes(term) ? 1 : 0), 0)
      if (hits === 0) continue
      found.push({ collection, text: text.slice(0, 2000), distance: 1 / hits, metadata: { file } })
    }
  }
  return found.sort((a, b) => a.distance - b.distance).slice(0, topK)
}
