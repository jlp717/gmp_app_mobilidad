'use strict';

process.env.VENDOR_COLUMN = 'R1_T8CDVD';
process.env.SNAPSHOT_UNTIL_MONTH = '2';

const { queryWithParams } = require('../config/db');
const { getVendorColumnExpr, LACLAE_SALES_FILTER } = require('../utils/common');

const YEAR = 2026;

async function run() {
    const caseExpr = getVendorColumnExpr('L');
    const salesFilter = LACLAE_SALES_FILTER;

    console.log('=== DIAGNOSTIC: Vendor 05 / 5 for 2026 ===');
    console.log('CASE expression: ' + caseExpr);
    console.log('Sales filter:    ' + salesFilter + '\n');

    // 1. COMMERCIAL_TARGETS
    console.log('--- 1. COMMERCIAL_TARGETS ---');
    const ct = await queryWithParams(`
        SELECT CODIGOVENDEDOR, ANIO, MES, IMPORTE_BASE_COMISION, ACTIVO
        FROM JAVIER.COMMERCIAL_TARGETS
        WHERE ANIO = ?
          AND (CODIGOVENDEDOR = '05' OR CODIGOVENDEDOR = '5')
        ORDER BY MES
    `, [YEAR], false);
    console.log(ct.length === 0 ? '  (no rows!)' : JSON.stringify(ct, null, 2));

    // 2. SNAPSHOT Jan/Feb
    console.log('\n--- 2. COMMISSION_SNAPSHOT_2026_0102 (vendor 05/5) ---');
    const snap = await queryWithParams(`
        SELECT VENDEDOR_CODIGO, MES, VENTAS_REAL, OBJETIVO_MES, COMISION_GENERADA
        FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102
        WHERE ANIO = 2026
          AND MES IN (1, 2)
          AND (VENDEDOR_CODIGO = '05' OR VENDEDOR_CODIGO = '5')
    `, [], false);
    console.log(snap.length === 0 ? '  (no rows - vendor not in snapshot)' : JSON.stringify(snap, null, 2));

    // 3. Snapshot global coverage
    console.log('\n--- 3. Snapshot global coverage (Jan+Feb, any vendor) ---');
    const snapCov = await queryWithParams(`
        SELECT MES, COUNT(*) as CNT
        FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102
        WHERE ANIO = 2026 AND MES IN (1, 2)
        GROUP BY MES ORDER BY MES
    `, [], false);
    console.log(snapCov.length === 0 ? '  (table EMPTY for Jan/Feb!)' : JSON.stringify(snapCov, null, 2));

    // 4. LACLAE via CASE expr (production query)
    console.log('\n--- 4. LACLAE sales via CASE expr (2025+2026) ---');
    const lacCase = await queryWithParams(`
        SELECT (${caseExpr}) as VENDOR_CODE, L.LCAADC as YEAR, L.LCMMDC as MONTH, SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCAADC IN (2025, 2026)
          AND ${salesFilter}
          AND (${caseExpr}) IN ('05', '5')
        GROUP BY (${caseExpr}), L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC, L.LCMMDC
    `, [], false);
    console.log(lacCase.length === 0 ? '  (no sales!)' : JSON.stringify(lacCase, null, 2));

    // 4b. LACLAE via LCCDVD (2025 prev year baseline)
    console.log('\n--- 4b. LACLAE via LCCDVD (2025 baseline) ---');
    const lacLCCDVD = await queryWithParams(`
        SELECT L.LCAADC as YEAR, L.LCMMDC as MONTH, SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCAADC IN (2025, 2026)
          AND ${salesFilter}
          AND L.LCCDVD IN ('05', '5')
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC, L.LCMMDC
    `, [], false);
    console.log(lacLCCDVD.length === 0 ? '  (no rows)' : JSON.stringify(lacLCCDVD, null, 2));

    // 5. VENTAS_B
    console.log('\n--- 5. VENTAS_B (2025+2026) ---');
    const vb = await queryWithParams(`
        SELECT TRIM(CODIGOVENDEDOR) as COD, EJERCICIO, MES, IMPORTE
        FROM JAVIER.VENTAS_B
        WHERE EJERCICIO IN (2025, 2026)
          AND (TRIM(CODIGOVENDEDOR) = '05' OR TRIM(CODIGOVENDEDOR) = '5')
        ORDER BY EJERCICIO, MES
    `, [], false);
    console.log(vb.length === 0 ? '  (no rows)' : JSON.stringify(vb, null, 2));

    // 6. COMMISSION_PAYMENTS
    console.log('\n--- 6. COMMISSION_PAYMENTS 2026 ---');
    const cp = await queryWithParams(`
        SELECT TRIM(VENDEDOR_CODIGO) as COD, MES, IMPORTE_PAGADO, COMISION_GENERADA, OBSERVACIONES
        FROM JAVIER.COMMISSION_PAYMENTS
        WHERE ANIO = 2026
          AND (TRIM(VENDEDOR_CODIGO) = '05' OR TRIM(VENDEDOR_CODIGO) = '5')
        ORDER BY MES
    `, [], false);
    console.log(cp.length === 0 ? '  (no rows)' : JSON.stringify(cp, null, 2));

    // 7. VDD vendor name
    console.log('\n--- 7. VDD vendor name ---');
    const vdd = await queryWithParams(`
        SELECT TRIM(CODIGOVENDEDOR) as CODE, TRIM(NOMBREVENDEDOR) as NAME
        FROM DSEDAC.VDD
        WHERE TRIM(CODIGOVENDEDOR) IN ('05', '5')
    `, [], false);
    console.log(JSON.stringify(vdd, null, 2));

    // 8. DISTINCT codes from CASE expr � check for 05 vs 5 duplication
    console.log('\n--- 8. DISTINCT codes via CASE expr (all vendors, check 05+5 dupe) ---');
    const allCodes = await queryWithParams(`
        SELECT DISTINCT RTRIM(${caseExpr}) as VENDOR_CODE
        FROM DSED.LACLAE L
        WHERE L.LCAADC IN (2025, 2026)
          AND ${salesFilter}
        ORDER BY VENDOR_CODE
    `, [], false);
    const has05 = allCodes.some(r => (r.VENDOR_CODE || '').trim() === '05');
    const has5  = allCodes.some(r => (r.VENDOR_CODE || '').trim() === '5');
    console.log('Total distinct codes: ' + allCodes.length + ' | has 05: ' + has05 + ' | has 5: ' + has5);
    if (has05 && has5) console.log('  *** DUPLICATE DETECTED: both 05 AND 5 in results ***');

    console.log('\n=== DONE ===');
    process.exit(0);
}

run().catch(e => {
    console.error('FATAL:', e.message);
    if (e.odbcErrors) console.error('ODBC:', JSON.stringify(e.odbcErrors, null, 2));
    process.exit(1);
});
