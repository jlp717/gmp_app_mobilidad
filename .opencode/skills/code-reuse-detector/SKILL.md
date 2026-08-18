---
name: code-reuse-detector
version: 1.0
description: "Detects code duplication and reuse opportunities before implementation. Searches existing codebase for similar patterns, flags duplicate utilities, and requires justification for new helpers above similarity threshold. Integrates with RAG to find prior art."
triggers:
  - /code-reuse-detector
  - /reuse-check
  - "check for duplication"
  - "find similar code"
  - "is this already implemented"
tools:
  - rag-query
  - grep
  - glob
agents:
  - Code-Autopilot
integrates_with:
  - .opencode/config/elite-quality-gate.yaml (duplication check)
  - verification-driven-development (pre-maker phase)
---

# Code Reuse Detector

Pre-implementation search that finds existing code before new code is written. Prevents utility proliferation, enforces DRY, and ensures consolidation when similarity exceeds thresholds.

## When to Use

- **Before any new utility/helper/function** is implemented
- During Phase 1 (DISCOVER) of /verification-driven-development
- When elite-quality-gate flags duplication in pre-commit
- On-demand via /code-reuse-detector or "is this already implemented"
- After decision-router classifies a task as T2/T3

## Core Rule

**If >80% similarity to existing code exists, consolidation is required.** New code must either reuse the existing utility or document a specific technical reason why duplication is necessary.

## Workflow

`
SEARCH → ANALYZE → REPORT → [BLOCK if >threshold without justification]
`

## Phase 1: SEARCH — Find Existing Code

### Step 1: RAG Semantic Search

Search for semantically similar code using the RAG system:

`ash
# Search for prior art via RAG
rag-query --query "<functionality description>" \
  --collections codebase,conversations,lessons \
  --top_k 10 \
  --similarity_threshold 0.7
`

Example queries:
- "date formatting utility for DD/MM/YYYY display"
- "DB2 query builder for albaran filtering"
- "Flutter form validation for email and phone"
- "API error mapping for Dio exceptions"

### Step 2: Pattern-Based Search with rg

Search for structural patterns that indicate duplication:

`ash
# Find similar function signatures
rg --type dart "Future.*fetch.*\(" lib/
rg --type dart "formatDate|parseDate|dateToString" lib/
rg --type js "const.*=.*async.*req.*res" backend/services/

# Find similar class/provider patterns
rg --type dart "class.*Provider.*ChangeNotifier" lib/
rg --type js "class.*Service" backend/services/

# Find existing utilities by name similarity
rg --type dart "StringUtils|DateUtils|FormatHelper|ValidationHelper" lib/
rg --type js "utils|helpers|formatters" backend/

# Find repeated code patterns (N+1 of the codebase)
rg --type dart "catch.*\(_" lib/  # Silent suppression pattern
rg --type dart "192\.168\." lib/  # Hardcoded IPs
`

### Step 3: Glob for File Structure

Find all files in the target feature and related core directories:

`ash
# Find all Dart files in the feature
glob "lib/features/<feature>/**/*.dart"

# Find all utilities in core
glob "lib/core/**/*.dart"

# Find backend utilities
glob "backend/utils/**/*.js"
glob "backend/services/**/*.js"
`

### Step 4: Feature Registry Check

Search the existing feature list for overlapping functionality:

`ash
# Grep feature documentation for existing capabilities
rg --type md "<functionality_keyword>" docs/
rg --type yaml "<functionality>" .opencode/harness/feature-list.json
`

## Phase 2: ANALYZE — Compare and Score

For each candidate match found, calculate:

### Similarity Score

| Dimension | Weight | How to measure |
|---|---|---|
| Function signature | 30% | Compare parameter types, return type |
| Logic body | 40% | Compare core algorithm/operations |
| Context/purpose | 20% | Same feature domain, same input/output |
| Naming | 10% | Levenshtein distance on function/class names |

### Similarity Tiers

| Score | Tier | Action |
|---|---|---|
| 95-100% | **Duplicate** | Must consolidate — identical logic |
| 80-94% | **Near-duplicate** | Must extend existing, not create new |
| 60-79% | **Similar** | Review required — may need shared abstraction |
| 30-59% | **Related** | Independent but should share core utilities |
| 0-29% | **Distinct** | Safe to implement new |

### Thresholds (from elite-quality-gate.yaml)

`yaml
duplication:
  threshold_lines: 6        # >6 identical lines triggers check
  threshold_files: 2        # In >2 files = BLOCK
  similarity_threshold: 0.85 # 85% similarity = consolidation required
`

## Phase 3: REPORT — Generate Output

Generate a machine-readable report:

`yaml
reuse_report:
  task_id: "YYYYMMDD-HHMMSS-proyecto-xxxx"
  schema_version: 1
  timestamp: "2026-08-10T18:30:00Z"
  proposed_functionality: "Date formatter for albaran list display"
  
  duplicated_functions:
    - name: "formatDisplayDate"
      location: "lib/core/utils/date_utils.dart:42"
      similarity: 96
      notes: "Identical signature and logic (DD/MM/YYYY formatting)"
      
  existing_utilities:
    - name: "DateUtils"
      location: "lib/core/utils/date_utils.dart"
      methods: ["formatDisplayDate", "parseApiDate", "toIsoString"]
      coverage: "covers the exact use_case"
      
    - name: "AppDateFormatter"
      location: "lib/features/pedidos/utils/pedido_dates.dart:15"
      similarity: 72
      notes: "Similar but localized to pedidos feature"
      
  new_patterns_required:
    - name: "AlbaranStatusBadge"
      justification: "No existing badge component with albaran-specific status colors"
      similarity_to_existing: 25
      
  recommendation: "REUSE"
  consolidation_actions:
    - "Import DateUtils from lib/core/utils/date_utils.dart"
    - "Use formatDisplayDate() directly — no new function needed"
    
  risk_if_duplicated: "Medium — date formatting logic drift across features"
  
  verdict: "BLOCK new DateUtils — reuse existing lib/core/utils/date_utils.dart"
`

