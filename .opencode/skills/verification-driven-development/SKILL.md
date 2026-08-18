---
name: verification-driven-development
version: 1.0
description: "VDD — Verification-Driven Development. Maker/checker split with independent evidence collection, anti-pattern detection, and iterative correction. Replaces human code review with a deterministic verification loop."
triggers:
  - /verification-driven-development
  - /vdd
  - "verify this code"
  - "run verification loop"
  - "maker checker"
tools:
  - elite-quality-gate
  - handoff-ledger
  - state-manager
  - rag-query
  - file-gate-check
agents:
  - Technical-Verifier
  - truth-teller
integrates_with:
  - .opencode/config/verification-loop.yaml
  - .opencode/config/quality-rubric.yaml
  - .opencode/config/elite-quality-gate.yaml
---

# Verification-Driven Development (VDD)

Implements the maker/checker paradigm where code is **never self-graded**. An independent checker verifies all claims against the quality rubric using real tool outputs. Zero human code review required when PASS.

## When to Use

- Tier 2/3 implementation tasks (multi-file, DB/API, auth, deploy)
- After any specialist delivers code output
- When chief-protocol verify step triggers
- When goal-loop-manager requires verification before advancing
- On-demand via /vdd or "verify this code"

## Workflow Overview

`
DISCOVER → MAKER → CHECKER → EVIDENCE → VERDICT → [ITERATE if BLOCK]
`

## Phase 1: DISCOVER — Context Assembly

Before any code is written or verified:

1. **Read the task state** via state-manager read for the active 	ask_id.
2. **Load memory** via ag-query on user_corrections, lessons, nti_patterns for the feature domain.
3. **Read existing files** — confirm real paths and entities before planning.
4. **Build the context_packet** (maker input):

`json
{
  "task_id": "YYYYMMDD-HHMMSS-proyecto-xxxx",
  "project": "gmp",
  "tier": 2,
  "feature": "repartidor",
  "scope": {
    "files_to_read": ["lib/features/rutero/providers/rutero_provider.dart"],
    "files_to_modify": ["lib/features/rutero/presentation/widgets/rutero_card.dart"],
    "files_to_create": [],
    "entities_to_verify": ["RuteroProvider", "fetchAlbaranesByDate"]
  },
  "acceptance_criteria": [
    "RuteroCard displays albaran count from provider",
    "No N+1 in build method",
    "Handles loading/empty/error states"
  ],
  "quality_rubric_ref": ".opencode/config/quality-rubric.yaml",
  "known_anti_patterns": ["await in forEach", "hardcoded 192.168.x.x"]
}
`

## Phase 2: MAKER — Implementation

The maker agent (specialist) implements against the context_packet.

### Maker Rules

1. **Read before write**: Always read target files before editing.
2. **Scope lock**: Only modify files listed in context_packet.scope.files_to_modify.
3. **No self-grading**: Do not claim "tests pass" or "quality is good" — that is the checker's job.
4. **Evidence collection**: After implementation, run these commands and capture output:

`ash
# Files changed
git diff --name-only

# Static analysis (Flutter)
flutter analyze lib/features/<feature>/

# Tests (if applicable)
flutter test test/features/<feature>/ --reporter=compact

# Backend tests (if applicable)
cd backend && npx jest --testPathPattern=<feature>
`

5. **Deliver specialist_output** to handoff-ledger with:
   - iles_modified (exact paths)
   - commands_executed (command + output + exit_code)
   - untime_facts_verified (what was checked, how, source)
   - 	ests_run (file + result + coverage_delta)
   - quality_gate_output (raw output from elite-quality-gate)

### Maker Anti-Patterns (BLOCK if detected)

The following patterns in maker output are **BLOCK**-level violations. The checker must flag them.

#### 1. Fake Confidence
`dart
// BLOCK: Claiming correctness without evidence
// "This should work fine" — no test run, no analyze output
// "All tests pass" — no test command in evidence
// "I verified it works" — no runtime verification captured
`

#### 2. Weak Evidence
`ash
# BLOCK: Claiming action without output
"ran flutter test" ← no output captured
"checked the code" ← no files listed
"analyzed for issues" ← no command or tool output
`

#### 3. Tautological Tests
`dart
// BLOCK: Test that tests the test, not the logic
test('provider exists', () {
  expect(provider, isNotNull);  // Not a behavior test
});

// BLOCK: Test that mirrors implementation exactly
test('adds numbers', () {
  expect(add(2, 3), equals(2 + 3));  // Tautology — tests the language, not the function
});
`

