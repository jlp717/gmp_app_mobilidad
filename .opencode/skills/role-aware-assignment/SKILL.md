---
name: role-aware-assignment
description: AgentCARD/UNO-ORCHESTRA pattern — heterogeneous role assignment for the GMP team. Optimizes model selection by role, not just task. Invocable as /role-aware.
triggers:
  - /role-aware
  - "assign roles"
  - "model assignment"
  - "who should do this"
  - "role optimization"
  - "cost accuracy"
version: 1.0
---

# Role-Aware Assignment (AgentCARD / UNO-ORCHESTRA)

Heterogeneous team optimization: role assignment matters more than model size.
A fast executor with a strong planner beats a single expensive model on every dimension.

## Core Principle

**Role > Agent > Model**

The team has specialists (agents), but what matters is the ROLE they play in a given task.
A single agent can play multiple roles across tasks. A role can be filled by different agents.
Model selection follows the role's cognitive demands, not the agent's default model.

---

## Role Definitions

### 1. Planner
- **Function**: Architecture, task decomposition, risk assessment, dependency mapping
- **Cognitive demand**: High reasoning, broad context, pattern recognition
- **Output**: Implementation plan, risk matrix, task graph, acceptance criteria
- **Agents that fill this role**: Architect-Planner, chief-engineer-assistant
- **Quality metric**: Plan completeness, risk identification rate, estimation accuracy

### 2. Executor
- **Function**: Code implementation following patterns, writing tests, documentation
- **Cognitive demand**: Instruction following, pattern matching, syntactic correctness
- **Output**: Working code, passing tests, updated documentation
- **Agents that fill this role**: code-autopilot, Flutter-UI-Specialist, Node-Express-Specialist, Flutter-Data-Specialist
- **Quality metric**: First-pass correctness, pattern compliance, test coverage

### 3. Verifier
- **Function**: Independent quality assessment, skeptical review, evidence validation
- **Cognitive demand**: Skeptical reasoning, edge case detection, counterfactual thinking
- **Output**: Verification report, edge case list, pass/fail per criterion
- **Agents that fill this role**: Technical-Verifier, truth-teller
- **Quality metric**: Bug detection rate, false positive rate, coverage of edge cases

### 4. Reviewer
- **Function**: Code review, pattern compliance, DRY/SOLID/OWASP checks
- **Cognitive demand**: Rule application, pattern recognition, constructive critique
- **Output**: Review comments, approval/rejection, improvement suggestions
- **Agents that fill this role**: Check-Reviewer, Simplify-Reviewer, code-review
- **Quality metric**: Issue detection rate, false positive rate, actionability of feedback

### 5. Security
- **Function**: OWASP Top 10, auth validation, input sanitization, injection prevention
- **Cognitive demand**: Threat modeling, attack surface analysis, rule expertise
- **Output**: Security report, vulnerability list, remediation plan
- **Agents that fill this role**: appsec-engineer, Security-Validator
- **Quality metric**: Vulnerability detection rate, false positive rate, remediation completeness

### 6. Performance
- **Function**: Profiling, benchmarking, N+1 detection, optimization
- **Cognitive demand**: Data analysis, measurement, bottleneck identification
- **Output**: Benchmark results, optimization plan, before/after metrics
- **Agents that fill this role**: Flutter-Performance-Specialist, DB2-Query-Optimizer, Performance-Analyst
- **Quality metric**: Optimization impact, measurement accuracy, regression detection

### 7. QA
- **Function**: Test strategy, regression testing, smoke tests, acceptance criteria
- **Cognitive demand**: Coverage analysis, edge case enumeration, test design
- **Output**: Test plan, test results, coverage report
- **Agents that fill this role**: qa-automation-lead, Test-Writer, Test-Specialist
- **Quality metric**: Defect escape rate, test coverage, regression prevention

---

## Model Assignment Strategy

### Role-to-Matrix Mapping

