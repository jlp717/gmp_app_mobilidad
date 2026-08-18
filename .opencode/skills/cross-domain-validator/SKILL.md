---
name: cross-domain-validator
description: Cross-domain impact validation for GMP App Mobilidad. Maps dependencies across Flutter features, API endpoints, DB tables, and shared types. Detects blast radius before merge. Invocable as /cross-domain.
---

# Cross-Domain Validator

Validates cross-service dependency impact BEFORE merge. Prevents regressions from changes that span Flutter → API → DB layers.

## When to Invoke

- Before merging any PR touching >1 feature module
- After modifying shared types, API contracts, or DB schema
- When adding/removing API endpoints
- When refactoring providers or services
- Run as `/cross-domain` or via `zero-trust-gates.yml` CI workflow

## Dependency Graph Structure

```
┌─────────────────────────────────────────────────────────┐
│                   DEPENDENCY GRAPH                       │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Flutter Feature                                         │
│    ├── providers/ → API service calls                    │
│    ├── presentation/ → UI consumers                      │
│    └── domain/ → type contracts                          │
│         │                                                │
│         ▼                                                │
│  API Endpoint (backend/routes/)                          │
│    ├── route handler → service invocation                │
│    ├── middleware → auth/validation                      │
│    └── response model → JSON contract                    │
│         │                                                │
│         ▼                                                │
│  Service Layer (backend/services/)                       │
│    ├── business rules                                    │
│    └── repository calls                                  │
│         │                                                │
│         ▼                                                │
│  Repository/Adapter (backend/repositories/)              │
│    ├── SQL queries                                       │
│    └── DB2 table access                                  │
│         │                                                │
│         ▼                                                │
│  DB2 Schema (DSN=GMP, schemas: JAVIER, DSEDAC)          │
│    ├── tables, views, indexes                            │
│    └── stored procedures                                 │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Impact Analysis Algorithm

### Step 1: Identify Changed Files

```bash
# Get changed files in current PR/branch
git diff --name-only origin/main...HEAD
# Or for uncommitted changes:
git diff --name-only && git diff --cached --name-only
```

### Step 2: Classify Changes by Domain

| Pattern | Domain | Impact Level |
|---------|--------|-------------|
| `lib/features/*/presentation/**` | Flutter UI | Low |
| `lib/features/*/providers/**` | Flutter State | Medium |
| `lib/features/*/domain/**` | Flutter Models | High |
| `lib/core/**` | Shared Infrastructure | Critical |
| `backend/routes/**` | API Surface | High |
| `backend/services/**` | Business Logic | High |
| `backend/repositories/**` | Data Access | Critical |
| `backend/middleware/**` | Cross-cutting | Critical |
| `lib/**/ *.freezed.dart` | Generated Models | High |

### Step 3: Map to Dependency Graph

For each changed file, traverse the graph:

```
changed_file → direct_dependents → transitive_dependents → blast_radius
```

**Mapping rules:**

1. **Flutter feature change** → find which API endpoints it calls (grep for endpoint URLs in provider/service files) → find which DB tables those endpoints touch
2. **API route change** → find which Flutter features consume it (grep for route path in lib/) → find which services/repositories the route uses
3. **Service change** → find which routes call it → find which repositories it uses → find which DB tables
4. **Repository change** → find which services use it → find which routes expose it → find which Flutter features consume those routes
5. **Shared type change** → grep for type name across entire codebase → all consumers are in blast radius

### Step 4: Determine Required Actions

```
blast_radius = {
  affected_modules: [...],
  required_tests: [...],
  deploy_scope: [...],
  docs_to_update: [...],
  rollback_plan: [...]
}
```

## Validation Checklist

Run for each change set:

### API Contract Consistency
- [ ] Response shape matches frontend model (field names, types, nullability)
- [ ] New required fields have defaults or migration plan
- [ ] Enum values match between backend and frontend
- [ ] Error response format follows `{ error: { code, message, details } }`
- [ ] Pagination response includes `total`, `page`, `pageSize`, `data`

### DB Schema Consistency
- [ ] Query columns exist in target tables (verify via QSYS2.SYSCOLUMNS)
- [ ] WHERE clause columns are indexed or cardinality is acceptable
- [ ] No N+1 patterns (no query inside loop over records)
- [ ] Parameterized queries only (no string interpolation)
- [ ] Schema prefix matches (JAVIER. vs DSEDAC.)

### Type Consistency
- [ ] Freezed models regenerated after model changes
- [ ] No `any` or `dynamic` in new API-facing code
- [ ] Date formats consistent (ISO 8601)
- [ ] Numeric precision matches DB2 DECIMAL definitions

### Dependency Integrity
- [ ] No new circular dependencies (A→B→A)
- [ ] Feature modules don't import other features' internals
- [ ] Core changes don't break existing feature contracts
- [ ] No removed exports still consumed by other modules

## Report Template

```markdown
# Cross-Domain Impact Report

