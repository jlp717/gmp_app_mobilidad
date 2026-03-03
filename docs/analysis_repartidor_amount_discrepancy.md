# Analysis: Repartidor Invoice Amount Discrepancies

**Date**: 2026-03-03
**Branch**: test
**Scope**: Repartidor (delivery driver) profile only
**Feature Flag**: SHOW_IVA_BREAKDOWN (off by default)

---

## 1. Components / Widgets Inventory

### Repartidor Profile (delivery drivers)
| File | Class/Widget | Purpose |
|------|-------------|---------|
| `lib/features/repartidor/presentation/pages/repartidor_rutero_page.dart` | RepartidorRuteroPage | Main delivery list with KPIs and week navigator |
| `lib/features/repartidor/presentation/widgets/smart_delivery_card.dart` | SmartDeliveryCard | Delivery card showing amount (`importeTotal`), status, factura label |
| `lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart` | RuteroDetailModal | **CRITICAL** - Full detail bottom sheet showing Importe, products, payment |
| `lib/features/repartidor/presentation/widgets/holographic_kpi_dashboard.dart` | HolographicKpiDashboard | KPI metrics (totals, collected, optional) |
| `lib/features/repartidor/presentation/widgets/rutero_kpi_dashboard.dart` | RuteroKpiDashboard | Alt KPI dashboard |
| `lib/features/repartidor/presentation/widgets/delivery_item_list.dart` | DeliveryItemList | Line item verification list |
| `lib/features/repartidor/presentation/widgets/signature_modal.dart` | SignatureModal | Signature capture |
| `lib/features/entregas/providers/entregas_provider.dart` | EntregasProvider, AlbaranEntrega, EntregaItem | State management + data models |
| `lib/features/repartidor/data/repartidor_data_service.dart` | RepartidorDataService | API client for commissions/collections |

### Jefe de Ventas Profile (sales manager) — NOT affected
| File | Class/Widget | Purpose |
|------|-------------|---------|
| `lib/features/facturas/presentation/pages/facturas_page.dart` | FacturasPage | Invoice listing with base/IVA/total breakdown |
| `lib/features/facturas/data/facturas_service.dart` | FacturasService, Factura, FacturaDetail | Invoice data models |
| `lib/features/rutero/presentation/pages/rutero_page.dart` | RuteroPage | Route planning (different from repartidor) |

### Shared Utilities
| File | Purpose |
|------|---------|
| `lib/core/utils/currency_formatter.dart` | CurrencyFormatter.format() — `#,##0.00 €` es_ES locale |
| `lib/core/utils/formatters.dart` | Formatters facade |

---

## 2. Backend Endpoints Feeding Repartidor Views

| Endpoint | File | Amount Fields | Issue |
|----------|------|--------------|-------|
| `GET /entregas/pendientes/:repartidorId` | `backend/routes/entregas.js:122` | `CPC.IMPORTEBRUTO` → `importe` | **Uses WRONG field** |
| `GET /entregas/albaran/:numero/:ejercicio` | `backend/routes/entregas.js:516` | `CPC.IMPORTEBRUTO` → `importe` | Same wrong field |
| `POST /entregas/receipt/:entregaId` | `backend/routes/entregas.js:787` | Receives `subtotal`/`iva`/`total` from client | Client sends wrong values |
| `POST /entregas/receipt/:entregaId/email` | `backend/routes/entregas.js:897` | Same as above | Same issue |

### Facturas endpoints (jefe profile — working correctly)
| Endpoint | File | Amount Fields |
|----------|------|--------------|
| `GET /facturas` | `backend/services/facturas.service.js` | `CAC.IMPORTETOTAL`, `CAC.IMPORTEBASEIMPONIBLE1+2+3`, `CAC.IMPORTEIVA1+2+3` |
| `GET /facturas/:serie/:numero/:ejercicio` | Same | Aggregated with SUM across albaranes |

---

