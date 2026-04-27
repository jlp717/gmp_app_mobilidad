# Agent 4: Documentation & Code Analysis - JAVIER vs DSEDAC Table Mapping

**Date**: 2026-04-27
**Mission**: Find definitive table mapping between JAVIER (test) and DSEDAC (production) schemas for repartidor liquidacion diaria, cobros, and comisiones features.

---

## 1. Explicit Table Mappings Found in Documentation

### 1.1 Core Mapping: LQD (Liquidaciones Diarias)

| JAVIER (Test) | DSEDAC (Production) | Relationship | Source |
|---|---|---|---|
| `JAVIER.LQD` | `DSEDAC.LQD` | **Shadow copy** via `CREATE TABLE JAVIER.LQD LIKE DSEDAC.LQD` | `020_repartidor_finance_tables.sql:46` |
| `JAVIER.LQD` | `DSEDAC.LQD` | Same physical structure, isolated in JAVIER schema | `repartidor-finance-production-mapping.md:72-75` |

**Control mechanism**: `REPARTIDOR_FINANCE_ERP_SCHEMA` env var (whitelist: `JAVIER` or `DSEDAC` only).
- Test: `REPARTIDOR_FINANCE_ERP_SCHEMA=JAVIER` → writes to `JAVIER.LQD`
- Production: `REPARTIDOR_FINANCE_ERP_SCHEMA=DSEDAC` → writes to `DSEDAC.LQD`

**Code reference**: `repartidor-finance-service.js:24-27`
```javascript
const ERP_FINANCE_SCHEMA = erpSchemaName(
  process.env.REPARTIDOR_FINANCE_ERP_SCHEMA || process.env.FINANCE_ERP_SCHEMA,
);
const LQD_TABLE = `${ERP_FINANCE_SCHEMA}.LQD`;
```

### 1.2 App-Only Tables (No DSEDAC Equivalent)

These tables exist ONLY in `JAVIER` schema and have NO DSEDAC counterpart:

| JAVIER Table | Purpose | DSEDAC Equivalent |
|---|---|---|
| `JAVIER.REPARTIDOR_COBROS` | App payment log (29 cols) | **None** - app-only ledger |
| `JAVIER.REPARTIDOR_LIQUIDACION_OPS` | Idempotent operation ledger | **None** - app-only |
| `JAVIER.REPARTIDOR_FINANCIAL_BALANCES` | Accumulated pending balance | **None** - app-only |
| `JAVIER.REPARTIDOR_COMMISSION_TIERS` | Editable commission tiers | **None** - app-only |
| `JAVIER.REPARTIDOR_LIQUIDACION_EMAILS` | Email delivery log | **None** - app-only |
| `JAVIER.DELIVERY_STATUS` | Delivery confirmation state | **None** - app-only |
| `JAVIER.REPARTIDOR_ENTREGAS` | Delivery headers (legacy) | **None** - app-only |
| `JAVIER.REPARTIDOR_ENTREGA_LINEAS` | Delivery line items | **None** - app-only |
| `JAVIER.REPARTIDOR_FIRMAS` | Digital signatures | **None** - app-only |
| `JAVIER.REPARTIDOR_OBJETIVOS` | Monthly 30% threshold tracking | **None** - app-only |
| `JAVIER.CLIENT_SIGNERS` | Frequent signers | **None** - app-only |
| `JAVIER.RUTERO_CONFIG` | Route overrides | **None** - app-only |

### 1.3 ERP Read-Only Tables (DSEDAC Only, No JAVIER Shadow)

These are ERP tables read by the backend but never written to by the app:

| DSEDAC Table | Purpose | Used By |
|---|---|---|
| `DSEDAC.CVC` | Debt/maturity master table (123,224 rows) | Vencimientos, cobros validation |
| `DSEDAC.CPC` | Delivery note headers (723,703 rows) | Entrega validation, amounts |
| `DSEDAC.OPP` | Preparation orders / repartidor assignment (289,939 rows) | Route assignment |
| `DSEDAC.CLCL1` | Client credit limits | Due date calculation |
| `DSEDAC.CLX` | Client extensions (emails, cobro riguroso) | Email notifications |
| `DSEDAC.CLP` | Client commercial/financial params | Vendor assignment |
| `DSEDAC.CDVI` | Visit planning by client/vendor | "Clientes No Visitados" |
| `DSEDAC.VDD` | Vendor/repartidor names | Identity lookup |
| `DSEDAC.VEH` | Vehicles/repartidores | Vehicle assignment |
| `DSEDAC.CAC` | Invoice headers | Commissions, factura data |
| `DSEDAC.LAC` | Document line items | Product details |
| `DSEDAC.CLI` | Client master | Client names, data |

