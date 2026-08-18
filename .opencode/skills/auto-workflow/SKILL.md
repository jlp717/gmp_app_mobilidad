---
name: auto-workflow
description: Automatically detect when a task warrants a dynamic multi-agent workflow. Implements Anthropic's "ultracode" pattern with confidence scoring and auto-escalation.
version: "1.0"
triggers:
  - /auto-workflow
  - /workflow-check
  - "should this use a workflow"
  - "is this complex enough"
---

# Auto-Workflow Detector

Implements dynamic workflow detection based on task complexity, verification needs, parallelizability, risk, and historical patterns.

## When to Use

- Automatically invoked by `decision-router` for T2+ classification
- Manual check via `/auto-workflow` before starting complex work
- Pre-execution gate for any task touching >3 files or >1 module

## Detection Criteria

### 1. Task Complexity (0-25 points)

| Signal | Points | Detection |
|--------|--------|-----------|
| Files >3 | +5 | `git diff --name-only` or plan analysis |
| Files >10 | +10 | Same |
| Modules >2 | +5 | Cross-feature imports |
| Modules >5 | +10 | Same |
| Lines changed >100 | +5 | Estimated from plan |
| Lines changed >500 | +10 | Same |
| New files >3 | +5 | Plan analysis |
| Cross-cutting concern | +10 | Touches core/shared code |

**Threshold**: ≥15 points triggers workflow consideration

### 2. Verification Need (0-25 points)

| Signal | Points | Detection |
|--------|--------|-----------|
| Security-sensitive | +10 | Auth, tokens, secrets |
| DB writes | +10 | DB2 DML, migrations |
| Production impact | +10 | Deploy, config change |
| API contract change | +5 | Request/response shape |
| UI with a11y requirement | +5 | Screen reader, contrast |
| Regression risk | +5 | Shared component touched |

**Threshold**: ≥15 points requires workflow-level verification

### 3. Parallelizability (0-25 points)

| Signal | Points | Detection |
|--------|--------|-----------|
| Independent subtasks >2 | +10 | Can run concurrently |
| Independent subtasks >5 | +15 | Same |
| No shared mutable state | +5 | Subtasks don't conflict |
| Specialist separation | +10 | Different agents needed |
| Research + implementation | +5 | Can parallelize discover/execute |

**Threshold**: ≥15 points benefits from parallel dispatch

### 4. Risk Level (0-15 points)

| Signal | Points | Detection |
|--------|--------|-----------|
| R2 classification | +5 | `decision-router` output |
| R3 classification | +10 | Same |
| R4 classification | +15 | Same |
| Production mutation | +10 | Deploy, PM2, secrets |
| Irreversible operation | +10 | Delete, overwrite |

**Threshold**: ≥10 points requires workflow orchestration

### 5. Historical Pattern (0-10 points)

| Signal | Points | Detection |
|--------|--------|-----------|
| Same-error history | +5 | `same-error-tracker.jsonl` |
| Previous workflow success | +5 | `team_trace` shows pattern |
| Retro mention | +5 | Retrospective flagged area |
| Correction history | +5 | `corrections.jsonl` matches |

**Threshold**: ≥5 points suggests workflow approach

## Confidence Scoring

```
Total = Complexity + Verification + Parallelizability + Risk + Historical
Max = 100
```

| Score | Recommendation | Action |
|-------|---------------|--------|
| 0-25 | **Single Agent** | Direct execution, no workflow |
| 26-50 | **Skill + Agent** | Invoke specific skill, single agent |
| 51-75 | **Workflow T2** | Multi-agent with plan approval |
| 76-100 | **Workflow T3** | Full orchestration with all gates |

## Decision Tree

```
Task received
├── Run decision-router → Get tier + classification
├── Calculate complexity score
│   ├── Files >3 OR modules >2 OR lines >100 → complexity_high
│   └── Else → complexity_low
├── Calculate verification score
│   ├── Security/DB/Prod → verification_high
│   └── Else → verification_low
├── Calculate parallelizability score
│   ├── Independent subtasks >2 → parallel_high
│   └── Else → parallel_low
├── Calculate risk score
│   ├── R2+ → risk_high
│   └── Else → risk_low
├── Calculate historical score
│   ├── Same-error match → history_high
│   └── Else → history_low
├── Sum scores
│   ├── 0-25 → Single agent execution
│   ├── 26-50 → Skill invocation
│   ├── 51-75 → T2 workflow (plan-approval-gate)
│   └── 76-100 → T3 workflow (full gates)
└── Output recommendation with evidence
```

## Auto-Escalation Rules

### T1 → T2 Escalation
Triggered when:
- Task grows during execution (new files discovered)
- Risk increases (touches unexpected shared code)
- Verification need emerges (security issue found)

### T2 → T3 Escalation
Triggered when:
- Production impact discovered
- Multiple modules affected
- Stakeholder approval required
- Cross-team coordination needed

### De-escalation
Allowed when:
- Scope reduced during planning
- Risk mitigated by approach
- Parallelizability eliminated by dependencies

## Output Format

```yaml
workflow_recommendation:
  task_id: "YYYYMMDD-HHMMSS-proyecto-xxxx"
  confidence: 72
  recommendation: "workflow_t2"
  scores:
    complexity: 20
    verification: 15
    parallelizability: 15
    risk: 12
    historical: 10
  reasoning:
    - "Touches 4 files across 2 modules"
    - "DB2 schema change requires verification"
    - "Independent research + implementation phases"
  suggested_agents:
    - db2-as400-specialist
    - node-express-specialist
    - technical-verifier
  gates_required:
    - plan-approval-gate
    - elite-quality-gate
  fallback: "If workflow rejected, decompose into 3 sequential T1 tasks"
```

## Integration Points

| Tool | How Used |
|------|----------|
| `decision-router` | Primary classification input |
| `flow-policy-check` | Validate workflow route |
| `task-classification.yaml` | Tier and risk reference |
| `parallel-dispatch` | Execute parallel subtasks |
| `handoff-ledger` | Track workflow state |
| `elite-quality-gate` | Verify workflow output |

## Examples

### Should Use Workflow (Score: 78)

**Task**: "Add new DB2-backed API endpoint with Flutter UI"
- Complexity: 20 (5+ files, 2 modules, 200+ lines)
- Verification: 20 (DB writes, API contract, security)
- Parallelizability: 15 (backend + UI can parallelize)
- Risk: 13 (R3, production impact)
- Historical: 10 (similar tasks had issues)

**Action**: T3 workflow with DB2 specialist, Node specialist, Flutter specialist, Technical Verifier

### Should NOT Use Workflow (Score: 18)

**Task**: "Fix typo in button label"
- Complexity: 0 (1 file, 1 module, 1 line)
- Verification: 0 (no security/DB/prod)
- Parallelizability: 0 (single atomic change)
- Risk: 0 (R0, no production impact)
- Historical: 0 (no pattern)

**Action**: Single agent, direct execution

### Borderline (Score: 45)

**Task**: "Add validation to existing form"
- Complexity: 10 (2 files, 1 module, 50 lines)
- Verification: 15 (input validation at trust boundary)
- Parallelizability: 0 (single flow)
- Risk: 10 (R2, auth-adjacent)
- Historical: 10 (previous validation bugs)

**Action**: Skill invocation (`api-and-interface-design` or `auth-security`), single agent with quality gate

## Constraints

- Always respect `task-classification.yaml` tier assignment
- Workflow recommendation is advisory; `decision-router` has final say
- Escalation requires evidence, not just score threshold
- De-escalation requires explicit justification
- All recommendations logged to `team_trace`