| Role | Model Tier | Rationale | Acceptable Models |
|---|---|---|---|
| Planner | **Strongest** | Architecture requires deep reasoning, trade-off analysis, and pattern synthesis | GPT-5.5, Claude Opus |
| Executor | **Fast/Cheap** | Following patterns and writing code is instruction-following, not reasoning | GPT-4o, Composer 2.5, Cursor ACP (non-GPT) |
| Verifier | **Separate strong** | Must be skeptical with fresh context — same model as executor fails | Different model from executor (if executor=cheap, verifier=strong) |
| Reviewer | **Strong** | Pattern compliance requires deep codebase knowledge and rule expertise | GPT-5.5, Claude Sonnet |
| Security | **Strong + rules** | Threat modeling needs reasoning + deterministic rule checking | GPT-5.5 + GuardVibe rules |
| Performance | **Specialized** | Benchmarking needs tool access, not just reasoning | Any with DB2/SSH access + benchmarking tools |
| QA | **Medium** | Test design needs moderate reasoning + domain knowledge | GPT-4o, Claude Sonnet |

### Critical Rule: Verifier != Executor
The verifier MUST use a different model than the executor. Same-model verification has a <30% bug detection rate (confirmation bias). Different-model verification achieves 60-80%.

### Critical Rule: Planner != Executor for T3
For Tier 3 tasks, the planner and executor MUST be different models. The planner's reasoning produces a plan; the executor's instruction-following implements it. Same model tends to rationalize its own plan rather than follow it critically.

---

## Domain-Specific Routing

### Frontend (Flutter) Tasks

```
┌─────────────────────────────────────────────────────────┐
│                   FRONTEND TASK                         │
├─────────────┬──────────────┬──────────────┬─────────────┤
│   Planner   │  Executor    │  Verifier    │  Reviewer   │
├─────────────┼──────────────┼──────────────┼─────────────┤
│ Architect-  │ Flutter-UI   │ Flutter-Perf │ Check-      │
│ Planner     │ Specialist   │ Specialist   │ Reviewer    │
│ (GPT-5.5)   │ (GPT-4o)     │ (Claude)     │ (GPT-5.5)   │
├─────────────┼──────────────┼──────────────┼─────────────┤
│ + Flutter-  │ + Flutter-   │ + Visual-    │ + Simplify- │
│   Arch      │   Data       │   Design     │   Reviewer  │
└─────────────┴──────────────┴──────────────┴─────────────┘
```

**Examples:**
- New feature page: Planner (arch) → Executor (UI + Data) → Verifier (perf + a11y) → Reviewer (patterns)
- Bug fix: Executor (UI fix) → Verifier (regression test) → Reviewer (quick check)
- Refactor: Planner (split plan) → Executor (widget extraction) → Verifier (behavior parity) → Reviewer (DRY check)

### Backend (Node.js/Express) Tasks

```
┌─────────────────────────────────────────────────────────┐
│                   BACKEND TASK                          │
├─────────────┬──────────────┬──────────────┬─────────────┤
│   Planner   │  Executor    │  Verifier    │  Reviewer   │
├─────────────┼──────────────┼──────────────┼─────────────┤
│ Architect-  │ Node-Express │ API-Contract │ Check-      │
│ Planner     │ Specialist   │ Specialist   │ Reviewer    │
│ (GPT-5.5)   │ (GPT-4o)     │ (Claude)     │ (GPT-5.5)   │
├─────────────┼──────────────┼──────────────┼─────────────┤
│ + Runtime-  │ + DB2-AS400  │ + Security-  │ + Simplify- │
│   Log       │              │   Validator  │   Reviewer  │
└─────────────┴──────────────┴──────────────┴─────────────┘
```

**Examples:**
- New endpoint: Planner (contract + auth) → Executor (route + service) → Verifier (contract test) → Reviewer (OWASP)
- Bug fix: Executor (fix) → Verifier (integration test) → Reviewer (quick)
- Performance: Planner (query plan) → DB2-Optimizer (SQL rewrite) → Verifier (benchmark) → Reviewer (readability)

### DB2/AS400 Tasks

```
┌─────────────────────────────────────────────────────────┐
│                     DB TASK                             │
├─────────────┬──────────────┬──────────────┬─────────────┤
│   Planner   │  Executor    │  Verifier    │  Reviewer   │
├─────────────┼──────────────┼──────────────┼─────────────┤
│ Architect-  │ DB2-AS400    │ DB2-Query-   │ DB2-AS400   │
│ Planner     │ Specialist   │ Optimizer    │ Specialist  │
│ (GPT-5.5)   │ (GPT-4o)     │ (GPT-5.5)    │ (Claude)    │
├─────────────┼──────────────┼──────────────┼─────────────┤
│             │              │ + Runtime-   │             │
│             │              │   Log        │             │
└─────────────┴──────────────┴──────────────┴─────────────┘
```

