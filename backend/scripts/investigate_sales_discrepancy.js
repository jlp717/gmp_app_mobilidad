/**
 * INVESTIGATION SCRIPT: Sales & Invoice Discrepancies
 * ====================================================
 * Diagnoses root causes of:
 * 1. Invoice F-00750 amount mismatch (581.34 vs 218.65)
 * 2. Sales total discrepancy across Panel/Objectives/Commissions
 *
 * Usage: node backend/scripts/investigate_sales_discrepancy.js
 */

const odbc = require('odbc');

const DB_CONFIG = `DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;`;

const LACLAE_SALES_FILTER = `
    L.TPDC = 'LAC'
    AND L.LCTPVT IN ('CC', 'VC')
    AND L.LCCLLN IN ('AB', 'VT')
    AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
`;

async function investigate() {
    const pool = await odbc.pool(DB_CONFIG);
    const q = async (sql) => {
        const rows = await pool.query(sql);
        return rows;
    };

    const year = 2026;
    const month = 2;
    const prevYear = year - 1;

    console.log('='.repeat(80));
    console.log('INVESTIGATION: Sales & Invoice Discrepancies');
    console.log(`Date: ${new Date().toISOString()}`);
    console.log(`Period: ${month}/${year}`);
    console.log('='.repeat(80));

    // =========================================================================
    // TEST 1: Global SUM vs Per-Vendor SUM (LACLAE)
    // =========================================================================
    console.log('\n--- TEST 1: Global SUM vs Per-Vendor SUM (LACLAE) ---');

    const globalSales = await q(`
        SELECT SUM(L.LCIMVT) as TOTAL_SALES, COUNT(*) as ROW_COUNT
        FROM DSED.LACLAE L
        WHERE L.LCAADC = ${year} AND L.LCMMDC = ${month}
          AND ${LACLAE_SALES_FILTER}
    `);
    console.log(`Global SUM (all vendors): ${parseFloat(globalSales[0]?.TOTAL_SALES || 0).toFixed(2)} (${globalSales[0]?.ROW_COUNT} rows)`);

    // Per-vendor using LCCDVD
    const perVendorLCCDVD = await q(`
        SELECT TRIM(L.LCCDVD) as VENDOR, SUM(L.LCIMVT) as SALES, COUNT(*) as ROWS
        FROM DSED.LACLAE L
        WHERE L.LCAADC = ${year} AND L.LCMMDC = ${month}
          AND ${LACLAE_SALES_FILTER}
          AND L.LCCDVD IS NOT NULL AND TRIM(L.LCCDVD) <> ''
        GROUP BY TRIM(L.LCCDVD)
        ORDER BY SALES DESC
    `);
    const sumLCCDVD = perVendorLCCDVD.reduce((s, r) => s + (parseFloat(r.SALES) || 0), 0);
    console.log(`Per-vendor SUM (LCCDVD): ${sumLCCDVD.toFixed(2)} (${perVendorLCCDVD.length} vendors)`);

    // Per-vendor using R1_T8CDVD
    const perVendorR1 = await q(`
        SELECT TRIM(L.R1_T8CDVD) as VENDOR, SUM(L.LCIMVT) as SALES, COUNT(*) as ROWS
        FROM DSED.LACLAE L
        WHERE L.LCAADC = ${year} AND L.LCMMDC = ${month}
          AND ${LACLAE_SALES_FILTER}
          AND L.R1_T8CDVD IS NOT NULL AND TRIM(L.R1_T8CDVD) <> ''
        GROUP BY TRIM(L.R1_T8CDVD)
        ORDER BY SALES DESC
    `);
    const sumR1 = perVendorR1.reduce((s, r) => s + (parseFloat(r.SALES) || 0), 0);
    console.log(`Per-vendor SUM (R1_T8CDVD): ${sumR1.toFixed(2)} (${perVendorR1.length} vendors)`);

    const globalTotal = parseFloat(globalSales[0]?.TOTAL_SALES || 0);
    console.log(`\nDifference (Global - LCCDVD): ${(globalTotal - sumLCCDVD).toFixed(2)}`);
    console.log(`Difference (Global - R1_T8CDVD): ${(globalTotal - sumR1).toFixed(2)}`);
    console.log(`Difference (LCCDVD - R1_T8CDVD): ${(sumLCCDVD - sumR1).toFixed(2)}`);

    // Records with NULL or empty vendor
    const nullVendors = await q(`
        SELECT COUNT(*) as CNT, SUM(L.LCIMVT) as SALES
        FROM DSED.LACLAE L
        WHERE L.LCAADC = ${year} AND L.LCMMDC = ${month}
          AND ${LACLAE_SALES_FILTER}
          AND (L.LCCDVD IS NULL OR TRIM(L.LCCDVD) = '')
    `);
    console.log(`Records with NULL/empty LCCDVD: ${nullVendors[0]?.CNT} (sales: ${parseFloat(nullVendors[0]?.SALES || 0).toFixed(2)})`);

    // Records where R1_T8CDVD != LCCDVD
    const mismatchVendors = await q(`
        SELECT TRIM(L.LCCDVD) as LCCDVD, TRIM(L.R1_T8CDVD) as R1_T8CDVD,
               SUM(L.LCIMVT) as SALES, COUNT(*) as ROWS
        FROM DSED.LACLAE L
        WHERE L.LCAADC = ${year} AND L.LCMMDC = ${month}
          AND ${LACLAE_SALES_FILTER}
          AND TRIM(COALESCE(L.LCCDVD, '')) <> TRIM(COALESCE(L.R1_T8CDVD, ''))
        GROUP BY TRIM(L.LCCDVD), TRIM(L.R1_T8CDVD)
        ORDER BY SALES DESC
        FETCH FIRST 20 ROWS ONLY
    `);
    if (mismatchVendors.length > 0) {
        console.log(`\nRecords where LCCDVD != R1_T8CDVD (${mismatchVendors.length} groups):`);
        mismatchVendors.forEach(r => {
            console.log(`  LCCDVD='${r.LCCDVD}' vs R1_T8CDVD='${r.R1_T8CDVD}': ${parseFloat(r.SALES).toFixed(2)} (${r.ROWS} rows)`);
        });
    } else {
        console.log('\nNo mismatch between LCCDVD and R1_T8CDVD');
    }

    // =========================================================================
    // TEST 2: B-Sales (JAVIER.VENTAS_B)
    // =========================================================================
    console.log('\n--- TEST 2: B-Sales (JAVIER.VENTAS_B) ---');
    try {
        const bSales = await q(`
            SELECT CODIGOVENDEDOR, MES, IMPORTE
            FROM JAVIER.VENTAS_B
            WHERE EJERCICIO = ${year}
            ORDER BY MES, CODIGOVENDEDOR
        `);
        if (bSales.length > 0) {
            console.log('B-Sales found:');
            let totalB = 0;
            bSales.forEach(r => {
                const amt = parseFloat(r.IMPORTE) || 0;
                totalB += amt;
                console.log(`  Vendor=${r.CODIGOVENDEDOR}, Month=${r.MES}, Amount=${amt.toFixed(2)}`);
            });
            console.log(`  TOTAL B-Sales for ${year}: ${totalB.toFixed(2)}`);

            const bSalesMonth = bSales.filter(r => parseInt(r.MES) === month);
            const totalBMonth = bSalesMonth.reduce((s, r) => s + (parseFloat(r.IMPORTE) || 0), 0);
            console.log(`  B-Sales for month ${month}: ${totalBMonth.toFixed(2)}`);
        } else {
            console.log('No B-Sales records found for this year');
        }
    } catch (e) {
        console.log(`VENTAS_B table error: ${e.message}`);
    }

    // =========================================================================
    // TEST 3: Invoice F-00750 - CAC vs CVC
    // =========================================================================
    console.log('\n--- TEST 3: Invoice F-00750 (Client 4300040696) - CAC vs CVC ---');

    const cacInvoice = await q(`
        SELECT
            TRIM(CAC.SERIEFACTURA) as SERIE,
            CAC.NUMEROFACTURA as NUMERO,
            CAC.EJERCICIOFACTURA as EJERCICIO,
            CAC.IMPORTETOTAL as TOTAL,
            CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3 as BASE,
            CAC.IMPORTEIVA1 + CAC.IMPORTEIVA2 + CAC.IMPORTEIVA3 as IVA,
            CAC.ANOFACTURA as ANO, CAC.MESFACTURA as MES, CAC.DIAFACTURA as DIA,
            TRIM(CAC.CODIGOCLIENTEFACTURA) as CLIENTE,
            TRIM(CAC.CODIGOVENDEDOR) as VENDEDOR,
            CAC.SUBEMPRESAALBARAN as SUBEMPRESA,
            CAC.EJERCICIOALBARAN as EJERCICIOALB,
            TRIM(CAC.SERIEALBARAN) as SERIEALB,
            CAC.NUMEROALBARAN as NUMALB
        FROM DSEDAC.CAC CAC
        WHERE CAC.NUMEROFACTURA = 750
          AND TRIM(CAC.CODIGOCLIENTEFACTURA) = '4300040696'
    `);

    if (cacInvoice.length > 0) {
        console.log('CAC (Invoice Header) records:');
        cacInvoice.forEach(r => {
            console.log(`  Serie=${r.SERIE}, Num=${r.NUMERO}, Ejercicio=${r.EJERCICIO}`);
            console.log(`  Total=${parseFloat(r.TOTAL).toFixed(2)}, Base=${parseFloat(r.BASE).toFixed(2)}, IVA=${parseFloat(r.IVA).toFixed(2)}`);
            console.log(`  Date=${r.DIA}/${r.MES}/${r.ANO}, Client=${r.CLIENTE}, Vendor=${r.VENDEDOR}`);
            console.log(`  SubEmpresa=${r.SUBEMPRESA}, EjercicioAlb=${r.EJERCICIOALB}, SerieAlb=${r.SERIEALB}, NumAlb=${r.NUMALB}`);
        });
    } else {
        console.log('No CAC records found for invoice 750, client 4300040696');
    }

    // CVC records for same client
    const cvcRecords = await q(`
        SELECT
            CVC.NUMERODOCUMENTO as NUMDOC,
            TRIM(CVC.SERIEDOCUMENTO) as SERIE,
            CVC.EJERCICIODOCUMENTO as EJERCICIO,
            CVC.IMPORTEVENCIMIENTO as IMPORTE_VTO,
            CVC.IMPORTEPENDIENTE as IMPORTE_PEND,
            CVC.SITUACION,
            CVC.ANOEMISION as ANO,
            CVC.MESEMISION as MES,
            CVC.DIAEMISION as DIA,
            CVC.SUBEMPRESADOCUMENTO as SUBEMPRESA
        FROM DSEDAC.CVC CVC
        WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = '4300040696'
          AND CVC.ANOEMISION >= 2025
        ORDER BY CVC.ANOEMISION DESC, CVC.MESEMISION DESC, CVC.DIAEMISION DESC
    `);

    if (cvcRecords.length > 0) {
        console.log(`\nCVC (Payment Tracking) records for client 4300040696 (${cvcRecords.length} total):`);
        cvcRecords.forEach(r => {
            const isF750 = parseInt(r.NUMDOC) === 750;
            const marker = isF750 ? ' *** F-750 ***' : '';
            console.log(`  Doc=${r.SERIE}-${r.NUMDOC}, Ejerc=${r.EJERCICIO}, ` +
                `VtoAmt=${parseFloat(r.IMPORTE_VTO).toFixed(2)}, PendAmt=${parseFloat(r.IMPORTE_PEND).toFixed(2)}, ` +
                `Sit=${r.SITUACION}, Date=${r.DIA}/${r.MES}/${r.ANO}${marker}`);
        });

        // Sum of all pending for this client
        const totalPending = cvcRecords
            .filter(r => r.SITUACION === 'P')
            .reduce((s, r) => s + (parseFloat(r.IMPORTE_PEND) || 0), 0);
        console.log(`\n  Total pending (SITUACION=P): ${totalPending.toFixed(2)}`);
    } else {
        console.log('No CVC records found for client 4300040696');
    }

    // =========================================================================
    // TEST 4: Objective Configuration
    // =========================================================================
    console.log('\n--- TEST 4: Objective & Commission Configuration ---');

    try {
        const objConfig = await q(`SELECT * FROM JAVIER.OBJ_CONFIG FETCH FIRST 10 ROWS ONLY`);
        console.log('OBJ_CONFIG:');
        objConfig.forEach(r => console.log(`  ${JSON.stringify(r)}`));
    } catch (e) {
        console.log(`OBJ_CONFIG error: ${e.message}`);
    }

    try {
        const commConfig = await q(`SELECT * FROM JAVIER.COMM_CONFIG WHERE YEAR = ${year} FETCH FIRST 5 ROWS ONLY`);
        console.log('COMM_CONFIG:');
        commConfig.forEach(r => console.log(`  ${JSON.stringify(r)}`));
    } catch (e) {
        console.log(`COMM_CONFIG error: ${e.message}`);
    }

    try {
        const targets = await q(`SELECT * FROM JAVIER.COMMERCIAL_TARGETS WHERE ANIO = ${year} AND ACTIVO = 1 FETCH FIRST 20 ROWS ONLY`);
        console.log(`COMMERCIAL_TARGETS (active, ${year}):`);
        targets.forEach(r => console.log(`  ${JSON.stringify(r)}`));
    } catch (e) {
        console.log(`COMMERCIAL_TARGETS error: ${e.message}`);
    }

    // =========================================================================
    // TEST 5: Vendor List Comparison
    // =========================================================================
    console.log('\n--- TEST 5: Vendor List Comparison ---');

    const vendorsLCCDVD = await q(`
        SELECT DISTINCT TRIM(L.LCCDVD) as CODE
        FROM DSED.LACLAE L
        WHERE L.LCAADC IN (${year}, ${prevYear})
          AND L.LCCDVD IS NOT NULL AND TRIM(L.LCCDVD) <> '' AND TRIM(L.LCCDVD) <> '0'
        ORDER BY CODE
    `);

    const vendorsR1 = await q(`
        SELECT DISTINCT TRIM(L.R1_T8CDVD) as CODE
        FROM DSED.LACLAE L
        WHERE L.LCAADC IN (${year}, ${prevYear})
          AND L.R1_T8CDVD IS NOT NULL AND TRIM(L.R1_T8CDVD) <> '' AND TRIM(L.R1_T8CDVD) <> '0'
        ORDER BY CODE
    `);

    const setLCCDVD = new Set(vendorsLCCDVD.map(r => r.CODE));
    const setR1 = new Set(vendorsR1.map(r => r.CODE));

    const onlyInLCCDVD = [...setLCCDVD].filter(c => !setR1.has(c));
    const onlyInR1 = [...setR1].filter(c => !setLCCDVD.has(c));

    console.log(`Vendors in LCCDVD: ${setLCCDVD.size}`);
    console.log(`Vendors in R1_T8CDVD: ${setR1.size}`);
    console.log(`Only in LCCDVD (not in R1): [${onlyInLCCDVD.join(', ')}]`);
    console.log(`Only in R1 (not in LCCDVD): [${onlyInR1.join(', ')}]`);

    // For vendors only in LCCDVD, show their sales
    if (onlyInLCCDVD.length > 0) {
        const codeList = onlyInLCCDVD.map(c => `'${c}'`).join(',');
        const missedSales = await q(`
            SELECT TRIM(L.LCCDVD) as CODE, SUM(L.LCIMVT) as SALES, COUNT(*) as ROWS
            FROM DSED.LACLAE L
            WHERE L.LCAADC = ${year} AND L.LCMMDC = ${month}
              AND ${LACLAE_SALES_FILTER}
              AND TRIM(L.LCCDVD) IN (${codeList})
            GROUP BY TRIM(L.LCCDVD)
        `);
        console.log('\nSales from vendors MISSING in R1_T8CDVD:');
        let totalMissed = 0;
        missedSales.forEach(r => {
            const amt = parseFloat(r.SALES) || 0;
            totalMissed += amt;
            console.log(`  Vendor ${r.CODE}: ${amt.toFixed(2)} (${r.ROWS} rows)`);
        });
        console.log(`  TOTAL MISSED: ${totalMissed.toFixed(2)}`);
    }

    // =========================================================================
    // SUMMARY
    // =========================================================================
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Global LACLAE sales (${month}/${year}): ${globalTotal.toFixed(2)}`);
    console.log(`Per-vendor LCCDVD sum: ${sumLCCDVD.toFixed(2)} (diff: ${(globalTotal - sumLCCDVD).toFixed(2)})`);
    console.log(`Per-vendor R1_T8CDVD sum: ${sumR1.toFixed(2)} (diff: ${(globalTotal - sumR1).toFixed(2)})`);
    console.log(`Vendors only in LCCDVD: ${onlyInLCCDVD.length} [${onlyInLCCDVD.join(', ')}]`);
    console.log(`Vendors only in R1: ${onlyInR1.length} [${onlyInR1.join(', ')}]`);

    if (cacInvoice.length > 0) {
        console.log(`\nInvoice F-750 CAC total: ${parseFloat(cacInvoice[0].TOTAL).toFixed(2)}`);
    }

    await pool.close();
    console.log('\nDone.');
}

investigate().catch(e => {
    console.error('Investigation failed:', e);
    process.exit(1);
});