**Generated:** {timestamp}
**Branch:** {branch_name}
**Commit:** {commit_hash}
**Changed Files:** {count}

## Blast Radius Summary

| Domain | Files Changed | Modules Affected | Risk |
|--------|--------------|-----------------|------|
| Flutter UI | {n} | {modules} | {Low/Med/High} |
| Flutter State | {n} | {modules} | {Low/Med/High} |
| API Routes | {n} | {modules} | {Low/Med/High} |
| Services | {n} | {modules} | {Low/Med/High} |
| Repositories | {n} | {modules} | {Low/Med/High} |
| DB Schema | {n} | {tables} | {Low/Med/High} |

## Affected Modules

### Direct Impact
- {module_name}: {reason}

### Transitive Impact
- {module_name}: {reason} (via {intermediate})

## Required Test Suites

- [ ] `{test_path}` — {reason}
- [ ] `{test_path}` — {reason}

## Deployment Order

1. {component} — {reason}
2. {component} — {reason}
3. {component} — {reason}

## Rollback Plan

| Component | Rollback Command | Verification |
|-----------|-----------------|--------------|
| Flutter | `git revert {commit}` | `flutter analyze` passes |
| Backend | `pm2 reload gmp-api --version {prev}` | `/api/health` returns 200 |
| DB | {rollback_sql} | Query returns expected shape |

## Verdict

**{PASS | WARN | BLOCK}**

{justification}
```

## Concrete Commands

```bash
# Find which Flutter features consume an API endpoint
grep -r "api/v1/endpoint_name" lib/ --include="*.dart" -l

# Find which API routes use a service
grep -r "require.*serviceName" backend/routes/ --include="*.js" -l

# Find which services use a repository
grep -r "require.*repositoryName" backend/services/ --include="*.js" -l

# Find all consumers of a shared type
grep -r "TypeName" lib/ backend/ --include="*.dart" --include="*.js" -l

# Check for circular deps (simplified)
# If feature_a imports from feature_b AND feature_b imports from feature_a → CIRCULAR
grep -r "import.*features/feature_a" lib/features/feature_b/ --include="*.dart"
grep -r "import.*features/feature_b" lib/features/feature_a/ --include="*.dart"

# Verify API response matches Dart model
# Compare JSON keys from route handler vs freezed model fields
grep -o "'[a-zA-Z_]*'" backend/routes/route.js | sort -u
grep -o "[a-zA-Z_]*:" lib/features/x/domain/model.dart | sort -u

# Check DB column existence (via ibm-db2-mcp)
# SELECT * FROM QSYS2.SYSCOLUMNS WHERE TABLE_NAME = 'X' AND COLUMN_NAME = 'Y'

# Detect N+1 in Dart
grep -rn "for.*{" lib/features/*/providers/ --include="*.dart" | grep -E "(http|api|fetch|get|query)"

# Detect N+1 in JS
grep -rn "for.*{" backend/services/ --include="*.js" | grep -E "(query|execute|db)"
```

## Integration with Zero-Trust Gates

This skill is invoked automatically in the `cross-domain` job of `.github/workflows/zero-trust-gates.yml`. It can also be run manually via `/cross-domain` before creating a PR.

## Thresholds

| Metric | PASS | WARN | BLOCK |
|--------|------|------|-------|
| Modules affected | ≤3 | 4-6 | >6 |
| Untested modules | 0 | 1-2 | >2 |
| Contract mismatches | 0 | — | ≥1 |
| Circular deps | 0 | — | ≥1 |
| N+1 patterns | 0 | — | ≥1 |
| Missing DB columns | 0 | — | ≥1 |
