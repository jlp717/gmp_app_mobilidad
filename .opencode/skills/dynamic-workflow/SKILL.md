---
name: dynamic-workflow
description: Orchestrate 10-100+ subagents via JavaScript workflow scripts that live outside the conversation context. Implements Anthropic's Dynamic Workflows pattern for codebase audits, migrations, bug hunts, and security audits. Invocable as /dynamic-workflow or /workflow.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  project_scope: gmp-granja
  version: "1.0"
---

## Purpose

When a task requires coordinating many subagents (10+) or the plan is too large for the conversation context, use this skill. The workflow plan lives in a JavaScript script file — not in the conversation window — enabling parallel execution, resumability, and adversarial review at scale.

## Trigger

- "audit the entire codebase for N+1"
- "migrate all X to Y"
- "hunt for bugs in feature Z"
- "security audit across all modules"
- Any task where `parallel-dispatch` alone would exhaust context

## Workflow Script Structure

A workflow script is a JavaScript file at `.opencode/workflows/<task_id>.mjs` that orchestrates subagents via the OpenCode tool interface.

```javascript
// .opencode/workflows/20260810-220000-gmp-nplus1-audit.mjs
// Workflow: N+1 Detection Across All Features
// Tier: T3 | Risk: R2 | Agents: up to 16 concurrent

import { WorkflowRunner } from "./lib/runner.mjs";

const workflow = new WorkflowRunner({
  task_id: "20260810-220000-gmp-nplus1-audit",
  max_concurrent: 16,
  max_total: 100,
  resume: true,
  checkpoint_path: ".opencode/workflows/checkpoints/",
});

// Phase 1: Discovery — parallel scan of each feature module
const discovery = await workflow.phase("discovery", {
  agents: [
    { id: "scan-commissions", target: "lib/features/commissions", pattern: "N+1" },
    { id: "scan-cobros", target: "lib/features/cobros", pattern: "N+1" },
    { id: "scan-pedidos", target: "lib/features/pedidos", pattern: "N+1" },
    { id: "scan-reparto", target: "lib/features/reparto", pattern: "N+1" },
    { id: "scan-warehouse", target: "lib/features/warehouse", pattern: "N+1" },
  ],
  aggregation: "merge_findings",
});

// Phase 2: Deep analysis — for each finding, spawn a specialist
const analysis = await workflow.phase("analysis", {
  input_from: discovery,
  agent_factory: (finding) => ({
    id: `analyze-${finding.file}-${finding.line}`,
    target: finding.file,
    instruction: `Analyze this potential N+1: ${finding.snippet}. Confirm or refute with evidence.`,
    output_schema: "nplus1_verdict",
  }),
  max_concurrent: 12,
});

// Phase 3: Adversarial review — independent agents refute findings
const review = await workflow.phase("adversarial_review", {
  input_from: analysis,
  agent_factory: (finding) => ({
    id: `refute-${finding.id}`,
    target: finding.file,
    instruction: `You are a skeptical reviewer. The previous agent flagged this as N+1. Find counter-evidence or confirm with stronger proof.`,
    output_schema: "adversarial_verdict",
  }),
  max_concurrent: 8,
});

// Phase 4: Report generation
const report = await workflow.phase("report", {
  input_from: { analysis, review },
  agent: {
    id: "report-writer",
    instruction: "Synthesize all confirmed N+1 findings into a prioritized remediation plan.",
    output_schema: "remediation_plan",
  },
});

await workflow.complete({ report });
```

## Size Guidelines

| Setting | Max Concurrent | Max Total | Use When |
|---------|---------------|-----------|----------|
| `small` | 4 | 20 | Bounded audit, single module |
| `medium` | 8 | 50 | Cross-module, 2-5 features |
| `unrestricted` | 16 | 100+ | Full codebase, migration, security audit |

## Agent Communication Protocol

Agents communicate via filesystem — never through the conversation context.

```
.opencode/workflows/
├── <task_id>.mjs              # Main workflow script
├── checkpoints/
│   └── <task_id>.json         # Resumable progress
├── outputs/
│   ├── <agent_id>.json        # Individual agent output
│   └── merged/<phase>.json    # Phase aggregation
└── lib/
    └── runner.mjs             # WorkflowRunner base class
```

Each agent output follows the handoff-contract schema:

```json
{
  "agent_id": "scan-commissions",
  "status": "PASS",
  "findings": [
    {
      "file": "lib/features/commissions/providers/commissions_provider.dart",
      "line": 142,
      "type": "N+1",
      "snippet": "for (order in orders) { await db.query(...) }",
      "confidence": "high"
    }
  ],
  "evidence": {
    "files_read": ["lib/features/commissions/providers/commissions_provider.dart"],
    "commands_executed": []
  }
}
```

## Quality Patterns

### 1. Adversarial Review

Every finding must survive an independent challenge:

```javascript
const review = await workflow.phase("adversarial_review", {
  input_from: analysis,
  agent_factory: (finding) => ({
    id: `refute-${finding.id}`,
    instruction: `Refute this finding. If you cannot, confirm with stronger evidence.`,
    output_schema: "adversarial_verdict",
  }),
});
```

Output schema requires: `{ verdict: "confirmed" | "refuted" | "inconclusive", evidence: string, counter_arguments?: string }`

### 2. Multi-Angle Drafting

For reports and plans, spawn 3 agents with different perspectives:

```javascript
const drafts = await workflow.phase("multi_angle_draft", {
  agents: [
    { id: "draft-pragmatist", persona: "senior engineer focused on shipping" },
    { id: "draft-security", persona: "security engineer focused on risk" },
    { id: "draft-perf", persona: "performance engineer focused on scale" },
  ],
  merge_strategy: "structured_debate", // uses debate-protocol
});
```

