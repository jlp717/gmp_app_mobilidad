import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

type Finding = {
  file: string
  line: number
  severity: "BLOCK" | "WARN"
  rule: string
  evidence: string
  fix: string
}

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".dart", ".sql"])

export default tool({
  description: "Gate determinista de calidad senior: detecta N+1, SQL inseguro, async loops y patrones fragiles antes de cerrar una tarea.",
  args: {
    files: tool.schema.array(tool.schema.string()).default([]).describe("Archivos a analizar. Si viene vacio, usa git diff --name-only."),
    fail_on_warn: tool.schema.boolean().default(false).describe("Si true, WARN tambien bloquea."),
  },
  async execute(args, context) {
    const root = path.resolve(context.worktree || context.directory || process.cwd())
    const files = (args.files.length > 0 ? args.files : await changedFiles(root))
      .map((file) => file.replace(/\\/g, "/"))
      .filter((file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()))

    const findings: Finding[] = []
    for (const file of files) {
      const abs = path.resolve(root, file)
      if (!abs.startsWith(root)) continue
      try {
        findings.push(...scanFile(file, await fs.readFile(abs, "utf8")))
      } catch {
        findings.push({
          file,
          line: 1,
          severity: "WARN",
          rule: "unreadable_file",
          evidence: "No se pudo leer el archivo para el gate de calidad.",
          fix: "Revisar permisos o pasar contenido verificable al reviewer.",
        })
      }
    }

    const blocks = findings.filter((item) => item.severity === "BLOCK")
    const warns = findings.filter((item) => item.severity === "WARN")
    const status = blocks.length > 0 || (args.fail_on_warn && warns.length > 0) ? "BLOCK" : "PASS"
    const payload = { status, files_scanned: files.length, findings }

    await fs.mkdir(path.join(root, ".opencode", "state"), { recursive: true })
    await fs.writeFile(path.join(root, ".opencode", "state", `elite-quality-gate-${Date.now()}.json`), JSON.stringify(payload, null, 2), "utf8")

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

function scanFile(file: string, text: string) {
  const findings: Finding[] = []
  const lines = text.split(/\r?\n/)

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const lineNo = index + 1

    if (/\bforEach\s*\(\s*async\b/.test(line)) {
      findings.push(block(file, lineNo, "async_for_each", line, "Usar for..of con control de errores o batch explicito."))
    }

    if (/\bmap\s*\(\s*async\b/.test(line) && nearbyContains(lines, index, /(query|execute|fetch|axios|http|db\.|pool\.|connection\.)/i, 12)) {
      findings.push(block(file, lineNo, "parallel_n_plus_one_risk", line, "Prefetch/batch con limite de concurrencia y una query agregada."))
    }

    if (isRecordLoop(line) &&
      blockContains(lines, index, /(await\s+.*(query|execute|fetch|axios|http|db\.|pool\.|connection\.)|fs\.(read|write|append))/i) &&
      !hasBoundedRecordLoopWaiver(lines, index)) {
      findings.push(block(file, lineNo, "n_plus_one_loop", line, "Mover DB/API/IO fuera del bucle: join, IN chunks, batch, cache por request o paginacion."))
    }

    if (/select\s+\*/i.test(line)) {
      findings.push(block(file, lineNo, "select_star", line, "Enumerar columnas necesarias y justificar indices/orden."))
    }

    if (looksLikeSqlConstruction(line, text)) {
      findings.push(block(file, lineNo, "sql_string_concat", line, "Usar parametros preparados y schema verificado."))
    }

    if (/\bcatch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
      findings.push(warn(file, lineNo, "swallowed_error", line, "Mapear error con contexto o registrar evidencia accionable."))
    }

    if (/setTimeout\s*\([^,]+,\s*[0-9]+\s*\)/.test(line) && !/AbortSignal|timeout|retry|backoff/i.test(text)) {
      findings.push(warn(file, lineNo, "ad_hoc_timeout", line, "Usar timeout/cancelacion controlada y politica de retry/backoff si aplica."))
    }
  }

  return findings
}

function block(file: string, line: number, rule: string, evidence: string, fix: string): Finding {
  return { file, line, severity: "BLOCK", rule, evidence: evidence.trim().slice(0, 240), fix }
}

function warn(file: string, line: number, rule: string, evidence: string, fix: string): Finding {
  return { file, line, severity: "WARN", rule, evidence: evidence.trim().slice(0, 240), fix }
}

function nearbyContains(lines: string[], index: number, pattern: RegExp, radius: number) {
  return lines.slice(index, Math.min(lines.length, index + radius)).some((line) => pattern.test(line))
}

function isRecordLoop(line: string) {
  const code = stripStringsAndComments(line)
  return /^[\s{};]*(?:for\s+await\s*\(|for\s*\(|while\s*\()/.test(code) &&
    /\b(rows|records|items|results|data|list|orders|pedidos|facturas|clientes|albaranes|cobros|stock|entries)\b/i.test(code)
}

function stripStringsAndComments(line: string) {
  let output = String()
  let quoteCode = 0
  let escaped = false

  for (let index = 0; index < line.length; index++) {
    const code = line.charCodeAt(index)
    const next = line.charCodeAt(index + 1)

    if (quoteCode !== 0) {
      if (escaped) {
        escaped = false
      } else if (code === 92) {
        escaped = true
      } else if (code === quoteCode) {
        quoteCode = 0
      }
      output += String.fromCharCode(32)
      continue
    }

    if (code === 47 && next === 47) break
    if (code === 47 && next === 42) {
      output += String.fromCharCode(32, 32)
      index += 2
      while (index < line.length && !(line.charCodeAt(index) === 42 && line.charCodeAt(index + 1) === 47)) {
        output += String.fromCharCode(32)
        index++
      }
      if (index < line.length) output += String.fromCharCode(32)
      continue
    }

    if (code === 39 || code === 34 || code === 96) {
      quoteCode = code
      output += String.fromCharCode(32)
      continue
    }

    output += line[index]
  }

  return output
}

function looksLikeSqlConstruction(line: string, fullText: string) {
  const trimmed = line.trim()
  if (trimmed.startsWith("if (/") || trimmed.startsWith("const ") && trimmed.includes("RegExp")) return false
  const hasSqlVerb = /\b(SELECT|UPDATE|DELETE|INSERT)\b/i.test(line)
  const hasUnsafeInterpolation = /(\+\s*\w|\$\{)/.test(line)
  const isSqlLiteral = /[`'"]\s*(SELECT|UPDATE|DELETE|INSERT)\b/i.test(line)
  if (hasSqlVerb && hasUnsafeInterpolation && isSqlLiteral && hasDb2IdentifierGuard(fullText) && onlySafeDb2Interpolation(line)) return false
  return hasSqlVerb && hasUnsafeInterpolation && isSqlLiteral
}

function hasDb2IdentifierGuard(text: string) {
  return (/db2-identifiers/.test(text) && /db2Schema\s*\(/.test(text)) ||
    (/function\s+db2Identifier\s*\(/.test(text) && /function\s+db2QualifiedTableName\s*\(/.test(text))
}

function onlySafeDb2Interpolation(line: string) {
  const matches = [...line.matchAll(/\$\{([^}]+)\}/g)].map((match) => match[1].trim())
  if (matches.length === 0) return false
  return matches.every((expr) =>
    /^(ERP_SCHEMA|APP_SCHEMA|ERP_FINANCE_SCHEMA|COBROS_TABLE)$/.test(expr) ||
    /^[A-Z][A-Z0-9_]*_TABLE$/.test(expr) ||
    /^target\.tables\.(cab|lin|obs)$/.test(expr) ||
    /^promotionsTable$/.test(expr) ||
    /^db2QualifiedTableName\(qualifiedTable\)$/.test(expr) ||
    /^db2ColumnList\(columns\)$/.test(expr) ||
    /^db2Placeholders\(columns\)$/.test(expr) ||
    /^sync\.synced \? 'CURRENT_TIMESTAMP' : 'SYNC_AT'$/.test(expr) ||
    /^where$/.test(expr) ||
    /^where \? where \+ ' AND' : 'WHERE'$/.test(expr)
  )
}

function hasBoundedRecordLoopWaiver(lines: string[], index: number) {
  const context = lines.slice(Math.max(0, index - 3), index + 1).join("\n")
  return /elite-quality-gate:\s*bounded-record-loop\b/i.test(context)
}

function blockContains(lines: string[], index: number, pattern: RegExp) {
  const chunk: string[] = []
  let depth = 0
  for (let i = index; i < Math.min(lines.length, index + 80); i++) {
    const line = lines[i]
    chunk.push(line)
    depth += (line.match(/\{/g) || []).length
    depth -= (line.match(/\}/g) || []).length
    if (i > index && depth <= 0) break
  }
  return pattern.test(chunk.join("\n"))
}