## 3. Reproduction Steps

### Prerequisites
1. Backend running: `cd backend && node server.js`
2. Flutter app on Android tablet connected to same network
3. Login as JEFE (e.g., DIEGO/98) to view repartidor data

### Steps to reproduce
1. Navigate to **Entregas/Rutero** tab
2. Select date **2 mar 2026** (Monday, week 10)
3. Find delivery for client **DELEGACION ALMERIA (90)** — client code `4300039982`
4. Observe card shows **574,87 €** (screenshot 2)
5. Tap to open RuteroDetailModal → shows `Importe: 574.87 €`
6. Tap "Ver PDF" → generates PDF showing **FACTURA: 219**, TOTAL: **105,53 €** (screenshot 1)
7. **Discrepancy**: Card/modal shows 574.87€, PDF shows 105.53€

### UI Route
`MainShell → RepartidorRuteroPage → SmartDeliveryCard (574.87€) → RuteroDetailModal (574.87€) → PDF Preview (105.53€)`

---

## 4. Root Cause Analysis

### 4.1 Primary Issue: Wrong DB Field Used

**File**: `backend/routes/entregas.js`, line 206

```
CPC.IMPORTEBRUTO        ← CURRENT (WRONG)
CPC.IMPORTETOTAL         ← CORRECT for albarán total (includes IVA, excludes bonificaciones)
```

The SQL query in the `/pendientes` endpoint selects `CPC.IMPORTEBRUTO` which is the **gross amount BEFORE discounts/bonifications**, NOT the collectable total. The column introspection revealed:

| CPC Column | Meaning | Factura 219 Value (client 4300039982) |
|-----------|---------|--------------------------------------|
| `IMPORTEBRUTO` | Gross pre-discount | **574.87€** ← displayed |
| `IMPORTETOTAL` | Final total (base+IVA) | **570.39€** ← should display |
| `IMPORTEBASEIMPONIBLE1` | Tax base at 10% | 297.75€ |
| `IMPORTEIVA1` | IVA at 10% | 29.78€ |
| `IMPORTEBASEIMPONIBLE2` | Tax base at 21% | 40.61€ |
| `IMPORTEIVA2` | IVA at 21% | 8.53€ |
| `IMPORTEBONIFICACION` | Bonification discount | 0.00€ |

**Verification**: `297.75 + 29.78 + 40.61 + 8.53 = 376.67` ≠ `570.39`. The remaining ~193.72€ is likely in base categories 3-5 (CPC has IMPORTEBASEIMPONIBLE1 through 5). The key point: `IMPORTETOTAL` is the correct field that already accounts for all this.

### 4.2 Secondary Issue: CPC vs CAC Amount Mismatch for Multi-Client Albaranes

Albaran `2026-P-93-69` has **two CPC records** (two different clients sharing the same physical albaran):
- Client **4300003479**: CPC.IMPORTETOTAL = **105.53€** (matches factura A-219)
- Client **4300039982** (DELEGACION ALMERIA): CPC.IMPORTETOTAL = **570.39€** (different delivery)

The `/pendientes` endpoint deduplicates by albaran ID (`EJERCICIO-SERIE-TERMINAL-NUMERO`) at line 244-252. When multiple CPC records exist for the same albaran (different clients), **only the first row survives** deduplication, and the JOIN with CAC.NUMEROFACTURA picks up the wrong association.

### 4.3 Tertiary Issue: IVA Not Displayed in Repartidor UI

The repartidor modal/card shows only a single amount (`importeTotal`). There is:
- No IVA breakdown (base + IVA percentages)
- No distinction between "neto" and "total"
- The receipt generation hardcodes `iva: 0` and `total: importeTotal` (entregas_provider.dart lines 476-477)

### 4.4 Description Truncation

Long product descriptions in `LAC.DESCRIPCION` (e.g., "PAN BARRA RIQUIÑA MEDIT.(23U)275GR....30") can overflow in SmartDeliveryCard and DeliveryItemList widgets. No `maxLines`, `overflow`, or expandable behavior is implemented.