### 1.4 Column Mapping: REPARTIDOR_COBROS vs DSEDAC.CVC

From `agent3-column-mapping.json` (automated comparison):

| JAVIER.REPARTIDOR_COBROS | DSEDAC.CVC | Match | Notes |
|---|---|---|---|
| `TIPO_DOCUMENTO` | `TIPODOCUMENTO` | EXACT | VARCHAR(10) vs CHAR(3) - truncation risk |
| `ORIGEN_DOCUMENTO` | `ORIGENDOCUMENTO` | EXACT | CHAR(1) = CHAR(1) ✓ |
| `SUBEMPRESA_DOCUMENTO` | `SUBEMPRESADOCUMENTO` | EXACT | CHAR(3) = CHAR(3) ✓ |
| `SERIE_DOCUMENTO` | `SERIEDOCUMENTO` | EXACT | VARCHAR(5) vs CHAR(1) - truncation risk |
| `TERMINAL_DOCUMENTO` | `TERMINALDOCUMENTO` | EXACT | INTEGER vs NUMERIC(3) - truncation risk |
| `NUMERO_DOCUMENTO` | `NUMERODOCUMENTO` | EXACT | INTEGER vs NUMERIC(6) ✓ |
| `XDE_DOCUMENTO` | `XDEDOCUMENTO` | EXACT | INTEGER vs NUMERIC(2) - truncation risk |
| `DEX_DOCUMENTO` | `DEXDOCUMENTO` | EXACT | INTEGER vs NUMERIC(2) - truncation risk |
| `IMPORTE_PENDIENTE` | `IMPORTEPENDIENTE` | EXACT | DECIMAL(15,2) vs NUMERIC(10,2) - fits |
| `CODIGO_CLIENTE` | `CODIGOCLIENTEALBARAN` | PARTIAL | VARCHAR(20) vs CHAR(10) - truncation risk |
| `FORMA_PAGO` | `CODIGOFORMAPAGO` | PARTIAL | VARCHAR(20) vs CHAR(2) - truncation risk |
| `FECHA_COBRO` | — | NO MATCH | App-only field |
| `NOTAS` | — | NO MATCH | App-only field |
| `OPERADOR` | — | NO MATCH | App-only field |
| `CREATED_AT` | — | NO MATCH | App-only field |
| `IDEMPOTENCY_TOKEN` | — | NO MATCH | App-only field |
| `LIQUIDADO_SN` | — | NO MATCH | App-only field |
| `LIQUIDACION_TOKEN` | — | NO MATCH | App-only field |

### 1.5 Column Mapping: REPARTIDOR_LIQUIDACION_OPS vs DSEDAC.LQD

From `agent3-column-mapping.json`:

| JAVIER.REPARTIDOR_LIQUIDACION_OPS | DSEDAC.LQD | Match | Notes |
|---|---|---|---|
| `SUBEMPRESA_LIQ` | `SUBEMPRESALIQUIDACION` | CONCEPTUAL | CHAR(3) = CHAR(3) ✓ |
| `EJERCICIO_LIQ` | `EJERCICIOLIQUIDACION` | CONCEPTUAL | INTEGER vs NUMERIC(4) ✓ |
| `SERIE_LIQ` | `SERIELIQUIDACION` | CONCEPTUAL | VARCHAR(5) vs CHAR(1) - truncation risk |
| `TERMINAL_LIQ` | `TERMINALLIQUIDACION` | CONCEPTUAL | INTEGER vs NUMERIC(3) - truncation risk |
| `NUMERO_LIQ` | `NUMEROLIQUIDACION` | CONCEPTUAL | INTEGER vs NUMERIC(6) ✓ |
| `TOTAL_EFECTIVO` | `IMPORTEEFECTIVO` | CONCEPTUAL | DECIMAL(15,2) vs NUMERIC(10,2) - fits |
| `TOTAL_CHEQUES` | `IMPORTECHEQUES` | CONCEPTUAL | DECIMAL(15,2) vs NUMERIC(10,2) - fits |
| `TOTAL_TARJETA` | `IMPORTETARJETA` | CONCEPTUAL | DECIMAL(15,2) vs NUMERIC(10,2) - fits |
| `TOTAL_POSTDATADOS` | `IMPORTEPOSTDATADOS` | CONCEPTUAL | DECIMAL(15,2) vs NUMERIC(10,2) - fits |
| `SALDO_ANTERIOR` | `IMPORTESALDOACTUAL` | CONCEPTUAL | DECIMAL(15,2) vs NUMERIC(10,2) - fits |
| `TOTAL_A_INGRESAR` | `IMPORTETOTALAINGRESAR` | CONCEPTUAL | DECIMAL(15,2) vs NUMERIC(10,2) - fits |
| `INGRESO_BANCO` | `IMPORTEINGRESOENBANCO` | CONCEPTUAL | DECIMAL(15,2) vs NUMERIC(10,2) - fits |
| `GASTOS` | `IMPORTEGASTOS` | CONCEPTUAL | DECIMAL(15,2) vs NUMERIC(10,2) - fits |
| `EFECTIVO_2` | `IMPORTEEFECTIVO2` | CONCEPTUAL | DECIMAL(15,2) vs NUMERIC(10,2) - fits |
| `ENTREGADO_2` | `IMPORTEENTREGADO2` | CONCEPTUAL | DECIMAL(15,2) vs NUMERIC(10,2) - fits |
| `CODIGO_REPARTIDOR` | `CODIGOVENDEDOR` | CONCEPTUAL | App uses repartidor, ERP uses vendedor |
| `IDEMPOTENCY_TOKEN` | `IDMARCALIQUIDACION` | CONCEPTUAL | App token stored in ERP mark column |
| `IDEMPOTENCY_TOKEN` | — | NO MATCH | App-only |
| `PANTALLA_ORIGEN` | — | NO MATCH | App-only |
| `CREADO_POR` | — | NO MATCH | App-only |
| `STATUS` | — | NO MATCH | App-only |
| `CREATED_AT` | — | NO MATCH | App-only |

---

## 2. Documented Production Cutover Strategy

### 2.1 Two-Phase Approach

**Phase 1: Test (Current)**
```env
REPARTIDOR_FINANCE_ERP_SCHEMA=JAVIER
```
- `JAVIER.LQD` receives liquidations with real ERP column structure
- `DSEDAC.LQD` is NOT touched
- `JAVIER.REPARTIDOR_*` tables store ledger, cobros, balances, emails
- Duration: 1 week minimum

**Phase 2: Production**
```env
REPARTIDOR_FINANCE_ERP_SCHEMA=DSEDAC
```
- `DSEDAC.LQD` receives real ERP liquidations
- Ledger continues in `JAVIER.REPARTIDOR_LIQUIDACION_OPS` (always JAVIER)
- Cleanup scripts must manually change `JAVIER.LQD` → `DSEDAC.LQD`

### 2.2 Cutover Steps (from documentation)

1. Execute `020_repartidor_finance_tables.sql` in ACS
2. Execute `021_verify_repartidor_finance_schema.sql` - all rows must return `OK`
3. Run `npm run finance:verify-schema` and `npm test -- --runInBand`
4. In app/tablet:
   - Select a specific repartidor
   - Register a cobro in Rutero
   - Verify `JAVIER.REPARTIDOR_COBROS`
   - Close Liquidacion Diaria
   - Verify `JAVIER.LQD`, `JAVIER.REPARTIDOR_LIQUIDACION_OPS`, `JAVIER.REPARTIDOR_FINANCIAL_BALANCES`
   - Verify Vencimientos subtracts the cobro and Comisiones recalculates

### 2.3 Cleanup Safety

- Test cleanup: `ALLOW_REPARTIDOR_FINANCE_CLEANUP=true`
- Production cleanup: BOTH `ALLOW_REPARTIDOR_FINANCE_CLEANUP=true` AND `ALLOW_PRODUCTION_REPARTIDOR_FINANCE_CLEANUP=true`
- Uses `IDEMPOTENCY_TOKEN` for safe deletion
- Blocks dangerous cases (linked liquidations, newer closures)

---

## 3. Discrepancies Between Documentation and Actual Code

### 3.1 CRITICAL: Hardcoded JAVIER References in Service

**Issue**: `repartidor-finance-service.js` uses `LQD_TABLE` (dynamic) for LQD writes, but **hardcodes `JAVIER.` for ALL other tables**:

