---
name: scope-creep-detector
description: Detects and blocks agents from modifying files outside their assigned scope. Validates scope compliance pre/post-execution via git diff, detects CI weakening patterns, and generates machine-readable scope reports. Invocable as /scope-creep-detector.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  project_scope: gmp
  triggers:
    - scope creep
    - out of scope
    - file gate
    - scope violation
    - CI weakening
    - test removal
    - allowed_files
    - file-gate-check
---

## Purpose

Prevents agents from touching files outside their assigned scope. Every subagent handoff defines `allowed_files`; this skill enforces that boundary before and after execution. Also detects CI weakening patterns where tests are silently removed, skipped, or coverage thresholds lowered to "make tests pass."

## When to Use

- Before delegating any Tier 2/3 task to a subagent
- After a subagent reports completion, before accepting output
- When `handoff-ledger` records a new handoff
- During verification loop, as a gate before PASS
- When `file-gate-check` reports a violation
- When `/scope-creep-detector` is invoked explicitly

## Required Flow

### Phase 1: Pre-Execution Scope Definition

Extract `allowed_files` from the context_packet:

```json
{
  "task_id": "string",
  "context": {
    "allowed_files": [
      "lib/features/reparto/presentation/widgets/rutero_detail_modal.dart",
      "lib/features/reparto/providers/rutero_provider.dart"
    ],
    "allowed_globs": [
      "lib/features/reparto/**",
      "test/features/reparto/**"
    ],
    "project": "gmp"
  }
}
```

Rules:
- `allowed_files`: exact file paths the agent may modify
- `allowed_globs`: glob patterns expanding to allowed paths (e.g., `lib/features/commissions/**`)
- If neither is specified, scope is UNKNOWN → BLOCK until defined
- Test files matching `test/**` or `**/*_test.dart` are allowed if the source file is allowed
- `pubspec.yaml` changes require explicit inclusion (dependency changes affect whole project)

### Phase 2: Post-Execution Verification

Run git diff to detect actual changes:

```powershell
# Get changed files vs the branch base or last commit
git diff --name-only HEAD~1..HEAD

# Or against a specific base branch
git diff --name-only origin/main...HEAD

# For uncommitted changes
git diff --name-only
git diff --name-only --cached
```

Cross-reference every changed file against `allowed_files` + expanded `allowed_globs`.

A file is "within scope" if:
1. It matches an entry in `allowed_files` exactly, OR
2. It matches any glob pattern in `allowed_globs` (use `glob` tool to expand)

### Phase 3: CI Weakening Detection

Check for these patterns in the diff:

**Test removal/renaming:**
```powershell
# Files deleted in test directories
git diff --name-status | Select-String -Pattern "^D.*test/|^D.*_test\."

# Files renamed (may hide test deletion)
git diff --name-status | Select-String -Pattern "^R.*test/|^R.*_test\."
```

**Test skipping:**
```powershell
# Added skip markers
git diff | Select-String -Pattern "^\+\s*(skip|Skip|skip\(|@skip|xit\(|xtest\(|xdescribe\()"

# Added .skip to existing tests
git diff | Select-String -Pattern "^\+\s*\.skip"
```

**CI step disabling:**
```powershell
# Added || true to CI commands
git diff | Select-String -Pattern "\|\|\s*true"

# Commented out CI steps
git diff | Select-String -Pattern "^\+\s*#\s*(test|jest|flutter test|dart test)"

# Coverage threshold lowered
git diff | Select-String -Pattern "coverage.*threshold|minimum_coverage|lines.*[0-9]+%" -CaseSensitive:$false
```

**Test file content weakening:**
```powershell
# expect(true) patterns
git diff | Select-String -Pattern "expect\(\s*true\s*\)"

# Empty test bodies
git diff | Select-String -Pattern "test\([^)]*\)\s*\{\s*\}"

# Removed assertions (deletions)
git diff | Select-String -Pattern "^\-\s*expect\(|^\-\s*assert\(|^\-\s*verify\("
```

### Phase 4: Scope Report Generation

Produce a machine-readable scope report:

```json
{
  "task_id": "string",
  "timestamp": "ISO-8601",
  "scope_status": "PASS | WARN | BLOCK",
  "files_modified": [
    "lib/features/reparto/presentation/widgets/rutero_detail_modal.dart",
    "lib/features/cobros/providers/cobros_provider.dart"
  ],
  "files_allowed": [
    "lib/features/reparto/presentation/widgets/rutero_detail_modal.dart",
    "lib/features/reparto/providers/rutero_provider.dart"
  ],
  "violations": [
    {
      "file": "lib/features/cobros/providers/cobros_provider.dart",
      "reason": "File outside allowed scope. Allowed: lib/features/reparto/**",
      "severity": "BLOCK"
    }
  ],
  "ci_integrity_status": {
    "status": "PASS | WARN | BLOCK",
    "tests_removed": [],
    "tests_skipped": [],
    "ci_steps_disabled": [],
    "coverage_threshold_changed": false,
    "tautological_tests_added": [],
    "assertions_removed": []
  },
  "recommendation": "accept | reject_and_rollback | reject_and_retry"
}
```

## Integration with handoff-ledger

When `handoff-ledger` records a handoff:

1. Extract `context_packet.context.allowed_files` and `context_packet.context.allowed_globs`
2. Store scope metadata alongside the handoff record
3. On `record_output`, run Phase 2 and Phase 3 checks
4. If violations found, set `scope_status: BLOCK` in the output
5. On `summarize`, include scope compliance in the summary

## Decision Matrix

| Condition | Scope Status | Action |
|-----------|-------------|--------|
| All modified files within allowed scope, no CI weakening | PASS | Accept output |
| Modified files within scope, minor CI warnings (1 skip) | WARN | Accept with note; flag for review |
| Any file outside allowed scope | BLOCK | Reject output, restore snapshot, retry or escalate |
| Tests removed without justification | BLOCK | Reject output, require test restoration |
| CI steps disabled (`|| true`, commented out) | BLOCK | Reject output, require CI restoration |
| Coverage threshold silently lowered | WARN | Accept only with explicit justification from Javier |
| Tautological tests added (`expect(true).toBe(true)`) | WARN | Flag for review; do not count as coverage |
| Assertions removed from existing tests | BLOCK | Reject output, require assertion restoration |

## Output

Always report:
1. Scope status (PASS/WARN/BLOCK)
2. List of violations (if any)
3. CI integrity status
4. Recommended action

If BLOCK: include exact files that violated scope and the allowed scope for reference.