#### 4. Scope Creep
`dart
// BLOCK: Modifying files outside context_packet scope
// Maker was told to edit only rutero_card.dart but also modified main_shell.dart
`

#### 5. Silent Suppression
`dart
// BLOCK: Swallowing errors silently
try { await fetchData(); } catch (_) {}  // No logging, no typed error, no user feedback
`

## Phase 3: CHECKER — Independent Verification

The checker is a **different agent** (preferably different model) that receives ONLY:
- Maker's specialist_output (artifacts, NOT full context_packet)
- Acceptance criteria
- Quality rubric reference

### Checker Constraints

- **Cannot modify code** — read-only verification.
- **Cannot see maker's full context** — forces independent verification from artifacts alone.
- **Must use real tools** — elite-quality-gate, lutter analyze, dart test, g, git diff.
- **Must reference evidence** — every PASS/WARN/BLOCK must cite a command output or file content.

### Checker Execution Steps

1. **Verify file integrity**:
   `ash
   git diff --name-only  # Confirm only scope files changed
   `

2. **Run elite-quality-gate** on changed files.

3. **Check each acceptance criterion** against the actual code:
   - Read the modified files
   - Verify each criterion has corresponding implementation
   - Check for regressions in related files

4. **Cross-reference with quality-rubric.yaml** criteria:
   - N+1 detection
   - SQL safety
   - Async loop patterns
   - Hardcode detection
   - File size
   - Test coverage
   - Auth boundaries
   - Input validation

5. **Run maker's claimed commands independently** to confirm outputs match.

## Phase 4: EVIDENCE COLLECTION

All evidence is structured per erification-loop.yaml evidence_schema:

`yaml
verification_manifest:
  task_id: "YYYYMMDD-HHMMSS-proyecto-xxxx"
  schema_version: 1
  timestamp: "2026-08-10T18:30:00Z"
  maker:
    agent_id: "Flutter-UI-Specialist"
    model: "openai/gpt-5.6-sol"
  checker:
    agent_id: "Technical-Verifier"
    model: "openai/gpt-5.6-terra"
  evidence:
    files_read:
      - "lib/features/rutero/presentation/widgets/rutero_card.dart"
      - "lib/features/rutero/providers/rutero_provider.dart"
    commands_executed:
      - command: "flutter analyze lib/features/rutero/"
        output: "No issues found!"
        exit_code: 0
      - command: "flutter test test/features/rutero/"
        output: "All tests passed! (+15)"
        exit_code: 0
    runtime_facts_verified:
      - fact: "RuteroCard uses ConsumerWidget with select() for albaranes"
        source: "lib/features/rutero/presentation/widgets/rutero_card.dart:42"
        verification_method: "read"
    tests_run:
      - test_file: "test/features/rutero/rutero_card_test.dart"
        result: "15/15 passed"
        coverage_delta: "+3.2%"
    quality_gate_output: "elite-quality-gate PASS (0 BLOCK, 0 WARN)"
    rubric_evaluation:
      - criterion: "n_plus_one"
        status: PASS
        metric_value: 0
        threshold: 0
        evidence_ref: "commands_executed[0]"
      - criterion: "async_loop_patterns"
        status: PASS
        metric_value: 0
        threshold: 0
        evidence_ref: "files_read[0]"
`

Save manifest to: .opencode/state/verification-manifests/<task_id>-manifest.json

## Phase 5: VERDICT — PASS / WARN / BLOCK

Based on erification-loop.yaml stop_conditions:

### PASS (all required)
- All quality-rubric criteria PASS
- handoff-ledger summarize PASS
- Tests PASS (if applicable)
- No scope escape detected

### WARN (all required)
- Zero BLOCK criteria
- Some criteria WARN
- Risks documented in manifest
- Rollback plan present (for DB/API changes)

### BLOCK (any triggers)
- Any criterion BLOCK
- Missing evidence (claimed commands without output)
- Unverified entity (referenced file/symbol does not exist)
- Anti-pattern detected (see library below)
- Scope creep (files changed outside context_packet)

## Phase 6: ITERATE — Correction Loop

If verdict is BLOCK:

1. **Build corrected_context_packet** for maker:
   - Include original context_packet
   - Attach full verification manifest (all evidence, all BLOCK/WARN findings)
   - Add specific fix instructions per blocker
   - Increment retry counter

