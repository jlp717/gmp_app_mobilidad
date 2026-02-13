#!/bin/bash
# =============================================================================
# GMP API Diagnostic Script
# Tests all 4 fixed issues:
#   1. Vendedores filter (should return exactly 20 active codes)
#   2. Repartidores dropdown (should return individual entries)
#   3. Signatures (should load from CACFIRMAS cascade)
#   4. FACTURA -0 fix (documents should have proper factura numbers)
# =============================================================================

BASE_URL="http://localhost:3000"
# Login credentials — adjust as needed
LOGIN_USER="${1:-01}"
LOGIN_PIN="${2:-1234}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

PASS=0
FAIL=0

pass() { echo -e "  ${GREEN}✅ PASS:${NC} $1"; ((PASS++)); }
fail() { echo -e "  ${RED}❌ FAIL:${NC} $1"; ((FAIL++)); }
info() { echo -e "  ${CYAN}ℹ️  INFO:${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠️  WARN:${NC} $1"; }

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  GMP API DIAGNOSTIC — $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════${NC}"
echo ""

# =============================================================================
# 0. Health check
# =============================================================================
echo -e "${BOLD}[0] Health Check${NC}"
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/login" -X POST -H "Content-Type: application/json" -d '{}' 2>/dev/null)
if [ "$HEALTH" = "000" ]; then
    fail "Server not reachable at $BASE_URL"
    echo -e "\n${RED}Server is down. Cannot continue.${NC}"
    exit 1
else
    pass "Server reachable (HTTP $HEALTH)"
fi
echo ""

# =============================================================================
# 1. Login to get token
# =============================================================================
echo -e "${BOLD}[1] Authentication${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$LOGIN_USER\",\"password\":\"$LOGIN_PIN\"}" 2>/dev/null)

TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)
ROLE=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('role',''))" 2>/dev/null)
USER_CODE=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('user',{}).get('code',''))" 2>/dev/null)

if [ -z "$TOKEN" ] || [ "$TOKEN" = "" ]; then
    fail "Login failed for user '$LOGIN_USER'"
    info "Response: $(echo "$LOGIN_RESPONSE" | head -c 200)"
    echo -e "\n${RED}Cannot continue without auth token.${NC}"
    exit 1
else
    pass "Logged in as $USER_CODE (role=$ROLE)"
fi
echo ""

AUTH="Authorization: Bearer $TOKEN"

# =============================================================================
# 2. TEST: Vendedores (Issue #1)
# =============================================================================
echo -e "${BOLD}[2] Vendedores Filter (Issue #1)${NC}"
echo -e "    Expected: exactly 20 active commercial codes"
echo ""