**Examples:**
- New query: Planner (schema + joins) → Executor (SQL) → Verifier (EXPLAIN plan) → Reviewer (security)
- Migration: Planner (rollback plan) → Executor (DDL) → Verifier (data integrity) → Reviewer (perf impact)
- Optimization: Planner (bottleneck analysis) → DB2-Optimizer (rewrite) → Verifier (benchmark) → Reviewer (maintainability)

### Security Tasks

```
┌─────────────────────────────────────────────────────────┐
│                  SECURITY TASK                          │
├─────────────┬──────────────┬──────────────┬─────────────┤
│   Planner   │  Executor    │  Verifier    │  Reviewer   │
├─────────────┼──────────────┼──────────────┼─────────────┤
│ AppSec-     │ AppSec-      │ Independent  │ Security-   │
│ Engineer    │ Engineer     │ Security     │ Validator   │
│ (GPT-5.5)   │ (GPT-4o)     │ Auditor      │ (GPT-5.5)   │
│             │              │ (Claude)     │             │
├─────────────┼──────────────┼──────────────┼─────────────┤
│             │ + GuardVibe  │ + GuardVibe  │             │
│             │   rules      │   rules      │             │
└─────────────┴──────────────┴──────────────┴─────────────┘
```

---

## Decision Tree for Role Assignment

```
START
  │
  ├─ Is this a T1 task (simple, low risk)?
  │   └─ YES → Single Executor (fast model) + self-check
  │
  ├─ Is this a T2 task (moderate complexity)?
  │   ├─ Does it touch auth/DB/API boundary?
  │   │   ├─ YES → Planner (strong) + Executor (fast) + Verifier (different model)
  │   │   └─ NO  → Executor (fast) + Reviewer (medium)
  │   └─ Does it have security implications?
  │       └─ YES → Add Security role (rules-based + strong model)
  │
  ├─ Is this a T3 task (complex, high risk)?
  │   ├─ Planner (strongest) → produces plan
  │   ├─ Executor (strong or fast, per sub-task) → implements
  │   ├─ Verifier (different model from executor) → verifies
  │   ├─ Reviewer (strong) → reviews
  │   └─ Security/Performance (if applicable) → specialized checks
  │
  └─ Is this R4 (production mutation)?
      └─ Full team: Planner + Executor + Verifier + Reviewer + Security + SRE
```

---

## Shapley-Based Role Criticality

### Concept
Shapley value measures each role's marginal contribution to the outcome. In practice:
- Which role, if removed, causes the biggest quality drop?
- Which role is the bottleneck (slowest, most backlogged)?
- Where does adding capacity yield the highest quality improvement?

### Identifying the Bottleneck Role

| Symptom | Bottleneck Role | Action |
|---|---|---|
| Plans are vague, miss edge cases | Planner | Upgrade model or add Architect-Planner |
| Implementation has bugs, misses patterns | Executor | Upgrade model or add specialist |
| Bugs escape to staging | Verifier | Upgrade model or add Technical-Verifier |
| Style/DRY issues accumulate | Reviewer | Add Simplify-Reviewer pass |
| Security issues found post-deploy | Security | Add GuardVibe mandatory scan |
| Performance regressions in prod | Performance | Add pre-deploy benchmark gate |

### When to Upgrade vs Add Agents

```
IF bottleneck_role == "planner" AND task_complexity == "high":
    UPGRADE model (strongest available)
    
IF bottleneck_role == "executor" AND task_volume == "high":
    ADD parallel executors (split by workstream)
    
IF bottleneck_role == "verifier" AND bug_escape_rate > 10%:
    UPGRADE verifier model OR add second verifier
    
IF bottleneck_role == "reviewer" AND review_turnaround > 30min:
    ADD reviewer (parallel review of independent files)
```

### Measuring Role Contribution

Track per task:
1. **Planner quality**: % of plan steps completed without revision
2. **Executor quality**: % of implementation passing first verification
3. **Verifier quality**: % of bugs found by verifier vs found later
4. **Reviewer quality**: % of review comments that are actionable