Save report to: .opencode/state/reuse-reports/<task_id>-reuse.json

## Phase 4: VERDICT — Gate Decision

### When to BLOCK

- Similarity >80% with existing utility AND no documented justification
- New file proposed where existing file can be extended
- Function duplicates an existing export from lib/core/

### When to WARN

- Similarity 60-79% — proceed only with explicit justification recorded
- New utility consolidates multiple existing ones (valid but needs review)

### When to PASS

- Similarity <30% — truly new functionality
- Justification documented for 60-79% similarity case
- New code extends existing utility instead of duplicating

## Justification Template (for >80% cases)

If the maker believes duplication is necessary, they must document:

`yaml
justification:
  reason: "technical"  # technical | performance | isolation | legacy
  explanation: >-
    Existing DateUtils.formatDisplayDate returns locale-specific output
    but albaran list requires fixed DD/MM/YYYY regardless of device locale.
    Modifying the shared utility would break pedidos feature which depends
    on locale-aware formatting.
  alternatives_considered:
    - "Add locale param to existing function — rejected: changes pedidos behavior"
    - "Create albaran-specific wrapper — selected: thin wrapper, no logic duplication"
  accepted_risk: "Thin wrapper (5 lines) instead of full duplication"
  reviewer_approval: "pending"
`

## Project-Specific Patterns to Check

### Flutter (lib/features/*, lib/core/*)

`ash
# Common duplication targets in this project
rg --type dart "class.*Repository" lib/features/     # Repository pattern duplication
rg --type dart "class.*Service" lib/features/        # Service layer duplication  
rg --type dart "extension.*on" lib/                  # Extension duplication
rg --type dart "mixin.*" lib/core/                  # Mixin duplication
rg --type dart "typedef.*=.*Future" lib/features/    # Type alias duplication

# Check core/ before adding to features/
rg --type dart "<function_name>" lib/core/
rg --type dart "<function_name>" lib/features/*/data/
rg --type dart "<function_name>" lib/features/*/domain/
`

### Backend (backend/routes/*, backend/services/*)

`ash
# Common backend duplication targets
rg --type js "const.*Query.*=.*async" backend/services/   # DB query duplication
rg --type js "odbc\.query" backend/                       # Raw query duplication
rg --type js "router\.(get|post|put|delete)" backend/routes/  # Route pattern duplication

# Check services/ before adding to routes/
rg --type js "<function_name>" backend/services/
rg --type js "<function_name>" backend/routes/
`

### Cross-Layer (Flutter ↔ Backend)

`ash
# Shared validation logic — should be duplicated intentionally with care
rg --type dart "validateEmail|validatePhone|validateNif" lib/
rg --type js "validateEmail|validatePhone|validateNif" backend/

# Shared constants — MUST be in single source of truth
rg --type dart "const.*MAX_" lib/
rg --type js "const.*MAX_" backend/
`

## Integration Points

| Tool/Config | Role |
|---|---|
| ag-query | Semantic search across codebase, conversations, lessons |
| grep / g | Structural pattern matching for duplication |
| glob | File discovery for feature/core structure |
| .opencode/config/elite-quality-gate.yaml | Defines duplication thresholds (6 lines, 2 files, 85% similarity) |
| /verification-driven-development | Called before maker phase — reuse check is pre-condition |

## Example: Full Reuse Check

`ash
# Proposed: New utility for formatting cobros dates

# Step 1: RAG search
rag-query --query "cobros date formatting utility" --collections codebase,lessons
# → Returns: lib/core/utils/date_utils.dart (score 0.91)

# Step 2: Pattern search
rg --type dart "formatDate" lib/core/
# → lib/core/utils/date_utils.dart:42 — formatDisplayDate(DateTime)
# → lib/core/utils/date_utils.dart:58 — formatApiDate(String)

# Step 3: Verify similarity
# Read lib/core/utils/date_utils.dart — exact function exists with same signature

# Step 4: Report
# verdict: BLOCK — reuse formatDisplayDate from lib/core/utils/date_utils.dart
# justification_required: true
`

## Anti-Patterns This Skill Prevents

| Anti-Pattern | Description | Prevention |
|---|---|---|
| Utility Proliferation | Creating DateUtils, DateHelper, DateFormat across features | RAG finds all variants before new one is created |
| Feature Silos | Same logic in cobros/utils.dart and pedidos/utils.dart | Cross-feature search finds duplicates |
| Core Bypass | Adding to lib/features/<feature>/utils/ instead of lib/core/utils/ | Explicit core/ check step |
| Reinventing the Wheel | Implementing what already exists in dependencies | pub-mcp search + existing import check |
| Copy-Paste Refactor | Duplicating then "will consolidate later" | BLOCK threshold enforces consolidation now |

## Escalation

If maker disagrees with BLOCK verdict:

1. Maker submits justification (see template above)
2. Chief reviews justification
3. If accepted → verdict becomes WARN with justification on file
4. If rejected → BLOCK stands, maker must reuse existing code
5. If deadlock → escalate to Javier with both perspectives

See also: /verification-driven-development (run after reuse check passes)