| Table | Expected (dynamic) | Actual (hardcoded) | Risk |
|---|---|---|---|
| `LQD_TABLE` | `${ERP_FINANCE_SCHEMA}.LQD` | Dynamic ✓ | Safe |
| `REPARTIDOR_COBROS` | `${ERP_FINANCE_SCHEMA}.REPARTIDOR_COBROS` | `JAVIER.REPARTIDOR_COBROS` | **By design** - app-only |
| `REPARTIDOR_LIQUIDACION_OPS` | `${ERP_FINANCE_SCHEMA}.REPARTIDOR_LIQUIDACION_OPS` | `JAVIER.REPARTIDOR_LIQUIDACION_OPS` | **By design** - app-only |
| `REPARTIDOR_FINANCIAL_BALANCES` | `${ERP_FINANCE_SCHEMA}.REPARTIDOR_FINANCIAL_BALANCES` | `JAVIER.REPARTIDOR_FINANCIAL_BALANCES` | **By design** - app-only |
| `REPARTIDOR_COMMISSION_TIERS` | `${ERP_FINANCE_SCHEMA}.REPARTIDOR_COMMISSION_TIERS` | `JAVIER.REPARTIDOR_COMMISSION_TIERS` | **By design** - app-only |
| `REPARTIDOR_LIQUIDACION_EMAILS` | `${ERP_FINANCE_SCHEMA}.REPARTIDOR_LIQUIDACION_EMAILS` | `JAVIER.REPARTIDOR_LIQUIDACION_EMAILS` | **By design** - app-only |
| `DELIVERY_STATUS` | `${ERP_FINANCE_SCHEMA}.DELIVERY_STATUS` | `JAVIER.DELIVERY_STATUS` | **By design** - app-only |

**Assessment**: This is intentional. The architecture separates:
- **ERP writes** (LQD): controlled by `REPARTIDOR_FINANCE_ERP_SCHEMA`
- **App ledger** (all other tables): always in `JAVIER` schema

### 3.2 CRITICAL: ERP Read Tables Always DSEDAC

**Issue**: All ERP read queries in `repartidor-finance-service.js` use hardcoded `DSEDAC.` prefix:
- `DSEDAC.CVC` (line 497, 577)
- `DSEDAC.CPC` (line 498, 578)
- `DSEDAC.OPP` (line 504, 584)
- `DSEDAC.CLI` (line 586)
- `DSEDAC.CLCL1` (line 588)

**Assessment**: This is correct. ERP tables are always read from production `DSEDAC` schema regardless of test/production mode. The app never creates shadow copies of ERP read tables.

### 3.3 Missing REPARTIDOR_FINANCE_ERP_SCHEMA in .env

**Issue**: `backend/.env` (line 1-90) does NOT contain `REPARTIDOR_FINANCE_ERP_SCHEMA`.
- `backend/.env.example` (line 34): `REPARTIDOR_FINANCE_ERP_SCHEMA=JAVIER` ✓
- `backend/.env.produccion` (line 1-55): **Missing** `REPARTIDOR_FINANCE_ERP_SCHEMA`

**Risk**: In production, the service falls back to default `JAVIER` (from `repartidor-finance-service.js:24`), meaning liquidations would go to `JAVIER.LQD` instead of `DSEDAC.LQD`.

**Fix needed**: Add `REPARTIDOR_FINANCE_ERP_SCHEMA=DSEDAC` to `backend/.env.produccion` before cutover.

### 3.4 SERIE_DOCUMENTO Truncation Risk

**Issue**: `JAVIER.REPARTIDOR_COBROS.SERIE_DOCUMENTO` is `VARCHAR(5)`, but `DSEDAC.CVC.SERIEDOCUMENTO` is `CHAR(1)`.

**Risk**: If app sends series longer than 1 character, it would be truncated when cross-referenced against CVC.

**Assessment**: Low risk in practice - series codes are typically single characters ('A', 'P', 'F', 'S').

### 3.5 TERMINAL_DOCUMENTO Truncation Risk

**Issue**: `JAVIER.REPARTIDOR_COBROS.TERMINAL_DOCUMENTO` is `INTEGER` (4 bytes), but `DSEDAC.CVC.TERMINALDOCUMENTO` is `NUMERIC(3,0)`.

**Risk**: Terminal values > 999 would overflow DSEDAC column.

**Assessment**: Low risk - terminal numbers are typically 1-3 digits.

