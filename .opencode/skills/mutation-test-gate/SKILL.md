---
name: mutation-test-gate
description: Verifies that tests actually catch bugs by introducing controlled mutations into code. Detects tautological tests, measures mutation score, and blocks merge if tests are ineffective. Invocable as /mutation-test-gate.
license: proprietary
compatibility: opencode
metadata:
  owner: Javier
  project_scope: gmp
  triggers:
    - mutation testing
    - test quality
    - tautology
    - fake tests
    - coverage quality
    - mutation score
    - test effectiveness
---

## Purpose

Verifies that tests actually catch bugs — not just pass. Introduces small controlled changes (mutations) to source code and checks whether the existing test suite fails. Tests that pass even when code is broken are worse than no tests: they provide false confidence.

This skill complements (not replaces) standard coverage. Coverage measures line execution; mutation testing measures test effectiveness.

## When to Use

- Before merging Tier 2/3 changes that include test modifications
- When `scope-creep-detector` reports CI weakening (tautological tests)
- During verification loop, as a gate before PASS
- When adding new test files to verify they catch real regressions
- When `/mutation-test-gate` is invoked explicitly
- When coverage is high but bugs still ship (coverage != effectiveness)

## Required Flow

### Phase 1: Tautology Detection

Before expensive mutation testing, scan for obviously useless tests.

**Dart tautologies:**
```powershell
# expect(true) / expect(false) literals
Select-String -Path "test/**/*.dart" -Pattern "expect\(\s*(true|false)\s*,"

# expect without matcher
Select-String -Path "test/**/*.dart" -Pattern "expect\([^)]+\)\s*;"  # no .toBe/.toEqual

# Empty test body
Select-String -Path "test/**/*.dart" -Pattern "test\([^)]*\)\s*\{\s*\}"

# Only comments in test body
Select-String -Path "test/**/*.dart" -Pattern "test\([^)]*\)\s*\{[^}]*//"  # comment-only

# Trivial equality (same value both sides)
Select-String -Path "test/**/*.dart" -Pattern "expect\(\s*(\w+)\s*,\s*\1\s*\)"
```

**JavaScript tautologies:**
```powershell
# expect(true) / expect(false) literals
Select-String -Path "backend/__tests__/**/*.js" -Pattern "expect\(\s*(true|false)\s*\)"

# toBe(true) / toBe(false) without computation
Select-String -Path "backend/__tests__/**/*.js" -Pattern "expect\([^)]+\)\.toBe\((true|false)\)"

# Empty test
Select-String -Path "backend/__tests__/**/*.js" -Pattern "test\([^)]*\)\s*\(\)\s*=>\s*\{\s*\}"

# Only assertions that always pass
Select-String -Path "backend/__tests__/**/*.js" -Pattern "expect\(.*\)\.toBeDefined\(\)"  # on literals
```

**Tautology verdict:**
- Any tautological test → WARN minimum
- >10% of tests are tautological → BLOCK
- Tautological tests in modified test files → BLOCK

### Phase 2: Mutation Operator Application

Apply mutations to source files (one at a time, revert after each):

**Dart Mutation Operators:**

| Operator | Description | Example |
|----------|-------------|---------|
| NEGATE_CONDITION | Invert boolean conditions | `if (a > b)` → `if (!(a > b))` |
| SWAP_OPERATOR | Swap arithmetic/comparison | `a + b` → `a - b` |
| SWAP_COMPARATOR | Swap comparison direction | `>=` → `<=` |
| REMOVE_METHOD_CALL | Remove a function call | `items.where(x).toList()` → `items.toList()` |
| ZERO_LITERAL | Replace numeric literal with 0 | `maxSize: 100` → `maxSize: 0` |
| EMPTY_STRING | Replace string with empty | `'error'` → `''` |
| NULL_RETURN | Replace return value with null | `return result;` → `return null;` |
| BOOLEAN_FLIP | Flip boolean literal | `true` → `false` |
| REMOVE_ASSERTION | Remove assert() call | `assert(x != null);` → `` |
| INVERT_NEGATION | Remove negation | `!isValid` → `isValid` |

**JavaScript Mutation Operators:**

