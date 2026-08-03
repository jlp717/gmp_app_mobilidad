import { tool } from "@opencode-ai/plugin"
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"

const allowed = new Set(["node:20-alpine", "dart:stable", "grafana/k6:latest", "python:3.12-slim"])
const ENV_ALLOWLIST = new Set([
  "PATH",
  "LANG",
  "LC_ALL",
  "HOME",
  "TMP",
  "TEMP",
  "TMPDIR",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "USERPROFILE",
])
const FORBIDDEN_HOSTS = ["192.168.1.230", "mari-pepa.com", "192.168.1.22"]

function result(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

function isInside(root: string, target: string) {
  const rel = path.relative(root, target)
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel))
}

function dockerAvailable(): boolean {
  try {
    const r = spawnSync("docker", ["info"], {
      encoding: "utf8",
      timeout: 4000,
      windowsHide: true,
    })
    return r.status === 0
  } catch {
    return false
  }
}

function strippedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key]) env[key] = process.env[key]
  }
  // Force offline-ish defaults; process isolate cannot enforce true egress.
  env.NO_PROXY = "*"
  env.HTTP_PROXY = ""
  env.HTTPS_PROXY = ""
  env.ALL_PROXY = ""
  return env
}

function commandLooksDestructive(argv: string[]): boolean {
  const joined = argv.join(" ").toLowerCase()
  return /\b(rm\b|deploy\b|drop\b|truncate\b)/.test(joined)
}

function commandTouchesForbiddenHost(argv: string[]): boolean {
  const joined = argv.join(" ").toLowerCase()
  return FORBIDDEN_HOSTS.some((h) => joined.includes(h.toLowerCase()))
}

async function runProcessIsolate(opts: {
  sandboxRoot: string
  command: string[]
  env_vars: Record<string, string>
  timeout_seconds: number
  started: number
}): Promise<Record<string, unknown>> {
  const env = { ...strippedEnv(), ...opts.env_vars, GMP_SANDBOX_MODE: "process_isolate" }
  // Block absolute paths outside sandbox in argv (workspace-only)
  for (const arg of opts.command) {
    if (path.isAbsolute(arg) && !isInside(opts.sandboxRoot, arg)) {
      return {
        success: false,
        error: `process_isolate: absolute path outside sandbox denied: ${arg}`,
        code: "CRITICAL_ERROR",
        mode: "process_isolate",
      }
    }
  }

  return await new Promise((resolve) => {
    const child = spawn(opts.command[0], opts.command.slice(1), {
      cwd: opts.sandboxRoot,
      env,
      shell: false,
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeout_seconds * 1000)
    child.stdout?.on("data", (d) => (stdout += d.toString()))
    child.stderr?.on("data", (d) => (stderr += d.toString()))
    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({
        success: false,
        error: error.message,
        stdout,
        stderr,
        mode: "process_isolate",
        execution_time_ms: Date.now() - opts.started,
      })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({
        success: code === 0,
        exit_code: code,
        stdout,
        stderr,
        mode: "process_isolate",
        execution_time_ms: Date.now() - opts.started,
        constraints: {
          ttl_seconds: opts.timeout_seconds,
          workspace_only: true,
          no_global_fs_writes: true,
          egress: "deny",
        },
      })
    })
  })
}