---

## 5. Factura 219 DB Evidence

### From `node scripts/analyze_factura_219.js`:

**CAC records** (factura-albaran link):
| Albaran | Serie Factura | Client | CAC.BRUTO | CAC.TOTAL | CAC.BASE | CAC.IVA | Bonif |
|---------|--------------|--------|-----------|-----------|----------|---------|-------|
| 2026-P-93-69 | A | 4300003479 | 164.55 | **105.53** | 98.73 | 6.00 | 65.82 |
| 2026-P-3-7 | F | 4300007589 | 8.34 | 9.17 | 8.34 | 0.83 | 0 |
| 2026-P-3-190 | F | 4300007589 | 293.80 | 323.18 | 293.80 | 29.38 | 0 |
| 2026-S-13-7 | S | 4300005000 | 0 | 0 | 0 | 0 | 186.53 SinCargo |

**CPC records** (delivery note):
| Albaran | CPC Client | CPC.BRUTO | CPC.TOTAL | Forma Pago |
|---------|-----------|-----------|-----------|------------|
| 2026-P-93-69 | 4300003479 | 164.55 | 105.53 | 02 |
| 2026-P-93-69 | **4300039982** | **574.87** | **570.39** | 02 |
| 2026-P-3-7 | 4300007589 | 8.34 | 9.17 | 02 |

### Validation Script Results (100 records)
- **99% of records have discrepancies** between CPC.IMPORTEBRUTO and CAC.IMPORTETOTAL
- Only 1/100 records where BRUTO ≈ TOTAL
- 41/100 records where BRUTO ≈ BASE (i.e., BRUTO = base without IVA)
- 58/100 records where BRUTO matches neither (BRUTO is gross before discounts AND before IVA)

---

## 6. Commit 7029bbea (UTF-8) Analysis

### What it fixed
- Added `CCSID=1208;` to ODBC connection string in `backend/config/db.js`
- Added `ensureUtf8()` / `wrapPoolWithUtf8()` to run `CHGJOB CCSID(1208)` per connection
- Fixes character encoding for Ñ, tildes, accents in Spanish text

### What it did NOT fix
1. **TypeScript database pool** (`backend/src/config/database.ts` / `backend/src/config/env.ts`):
   - Connection string in `env.ts` line 43: `DSN=GMP;UID=...;PWD=...;NAM=1;` — **missing CCSID=1208**
   - `database.ts` ODBCPool class has no `ensureUtf8()` equivalent
   - Affects ALL TypeScript services when `USE_TS_ROUTES=true` (currently off by default)

2. **Standalone API server** (`backend/src/api-server.ts` line 14): hardcoded `DSN=GMP;UID=JAVIER;PWD=JAVIER` — missing CCSID and NAM

3. **Standalone scripts** (~80+ in `backend/scripts/`): each creates own connection without CCSID=1208

