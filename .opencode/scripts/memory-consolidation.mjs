import fs from "node:fs/promises"
import path from "node:path"

const MEMORY_DIR = ".opencode/memory"
const TRACE = ".opencode/TEAM_TRACE.jsonl"

function jaccard(a, b) {
  const sa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean))
  const sb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean))
  if (sa.size === 0 && sb.size === 0) return 1
  let inter = 0
  for (const w of sa) if (sb.has(w)) inter++
  return inter / (sa.size + sb.size - inter)
}

async function consolidate() {
  const root = process.cwd()
  const raw = await fs.readFile(path.join(root, MEMORY_DIR, "user-corrections.jsonl"), "utf8").catch(()=> "")
  const lines = raw.trim().split("\n").filter(Boolean)
  const parsed = []
  for (const l of lines) {
    try { const j = JSON.parse(l); parsed.push({raw:l, k: j.correction_text || l}) } catch { parsed.push({raw:l, k:l}) }
  }
  const keep = []
  for (const cur of parsed) {
    let dup = -1
    for (let i=0;i<keep.length;i++) if (jaccard(cur.k, keep[i].k) > 0.85) { dup=i; break }
    if (dup>=0) keep[dup]=cur; else keep.push(cur)
  }
  if (keep.length !== parsed.length) await fs.writeFile(path.join(root, MEMORY_DIR, "user-corrections.jsonl"), keep.map(x=>x.raw).join("\n")+"\n", "utf8")
  const snap = { ts: new Date().toISOString(), deduped: keep.length, original: parsed.length, method: "jaccard_0.85" }
  await fs.mkdir(path.join(root, MEMORY_DIR), {recursive:true})
  await fs.appendFile(path.join(root, MEMORY_DIR, "consolidation-snapshots.jsonl"), JSON.stringify(snap)+"\n", "utf8")
  const trace = await fs.readFile(path.join(root, TRACE), "utf8").catch(()=> "")
  const fails = trace.split("\n").filter(l=> l.includes("session_error")).slice(-10)
  const goldenPath = path.join(root, ".opencode/evals/golden-dataset.jsonl")
  await fs.mkdir(path.dirname(goldenPath), {recursive:true})
  for (const f of fails) await fs.appendFile(goldenPath, JSON.stringify({ts:new Date().toISOString(), source:"TRACE", raw:f.slice(0,800)})+"\n","utf8").catch(()=>{})
  console.log("consolidated semantic "+parsed.length+"->"+keep.length)
}
consolidate()