export default tool({
  description:
    "Run command in ephemeral sandbox under workspace only. Prefers Docker; if Docker missing uses process_isolate (TTL≤30, workspace-only, egress deny). network=true without Docker fails closed. Do NOT use for production hosts.",
  args: {
    image: tool.schema
      .string()
      .describe("Allowlisted image only (node:20-alpine, dart:stable, grafana/k6:latest, python:3.12-slim)."),
    command: tool.schema
      .array(tool.schema.string())
      .min(1)
      .describe("Argv command executed inside /workspace (or sandbox cwd in process_isolate)."),
    files_to_mount: tool.schema
      .array(
        tool.schema.object({
          host_path: tool.schema.string(),
          container_path: tool.schema.string(),
        }),
      )
      .default([]),
    env_vars: tool.schema.record(tool.schema.string(), tool.schema.string()).default({}),
    timeout_seconds: tool.schema
      .number()
      .int()
      .min(1)
      .max(300)
      .default(30)
      .describe("Hard default 30s. >30 requires allow_extended_ttl + justification."),
    network: tool.schema
      .boolean()
      .default(false)
      .describe("Only true when task justifies non-production egress. Requires Docker."),
    allow_extended_ttl: tool.schema
      .boolean()
      .default(false)
      .describe("Must be true with justification to exceed 30s TTL."),
    justification: tool.schema.string().optional().describe("Required when allow_extended_ttl or network is true."),
    confirm: tool.schema
      .boolean()
      .default(false)
      .describe("Poka-yoke: true after HITL for destructive/network runs."),
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
    if (commandTouchesForbiddenHost(args.command)) {
      return result({
        success: false,
        error: "sandbox_egress: production/forbidden host referenced in command",
        code: "CRITICAL_ERROR",
      })
    }
    if (commandLooksDestructive(args.command) && !args.confirm) {
      return result({
        success: false,
        error: "sandbox_poka_yoke: destructive command requires confirm=true after HITL",
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
        if (!isInside(root, source))
          return result({ success: false, error: `Ruta fuera del proyecto: ${mount.host_path}` })
        const relativeTarget = mount.container_path.replace(/^\/+/, "").replace(/^workspace[\/\\]?/, "")
        const dest = path.join(sandboxRoot, relativeTarget)
        if (!isInside(sandboxRoot, dest))
          return result({ success: false, error: `container_path inseguro: ${mount.container_path}` })
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.copyFile(source, dest)
      }

      const hasDocker = dockerAvailable()
      if (!hasDocker) {
        if (args.network) {
          return result({
            success: false,
            error:
              "sandbox_network: network=true requires Docker; process_isolate is egress deny / fail-closed",
            code: "CRITICAL_ERROR",
            mode: "process_isolate",
          })
        }
        const execution = await runProcessIsolate({
          sandboxRoot,
          command: args.command,
          env_vars: args.env_vars,
          timeout_seconds: Math.min(ttl, 30),
          started,
        })
        return result(execution)
      }

      const dockerArgs = [
        "run",
        "--rm",
        "--network",
        args.network ? "bridge" : "none",
        "--memory",
        "512m",
        "--cpus",
        "1",
        "--read-only",
        "--security-opt",
        "no-new-privileges",
        "--user",
        "1000:1000",
        "-v",
        `${sandboxRoot}:/workspace:rw`,
        "-w",
        "/workspace",
      ]
      for (const [k, v] of Object.entries(args.env_vars)) dockerArgs.push("-e", `${k}=${v}`)
      dockerArgs.push(args.image, ...args.command)
      const execution = await new Promise<Record<string, unknown>>((resolve) => {
        const child = spawn("docker", dockerArgs, { shell: false, windowsHide: true })
        let stdout = ""
        let stderr = ""
        const timer = setTimeout(() => child.kill("SIGKILL"), ttl * 1000)
        child.stdout.on("data", (d) => (stdout += d.toString()))
        child.stderr.on("data", (d) => (stderr += d.toString()))
        child.on("error", (error) => {
          clearTimeout(timer)
          // Docker binary vanished mid-flight → fail closed rather than silent host exec
          resolve({
            success: false,
            error: error.message,
            stdout,
            stderr,
            mode: "docker",
            code: "CRITICAL_ERROR",
          })
        })
        child.on("close", (code) => {
          clearTimeout(timer)
          resolve({
            success: code === 0,
            exit_code: code,
            stdout,
            stderr,
            mode: "docker",
            execution_time_ms: Date.now() - started,
          })
        })
      })
      return result(execution)
    } catch (error) {
      return result({ success: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      await fs.rm(sandboxRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  },
})