### 3.6 XDE/DEX_DOCUMENTO Truncation Risk

**Issue**: Both `XDE_DOCUMENTO` and `DEX_DOCUMENTO` are `INTEGER` in JAVIER but `NUMERIC(2,0)` in DSEDAC.

**Risk**: Values > 99 would overflow.

**Assessment**: Low risk - these are typically small values (1-2 digits).

### 3.7 CODIGO_CLIENTE Length Mismatch

**Issue**: `JAVIER.REPARTIDOR_COBROS.CODIGO_CLIENTE` is `VARCHAR(20)`, but `DSEDAC.CVC.CODIGOCLIENTEALBARAN` is `CHAR(10)`.

**Risk**: Client codes > 10 characters would not match DSEDAC records.

**Assessment**: Moderate risk - verify all client codes in the system are ≤ 10 characters.

### 3.8 FORMA_PAGO vs CODIGOFORMAPAGO Mismatch

**Issue**: `JAVIER.REPARTIDOR_COBROS.FORMA_PAGO` is `VARCHAR(20)` storing text values like 'EFECTIVO', 'TARJETA', 'BIZUM'. `DSEDAC.CVC.CODIGOFORMAPAGO` is `CHAR(2)` storing numeric codes like '01', '02'.

**Risk**: These are fundamentally different data types. The app does NOT write FORMA_PAGO to DSEDAC - it's app-only. The matching is done via document keys, not payment method.

**Assessment**: No cutover risk - FORMA_PAGO is app-only, never written to ERP.

### 3.9 JAVIER.LQD Creation Status

**Documentation says** (`repartidor-finance-production-mapping.md:43`):
> `JAVIER.LQD` | No existe todavia | La crea `020_repartidor_finance_tables.sql`

**SQL says** (`020_repartidor_finance_tables.sql:46`):
```sql
CREATE TABLE JAVIER.LQD LIKE DSEDAC.LQD;
```

**Assessment**: If `020` has been executed, `JAVIER.LQD` should exist. If not, it needs to be created before testing.

---

## 4. Recommendations for Aligning JAVIER with DSEDAC

### 4.1 Immediate (Before Cutover)

1. **Add `REPARTIDOR_FINANCE_ERP_SCHEMA=DSEDAC` to `.env.produccion`**
   - Current `.env.produccion` is missing this variable
   - Without it, production would default to `JAVIER.LQD`

2. **Verify `JAVIER.LQD` exists and matches `DSEDAC.LQD` structure**
   - Run `020_repartidor_finance_tables.sql` if not already executed
   - Run `021_verify_repartidor_finance_schema.sql` and confirm all `OK`

3. **Validate client code lengths**
   - Query: `SELECT MAX(LENGTH(TRIM(CODIGO_CLIENTE))) FROM JAVIER.REPARTIDOR_COBROS`
   - Must be ≤ 10 to match `DSEDAC.CVC.CODIGOCLIENTEALBARAN CHAR(10)`

4. **Confirm ERP cobro registration**
   - Documented risk #1: App cobros don't physically reduce `DSEDAC.CVC`
   - Need to confirm with ERP team if a separate table/process handles this

### 4.2 Medium-Term (During Test Phase)

5. **Resolve repartidor email**
   - Documented risk #2: `VDD`/`VEH` have no email column
   - Need alternative source for repartidor email (app users table, config)

6. **Validate document type coverage**
   - Documented risk #3: Types `COB`, `PGC`, `PGP`, `PAG`, `CNP` excluded from Vencimientos
   - Confirm with business if these should appear for repartidores

7. **Clarify `CLX.COBRORIGUROSOSN` values `C` and `M`**
   - Documented risk #4: Only `S` is treated as active
   - Values `C` and `M` need business validation

8. **Validate `LIKE` sufficiency**
   - Documented risk #5: Confirm with ERP that `JAVIER.LQD LIKE DSEDAC.LQD` is sufficient
   - Verify no triggers, constraints, or computed columns are missing

### 4.3 Long-Term (Post-Cutover)

9. **Consider ERP cobro write-back**
   - Currently app cobros are tracked in `JAVIER.REPARTIDOR_COBROS` only
   - For full ERP integration, may need to write to a DSEDAC cobro table
   - Requires ERP team coordination

