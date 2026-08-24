import { tool } from "@opencode-ai/plugin"

type Issue = { issue: string; severity: "bloqueante" | "advertencia" | "sugerencia"; source?: string }

function normalizeIssues(input: any, source: string): Issue[] {
  const raw = Array.isArray(input?.issues) ? input.issues : []
  return raw
    .filter((item) => item && typeof item.issue === "string")
    .map((item) => ({
      issue: item.issue,
      severity: ["bloqueante", "advertencia", "sugerencia"].includes(item.severity) ? item.severity : "advertencia",
      source,
    }))
}

function result(data: Record<string, unknown>) {
  return { output: JSON.stringify(data, null, 2), metadata: data }
}

export default tool({
  description: "Resuelve debate estructurado entre Check-Reviewer y Simplify-Reviewer.",
  args: {
    implementation_summary: tool.schema.string(),
    check_review_output: tool.schema.any().describe("Salida estructurada de Check-Reviewer."),
    simplify_review_output: tool.schema.any().describe("Salida estructurada de Simplify-Reviewer."),
  },
  async execute(args) {
    const all = [
      ...normalizeIssues(args.check_review_output, "Check-Reviewer"),
      ...normalizeIssues(args.simplify_review_output, "Simplify-Reviewer"),
    ]
    const blocking_issues = all.filter((i) => i.severity === "bloqueante")
    const warnings = all.filter((i) => i.severity === "advertencia")
    return result({ success: true, consensus: blocking_issues.length === 0, blocking_issues, warnings, resolution_needed: blocking_issues.length > 0 })
  },
})