```json
{
  "role_contribution": {
    "planner": {"quality_score": 0.85, "revision_rate": 0.15},
    "executor": {"first_pass_rate": 0.72, "bug_rate": 0.08},
    "verifier": {"detection_rate": 0.78, "false_positive_rate": 0.12},
    "reviewer": {"actionable_rate": 0.88, "miss_rate": 0.05}
  }
}
```

---

## Cost-Accuracy Optimization

### Task Complexity Tiers

#### Simple Tasks (T1, R0-R1)
- **Roles**: Executor only
- **Model**: Fast/cheap (GPT-4o, Composer 2.5)
- **Cost**: ~1x
- **Accuracy**: 90% (self-check sufficient)
- **Examples**: Typo fix, comment update, simple widget, config change

#### Medium Tasks (T2, R1-R2)
- **Roles**: Planner (strong) + Executor (cheap) + Verifier (medium)
- **Model mix**: 1 strong + 1 cheap + 1 medium
- **Cost**: ~3x
- **Accuracy**: 95% (catches most issues)
- **Examples**: New endpoint, new page, DB query, auth flow

#### Critical Tasks (T3, R2-R3)
- **Roles**: Planner (strongest) + Executor (strong) + Verifier (different strong) + Reviewer (strong)
- **Model mix**: 2 strongest + 1 different strong + 1 strong
- **Cost**: ~6x
- **Accuracy**: 98% (defense in depth)
- **Examples**: Architecture change, migration, security fix, payment flow

#### Production Mutation (R4)
- **Roles**: Full team + SRE + AppSec + QA
- **Model mix**: All strong + rules-based + human approval
- **Cost**: ~10x
- **Accuracy**: 99.5% (human in the loop)
- **Examples**: Deploy, rollback, DDL, secret rotation

### Cost-Accuracy Curve

```
Accuracy
  99% ┤                              ╭──── Production (R4)
  98% ┤                    ╭────────╯
  95% ┤          ╭────────╯
  90% ┤    ╭────╯
  85% ┤────╯
      └──────────────────────────────── Cost
        1x    2x    3x    4x    6x    10x
```

**Diminishing returns**: Going from 0→1 verifier adds 5% accuracy. Going from 1→2 verifiers adds 1%. The sweet spot is 1 planner + 1 executor + 1 verifier for most tasks.

### When to Use a Single Model

A single model is sufficient when:
- T1 task with R0 risk
- Pure research/reading task
- Documentation generation
- Simple formatting/linting fixes
- Tasks with <50 lines of code change AND no boundary touch

### When to Use Multiple Models

Multiple models are required when:
- T2+ task (different planner + executor)
- Security-sensitive (executor + security reviewer)
- Performance-critical (executor + performance verifier)
- Cross-module changes (multiple executors in parallel)
- Production-bound (full team)

---

## Concrete Examples

### Example 1: New Flutter Feature (Commissions Tab)

```
Task: Add commissions tab with chart and list
Tier: T2, R2

Roles:
  1. Planner (Architect-Planner, GPT-5.5)
     → Decompose: data model, provider, UI page, chart widget, API contract
     → Risk: DB2 query performance, chart rendering perf
     
  2. Executor (Flutter-UI-Specialist + Flutter-Data-Specialist, GPT-4o)
     → Implement: provider, page, chart, list items
     → Pattern: follow existing pedidos/cobros structure
     
  3. Verifier (Flutter-Performance-Specialist, Claude Sonnet)
     → Check: no N+1, list virtualization, chart rebuild optimization
     → Verify: provider select() usage, const widgets
     
  4. Reviewer (Check-Reviewer, GPT-5.5)
     → Check: pattern compliance, DRY, import boundaries
     
Cost: ~4x single model
Expected accuracy: 95%
```

### Example 2: Backend API Endpoint (Receipt with Signature)

```
Task: Add signaturePath to receipt endpoint
Tier: T2, R2 (DB + API boundary)

Roles:
  1. Planner (Architect-Planner, GPT-5.5)
     → Contract: request/response shape, auth requirements
     → DB: verify column exists in schema
     
  2. Executor (Node-Express-Specialist, GPT-4o)
     → Implement: route handler, service method, DB query
     → Pattern: follow existing receipt endpoint
     
  3. Verifier (API-Contract-Specialist, Claude Sonnet)
     → Check: contract matches Flutter expectations
     → Test: integration test with real DB
     
  4. Security (Security-Validator, rules-based + GPT-5.5)
     → Check: auth before DB, parameterized query, no injection
     
Cost: ~4x single model
Expected accuracy: 96%
```