### 3. Plan Verification

Before executing a plan generated by a workflow, verify it:

```javascript
const verification = await workflow.phase("plan_verify", {
  agent: {
    id: "plan-verifier",
    instruction: "This plan was generated by another agent. Verify each step is correct, complete, and safe. Flag any step that would cause data loss, security issues, or regressions.",
    output_schema: "plan_verification",
  },
});
```

## Integration with OpenCode Tools

| Workflow Need | OpenCode Tool |
|--------------|---------------|
| Spawn subagent | `parallel-dispatch` |
| Record handoff | `handoff-ledger record_handoff` |
| Persist state | `state-manager snapshot` |
| Quality gate | `elite-quality-gate` |
| Security scan | `guardvibe scan_file` |
| DB2 verification | `ibm-db2-mcp_db2_query_readonly` |
| Debate merge | `debate-protocol` |

## Execution

1. **Generate** the workflow script from the task brief
2. **Save** to `.opencode/workflows/<task_id>.mjs`
3. **Execute** via the workflow runner (or step through phases manually)
4. **Monitor** via checkpoint files
5. **Resume** from last checkpoint on interruption
6. **Verify** output via adversarial review phase
7. **Deliver** final report with evidence

## Stop Conditions

- Agent returns malformed output → retry once, then escalate to Chief
- Same error in 3+ agents → pause workflow, report pattern
- Security finding at HIGH+ → pause workflow, escalate immediately
- Checkpoint corruption → restore from last good checkpoint, re-run phase

## Concrete Examples

### Codebase Audit (N+1 Detection)

```javascript
// .opencode/workflows/audit-nplus1.mjs
const workflow = new WorkflowRunner({ task_id: "audit-nplus1", max_concurrent: 12 });

// Scan all feature directories
const scan = await workflow.phase("scan", {
  glob: "lib/features/*/providers/*.dart",
  instruction: "Find all loops containing DB/API calls. Output file, line, snippet.",
});

// Verify each finding
const verify = await workflow.phase("verify", {
  input_from: scan,
  instruction: "Confirm this is a real N+1. Check if batch/join/prefetch already exists nearby.",
});

// Adversarial review
const review = await workflow.phase("review", {
  input_from: verify,
  instruction: "Try to refute this N+1 finding. Look for caching, batching, or cardinality < 5.",
});

await workflow.complete({ scan, verify, review });
```

### Migration (Provider Pattern Update)

```javascript
// .opencode/workflows/migrate-providers.mjs
const workflow = new WorkflowRunner({ task_id: "migrate-providers", max_concurrent: 8 });

// Inventory all providers
const inventory = await workflow.phase("inventory", {
  glob: "lib/features/*/providers/*.dart",
  instruction: "List all providers, their state management pattern, and dependencies.",
});

// Generate migration plan per provider
const plans = await workflow.phase("plan", {
  input_from: inventory,
  instruction: "Create a migration plan for this provider. Include files to change, risk level, and rollback strategy.",
});

// Verify plans don't conflict
const verify = await workflow.phase("verify", {
  input_from: plans,
  instruction: "Check all migration plans for conflicts. Two plans modifying the same file = conflict.",
});

await workflow.complete({ inventory, plans, verify });
```

### Bug Hunt (Repartidor Flow)

```javascript
// .opencode/workflows/bughunt-repartidor.mjs
const workflow = new WorkflowRunner({ task_id: "bughunt-repartidor", max_concurrent: 10 });

// Map the repartidor flow
const map = await workflow.phase("map", {
  target: "lib/features/reparto/",
  instruction: "Trace the full repartidor flow from login to delivery completion. List all state transitions and API calls.",
});

// Inject fault scenarios
const faults = await workflow.phase("faults", {
  input_from: map,
  instruction: "For each state transition, what happens on network failure, timeout, server error, or invalid data?",
});

// Find unhandled paths
const gaps = await workflow.phase("gaps", {
  input_from: faults,
  instruction: "Find all error paths without proper handling. Output file, line, scenario, and severity.",
});

await workflow.complete({ map, faults, gaps });
```

### Security Audit

```javascript
// .opencode/workflows/security-audit.mjs
const workflow = new WorkflowRunner({ task_id: "security-audit", max_concurrent: 16 });

// Scan all API routes
const routes = await workflow.phase("routes", {
  glob: "backend/routes/*.js",
  instruction: "Audit this route for OWASP Top 10 vulnerabilities. Check auth, input validation, SQL injection, XSS.",
});

// Scan all DB queries
const queries = await workflow.phase("queries", {
  glob: "backend/services/*.js",
  instruction: "Find all DB queries. Check for parameterized queries, proper error handling, and data exposure.",
);

// Scan Flutter for secrets
const secrets = await workflow.phase("secrets", {
  glob: "lib/**/*.dart",
  instruction: "Find hardcoded secrets, tokens, API keys, or sensitive data in logs/prints.",
});

// Adversarial: try to bypass auth
const bypass = await workflow.phase("bypass", {
  input_from: routes,
  instruction: "For each authenticated route, describe how an attacker might bypass the auth check.",
});

await workflow.complete({ routes, queries, secrets, bypass });
```

## Resumability

Checkpoints are saved after each phase. On interruption:

1. Read `.opencode/workflows/checkpoints/<task_id>.json`
2. Identify last completed phase
3. Re-run from that phase with `resume: true`
4. Completed phases are skipped, in-progress phase re-executes

## Context Budget

The workflow script itself stays under 500 lines. Agent outputs are written to files, never accumulated in context. The Chief reads only:
- Phase summaries (1-2 lines per agent)
- Final report
- Adversarial review verdicts

This keeps the Chief's context under 20k tokens even for 100-agent workflows.
