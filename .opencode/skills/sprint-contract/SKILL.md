---
name: sprint-contract
description: Negotiate a binding contract between generator and evaluator BEFORE any code is written. Defines scope, acceptance criteria, verification methods, edge cases, and known limitations. Max 3 negotiation rounds.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  project_scope: gmp-granja
  version: 1.0
  references:
    - .opencode/config/quality-rubric.yaml
    - .opencode/config/verification-loop.yaml
    - .opencode/config/handoff-contract.yaml
---

## Purpose

Implements Anthropic's sprint contract pattern: generator and evaluator **negotiate what "done" looks like** before any code is written. Eliminates subjective judgment by making verification purely contractual.

**Trigger**: `/sprint-contract` or when Chief detects Tier 2+ work with ambiguous acceptance criteria.

## The Protocol

```
┌─────────────────────────────────────────────────────────────────┐
│  SPRINT CONTRACT LIFECYCLE                                      │
│                                                                 │
│  1. PROPOSE    → Generator drafts contract                      │
│  2. REVIEW     → Evaluator reviews for completeness             │
│  3. NEGOTIATE  → Iterate (max 3 rounds)                         │
│  4. FINALIZE   → Both sign off                                  │
│  5. EXECUTE    → Generator builds against contract              │
│  6. VERIFY     → Evaluator verifies against contract            │
│                                                                 │
│  Exit conditions:                                               │
│  - Agreement reached → proceed to execution                     │
│  - Round 3 without agreement → escalate to Chief                │
│  - Fundamental disagreement → Chief arbitrates                  │
└─────────────────────────────────────────────────────────────────┘
```

## Contract Structure

Every sprint contract uses this markdown format:

```markdown
# Sprint Contract: [task_id]

## Metadata
- **Task ID**: YYYYMMDD-HHMMSS-proyecto-xxxx
- **Tier**: T1 | T2 | T3
- **Risk**: R0 | R1 | R2 | R3 | R4
- **Created**: ISO-8601 timestamp
- **Round**: 1 | 2 | 3

## 1. Scope

### In Scope
- [Exact files to modify]
- [Exact behavior to implement]
- [Exact endpoints/tables touched]

### Out of Scope
- [Explicit exclusions]
- [Related but deferred work]
- [Things that might look related but aren't]

## 2. Acceptance Criteria

Each criterion MUST be:
- **Specific**: Exact behavior, not "works correctly"
- **Measurable**: Has a pass/warn/block threshold
- **Verifiable**: Can be checked by a tool or test
- **Independent**: Can be judged in isolation

| ID | Criterion | Verification Method | Pass Threshold | Warn Threshold | Block Threshold |
|----|-----------|-------------------|----------------|----------------|-----------------|
| AC-001 | [description] | [tool/test/command] | [value] | [value] | [value] |
| AC-002 | ... | ... | ... | ... | ... |

## 3. Verification Methods

For each acceptance criterion, specify:
- **Tool**: Which tool verifies this (dart analyze, flutter test, rg, etc.)
- **Command**: Exact command to run
- **Expected output**: What success looks like
- **Evidence**: What artifact proves it (screenshot, test output, log)

## 4. Edge Cases

Generator MUST declare which edge cases are handled:

- [ ] Empty/null inputs
- [ ] Maximum length inputs
- [ ] Special characters / injection attempts
- [ ] Concurrent access
- [ ] Network failure mid-operation
- [ ] Offline state
- [ ] Session expiry
- [ ] Duplicate submissions
- [ ] Large datasets (pagination boundary)
- [ ] First run / clean install

## 5. Known Limitations

Deliberate simplifications (ponytail markers):

| Limitation | Ceiling | Upgrade Trigger |
|------------|---------|-----------------|
| [description] | [known limit] | [when to improve] |

## 6. Quality Rubric Mapping

Which criteria from `quality-rubric.yaml` apply:

- [ ] COR-001: Zero type errors
- [ ] COR-002: Zero lint errors
- [ ] SEC-001: Zero critical/high SAST
- [ ] PERF-001: Zero N+1
- [ ] TEST-001: Diff coverage >= 80%
- [ ] ARCH-001: Zero scope escapes
- [ ] ... (check all that apply)

## 7. Non-Goals

What this work explicitly does NOT achieve:
- [Performance target not in scope]
- [Browser support not required]
- [Backward compatibility not needed]

## 8. Sign-Off

| Role | Agent | Status | Date |
|------|-------|--------|------|
| Generator | [agent_name] | PENDING | - |
| Evaluator | evaluator | PENDING | - |
| Chief | chief-engineer-assistant | PENDING | - |
```

## Negotiation Protocol

### Round 1: Proposal

**Generator proposes** the complete contract. Must include:
- At least 3 acceptance criteria with measurable thresholds
- At least 5 edge cases declared
- At least 1 known limitation (if applicable)

