import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

export const RequireGreenTests = async () => {
  return {
    "tool.execute.before": async (input: any, output: any) => {
      const tool = String(input?.tool || "")
      const cmd = String(output?.args?.command || input?.args?.command || "")
      const isCommit = tool === "bash" && /git\s+commit/.test(cmd)
      if (!isCommit) return
      const root = process.cwd()
      const hasRootPkg = fs.existsSync(path.join(root, "package.json"))
      const hasBackendPkg = fs.existsSync(path.join(root, "backend", "package.json"))
      // Detect affected packages via git diff
      let affected: string[] = []
      try {
        const diff = spawnSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8", timeout: 5000, windowsHide: true })
        const files = (diff.stdout || "").split("\n").filter(Boolean)
        const backendTouched = files.some(f => f.startsWith("backend/"))
        const dartTouched = files.some(f => f.endsWith(".dart"))
        if (backendTouched) affected.push("backend")
        if (dartTouched) affected.push("dart")
        if (affected.length === 0 && files.length === 0) {
          // initial commit or --allow-empty, test backend if exists
          if (hasBackendPkg) affected.push("backend")
        }
      } catch {}
      let failed: string[] = []
      if (affected.includes("backend") && hasBackendPkg) {
        const r = spawnSync("npm", ["--prefix", "backend", "test", "--silent"], { encoding: "utf8", timeout: 120000, windowsHide: true })
        if (r.status !== 0) failed.push("backend: " + (r.stderr || r.stdout || "").slice(0, 600))
      } else if (hasRootPkg && affected.length === 0) {
        const r = spawnSync("npm", ["test", "--silent"], { encoding: "utf8", timeout: 120000, windowsHide: true })
        if (r.status !== 0) failed.push("root: " + (r.stderr || r.stdout || "").slice(0, 600))
      }
      if (affected.includes("dart")) {
        const r = spawnSync("dart", ["test"], { encoding: "utf8", timeout: 120000, windowsHide: true })
        if (r.status !== 0) failed.push("dart: " + (r.stderr || r.stdout || "").slice(0, 600))
      }
      if (failed.length > 0) {
        throw new Error("Tests en rojo (" + affected.join(",") + "). Corrige antes de commit: " + failed.join(" | ").slice(0, 1000))
      }
    }
  }
}
export default RequireGreenTests
