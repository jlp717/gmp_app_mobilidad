import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".dart", ".sql", ".yml", ".yaml", ".md", ".json", ".env"])

type Item = { id: string; name: string; status: "PASS" | "BLOCK"; evidence: string }

export default tool({
  description:
    "Scorecard Politec+elite que sustituye la revision humana. PASS = se puede cerrar BUILD/SWEEP/SECURE.",
  args: {
    files: tool.schema.array(tool.schema.string()).default([]),
    test_command: tool.schema.string().default(""),
    test_exit_code: tool.schema.number().default(-1),
    playbook: tool.schema.enum(["tiny", "explore", "build", "sweep", "secure", "prod"]).default("build"),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const files = (args.files.length > 0 ? args.files : await changedFiles(root))
      .map((file) => file.replace(/\\/g, "/"))
      .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()))

    const scan = { nPlusOne: 0, sqlUnsafe: 0, selectStar: 0, logs: 0, secrets: 0, findings: [] as string[] }
    const secretRe = /(password|passwd|pwd|api[_-]?key|secret|token)\s*[:=]\s*['"`][^'"`]{6,}['"`]/i
    const privateKeyRe = /BEGIN (RSA |OPENSSH |EC |PRIVATE )/
    for (const file of files) {
      const abs = path.resolve(root, file)
      if (!abs.startsWith(root)) continue
      let text = ""
      try {
        text = await fs.readFile(abs, "utf8")
      } catch {
        continue
      }
      const lines = text.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (/\bforEach\s*\(\s*async\b/.test(line) || (/\bfor\s*\(/.test(line) && /await\s+.*(query|execute|fetch|odbc)/i.test(lines.slice(i, i + 12).join("\n")))) {
          scan.nPlusOne += 1
          scan.findings.push(`${file}:${i + 1} n_plus_one_or_async_foreach`)
        }
        if (/select\s+\*/i.test(line)) {
          scan.selectStar += 1
          scan.findings.push(`${file}:${i + 1} select_star`)
        }
        if (/(query|execute)\s*\([^)]*\+|`[^`]*SELECT[^`]*\$\{/i.test(line)) {
          scan.sqlUnsafe += 1
          scan.findings.push(`${file}:${i + 1} sql_string_concat`)
        }
        if (/(console\.log|print\s*\()/.test(line) && /^(lib|backend)\//.test(file)) {
          scan.logs += 1
          scan.findings.push(`${file}:${i + 1} production_log`)
        }
        if (secretRe.test(line) || privateKeyRe.test(line)) {
          scan.secrets += 1
          scan.findings.push(`${file}:${i + 1} secret_literal`)
        }
      }
    }

    const needsTests = ["build", "sweep", "secure"].includes(args.playbook) && files.length > 0
    const testsPass = !needsTests || (args.test_command.trim().length > 0 && args.test_exit_code === 0)
    const items: Item[] = [
      { id: "POL-P", name: "Purpose", status: files.length > 80 ? "BLOCK" : "PASS", evidence: `${files.length} files` },
      { id: "POL-O", name: "Organization", status: files.some((f) => /^lib\/features\/[^/]+\.dart$/.test(f)) ? "BLOCK" : "PASS", evidence: "feature layer paths" },
      { id: "POL-L", name: "Legibility", status: scan.logs > 0 ? "BLOCK" : "PASS", evidence: `${scan.logs} print/console.log` },
      { id: "POL-I", name: "Integration", status: "PASS", evidence: "see critic/verifier" },
      { id: "POL-T", name: "Tests", status: testsPass ? "PASS" : "BLOCK", evidence: args.test_command ? `${args.test_command} exit=${args.test_exit_code}` : "missing test_command" },
      { id: "POL-E", name: "Efficiency", status: scan.nPlusOne + scan.selectStar === 0 ? "PASS" : "BLOCK", evidence: `n+1=${scan.nPlusOne} select*=${scan.selectStar}` },
      { id: "POL-C", name: "Compliance", status: scan.sqlUnsafe + scan.secrets === 0 ? "PASS" : "BLOCK", evidence: `sql_unsafe=${scan.sqlUnsafe} secrets=${scan.secrets}` },
    ]
    const blocked = items.filter((item) => item.status === "BLOCK")
    const status = blocked.length > 0 ? "BLOCK" : "PASS"
    const payload = {
      status,
      playbook: args.playbook,
      files_scanned: files,
      politec: items,
      elite_like_findings: scan.findings,
      test_command: args.test_command,
      test_exit_code: args.test_exit_code,
      pass_means: "Javier no revisa el diff. El Chief puede cerrar.",
    }
    const dir = path.join(root, ".opencode", "state")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "code-quality-scorecard-latest.json"), JSON.stringify(payload, null, 2), "utf8")
    await fs.writeFile(path.join(dir, `code-quality-scorecard-${Date.now()}.json`), JSON.stringify(payload, null, 2), "utf8")
    return { output: JSON.stringify(payload, null, 2), metadata: { success: status === "PASS", ...payload } }
  },
})

async function changedFiles(root: string) {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", "HEAD"], { cwd: root, timeout: 5000 })
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}