2. **Maker retries** with corrected context (max 1 retry per verification-loop.yaml).

3. **Checker re-verifies** — if second verdict is BLOCK:
   - Status: BLOCK + escalation_to_chief
   - Chief notifies Javier via Telegram with Human Verification Card
   - Task remains incomplete

### Same Error Detection
- Normalized error hash registered in .opencode/memory/same-error-tracker.jsonl
- Second occurrence within 30 days triggers etrospective-trigger

## Human Verification Card

When BLOCK reaches Javier (escalation or on-demand), generate:

`
┌─────────────────────────────────────────────┐
│  VERIFICATION CARD — BLOCK                   │
├─────────────────────────────────────────────┤
│ Task:    YYYYMMDD-HHMMSS-proyecto-xxxx       │
│ Feature: repartidor / rutero_card.dart        │
│ Maker:   Flutter-UI-Specialist               │
│ Checker: Technical-Verifier                  │
│                                              │
│ BLOCKERS:                                    │
│  1. N+1 detected in build() at line 87       │
│  2. Test coverage 45% (threshold 80%)        │
│                                              │
│ EVIDENCE:                                    │
│  flutter analyze → 2 issues                  │
│  flutter test → 7/15 passed                  │
│                                              │
│ OPTIONS:                                     │
│  A) Approve with technical debt (WARN)       │
│  B) Send back for correction (retry)         │
│  C) Escalate to senior review                │
│                                              │
│ Retry: 0/1 used                              │
└─────────────────────────────────────────────┘
`

## Integration Points

| Tool/Config | Role |
|---|---|
| .opencode/config/verification-loop.yaml | Defines maker/checker schema, stop_conditions, retry_policy |
| .opencode/config/quality-rubric.yaml | Defines criteria, thresholds, evidence requirements |
| .opencode/config/elite-quality-gate.yaml | Concrete checks (N+1, SQL, async, hardcode, etc.) |
| elite-quality-gate tool | Automated static analysis on changed files |
| Technical-Verifier agent | Independent checker (first pass) |
| 	ruth-teller agent | Independent checker (second pass / debate) |
| handoff-ledger | Records context_packet and specialist_output |
| state-manager | Persists verification state per task |
| ile-gate-check | Validates maker stayed within scope |

## Anti-Pattern Library (Reference)

| Pattern | Description | Verdict |
|---|---|---|
| Fake Confidence | Claiming success without evidence | BLOCK |
| Weak Evidence | Command mentioned but no output captured | BLOCK |
| Tautological Tests | Tests that test the language, not logic | BLOCK |
| Scope Creep | Modifying files outside approved scope | BLOCK |
| Silent Suppression | Empty catch blocks, swallowed errors | BLOCK |
| Rubber Stamping | Approving own work or teammate's without tools | BLOCK |
| Evidence Laundering | Citing unrelated evidence for a failing criterion | BLOCK |
| Threshold Moving | Relaxing criteria to force a PASS | BLOCK |
| Confirmation Bias | Only checking paths that support success | WARN |

## Example: Full VDD Run

`ash
# 1. State check
state-manager read --task-id 20260810-180000-gmp-rutero

# 2. RAG for prior lessons
rag-query --query "rutero_card verification patterns" --collections lessons,anti_patterns

# 3. Dispatch maker (Flutter-UI-Specialist)
handoff-ledger record_handoff --task-id 20260810-180000-gmp-rutero \
  --agent Flutter-UI-Specialist \
  --context_packet '{...}'

# 4. Maker implements, delivers specialist_output

# 5. Dispatch checker (Technical-Verifier)
handoff-ledger record_handoff --task-id 20260810-180000-gmp-rutero \
  --agent Technical-Verifier \
  --context_packet '{acceptance_criteria, rubric_ref, maker_output_ref}'

# 6. Checker runs verification, produces manifest

# 7. Verdict
handoff-ledger summarize --task-id 20260810-180000-gmp-rutero
# → PASS: task complete | WARN: proceed with notes | BLOCK: iterate or escalate
`

## Escalation Path

1. First BLOCK → retry maker with corrected context
2. Second BLOCK → escalate to Chief
3. Chief generates Human Verification Card for Javier
4. Javier chooses: approve-as-WARN, send-back, or manual-review

See also: /code-reuse-detector (run before implementation to avoid duplication)