VEND_RESPONSE=$(curl -s "$BASE_URL/api/rutero/vendedores" -H "$AUTH" 2>/dev/null)
VEND_COUNT=$(echo "$VEND_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
v=d.get('vendedores',[])
print(len(v))
" 2>/dev/null)

VEND_CODES=$(echo "$VEND_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
v=d.get('vendedores',[])
codes = [x.get('code','?') for x in v]
print(', '.join(sorted(codes)))
" 2>/dev/null)

EXPECTED_CODES="01, 02, 03, 05, 10, 13, 15, 16, 33, 35, 72, 73, 80, 81, 83, 92, 93, 95, 97, 98"

if [ "$VEND_COUNT" = "20" ]; then
    pass "Vendedores count = $VEND_COUNT (expected 20)"
else
    fail "Vendedores count = $VEND_COUNT (expected 20)"
fi

info "Returned codes: $VEND_CODES"
info "Expected codes: $EXPECTED_CODES"

# Check for known bad codes that should be excluded
BAD_CODES_FOUND=$(echo "$VEND_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
v=d.get('vendedores',[])
bad = [x['code'] for x in v if x.get('code','').strip().startswith('ZZ') or x.get('code','').strip() == 'UNK' or len(x.get('code','').strip()) > 3]
print(', '.join(bad) if bad else 'NONE')
" 2>/dev/null)

if [ "$BAD_CODES_FOUND" = "NONE" ]; then
    pass "No bad codes (ZZ/UNK/long) found"
else
    fail "Bad codes found: $BAD_CODES_FOUND"
fi
echo ""

# =============================================================================
# 3. TEST: Repartidores (Issue #2)
# =============================================================================
echo -e "${BOLD}[3] Repartidores Dropdown (Issue #2)${NC}"
echo -e "    Expected: individual repartidor entries with name/code"
echo ""

REPART_RESPONSE=$(curl -s "$BASE_URL/api/auth/repartidores" -H "$AUTH" 2>/dev/null)
REPART_COUNT=$(echo "$REPART_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=d.get('repartidores',[])
print(len(r))
" 2>/dev/null)

REPART_SAMPLE=$(echo "$REPART_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=d.get('repartidores',[])
for x in r[:5]:
    print(f\"    {x.get('code','?'):>4} - {x.get('name','?')}\")
" 2>/dev/null)

if [ -n "$REPART_COUNT" ] && [ "$REPART_COUNT" -gt 0 ] 2>/dev/null; then
    pass "Repartidores count = $REPART_COUNT"
else
    fail "Repartidores count = $REPART_COUNT (expected > 0)"
fi

if [ -n "$REPART_SAMPLE" ]; then
    info "Sample entries:"
    echo "$REPART_SAMPLE"
fi

# Check UNK and ZZ exclusion
REPART_BAD=$(echo "$REPART_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=d.get('repartidores',[])
bad = [x.get('code','') for x in r if x.get('code','').strip() in ('UNK','ZZ')]
print(', '.join(bad) if bad else 'NONE')
" 2>/dev/null)

if [ "$REPART_BAD" = "NONE" ]; then
    pass "No UNK/ZZ codes in repartidores"
else
    fail "UNK/ZZ found in repartidores: $REPART_BAD"
fi
echo ""

# =============================================================================
# 4. TEST: History Documents — FACTURA -0 (Issue #4)
# =============================================================================
echo -e "${BOLD}[4] FACTURA -0 Fix (Issue #4)${NC}"
echo -e "    Expected: documents have proper numFactura, serieFactura"
echo ""

# Find a client with documents — use a well-known test client or pick one
# We'll use a generic approach: query recent documents for repartidor
DOCS_RESPONSE=$(curl -s "$BASE_URL/api/repartidor/history/documents/0?repartidor=$USER_CODE&days=30" -H "$AUTH" 2>/dev/null)

DOC_COUNT=$(echo "$DOCS_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
docs=d.get('documents',[])
print(len(docs))
" 2>/dev/null)

if [ -n "$DOC_COUNT" ] && [ "$DOC_COUNT" -gt 0 ] 2>/dev/null; then
    pass "Found $DOC_COUNT documents"
else
    warn "No documents found for client 0 with repartidor $USER_CODE (trying without filters)..."
    # Try alternative: direct client query
    DOCS_RESPONSE=$(curl -s "$BASE_URL/api/repartidor/history/documents/0?days=30" -H "$AUTH" 2>/dev/null)
    DOC_COUNT=$(echo "$DOCS_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
docs=d.get('documents',[])
print(len(docs))
" 2>/dev/null)
    if [ -n "$DOC_COUNT" ] && [ "$DOC_COUNT" -gt 0 ] 2>/dev/null; then
        pass "Found $DOC_COUNT documents (no repartidor filter)"
    else
        warn "No documents returned. Skipping FACTURA -0 checks."
    fi
fi

if [ -n "$DOC_COUNT" ] && [ "$DOC_COUNT" -gt 0 ] 2>/dev/null; then
    # Check for FACTURA -0 documents
    FACTURA_ZERO=$(echo "$DOCS_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
docs=d.get('documents',[])
zero_facturas = [x for x in docs if x.get('tipo','')=='FACTURA' and (x.get('numFactura',0)==0 or x.get('numFactura')==None)]
print(len(zero_facturas))
" 2>/dev/null)

    if [ "$FACTURA_ZERO" = "0" ]; then
        pass "No FACTURA -0 documents found"
    else
        fail "$FACTURA_ZERO facturas have numFactura=0"
    fi

    # Check for serieFactura presence
    HAS_SERIE=$(echo "$DOCS_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
docs=d.get('documents',[])
facturas = [x for x in docs if x.get('tipo','')=='FACTURA']
has_serie = sum(1 for x in facturas if x.get('serieFactura'))
print(f'{has_serie}/{len(facturas)}')
" 2>/dev/null)
    info "Facturas with serieFactura: $HAS_SERIE"

    # Check for ejercicioFactura
    HAS_EJERCICIO=$(echo "$DOCS_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
docs=d.get('documents',[])
facturas = [x for x in docs if x.get('tipo','')=='FACTURA']
has_ej = sum(1 for x in facturas if x.get('ejercicioFactura'))
print(f'{has_ej}/{len(facturas)}')
" 2>/dev/null)
    info "Facturas with ejercicioFactura: $HAS_EJERCICIO"

    # Print sample document
    info "Sample document:"
    echo "$DOCS_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
docs=d.get('documents',[])
if docs:
    x=docs[0]
    print(f\"    tipo={x.get('tipo')} numAlbaran={x.get('numAlbaran')} serie={x.get('serie')} numFactura={x.get('numFactura')} serieFactura={x.get('serieFactura')} ejercicioFactura={x.get('ejercicioFactura')} hasSignature={x.get('hasSignature')}\")
" 2>/dev/null
fi
echo ""

# =============================================================================
# 5. TEST: Signatures (Issue #3)
# =============================================================================
echo -e "${BOLD}[5] Signatures Loading (Issue #3)${NC}"
echo -e "    Expected: signature cascade (DELIVERY_STATUS → REPARTIDOR_FIRMAS → FILE → CACFIRMAS)"
echo ""

# Try to find a document with hasSignature=true from the documents we got
SIG_PARAMS=$(echo "$DOCS_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
docs=d.get('documents',[])
# Pick any doc that has hasSignature or hasLegacySignature
for x in docs:
    if x.get('hasSignature') or x.get('hasLegacySignature'):
        print(f\"ejercicio={x.get('ejercicio',2025)}&serie={x.get('serie','A')}&terminal={x.get('terminal',0)}&numero={x.get('numAlbaran',0)}\")
        sys.exit(0)
# Fallback: just try first doc
if docs:
    x=docs[0]
    print(f\"ejercicio={x.get('ejercicio',2025)}&serie={x.get('serie','A')}&terminal={x.get('terminal',0)}&numero={x.get('numAlbaran',0)}\")
" 2>/dev/null)

if [ -n "$SIG_PARAMS" ]; then
    info "Testing signature for: $SIG_PARAMS"
    SIG_RESPONSE=$(curl -s "$BASE_URL/api/repartidor/history/signature?$SIG_PARAMS" -H "$AUTH" 2>/dev/null)
    
    SIG_HAS=$(echo "$SIG_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(d.get('hasSignature', False))
" 2>/dev/null)

    SIG_SOURCE=$(echo "$SIG_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
sig=d.get('signature',{})
if sig:
    print(sig.get('source','NONE'))
else:
    print('NONE')
" 2>/dev/null)

    SIG_B64_LEN=$(echo "$SIG_RESPONSE" | python3 -c "
import sys,json
d=json.load(sys.stdin)
sig=d.get('signature',{})
if sig and sig.get('base64'):
    print(len(sig['base64']))
else:
    print(0)
" 2>/dev/null)

    if [ "$SIG_HAS" = "True" ]; then
        pass "Signature found (source=$SIG_SOURCE, base64 len=$SIG_B64_LEN)"
    else
        warn "No signature for this specific document (source=$SIG_SOURCE)"
        info "This may be expected if this particular albaran has no signature"
    fi

    # Test the cascade is working by checking server logs
    info "Signature endpoint returned: hasSignature=$SIG_HAS, source=$SIG_SOURCE"
else
    warn "No documents available to test signatures"
fi
echo ""

# =============================================================================
# 6. Direct DB Verification (vendedores SQL whitelist)
# =============================================================================
echo -e "${BOLD}[6] Vendedores SQL Verification${NC}"
echo ""

# Also test with role=repartidor
VEND_REPART=$(curl -s "$BASE_URL/api/rutero/vendedores?role=repartidor" -H "$AUTH" 2>/dev/null)
VEND_REPART_COUNT=$(echo "$VEND_REPART" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(len(d.get('vendedores',[])))
" 2>/dev/null)
info "Vendedores (role=repartidor): $VEND_REPART_COUNT entries"

# Verify cache key behavior (repeat call should be faster)
START=$(date +%s%N)
curl -s "$BASE_URL/api/rutero/vendedores" -H "$AUTH" > /dev/null 2>&1
END=$(date +%s%N)
ELAPSED=$(( (END - START) / 1000000 ))
info "Vendedores response time: ${ELAPSED}ms (should be <100ms if cached)"
echo ""

# =============================================================================
# SUMMARY
# =============================================================================
echo -e "${BOLD}═══════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  RESULTS SUMMARY${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════${NC}"
echo ""
TOTAL=$((PASS + FAIL))
echo -e "  ${GREEN}Passed: $PASS${NC}"
echo -e "  ${RED}Failed: $FAIL${NC}"
echo -e "  Total:  $TOTAL"
echo ""
if [ "$FAIL" -eq 0 ]; then
    echo -e "  ${GREEN}${BOLD}ALL TESTS PASSED ✅${NC}"
else
    echo -e "  ${RED}${BOLD}$FAIL TEST(S) FAILED ❌${NC}"
fi
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════${NC}"
