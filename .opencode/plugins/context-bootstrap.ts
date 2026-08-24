// context-bootstrap.ts - Carga la memoria canonica del proyecto en CADA sesion.
// Inyecta: project-state.md (arquitectura, decisiones, negocio), correcciones, handoff, living-spec.
// Independiente del RAG: lee archivos directamente, asi funciona aunque ChromaDB este caido.
import fs from "node:fs/promises"
import path from "node:path"

async function readFileSafe(p: string): Promise<string> {
  try { return await fs.readFile(p, "utf8") } catch { return "" }
}

function buildContext(root: string): Promise<string> {
  return (async () => {
    const parts: string[] = []
    // 1. Estado canonico del proyecto
    const state = await readFileSafe(path.join(root, ".opencode", "memory", "project-state.md"))
    if (state) parts.push(state)
    // 2. Living-spec si existe
    const spec = await readFileSafe(path.join(root, "docs", "spec", "gmp.md"))
    const master = await readFileSafe(path.join(root, "docs", "MASTER-SPEC.md"))
    if (master) parts.push("## Master Spec (ADN del equipo)\n" + master)
    if (spec) parts.push("## Living Spec\n" + spec)
    // 3. Correcciones recientes (ultimas 10)
    const corr = (await readFileSafe(path.join(root, ".opencode", "memory", "corrections.jsonl"))).split("\n").filter(Boolean).slice(-10).join("\n")
    if (corr) parts.push("## Correcciones recientes\n" + corr)
    // 4. Handoff de sesion anterior
    const handoff = await readFileSafe(path.join(root, ".opencode", "state", "session-handoff-latest.json"))
    if (handoff) parts.push("## Handoff sesion anterior\n" + handoff)
    // 5. Goal activo si existe
    const goal = await readFileSafe(path.join(root, ".opencode", "state", "goal-continuation-hint.json"))
    if (goal) parts.push("## Goal activo\n" + goal)
    return parts.join("\n\n---\n\n")
  })()
}

export default async function ContextBootstrapPlugin(ctx?: { directory?: string }) {
  const root = ctx?.directory || process.cwd()
  let injected = false
  return {
    event: async (input: any) => {
      const type = String(input?.event?.type || "")
      if (type === "session.created" && !injected) {
        const info = await buildContext(root)
        if (info) { try { console.log("[context-bootstrap] memoria de proyecto cargada (" + info.length + " chars)") } catch {} }
      }
    },
    "experimental.session.compacting": async (_input: any, output: any) => {
      const info = await buildContext(root)
      if (info) {
        const body = String(output?.body || "")
        if (!body.includes("# Project State")) {
          output.body = body ? info + "\n\n---\n\n" + body : info
          injected = true
        }
      }
    },
    "chat.message": async (input: any, output: any) => {
      if (injected) return
      const info = await buildContext(root)
      if (info) {
        const body = String(output?.body || "")
        if (!body.includes("# Project State")) {
          output.body = body ? info + "\n\n---\n\n" + body : info
          injected = true
          try { console.log("[context-bootstrap] contexto inyectado en chat.message") } catch {}
        }
      }
    },
  }
}