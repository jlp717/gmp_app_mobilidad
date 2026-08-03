import { tool } from "@opencode-ai/plugin"
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"

const allowed = new Set(["node:20-alpine", "dart:stable", "grafana/k6:latest", "python:3.12-slim"])

function result(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

function isInside(root: string, target: string) {
  const rel = path.relative(root, target)
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel))
}

export default tool({
  description:
    "Run command in ephemeral Docker sandbox under /workspace only. Prefer for untrusted code. Do NOT use for production hosts. Default TTL 30s; network off. Destructive/open-world — set confirm=true after HITL when deleting or enabling network.",
  args: {
    image: tool.schema.string().describe("Allowlisted image only (node:20-alpine, dart:stable, grafana/k6:latest, python:3.12-slim)."),
    command: tool.schema.array(tool.schema.string()).min(1).describe("Argv command executed inside /workspace."),
    files_to_mount: tool.schema.array(tool.schema.object({
      host_path: tool.schema.string(),
      container_path: tool.schema.string(),
    })).default([]),
    env_vars: tool.schema.record(tool.schema.string(), tool.schema.string()).default({}),
    timeout_seconds: tool.schema.number().int().min(1).max(300).default(30).describe("Hard default 30s. >30 requires allow_extended_ttl + justification."),
    network: tool.schema.boolean().default(false).describe("Only true when task justifies non-production egress."),
    allow_extended_ttl: tool.schema.boolean().default(false).describe("Must be true with justification to exceed 30s TTL."),
    justification: tool.schema.string().optional().describe("Required when allow_extended_ttl or network is true."),
    confirm: tool.schema.boolean().default(false).describe("Poka-yoke: true after HITL for destructive/network runs."),
  },
  async execute(args, context) {
    if (!allowed.has(args.image)) return result({ success: false, error: `Imagen no permitida: ${args.image}` })
    const ttl = Number(args.timeout_seconds) || 30
    if (ttl > 30 && !(args.allow_extended_ttl && String(args.justification || "").trim())) {
      return result({
        success: false,
        error: "sandbox_ttl: timeout_seconds>30 requires allow_extended_ttl=true and justification",
        code: "CRITICAL_ERROR",
      })
    }
    if (args.network && !(args.confirm && String(args.justification || "").trim())) {
      return result({
        success: false,
        error: "sandbox_network: network=true requires confirm=true and justification (HITL)",
        code: "CRITICAL_ERROR",
      })
    }
    const root = path.resolve(context.worktree || context.directory)
    const sandboxRoot = path.join(root, ".opencode", "sandbox", crypto.randomUUID())
    const started = Date.now()
    try {
      await fs.mkdir(sandboxRoot, { recursive: true })
      for (const mount of args.files_to_mount) {
        const source = path.resolve(root, mount.host_path)
        if (!isInside(root, source)) return result({ success: false, error: `Ruta fuera del proyecto: ${mount.host_path}` })
        const relativeTarget = mount.container_path.replace(/^\/+/, "").replace(/^workspace[\/\\]?/, "")
        const dest = path.join(sandboxRoot, relativeTarget)
        if (!isInside(sandboxRoot, dest)) return result({ success: false, error: `container_path inseguro: ${mount.container_path}` })
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.copyFile(source, dest)
      }
      const dockerArgs = ["run", "--rm", "--network", args.network ? "bridge" : "none", "--memory", "512m", "--cpus", "1", "--read-only", "--security-opt", "no-new-privileges", "--user", "1000:1000", "-v", `${sandboxRoot}:/workspace:rw`, "-w", "/workspace"]
      for (const [k, v] of Object.entries(args.env_vars)) dockerArgs.push("-e", `${k}=${v}`)
      dockerArgs.push(args.image, ...args.command)
      const execution = await new Promise<Record<string, unknown>>((resolve) => {
        const child = spawn("docker", dockerArgs, { shell: false })
        let stdout = ""; let stderr = ""
        const timer = setTimeout(() => child.kill("SIGKILL"), args.timeout_seconds * 1000)
        child.stdout.on("data", (d) => stdout += d.toString())
        child.stderr.on("data", (d) => stderr += d.toString())
        child.on("error", (error) => { clearTimeout(timer); resolve({ success: false, error: error.message, stdout, stderr }) })
        child.on("close", (code) => { clearTimeout(timer); resolve({ success: code === 0, exit_code: code, stdout, stderr, execution_time_ms: Date.now() - started }) })
      })
      return result(execution)
    } catch (error) {
      return result({ success: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      await fs.rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  },
})
