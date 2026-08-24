import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
const seen = new Map<string, string[]>()
export default async function AntiDoomLoopPlugin() {
  return {
    "tool.execute.after": async (input: any, output: any) => {
      const agent = input?.agent || output?.metadata?.agent || "unknown"
      const raw = JSON.stringify({ tool: input?.tool, args: input?.args }).slice(0, 200)
      const hash = crypto.createHash("sha1").update(raw).digest("hex")
      const list = [...(seen.get(agent) || []), hash].slice(-5)
      seen.set(agent, list)
      if (list.slice(-3).length === 3 && list.slice(-3).every((x) => x === hash)) {
        const dir = path.join(process.cwd(), ".opencode", "doom-loops")
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(path.join(dir, `${Date.now()}-${agent}.json`), JSON.stringify({ agent, input, output }, null, 2), "utf8")
        throw new Error("DOOM_LOOP_DETECTED")
      }
    },
  }
}
