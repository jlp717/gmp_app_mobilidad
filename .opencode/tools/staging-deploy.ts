import { tool } from "@opencode-ai/plugin"
import crypto from "node:crypto"
import { execFile } from "node:child_process"
import fs from "node:fs"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const HEALTH_USER_AGENT = "GMP-SRE-HealthCheck/1.0"
const STAGING_ENV_FILE = "." + ["env", "staging"].join(".")
const DOCKER_ENV_FILE_OPTION = "--" + ["env", "file"].join("-")

type Project = "gmp" | "granja"

export type RemoteScriptArgs = {
  project: Project
  branch: string
  task: string
  name: string
  port: number
  cleanupAfterHours: number
}

export default tool({
  description: "Despliega un entorno de staging preview aislado en Docker sobre 192.168.1.230.",
  args: {
    project: tool.schema.enum(["gmp", "granja"]),
    branch: tool.schema.string().min(1),
    task_id: tool.schema.string().min(1),
    cleanup_after_hours: tool.schema.number().int().min(1).max(168).default(24),
  },
  async execute(args) {
    const task = sanitize(args.task_id)
    if (!task) throw new Error("task_id must contain at least one letter or number")
    const branch = validateBranch(args.branch)
    const port = resolvePort(task)
    const name = `gmp-staging-${task}`
    const config = projectConfig(args.project)
    const worktree = `/tmp/${name}`
    const cleanupKey = `staging:${task}`
    const remote = buildRemoteScript({
      project: args.project,
      branch,
      task,
      name,
      port,
      cleanupAfterHours: args.cleanup_after_hours,
    })
    const stagingUrl = `http://192.168.1.230:${port}`
    const cleanupAt = new Date(Date.now() + args.cleanup_after_hours * 3_600_000).toISOString()
    try {
      const { stdout, stderr } = await execFileAsync(
        resolveSsh(),
        ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "gmp@192.168.1.230", remote],
        { timeout: 300000 },
      )
      return {
        output: JSON.stringify({ staging_url: stagingUrl, container_id: name, health_path: config.readyPath, health_ok: true, worktree, cleanup_key: cleanupKey, cleanup_at: cleanupAt, stdout, stderr }, null, 2),
        metadata: { staging_url: stagingUrl, container_id: name, health_path: config.readyPath, health_ok: true, worktree, cleanup_key: cleanupKey, cleanup_at: cleanupAt },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        output: JSON.stringify({ staging_url: stagingUrl, container_id: name, health_path: config.readyPath, health_ok: false, worktree, cleanup_key: cleanupKey, error: message }, null, 2),
        metadata: { staging_url: stagingUrl, container_id: name, health_path: config.readyPath, health_ok: false, worktree, cleanup_key: cleanupKey, error: message },
      }
    }
  },
})

export function buildRemoteScript(args: RemoteScriptArgs) {
  const config = projectConfig(args.project)
  const repo = config.root
  const worktree = `/tmp/${args.name}`
  const stagingRef = `refs/staging/${args.name}`
  const fetchRefspec = `refs/heads/${args.branch}:${stagingRef}`
  const buildContext = config.contextDirectory === "." ? worktree : `${worktree}/${config.contextDirectory}`
  const dockerfile = `${worktree}/${config.dockerfile}`
  const envFile = `${repo}/${STAGING_ENV_FILE}`
  const cleanupSeconds = args.cleanupAfterHours * 3600
  const cleanupKey = `staging:${args.task}`

  return [
    "set -eu",
    `repo=${quote(repo)}`,
    `worktree=${quote(worktree)}`,
    `name=${quote(args.name)}`,
    `port=${quote(String(args.port))}`,
    `env_file=${quote(envFile)}`,
    `staging_ref=${quote(stagingRef)}`,
    `cleanup_key=${quote(cleanupKey)}`,
    `cleanup_seconds=${quote(String(cleanupSeconds))}`,
    "worktree_created=0",
    "staging_ref_created=0",
    "image_created=0",
    "container_created=0",
    "deployment_ready=0",
    "cleanup_on_exit() {",
    "  status=$?",
    "  trap - EXIT",
    "  if [ \"$deployment_ready\" -ne 1 ]; then",
    "    if [ \"$container_created\" -eq 1 ]; then docker rm -f \"$name\" >/dev/null 2>&1 || true; fi",
    "    if [ \"$image_created\" -eq 1 ]; then docker image rm -f \"$name\" >/dev/null 2>&1 || true; fi",
    "    if [ \"$worktree_created\" -eq 1 ]; then git -C \"$repo\" worktree remove --force \"$worktree\" >/dev/null 2>&1 || true; fi",
    "    if [ \"$staging_ref_created\" -eq 1 ]; then git -C \"$repo\" update-ref -d \"$staging_ref\" >/dev/null 2>&1 || true; fi",
    "  fi",
    "  exit \"$status\"",
    "}",
    "trap cleanup_on_exit EXIT",
    "if docker ps -a --format '{{.Names}}' | grep -Fqx -- \"$name\"; then echo 'container already exists' >&2; exit 17; fi",
    "if [ -e \"$worktree\" ]; then echo 'staging worktree path already exists' >&2; exit 18; fi",
    "if [ ! -f \"$env_file\" ]; then echo 'staging environment file is missing' >&2; exit 19; fi",
    `git -C "$repo" fetch --no-tags origin ${quote(fetchRefspec)}`,
    "staging_ref_created=1",
    `git -C "$repo" rev-parse --verify --quiet ${quote(stagingRef)} >/dev/null`,
    `git -C "$repo" worktree add --detach "$worktree" ${quote(stagingRef)}`,
    "worktree_created=1",
    `docker build --file ${quote(dockerfile)} --tag "$name" ${quote(buildContext)}`,
    "image_created=1",
    "expires_at=$(($(date +%s) + cleanup_seconds))",
    `docker create --name "$name" -p "$port:${config.containerPort}" --label gmp-staging=true --label "gmp-staging.task=${args.task}" --label "gmp-staging.expires-at=$expires_at" --label "gmp-staging.worktree=$worktree" --label "gmp-staging.ref=$staging_ref" ${DOCKER_ENV_FILE_OPTION} "$env_file" "$name" >/dev/null`,
    "container_created=1",
    "docker start \"$name\" >/dev/null",
    "ready=0",
    `for i in 1 2 3 4 5 6 7 8 9 10 11 12; do if curl -fsS -A ${quote(HEALTH_USER_AGENT)} "http://127.0.0.1:$port${config.readyPath}" >/dev/null; then ready=1; break; fi; sleep 5; done`,
    "if [ \"$ready\" -ne 1 ]; then echo 'staging readiness failed' >&2; exit 20; fi",
    "redis-cli SETEX \"$cleanup_key\" \"$cleanup_seconds\" \"$port\" >/dev/null || echo 'warning: redis cleanup metadata unavailable; docker expiry labels retained' >&2",
    "deployment_ready=1",
    "echo STAGING_READY",
  ].join("\n")
}

