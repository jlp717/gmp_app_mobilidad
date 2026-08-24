import { tool } from "@opencode-ai/plugin"
import fs from "node:fs/promises"
import path from "node:path"

async function readJson(file: string) {
  return JSON.parse(await fs.readFile(file, "utf8"))
}

function result(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

export default tool({
  description: "Devuelve hechos operativos del proyecto y memoria basica.",
  args: {
    project: tool.schema.enum(["gmp", "granja"]).default("gmp"),
  },
  async execute(args, context) {
    try {
      const root = path.resolve(context.worktree || context.directory)
      const memoryDir = path.join(root, ".opencode", "memory")
      const factsPath = path.join(root, ".opencode", "memory", "project-facts.json")
      const probePath = path.join(root, ".opencode", "probe-results.json")
      const manifestPath = path.join(memoryDir, "tools-manifest.json")
      const stateDir = path.join(root, ".opencode", "state")
      const facts = await readJson(factsPath).catch(() => ({}))
      const probe = await readJson(probePath).catch(() => null)
      const manifest = await readJson(manifestPath).catch(() => [])
      const stateFiles = await fs.readdir(stateDir).catch(() => [])
      return result({
        success: true,
        project: args.project,
        facts,
        probe_summary: probe ? { ts: probe.ts, providers: Object.keys(probe.providers || {}), tier_assignment: probe.tier_assignment } : null,
        tools_manifest_count: Array.isArray(manifest) ? manifest.length : 0,
        interrupted_states: stateFiles.filter((file) => file.endsWith(".json")).length,
      })
    } catch (error) {
      return result({ success: false, error: error instanceof Error ? error.message : String(error) })
    }
  },
})
