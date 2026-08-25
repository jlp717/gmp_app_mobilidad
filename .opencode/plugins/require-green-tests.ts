import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

// Gate: no permitir git commit cuando los tests del paquete afectado estan en rojo.
//
// v2 (2026-08-25, Prompt 1 DX):
// - Fix bug: spawnSync("git") sin shell fallaba silenciosamente bajo el runtime
//   de opencode (PATH distinto) -> files=[] -> se ejecutaba SIEMPRE la suite
//   completa incluso cuando el diff no tocaba nada relevante.
// - El diff relevante es el STAGED (--cached), que es lo que se va a commitear,
//   no todo el working tree.
// - Cubre las tools bash Y shell (antes solo bash; shell la saltaba).
// - Commit vacio (--allow-empty): nada que verificar, no ejecuta tests.

export const RequireGreenTests = async () => {
  return {
    "tool.execute.before": async (input: any, output: any) => {
      const tool = String(input?.tool || "")
      const cmd = String(output?.args?.command || input?.args?.command || "")
      const isCommit = ["bash", "shell"].includes(tool) && /git\s+commit/.test(cmd)
      if (!isCommit) return
      const root = process.cwd()
      const hasRootPkg = fs.existsSync(path.join(root, "package.json"))
      const hasBackendPkg = fs.existsSync(path.join(root, "backend", "package.json"))
      // Staged diff = lo que realmente se va a commitear. shell:true evita el
      // fallo silencioso de resolucion de git.exe fuera del PATH del runtime.
      let affected: string[] = []
      let stagedFiles: string[] = []
      try {
        const diff = spawnSync("git", ["diff", "--cached", "--name-only", "HEAD"], { encoding: "utf8", timeout: 10000, windowsHide: true, shell: true })
        stagedFiles = (diff.stdout || "").split("\n").map(f => f.trim().replace(/\\/g, "/")).filter(Boolean)
        if (stagedFiles.length === 0) {
          // Fallback explicito: si no hay salida, distinguir repo vacio de error.
          const probe = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8", timeout: 5000, windowsHide: true, shell: true })
          if ((probe.stdout || "").trim() !== "true") return // sin repo: dejar pasar, no es responsabilidad de este gate
        }
        const backendTouched = stagedFiles.some(f => f.startsWith("backend/"))
        const dartTouched = stagedFiles.some(f => f.endsWith(".dart"))
        if (backendTouched) affected.push("backend")
        if (dartTouched) affected.push("dart")
      } catch {}
      // Sin ficheros staged (commit vacio o nada seleccionado): no hay cambio que proteger.
      if (affected.length === 0 && stagedFiles.length === 0) return
      let failed: string[] = []
      if (affected.includes("backend") && hasBackendPkg) {
        const r = spawnSync("npm", ["--prefix", "backend", "run", "test:ci", "--silent"], { encoding: "utf8", timeout: 300000, windowsHide: true, shell: true })
        if (r.status !== 0) failed.push("backend(test:ci): " + (r.stderr || r.stdout || "").slice(0, 600))
      } else if (hasRootPkg && affected.length === 0) {
        const r = spawnSync("npm", ["test", "--silent"], { encoding: "utf8", timeout: 300000, windowsHide: true, shell: true })
        if (r.status !== 0) failed.push("root: " + (r.stderr || r.stdout || "").slice(0, 600))
      }
      if (affected.includes("dart")) {
        const r = spawnSync("dart", ["test"], { encoding: "utf8", timeout: 300000, windowsHide: true, shell: true })
        if (r.status !== 0) failed.push("dart: " + (r.stderr || r.stdout || "").slice(0, 600))
      }
      if (failed.length > 0) {
        throw new Error("Tests en rojo (" + affected.join(",") + "). Corrige antes de commit: " + failed.join(" | ").slice(0, 1000))
      }
    }
  }
}
export default RequireGreenTests