**Evaluator reviews** and responds with:
- `APPROVE`: Contract is complete and testable
- `REJECT`: With specific missing elements
- `AMEND`: With proposed changes to specific sections

### Round 2: Amendment

If REJECT or AMEND:
- Generator addresses each point
- Evaluator reviews amendments
- If still disagreement → Round 3

### Round 3: Final

If still disagreement after Round 3:
- Both submit their positions to Chief
- Chief arbitrates and imposes final contract
- Chief's decision is binding

### Negotiation Rules

1. **Evidence-based**: Every objection must cite a missing threshold, untestable criterion, or missing edge case
2. **No scope expansion**: Evaluator cannot add new requirements in Round 2+. Only clarify existing ones.
3. **No lowering bars**: Generator cannot reduce thresholds to make them easier
4. **Time-bound**: Each round completes before moving to execution
5. **Documented**: All rounds preserved in contract history

## Templates by Task Type

### Feature Template

```markdown
# Sprint Contract: [task_id] — Feature

## Scope
### In Scope
- New widget/page at `lib/features/[feature]/presentation/pages/[page].dart`
- Provider at `lib/features/[feature]/providers/[provider].dart`
- Navigation integration in `main_shell.dart`

### Out of Scope
- Backend API changes (separate contract)
- Database schema changes
- Unit tests for existing code

## Acceptance Criteria
| ID | Criterion | Verification | Pass | Warn | Block |
|----|-----------|-------------|------|------|-------|
| AC-001 | Page renders without error | flutter test | 0 exceptions | - | >0 |
| AC-002 | Navigation from main_shell works | integration_test | Route pushed | - | Exception |
| AC-003 | Loading/empty/error states exist | Widget test | All 3 states | Missing 1 | Missing 2+ |
| AC-004 | Provider state updates correctly | Unit test | All transitions | Partial | No tests |

## Edge Cases
- [x] Empty data state
- [x] Loading state
- [x] Error state
- [x] Offline state
- [ ] Concurrent navigation (out of scope)

## Known Limitations
| Limitation | Ceiling | Upgrade Trigger |
|------------|---------|-----------------|
| No pagination | First 50 records | >50 records in production |
| No pull-to-refresh | Manual refresh only | User feedback requests it |
```

### Bug Fix Template

```markdown
# Sprint Contract: [task_id] — Bug Fix

## Scope
### In Scope
- Fix file: `lib/features/[feature]/[file].dart`
- Root cause: [specific function/line]
- Regression test to prevent recurrence

### Out of Scope
- Refactoring surrounding code
- Fixing similar bugs in other files
- Performance optimization

## Acceptance Criteria
| ID | Criterion | Verification | Pass | Warn | Block |
|----|-----------|-------------|------|------|-------|
| AC-001 | Bug scenario no longer reproduces | Widget test | Test passes | - | Test fails |
| AC-002 | No regression in existing tests | flutter test suite | All pass | Known failures | New failures |
| AC-003 | Root cause documented | Code comment | Present with explanation | Vague | Missing |

## Edge Cases
- [x] Original bug trigger
- [x] Boundary values near the bug trigger
- [x] Related code paths that might have same issue

## Known Limitations
| Limitation | Ceiling | Upgrade Trigger |
|------------|---------|-----------------|
| Fix is local | May not address systemic issue | Same pattern found elsewhere |
```

### Migration Template

```markdown
# Sprint Contract: [task_id] — Migration

## Scope
### In Scope
- Migrate [N] files from [old_pattern] to [new_pattern]
- Update imports in [N] dependent files
- Run build_runner if code generation affected

### Out of Scope
- Behavior changes (migration is mechanical)
- New features using the new pattern
- Documentation updates

## Acceptance Criteria
| ID | Criterion | Verification | Pass | Warn | Block |
|----|-----------|-------------|------|------|-------|
| AC-001 | All target files migrated | rg for old pattern | 0 hits | - | >0 hits |
| AC-002 | No behavior change | Existing tests pass | All pass | Known failures | New failures |
| AC-003 | Build succeeds | flutter build / npm build | Exit 0 | Warnings | Exit != 0 |
| AC-004 | No broken imports | dart analyze | 0 errors | - | >0 errors |

## Edge Cases
- [x] Files with mixed old/new patterns
- [x] Files that import both old and new
- [x] Circular dependencies
- [x] Code-generated files

## Known Limitations
| Limitation | Ceiling | Upgrade Trigger |
|------------|---------|-----------------|
| Mechanical only | May miss semantic improvements | Follow-up refactor contract |
```

### Audit Template

