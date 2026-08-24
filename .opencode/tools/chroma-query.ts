import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

function ok(data: Record<string, unknown>) {
  return { output: JSON.stringify({ success: true, ...data }, null, 2), metadata: { success: true, ...data } }
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return { output: JSON.stringify({ success: false, error: message }, null, 2), metadata: { success: false, error: message } }
}

async function keywordFallback(root: string, query: string, topK: number) {
  const memDir = path.join(root, ".opencode", "memory")
  const terms = query.toLowerCase().split(/\W+/).filter(Boolean)
  const files = await fs.readdir(memDir).catch(() => [])
  const results: any[] = []
  for (const file of files.filter((f) => /\.(md|jsonl|json)$/.test(f))) {
    const text = await fs.readFile(path.join(memDir, file), "utf8").catch(() => "")
    const score = terms.reduce((n, t) => n + (text.toLowerCase().includes(t) ? 1 : 0), 0) / Math.max(terms.length, 1)
    if (score > 0) results.push({ document: text.slice(0, 2000), metadata: { file }, score })
  }
  return results.sort((a, b) => b.score - a.score).slice(0, topK)
}

async function queryCollection(collection: string, query: string, topK: number) {
  const payload = JSON.stringify({ query_texts: [query], n_results: topK })
  const endpoints = [
    `http://localhost:8000/api/v2/collections/${encodeURIComponent(collection)}/query`,
    `http://localhost:8000/api/v2/tenants/default_tenant/databases/default_database/collections/${encodeURIComponent(collection)}/query`,
    `http://localhost:8000/api/v1/collections/${encodeURIComponent(collection)}/query`,
  ]
  const errors: string[] = []
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) {
        errors.push(`${endpoint}: HTTP ${response.status}`)
        continue
      }
      const body: any = await response.json()
      const docs = body.documents?.[0] || body.documents || []
      const metas = body.metadatas?.[0] || body.metadatas || []
      const distances = body.distances?.[0] || body.distances || []
      return docs.map((document: string, index: number) => ({
        document,
        metadata: metas[index] || { collection },
        score: typeof distances[index] === "number" ? Math.max(0, 1 - distances[index]) : 1,
      }))
    } catch (error) {
      errors.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(errors.join("; "))
}

export default tool({
  description: "Consulta memoria semantica ChromaDB con fallback por keywords.",
  args: {
    query_text: tool.schema.string().describe("Texto de busqueda semantica."),
    collections: tool.schema.array(tool.schema.string()).default(["gmp_sessions"]).describe("Colecciones ChromaDB."),
    top_k: tool.schema.number().int().min(1).max(20).default(5),
    min_score: tool.schema.number().min(0).max(1).default(0.7),
  },
  async execute(args, context) {
    try {
      const heartbeat = await fetch("http://localhost:8000/api/v2/heartbeat", { signal: AbortSignal.timeout(2000) })
      if (!heartbeat.ok) throw new Error("ChromaDB heartbeat fallo")
      const found: any[] = []
      for (const collection of args.collections) {
        const results = await queryCollection(collection, args.query_text, args.top_k)
        found.push(...results.filter((r: any) => r.score >= args.min_score))
      }
      return ok({ source: "chromadb", results: found.sort((a: any, b: any) => b.score - a.score).slice(0, args.top_k) })
    } catch (error) {
      const root = path.resolve(context.worktree || context.directory)
      const results = await keywordFallback(root, args.query_text, args.top_k)
      return ok({ source: "fallback", fallback_reason: error instanceof Error ? error.message : String(error), results: results.filter((r) => r.score >= Math.min(args.min_score, 0.2)) })
    }
  },
})
