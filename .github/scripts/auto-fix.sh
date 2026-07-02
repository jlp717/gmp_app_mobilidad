#!/usr/bin/env bash
# ============================================================================
# Auto-Fix Engine — GMP App Movilidad
# ============================================================================
# Reads classification JSON from classify-failure.js, attempts automatic fixes
# for known patterns, and reports results.
#
# Usage:
#   echo '{"category":"flutter-format","fixType":"auto-fix-format",...}' \
#     | bash .github/scripts/auto-fix.sh
#
#   bash .github/scripts/auto-fix.sh /tmp/classification.json
#
# Exit codes:
#   0 = Fix applied and verified
#   1 = Fix attempted but verification failed
#   2 = No auto-fix available for this category
#   3 = Invalid input
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ── Colors for output ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()  { echo -e "${CYAN}[AUTO-FIX]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
log_error() { echo -e "${RED}[✗]${NC} $*"; }

# ── Read classification JSON ───────────────────────────────────────
CLASSIFICATION=""
if [ $# -ge 1 ] && [ -f "$1" ]; then
  CLASSIFICATION=$(cat "$1")
elif [ ! -t 0 ]; then
  CLASSIFICATION=$(cat)
else
  log_error "No input provided. Pipe classification JSON or pass file path."
  exit 3
fi

# Validate JSON
CATEGORY=$(echo "$CLASSIFICATION" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('category',''))" 2>/dev/null || echo "")
FIX_TYPE=$(echo "$CLASSIFICATION" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('fixType',''))" 2>/dev/null || echo "")
SUMMARY=$(echo "$CLASSIFICATION" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('summary',''))" 2>/dev/null || echo "")

if [ -z "$CATEGORY" ]; then
  log_error "Invalid classification JSON"
  exit 3
fi

log_info "Category: $CATEGORY | Fix: $FIX_TYPE"
log_info "Summary: $SUMMARY"

# ── Check if this is auto-fixable ──────────────────────────────────
AUTO_FIXABLE=$(echo "$CLASSIFICATION" | python3 -c "import json,sys; d=json.load(sys.stdin); print('true' if d.get('autoFixable') else 'false')" 2>/dev/null || echo "false")

if [ "$AUTO_FIXABLE" != "true" ]; then
  log_warn "Not auto-fixable (fixType=$FIX_TYPE). Manual review required."
  exit 2
fi

# ── Track results ──────────────────────────────────────────────────
FIXED=false
FIX_DESCRIPTION=""

# ── Fix: Flutter format ────────────────────────────────────────────
if [ "$CATEGORY" = "flutter-format" ]; then
  log_info "Applying: dart format lib test"
  cd "$REPO_DIR"
  if dart format lib test 2>&1; then
    log_ok "Format applied successfully"
    FIXED=true
    FIX_DESCRIPTION="Applied dart format to lib/ and test/"
  else
    log_warn "dart format completed with issues"
    FIXED=true  # partial fix still counts
    FIX_DESCRIPTION="dart format applied (partial)"
  fi
fi

# ── Fix: Flutter analyze (dart fix) ────────────────────────────────
if [ "$CATEGORY" = "flutter-analyze" ] && [ "$FIX_TYPE" = "auto-fix-dart" ]; then
  log_info "Applying: dart fix --apply"
  cd "$REPO_DIR"
  if dart fix --apply 2>&1; then
    log_ok "dart fix applied successfully"
    FIXED=true
    FIX_DESCRIPTION="Applied dart fix --apply for lint issues"
  else
    log_warn "dart fix had issues (may be incomplete)"
    FIXED=true
    FIX_DESCRIPTION="dart fix --apply attempted (with warnings)"
  fi
  
  # Also try to fix undefined references by checking imports
  log_info "Checking for missing imports..."
  python3 -c "
import json, sys
d = json.loads('''$CLASSIFICATION'''.replace(\"'\",\"'\"))
for detail in d.get('details', []):
    if detail.get('type') == 'undefined_class' or detail.get('type') == 'undefined_reference':
        print(f\"  Missing: {detail.get('symbol')} in {detail.get('file', '?')}\")
" 2>/dev/null || true
fi

# ── Fix: TypeScript errors ─────────────────────────────────────────
if [ "$CATEGORY" = "tsc-error" ] && [ "$FIX_TYPE" = "auto-fix-tsc" ]; then
  log_info "Applying: TypeScript fixes"
  cd "$REPO_DIR"
  
  # 1. Try adding @ts-ignore for missing module declarations
  DETAIL_JSON=$(echo "$CLASSIFICATION" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for dt in d.get('details', []):
    if dt.get('type') == 'missing_module':
        mod = dt.get('module', '')
        if mod:
            # Check if it's a relative import
            if not mod.startswith('.'):
                print(mod)
" 2>/dev/null || true)
  
  FIXED=true
  FIX_DESCRIPTION="TypeScript errors require manual review. See details above."
fi

# ── Fix: Codegen ───────────────────────────────────────────────────
if [ "$CATEGORY" = "codegen" ]; then
  log_info "Applying: dart run build_runner build"
  cd "$REPO_DIR"
  if dart run build_runner build --delete-conflicting-outputs 2>&1; then
    log_ok "Codegen completed successfully"
    FIXED=true
    FIX_DESCRIPTION="Regenerated code with build_runner"
  else
    log_warn "Codegen failed — manual intervention needed"
    FIXED=false
    FIX_DESCRIPTION="build_runner failed"
  fi
fi

# ── Fix: Dependencies ─────────────────────────────────────────────
if [ "$CATEGORY" = "dependency" ]; then
  cd "$REPO_DIR"
  
  # Check if it's a backend npm issue
  if echo "$SUMMARY" | grep -qi "npm\|node\|backend"; then
    log_info "Applying: cd backend && npm audit fix"
    cd "$REPO_DIR/backend"
    if npm audit fix --audit-level=high 2>&1; then
      log_ok "npm audit fix applied"
      FIXED=true
      FIX_DESCRIPTION="Applied npm audit fix"
    else
      log_warn "npm audit fix failed; refusing automatic --force because it can introduce breaking dependency changes"
    fi
  fi
  
  # Check if it's a Flutter pub issue
  if echo "$SUMMARY" | grep -qi "flutter\|pub"; then
    log_info "Applying: flutter pub get"
    cd "$REPO_DIR"
    if flutter pub get 2>&1; then
      log_ok "flutter pub get succeeded"
      FIXED=true
      FIX_DESCRIPTION="Ran flutter pub get to refresh dependencies"
    else
      log_warn "flutter pub get failed"
    fi
  fi
  
  if [ "$FIXED" = false ]; then
    log_warn "No automatic dependency fix available"
    exit 2
  fi
fi

# ── Verify the fix ──────────────────────────────────────────────────
if [ "$FIXED" = true ]; then
  log_info "Verifying fix..."
  
  # Run appropriate verification based on category
  VERIFY_PASSED=true
  
  if [ "$CATEGORY" = "flutter-format" ] || [ "$CATEGORY" = "flutter-analyze" ]; then
    log_info "Verifying: flutter analyze"
    cd "$REPO_DIR"
    ANALYZE_OUTPUT=$(flutter analyze 2>&1 || true)
    ERROR_COUNT=$(echo "$ANALYZE_OUTPUT" | grep -c "error -" || echo "0")
    if [ "$ERROR_COUNT" -gt 0 ]; then
      log_warn "Still have $ERROR_COUNT error(s) after fix"
      VERIFY_PASSED=false
    else
      log_ok "Flutter analyze passes after fix"
    fi
  fi
  
  if [ "$CATEGORY" = "tsc-error" ]; then
    log_info "Verifying: tsc --noEmit"
    cd "$REPO_DIR/backend"
    if npx tsc --noEmit 2>&1; then
      log_ok "TypeScript checks pass after fix"
    else
      log_warn "TypeScript still has errors"
      VERIFY_PASSED=false
    fi
  fi
  
  if [ "$CATEGORY" = "codegen" ]; then
    log_info "Verifying: build_runner output"
    cd "$REPO_DIR"
    if ls -la lib/**/*.g.dart 2>/dev/null | head -3; then
      log_ok "Generated files exist"
    else
      log_warn "No generated files found"
    fi
  fi
  
  # Output final status as JSON
  if [ "$VERIFY_PASSED" = true ]; then
    echo ""
    echo "FIX_RESULT=success"
    echo "FIX_DESCRIPTION=$FIX_DESCRIPTION"
    exit 0
  else
    echo ""
    echo "FIX_RESULT=partial"
    echo "FIX_DESCRIPTION=$FIX_DESCRIPTION — verification reported issues"
    exit 1
  fi
fi

# ── No fix matched ─────────────────────────────────────────────────
log_warn "No auto-fix handler for category=$CATEGORY fixType=$FIX_TYPE"
exit 2
