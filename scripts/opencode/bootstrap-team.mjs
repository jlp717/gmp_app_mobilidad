#!/usr/bin/env node
// bootstrap-team.mjs - Copia el harness completo del equipo a un repo/carpeta nueva.
// Uso: node scripts/opencode/bootstrap-team.mjs <destino>
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(__dirname, "..", "..") // raiz del repo fuente (gmp_app_mobilidad)

// Directorios de estado/sesion que NO se copian
const EXCLUDE_DIRS = new Set([
  "state", "backups", "metrics", "sandbox", "node_modules",
  "chromadb", "proposals", "runtime",
])

// Archivos de estado/sesion que NO se copian
const EXCLUDE_FILES = new Set([
  "TEAM_TRACE.jsonl", "FLOW_TRACE.jsonl", "tokens.jsonl", "live-execution.jsonl",
  "same-error-tracker.jsonl", "compaction-snapshots.jsonl", "sessions",
])

// Archivos .opencode sueltos que son informes/certificaciones (no necesarios en repo nuevo)
const EXCLUDE_ROOT_FILES = new Set([
  "AUDIT-REPORT-20260527.md", "AUDIT-REAL-FINAL.md", "CERTIFICACION-FINAL.md",
  "CIERRE_FINAL_VEREDICTO.md", "FASE14_VEREDICT.md", "INFORME-FINAL-AUDIT.md",
  "INFORME-PRUEBAS-EJECUCION.md", "INFORME-VERIFICACION-FINAL.md", "SISTEMA_VEREDICT.md",
  "ATLAS_VEREDICT.md", "CONTEXT-PRUNING.md", "CREDENCIALES.md", "MCP_SETUP_GUIDE.md",
  "MODEL-CURATION.md", "NOTIFICATION-RULES.md", "SUBAGENT_TOPOLOGY.md", "TASK_ROUTING.md",
  "FLOW_HEALTH.md", "AGENT_DASHBOARD.md", "LOOP_ENGINEERING_POLICY.md", "POST-MORTEM-PROTOCOL.md",
  "QUALITY-GATES.md", "TEAM-OBSERVABILITY.md", "AGENT-COMMUNICATION.md", "CORTEX-PROTOCOL.md",
])

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return 0
  fs.mkdirSync(dst, { recursive: true })
  let count = 0
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue
      count += copyDir(path.join(src, entry.name), path.join(dst, entry.name))
    } else {
      if (EXCLUDE_FILES.has(entry.name)) continue
      if (path.dirname(src) === path.resolve(SRC, ".opencode") && EXCLUDE_ROOT_FILES.has(entry.name)) continue
      fs.copyFileSync(path.join(src, entry.name), path.join(dst, entry.name))
      count++
    }
  }
  return count
}

function copyFile(src, dst) {
  if (!fs.existsSync(src)) return 0
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  return 1
}

function main() {
  const destArg = process.argv[2]
  if (!destArg) { console.error("Uso: node scripts/opencode/bootstrap-team.mjs <destino>"); process.exit(1) }
  const DST = path.resolve(destArg)
  if (!fs.existsSync(DST)) { console.error("Destino no existe:", DST); process.exit(1) }

  let total = 0
  // 1. .opencode/ completo (config, agents, skills, plugins, tools, scripts, rules, fallback, memoria base)
  total += copyDir(path.join(SRC, ".opencode"), path.join(DST, ".opencode"))
  // 2. opencode.json raiz
  total += copyFile(path.join(SRC, "opencode.json"), path.join(DST, "opencode.json"))
  // 3. AGENTS.md raiz (instrucciones del proyecto)
  total += copyFile(path.join(SRC, "AGENTS.md"), path.join(DST, "AGENTS.md"))
  // 4. docs/ esenciales (spec, compliance matrix)
  total += copyFile(path.join(SRC, "docs", "agent-compliance-matrix.md"), path.join(DST, "docs", "agent-compliance-matrix.md"))
  total += copyFile(path.join(SRC, "docs", "REPLICAR-EQUIPO.md"), path.join(DST, "docs", "REPLICAR-EQUIPO.md"))
  total += copyFile(path.join(SRC, "docs", "ESTRATEGIA-NEGOCIO.md"), path.join(DST, "docs", "ESTRATEGIA-NEGOCIO.md"))
  total += copyFile(path.join(SRC, "docs", "ESTRATEGIA-MERCADO.md"), path.join(DST, "docs", "ESTRATEGIA-MERCADO.md"))

  console.log("\nEquipo portado a", DST)
  console.log("Archivos copiados:", total)
  console.log("\nSiguientes pasos:")
  console.log("1. cd", DST)
  console.log("2. Ajusta opencode.json: provider/modelos si el repo nuevo usa otro stack.")
  console.log("3. Crea docs/spec/<app>.md con la living-spec del nuevo proyecto (o /greenfield).")
  console.log("4. Ejecuta /greenfield 'nombre-app' para arrancar el pipeline completo.")
}

main()