```markdown
# Sprint Contract: [task_id] — Audit

## Scope
### In Scope
- Audit target: [files/endpoints/tables]
- Criteria: [security/performance/maintainability]
- Output: Findings report with severity

### Out of Scope
- Fixing findings (separate contracts)
- Implementation work
- Testing beyond verification

## Acceptance Criteria
| ID | Criterion | Verification | Pass | Warn | Block |
|----|-----------|-------------|------|------|-------|
| AC-001 | All target files reviewed | File list vs actual | 100% | >90% | <90% |
| AC-002 | Findings have severity + location | Finding format | All formatted | Some incomplete | Unstructured |
| AC-003 | No false positives | Sample verification | <5% FP | 5-15% FP | >15% FP |

## Edge Cases
- [x] Files with multiple issues
- [x] Cross-file patterns
- [x] Configuration files (not just source)

## Known Limitations
| Limitation | Ceiling | Upgrade Trigger |
|------------|---------|-----------------|
| Static analysis only | Runtime issues may be missed | Follow-up with runtime audit |
```

## Integration with Chief Protocol

### When to Invoke

The Chief should invoke `/sprint-contract` when:
1. Task tier is T2 or T3
2. Acceptance criteria are ambiguous or untestable
3. Generator and evaluator have disagreed in the past on similar work
4. The work is complex enough that "done" could be interpreted multiple ways

### State Machine Integration

```
[CONTRACT_DRAFTING] → Generator proposes
    ↓
[CONTRACT_REVIEWING] → Evaluator reviews
    ↓ (approve)
[CONTRACT_FINALIZED] → Both sign off
    ↓
[EXECUTING] → Generator builds
    ↓
[VERIFYING] → Evaluator verifies against contract
    ↓ (pass)
[DONE]
    ↓ (fail)
[ITERATING] → Generator fixes (max 2 iterations)
```

### Handoff Ledger Integration

```json
{
  "task_id": "20260810-143000-gmp-sprint-contract",
  "operation": "record_handoff",
  "phase": "contract_negotiation",
  "context_packet": {
    "contract": "full contract markdown",
    "round": 1,
    "generator_proposal": "...",
    "evaluator_response": "..."
  }
}
```

## Concrete Example

### Scenario: Add search to product list

**Generator proposes (Round 1):**

```markdown
## Acceptance Criteria
| ID | Criterion | Verification | Pass | Warn | Block |
|----|-----------|-------------|------|------|-------|
| AC-001 | Search filters products | Widget test | Filters correctly | - | No filter |
| AC-002 | Empty search shows all | Widget test | All shown | - | None shown |
```

**Evaluator rejects:**
> AC-001 untestable: "Filters correctly" is not measurable. Specify: input "apple" with 10 products (3 matching) → result list has exactly 3 items.
> AC-002 missing threshold: What does "all shown" mean numerically?
> Missing edge case: What if search term has special characters?
> Missing edge case: What if search term is empty string vs null?

**Generator amends (Round 2):**

```markdown
| ID | Criterion | Verification | Pass | Warn | Block |
|----|-----------|-------------|------|------|-------|
| AC-001 | Search "apple" returns 3 of 10 products | Widget test: pump search "apple", expect 3 ListTile | Exactly 3 | 1-2 | 0 or >3 |
| AC-002 | Empty search returns all 10 products | Widget test: pump "", expect 10 ListTile | Exactly 10 | 1-9 | 0 |
| AC-003 | Search "DROP TABLE" returns 0 (no crash) | Widget test: pump "DROP TABLE", expect 0 | 0 results, no exception | - | Exception |
| AC-004 | Search is case-insensitive | Widget test: "Apple" matches "apple" | Same results | - | Different results |
```

**Evaluator approves.** Contract finalized. Generator builds. Evaluator verifies against exact criteria.

## Output

After successful contract finalization, the skill produces:

1. **Contract file**: `.opencode/state/contracts/[task_id].md`
2. **Handoff ledger entry**: Both parties recorded
3. **State machine update**: `CONTRACT_FINALIZED`
4. **Execution authorization**: Generator may now proceed

## Failure Modes

| Mode | Cause | Resolution |
|------|-------|------------|
| Infinite negotiation | Both parties entrenched | Chief imposes contract after Round 3 |
| Contract too vague | Generator won't specify thresholds | Chief provides example criteria |
| Contract too rigid | Evaluator demands impossible precision | Chief sets reasonable thresholds |
| Scope creep during execution | Generator adds unapproved work | Evaluator blocks, requires new contract |
| Contract violation | Work doesn't match contract | Generator must fix or renegotiate |

## References

- `quality-rubric.yaml`: Source of truth for measurable thresholds
- `verification-loop.yaml`: How this integrates with maker/checker
- `handoff-contract.yaml`: Evidence schema for contract sign-off
- `task-classification.yaml`: When to use this skill (T2/T3)