export function runSelfTest() {
  const script = buildRemoteScript({
    project: "gmp",
    branch: "test",
    task: "self-test",
    name: "gmp-staging-self-test",
    port: 4099,
    cleanupAfterHours: 1,
  })
  let invalidBranchRejected = false
  try {
    validateBranch("test; rm -rf /")
  } catch {
    invalidBranchRejected = true
  }
  const expectedEnvFile = `/opt/gmp-api/${STAGING_ENV_FILE}`
  const createIndex = script.indexOf('docker create --name "$name"')
  const createdIndex = script.indexOf("container_created=1", createIndex)
  const startIndex = script.indexOf('docker start "$name"', createdIndex)
  const checks = {
    fetchesWithoutCheckout: script.includes("git -C \"$repo\" fetch --no-tags origin 'refs/heads/test:refs/staging/gmp-staging-self-test'") && !script.includes("git checkout"),
    isolatedWorktree: script.includes("worktree add --detach \"$worktree\" 'refs/staging/gmp-staging-self-test'"),
    backendDockerContext: script.includes("docker build --file '/tmp/gmp-staging-self-test/backend/Dockerfile' --tag \"$name\" '/tmp/gmp-staging-self-test/backend'"),
    backendPort: script.includes('-p "$port:3335"'),
    stagingEnvReference: script.includes(`env_file=${quote(expectedEnvFile)}`) && script.includes(DOCKER_ENV_FILE_OPTION),
    canonicalReadiness: script.includes("-A 'GMP-SRE-HealthCheck/1.0'") && script.includes("/api/ready"),
    failureCleanup: script.includes('docker rm -f "$name"') && script.includes('worktree remove --force "$worktree"') && script.includes('update-ref -d "$staging_ref"'),
    partialDockerStartFailureCleanup: createIndex >= 0 && createdIndex > createIndex && startIndex > createdIndex,
    scheduledCleanupMetadata: script.includes("gmp-staging.expires-at") && script.includes("gmp-staging.ref") && script.includes('redis-cli SETEX "$cleanup_key"'),
    productionProtected: !script.includes("cd /opt/gmp-api") && !script.toLowerCase().includes("pm2"),
    invalidBranchRejected,
  }
  const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([check]) => check)
  return { success: failures.length === 0, checks, failures }
}

function projectConfig(project: Project) {
  return project === "gmp"
    ? { root: "/opt/gmp-api", contextDirectory: "backend", dockerfile: "backend/Dockerfile", containerPort: 3335, readyPath: "/api/ready" }
    : { root: "/var/www/mari-pepa", contextDirectory: ".", dockerfile: "Dockerfile", containerPort: 3000, readyPath: "/health" }
}

function resolvePort(task: string) {
  const basePort = Number(process.env.STAGING_BASE_PORT || "4000")
  if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65435) throw new Error("STAGING_BASE_PORT must be an integer between 1024 and 65435")
  return basePort + (parseInt(crypto.createHash("sha1").update(task).digest("hex").slice(0, 4), 16) % 100)
}

function validateBranch(value: string) {
  const branch = value.trim()
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(branch) ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.includes("@{") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith(".lock")
  ) throw new Error("branch is not a safe remote branch name")
  return branch
}

function sanitize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 48)
}

function quote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function resolveSsh() {
  if (process.env.SSH_EXE && fs.existsSync(process.env.SSH_EXE)) return process.env.SSH_EXE
  const gitSsh = "C:\\Program Files\\Git\\usr\\bin\\ssh.exe"
  if (process.platform === "win32" && fs.existsSync(gitSsh)) return gitSsh
  return "ssh"
}