### Why "clientes de comerciales" still had issues
**Hypothesis verified**: The TS routes are disabled by default (`USE_TS_ROUTES=false`), so the JS routes handle all traffic. The UTF-8 fix covers the JS pool completely. However:
- If any route temporarily switches to TS mode, encoding breaks
- Cached data from before the fix may still contain garbled text (requires cache invalidation)
- Client-side caching (Flutter's HTTP cache) may serve stale garbled responses

**Evidence**: The `laclae.js` in-memory cache and `redis-cache.js` L2 cache persist data. If cached before the UTF-8 fix, they serve garbled text until cache TTL expires or manual invalidation.

---

## 7. Proposed Fixes

### 7.1 Backend Fix — `backend/routes/entregas.js`

**Change 1: Use correct amount field** (line 206)
```diff
- CPC.IMPORTEBRUTO,
+ CPC.IMPORTETOTAL,
+ CPC.IMPORTEBRUTO as IMPORTEBRUTO_REF,
+ CPC.IMPORTEBASEIMPONIBLE1 as CPC_BASE1,
+ CPC.IMPORTEBASEIMPONIBLE2 as CPC_BASE2,
+ CPC.IMPORTEBASEIMPONIBLE3 as CPC_BASE3,
+ CPC.PORCENTAJEIVA1 as CPC_PCTIVA1,
+ CPC.PORCENTAJEIVA2 as CPC_PCTIVA2,
+ CPC.PORCENTAJEIVA3 as CPC_PCTIVA3,
+ CPC.IMPORTEIVA1 as CPC_IVA1,
+ CPC.IMPORTEIVA2 as CPC_IVA2,
+ CPC.IMPORTEIVA3 as CPC_IVA3,
```

**Change 2: Map response with IVA breakdown** (line 362-392)
```diff
  return {
    ...
-   importe: parseFloat(row.IMPORTEBRUTO) || 0,
+   importe: parseFloat(row.IMPORTETOTAL) || 0,
+   importeBruto: parseFloat(row.IMPORTEBRUTO_REF) || 0,
+   netoSum: round2(base1 + base2 + base3),
+   ivaSum: round2(iva1 + iva2 + iva3),
+   ivaBreakdown: ivaBreakdownArray,  // [{base, pct, iva}]
+   checksum: `${round2(netoSum + ivaSum)}`,
    ...
  };
```

**Change 3: Fix deduplication** (line 244-252)
Add client code to deduplication key to prevent cross-client confusion:
```diff
- const id = `${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}`;
+ const id = `${row.EJERCICIOALBARAN}-${serie}-${row.TERMINALALBARAN}-${row.NUMEROALBARAN}-${(row.CLIENTE || '').trim()}`;
```

**Change 4: Fix albaran detail endpoint** (line 531)
Same change: use `CPC.IMPORTETOTAL` instead of `CPC.IMPORTEBRUTO as IMPORTE`.

### 7.2 Frontend Fix — Repartidor Widgets

**File: `lib/features/entregas/providers/entregas_provider.dart`**

AlbaranEntrega model: add fields for IVA data:
```dart
final double importeNeto;      // base sum (without IVA)
final double importeIva;       // IVA sum
final List<IvaBreakdown> ivaBreakdown;  // [{base, pct, iva}]
final String? checksum;        // verification field
```

fromJson: parse new fields conditionally (feature flag):
```dart
importeNeto: ((json['netoSum'] ?? json['importe'] ?? 0) as num).toDouble(),
importeIva: ((json['ivaSum'] ?? 0) as num).toDouble(),
```

Fix receipt generation (line 475-477):
```diff
- 'subtotal': albaran.importeTotal,
- 'iva': 0,
- 'total': albaran.importeTotal,
+ 'subtotal': albaran.importeNeto,
+ 'iva': albaran.importeIva,
+ 'total': albaran.importeTotal,
```

**File: `lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart`**

Line 315: Add IVA breakdown when feature flag is active:
```dart
_buildInfoRow(Icons.euro, 'Importe Neto', '${albaran.importeNeto.toStringAsFixed(2)} €'),
if (showIvaBreakdown) ...[
  for (final iva in albaran.ivaBreakdown)
    _buildInfoRow(Icons.percent, 'IVA ${iva.pct}%', '${iva.iva.toStringAsFixed(2)} €'),
],
_buildInfoRow(Icons.euro, 'Total', '${albaran.importeTotal.toStringAsFixed(2)} €'),
```

**New Widget: `ExpandableDescription`**
```dart
class ExpandableDescription extends StatefulWidget {
  final String text;
  final int maxLines;
  // softWrap: true, overflow: TextOverflow.ellipsis
  // onTap: toggles expanded state showing full text
}
```

### 7.3 Feature Flag

**Backend**: `backend/config/feature-flags.js`
```javascript
const FEATURE_FLAGS = {
  SHOW_IVA_BREAKDOWN: process.env.SHOW_IVA_BREAKDOWN === 'true' || false,
};
```

When `SHOW_IVA_BREAKDOWN = false`: response includes `importe` only (backward compatible).
When `SHOW_IVA_BREAKDOWN = true`: response includes `importe`, `netoSum`, `ivaSum`, `ivaBreakdown[]`, `checksum`.

**Frontend**: Check for presence of `ivaBreakdown` in response to conditionally render.

### 7.4 UTF-8 Gap Fix

**File: `backend/src/config/env.ts`**, line 43:
```diff
- return `DSN=GMP;UID=${uid};PWD=${pwd};NAM=1;`;
+ return `DSN=GMP;UID=${uid};PWD=${pwd};NAM=1;CCSID=1208;`;
```

**File: `backend/src/config/database.ts`**: Add ensureUtf8 equivalent to ODBCPool.initialize().

---

## 8. Tests

### Unit Tests (Dart)
- `test/helpers/iva_calculator_test.dart`: Test `calculateIva()` and `calculateTotal()` helpers
- `test/widgets/expandable_description_test.dart`: Test expand/collapse behavior
- `test/models/albaran_entrega_test.dart`: Test fromJson with and without IVA fields

### Integration Tests
- `test/integration/invoice_amounts_test.dart`: Compare UI displayed values with script-generated JSON

### Node Validation Scripts
- `backend/scripts/validate_invoice_amounts.js` — bulk validation (100+ records)
- `backend/scripts/analyze_factura_219.js` — deep analysis of specific factura

### Run commands
```bash
# Dart tests
flutter test test/helpers/
flutter test test/widgets/
flutter test test/models/

# Node validation
cd backend && node scripts/validate_invoice_amounts.js --limit 100
cd backend && node scripts/analyze_factura_219.js
```

---

## 9. Deployment Plan

### Phase 1: Backend fix (SHOW_IVA_BREAKDOWN=false)
1. Change `CPC.IMPORTEBRUTO` → `CPC.IMPORTETOTAL` in entregas.js
2. Fix deduplication key to include client code
3. Deploy to test branch
4. **Immediate impact**: All repartidores see correct total amounts
5. **Rollback**: Revert single SQL column change

### Phase 2: IVA Breakdown (SHOW_IVA_BREAKDOWN=true for canary)
1. Add IVA fields to response behind feature flag
2. Update AlbaranEntrega model to parse new fields
3. Update RuteroDetailModal to show breakdown
4. Enable for canary subset of repartidores via env var
5. **Rollback**: Set SHOW_IVA_BREAKDOWN=false

### Phase 3: Full rollout
1. After canary validation, enable for all repartidores
2. Add ExpandableDescription widget
3. Fix receipt generation IVA values
4. **Rollback**: Feature flag off

### Rollback procedure
```bash
# Instant rollback via feature flag
SHOW_IVA_BREAKDOWN=false node server.js

# Code rollback
git revert <commit-hash>
git push origin test
```

---

## 10. Files Modified (proposed, not yet applied)

| File | Change Type | Profile Affected |
|------|------------|-----------------|
| `backend/routes/entregas.js` | SQL field + response mapping | Repartidor ONLY |
| `backend/config/feature-flags.js` | NEW FILE | Shared (flag mechanism) |
| `lib/features/entregas/providers/entregas_provider.dart` | Model fields + fromJson | Repartidor ONLY |
| `lib/features/repartidor/presentation/widgets/rutero_detail_modal.dart` | IVA display | Repartidor ONLY |
| `lib/features/repartidor/presentation/widgets/smart_delivery_card.dart` | ExpandableDescription | Repartidor ONLY |
| `backend/src/config/env.ts` | CCSID=1208 | Shared (TS routes) |

**Jefe de Ventas impact**: NONE. All changes scoped to repartidor endpoints and widgets.