10. **Add column length validation**
    - Add runtime checks for `SERIE_DOCUMENTO` (≤ 1 char), `TERMINAL_DOCUMENTO` (≤ 999), `XDE/DEX_DOCUMENTO` (≤ 99)
    - Prevent silent truncation if data exceeds ERP limits

11. **Document cleanup procedure for production**
    - `022_cleanup_repartidor_finance_test_template.sql` references `JAVIER.LQD`
    - Production cleanup must manually change to `DSEDAC.LQD`
    - Consider creating a production-specific cleanup script

---

## 5. Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                        APP (Flutter)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   BACKEND (Node.js)                             │
│                                                                 │
│  ERP READ (always DSEDAC):                                      │
│    DSEDAC.CPC  → albaran headers, amounts                       │
│    DSEDAC.OPP  → repartidor assignment                          │
│    DSEDAC.CVC  → debt/maturity data                             │
│    DSEDAC.CLCL1 → credit limits                                 │
│    DSEDAC.CLX  → client emails, cobro riguroso                  │
│    DSEDAC.CAC  → invoice data (commissions)                     │
│    DSEDAC.LAC  → line items                                     │
│    DSEDAC.CLI  → client master                                  │
│    DSEDAC.VDD  → vendor names                                   │
│    DSEDAC.VEH  → vehicles                                       │
│    DSEDAC.CDVI → visit planning                                 │
│                                                                 │
│  ERP WRITE (controlled by REPARTIDOR_FINANCE_ERP_SCHEMA):       │
│    <SCHEMA>.LQD → daily liquidations                            │
│      JAVIER.LQD (test) or DSEDAC.LQD (production)               │
│                                                                 │
│  APP-ONLY (always JAVIER):                                      │
│    JAVIER.REPARTIDOR_COBROS          → payment log              │
│    JAVIER.REPARTIDOR_LIQUIDACION_OPS → idempotent ledger        │
│    JAVIER.REPARTIDOR_FINANCIAL_BALANCES → pending balance       │
│    JAVIER.REPARTIDOR_COMMISSION_TIERS → commission config       │
│    JAVIER.REPARTIDOR_LIQUIDACION_EMAILS → email log             │
│    JAVIER.DELIVERY_STATUS            → delivery state           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Files Analyzed

| File | Lines | Relevance |
|---|---|---|
| `docs/repartidor-finance-production-mapping.md` | 620 | PRIMARY - definitive mapping doc |
| `backend/services/repartidor-finance-service.js` | 1577 | PRIMARY - implementation |
| `backend/scripts/sql/020_repartidor_finance_tables.sql` | 296 | DDL for all finance tables |
| `backend/scripts/sql/021_verify_repartidor_finance_schema.sql` | 352 | Schema verification |
| `backend/scripts/sql/022_cleanup_repartidor_finance_test_template.sql` | 140 | Cleanup template |
| `backend/scripts/sql/023_repartidor_finance_db_exploration_acs.sql` | 205 | DB exploration |
| `backend/scripts/sql/002_create_repartidor_tables.sql` | 227 | Legacy table creation |
| `backend/.env.example` | 160 | Env var documentation |
| `backend/.env` | 90 | Current env (missing ERP_SCHEMA) |
| `backend/.env.produccion` | 55 | Production env (missing ERP_SCHEMA) |
| `backend/scripts/results/agent1-dsedac-mapping.json` | 11950 | Automated column mapping |
| `backend/scripts/results/agent3-column-mapping.json` | ~5000+ | Column-by-column comparison |
| `docs/analysis_repartidor_amount_discrepancy.md` | 371 | Amount field analysis |
| `backend/routes/repartidor.js` | ~2000 | Route queries (DSEDAC reads) |
| `backend/routes/repartidor-finanzas.js` | ~200 | Route delegating to service |

---

## 7. Verdict

**The JAVIER/DSEDAC mapping is well-documented and intentionally designed:**

1. **LQD** is the ONLY table that switches between JAVIER and DSEDAC based on `REPARTIDOR_FINANCE_ERP_SCHEMA`
2. **All app-only tables** (cobros, ledger, balances, tiers, emails, delivery_status) are permanently in `JAVIER` schema
3. **All ERP read tables** (CPC, OPP, CVC, CLI, etc.) are permanently in `DSEDAC` schema
4. **The cutover is a single env var change** - no code changes needed

**Critical blocker before production**: `REPARTIDOR_FINANCE_ERP_SCHEMA=DSEDAC` must be added to `.env.produccion`.