| Operator | Description | Example |
|----------|-------------|---------|
| NEGATE_CONDITION | Invert conditions | `if (a && b)` → `if (!(a && b))` |
| SWAP_OPERATOR | Swap arithmetic | `a * b` → `a / b` |
| SWAP_COMPARISON | Swap comparison | `===` → `!==` |
| REMOVE_CALLBACK | Remove callback invocation | `cb(null, result)` → `` |
| EMPTY_OBJECT | Replace object literal | `{x: 1}` → `{}` |
| UNDEFINED_RETURN | Return undefined | `return data;` → `return undefined;` |
| BOOLEAN_FLIP | Flip boolean | `true` → `false` |
| REMOVE_AWAIT | Remove await keyword | `await fetch()` → `fetch()` |
| INVERT_TERNARY | Swap ternary branches | `a ? b : c` → `a ? c : b` |
| ZERO_DIVIDE | Replace divisor | `x / y` → `x / 0` |

### Phase 3: Mutation Execution

For each source file modified in the task:

1. **Snapshot the original file** (store content in memory)
2. **Apply a single mutation** to the file
3. **Run the relevant test suite:**
   ```powershell
   # Dart/Flutter
   flutter test test/features/reparto/rutero_detail_test.dart

   # JavaScript/Node
   cd backend && npx jest __tests__/rutero.test.js
   ```
4. **Record result:**
   - Test FAILS → mutation CAUGHT (good)
   - Test PASSES → mutation MISSED (bad)
5. **Revert the mutation** immediately (restore original content)
6. **Repeat** for each mutation operator applicable to that file

**Constraints:**
- Maximum 10 mutations per file (prioritize high-risk code)
- Skip mutations that would cause compile errors (JS syntax breakage)
- Skip mutations inside `build()` methods that only affect UI rendering
- Focus on: business logic, data transformations, conditionals, error handling, DB queries

### Phase 4: Mutation Score Calculation

```
mutation_score = (caught_mutations / total_mutations) * 100
```

**Thresholds:**

| Score | Status | Action |
|-------|--------|--------|
| >= 80% | PASS | Tests are effective |
| 60-79% | WARN | Tests catch most issues; flag gaps for review |
| < 60% | BLOCK | Tests are ineffective; require test improvements |

**Tautology penalty:**
- Each tautological test reduces effective score by 5 percentage points
- Example: raw score 70% with 2 tautologies → effective score 60%

### Phase 5: Mutation Report Generation

```json
{
  "task_id": "string",
  "timestamp": "ISO-8601",
  "mutation_status": "PASS | WARN | BLOCK",
  "total_mutations": 25,
  "caught_mutations": 20,
  "missed_mutations": 5,
  "mutation_score": 80.0,
  "effective_score": 75.0,
  "tautology_penalty": 5.0,
  "tautological_tests_found": [
    {
      "file": "test/features/reparto/example_test.dart",
      "line": 42,
      "pattern": "expect(true, true)"
    }
  ],
  "missed_mutations": [
    {
      "file": "lib/features/reparto/providers/rutero_provider.dart",
      "line": 156,
      "operator": "NEGATE_CONDITION",
      "mutation": "if (isValid)" → "if (!(isValid))",
      "test_file": "test/features/reparto/rutero_provider_test.dart",
      "recommendation": "Add test for invalid input rejection"
    }
  ],
  "recommendation": "accept | reject_and_improve_tests"
}
```

## Integration with Test Runners

**Flutter tests:**
```powershell
# Run specific test file
flutter test test/path/to/test.dart

# Run with coverage
flutter test --coverage test/path/to/test.dart

# Run all tests in a feature
flutter test test/features/reparto/
```

**Jest tests:**
```powershell
# Run specific test
cd backend && npx jest __tests__/specific.test.js

# Run with coverage
cd backend && npx jest --coverage __tests__/specific.test.js

# Run all backend tests
cd backend && npx jest
```

## Integration with scope-creep-detector

When `scope-creep-detector` reports CI weakening:
1. Run tautology detection (Phase 1) on modified test files
2. If tautologies found, escalate to BLOCK
3. Run mutation testing (Phase 2-4) on source files with weakened tests
4. Combine reports: scope violations + mutation failures = stronger BLOCK signal

## Decision Matrix

| Condition | Mutation Status | Action |
|-----------|----------------|--------|
| Score >= 80%, no tautologies | PASS | Tests are effective |
| Score 60-79%, no tautologies | WARN | Accept with gap analysis |
| Score < 60% | BLOCK | Require test improvements |
| Any tautology in modified tests | WARN | Flag for review |
| >10% tautological tests | BLOCK | Require test rewrite |
| Mutation in business logic not caught | BLOCK | Add regression test for that path |

## Output

Always report:
1. Mutation status (PASS/WARN/BLOCK)
2. Mutation score (raw and effective)
3. Tautological tests found (if any)
4. Missed mutations with specific recommendations
5. Recommended action

If BLOCK: include exact mutations that were missed and the test files that should have caught them.