### Example 3: DB2 Query Optimization (Deuda List)

```
Task: Optimize slow deuda query (8s → <500ms)
Tier: T2, R2 (DB performance)

Roles:
  1. Planner (DB2-Query-Optimizer, GPT-5.5)
     → Analyze: EXPLAIN plan, missing indexes, join strategy
     → Plan: rewrite query, add index, test plan
     
  2. Executor (DB2-AS400-Specialist, GPT-4o)
     → Implement: SQL rewrite, index creation
     → Safety: test in non-prod first
     
  3. Verifier (DB2-Query-Optimizer, different context)
     → Verify: EXPLAIN plan improved, no regression
     → Benchmark: before/after timing
     
Cost: ~3x single model
Expected accuracy: 97%
```

### Example 4: Security Fix (SQL Injection)

```
Task: Fix SQL injection in search endpoint
Tier: T3, R3 (security + production)

Roles:
  1. Planner (AppSec-Engineer, GPT-5.5)
     → Analyze: attack surface, all injection points
     → Plan: parameterized queries, input validation, WAF rules
     
  2. Executor (Node-Express-Specialist, GPT-4o)
     → Fix: all raw SQL → parameterized
     → Add: input validation with Zod
     
  3. Verifier (AppSec-Engineer, Claude Opus)
     → Verify: no remaining injection points
     → Test: fuzzing, edge cases
     
  4. Security (Security-Validator, rules-based)
     → GuardVibe scan: all files clean
     
  5. Reviewer (Check-Reviewer, GPT-5.5)
     → Check: no regression, tests pass
     
Cost: ~6x single model
Expected accuracy: 98%
```

---

## Integration with decision-router

The decision-router should output role assignments:

```json
{
  "task_id": "20260810-221400-gmp-anti-rationalization",
  "tier": "T2",
  "risk": "R2",
  "roles": [
    {
      "role": "planner",
      "agent": "Architect-Planner",
      "model": "GPT-5.5",
      "reason": "Architecture requires deep reasoning"
    },
    {
      "role": "executor",
      "agent": "code-autopilot",
      "model": "GPT-4o",
      "reason": "Implementation following established patterns"
    },
    {
      "role": "verifier",
      "agent": "Technical-Verifier",
      "model": "Claude Sonnet",
      "reason": "Independent verification with different model"
    }
  ],
  "cost_multiplier": 4,
  "expected_accuracy": 0.95
}
```

---

## Integration with handoff-ledger

Each handoff records role assignment:

```json
{
  "task_id": "...",
  "from_role": "planner",
  "to_role": "executor",
  "from_model": "GPT-5.5",
  "to_model": "GPT-4o",
  "context_packet": {
    "plan": "...",
    "risks": ["..."],
    "patterns": ["..."]
  },
  "role_criticality": "executor"
}
```

---

## Usage

### Manual Invocation
```
/role-aware
```
Runs the decision tree for the current task and outputs role assignments.

### Automatic Invocation
The Chief automatically invokes this skill:
- After decision-router classifies a T2+ task
- When parallel-dispatch is needed
- When model assignment is ambiguous
- When cost-accuracy tradeoff needs analysis

### Slash Commands
```
/role-aware frontend     → Show frontend role matrix
/role-aware backend      → Show backend role matrix
/role-aware db           → Show DB role matrix
/role-aware security     → Show security role matrix
/role-aware cost         → Show cost-accuracy analysis
/role-aware decision     → Run decision tree for current task
```

---

## Metrics to Track

| Metric | Target | How to Measure |
|---|---|---|
| First-pass correctness | >85% | % of implementations passing verifier without revision |
| Bug escape rate | <5% | % of bugs found in staging/production vs caught in verification |
| Planner revision rate | <20% | % of plan steps that need revision during execution |
| Verifier detection rate | >75% | % of injected bugs caught by verifier |
| Reviewer actionable rate | >80% | % of review comments that result in code changes |
| Cost per task | Decreasing | Track model usage per task over time |
