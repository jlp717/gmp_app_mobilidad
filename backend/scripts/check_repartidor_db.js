/**
 * check_repartidor_db.js — Auditoría DB del perfil repartidor
 *
 * Uso: node backend/scripts/check_repartidor_db.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query, queryWithParams } = require('../config/db');

async function main() {
    console.log('\n══════════════════════════════════════════════');
    console.log('  AUDITORÍA DB - PERFIL REPARTIDOR');
    console.log('  Fecha:', new Date().toISOString());
    console.log('══════════════════════════════════════════════\n');

    const results = { timestamp: new Date().toISOString(), checks: [] };

    // ─── CHECK 1: Albarán P-16-4876 ───
    console.log('1️⃣  Albarán P-16-4876 (Header + Lines)');
    try {
        const header = await query(`
            SELECT CPC.EJERCICIOALBARAN, TRIM(CPC.SERIEALBARAN) AS SERIE,
                   CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                   CPC.IMPORTETOTAL, CPC.IMPORTEBRUTO,
                   TRIM(CPC.CODIGOVENDEDOR) AS REP,
                   CPC.NUMEROORDENPREPARACION AS OPP_NUM,
                   CPC.DIADOCUMENTO, CPC.MESDOCUMENTO, CPC.ANODOCUMENTO
            FROM DSEDAC.CPC CPC
            WHERE CPC.NUMEROALBARAN = 4876
              AND TRIM(CPC.SERIEALBARAN) = 'P'
              AND CPC.TERMINALALBARAN = 16
            FETCH FIRST 5 ROWS ONLY
        `, false);
        console.log('   Header rows:', header.length);
        header.forEach(r => console.log('  ', JSON.stringify(r)));

        const lines = await query(`
            SELECT LAC.SECUENCIA, TRIM(LAC.CODIGOARTICULO) AS ART,
                   TRIM(LAC.DESCRIPCION) AS DESCRIP, LAC.CANTIDADENVASES AS BULTOS,
                   LAC.IMPORTEVENTA AS IMPORTE, TRIM(LAC.TIPOLINEA) AS TIPO
            FROM DSEDAC.LAC LAC
            WHERE LAC.NUMEROALBARAN = 4876
              AND TRIM(LAC.SERIEALBARAN) = 'P'
              AND LAC.TERMINALALBARAN = 16
              AND TRIM(LAC.TIPOLINEA) != 'T'
              AND TRIM(LAC.CODIGOARTICULO) != ''
            ORDER BY LAC.SECUENCIA
        `, false);
        console.log('   Lines:', lines.length);
        const lineSum = lines.reduce((s, l) => s + parseFloat(l.IMPORTE || 0), 0);
        console.log('   SUM(IMPORTEVENTA):', lineSum.toFixed(2));
        if (header.length > 0) {
            const diff = Math.abs(parseFloat(header[0].IMPORTETOTAL) - lineSum);
            console.log('   CPC.IMPORTETOTAL:', header[0].IMPORTETOTAL);
            console.log('   Discrepancia:', diff > 0.01 ? `⚠️ ${diff.toFixed(2)}` : '✅ OK');
        }
        results.checks.push({ id: 'P-16-4876', header, lines_count: lines.length, lineSum: lineSum.toFixed(2) });
    } catch (e) {
        console.log('   ❌ Error:', e.message);
        results.checks.push({ id: 'P-16-4876', error: e.message });
    }

    // ─── CHECK 2: Albarán P-16-4777 ───
    console.log('\n2️⃣  Albarán P-16-4777');
    try {
        const header = await query(`
            SELECT CPC.EJERCICIOALBARAN, TRIM(CPC.SERIEALBARAN) AS SERIE,
                   CPC.TERMINALALBARAN, CPC.NUMEROALBARAN,
                   CPC.IMPORTETOTAL, CPC.IMPORTEBRUTO,
                   TRIM(CPC.CODIGOVENDEDOR) AS REP,
                   CPC.NUMEROORDENPREPARACION AS OPP_NUM
            FROM DSEDAC.CPC CPC
            WHERE CPC.NUMEROALBARAN = 4777
              AND TRIM(CPC.SERIEALBARAN) = 'P'
              AND CPC.TERMINALALBARAN = 16
            FETCH FIRST 5 ROWS ONLY
        `, false);
        console.log('   Header rows:', header.length);
        header.forEach(r => console.log('  ', JSON.stringify(r)));

        const lines = await query(`
            SELECT COUNT(*) AS CNT, SUM(LAC.IMPORTEVENTA) AS TOTAL
            FROM DSEDAC.LAC LAC
            WHERE LAC.NUMEROALBARAN = 4777
              AND TRIM(LAC.SERIEALBARAN) = 'P'
              AND LAC.TERMINALALBARAN = 16
              AND TRIM(LAC.TIPOLINEA) != 'T'
              AND TRIM(LAC.CODIGOARTICULO) != ''
        `, false);
        console.log('   Lines count:', lines[0]?.CNT, 'Sum:', lines[0]?.TOTAL);
        results.checks.push({ id: 'P-16-4777', header, linesSummary: lines[0] });
    } catch (e) {
        console.log('   ❌ Error:', e.message);
        results.checks.push({ id: 'P-16-4777', error: e.message });
    }

    // ─── CHECK 3: Factura F-133393 ───
    console.log('\n3️⃣  Factura F-133393');
    try {
        // CAC uses EJERCICIOALBARAN, SERIEALBARAN, etc + joins to get factura number
        // Search by joining CPC → CAC or directly in CAC if it has factura info
        const factura = await query(`
            SELECT CAC.EJERCICIOALBARAN, TRIM(CAC.SERIEALBARAN) AS SERIE,
                   CAC.TERMINALALBARAN, CAC.NUMEROALBARAN,
                   CAC.IMPORTETOTAL,
                   TRIM(CAC.CODIGOCLIENTEALBARAN) AS CLI,
                   CAC.DIADOCUMENTO, CAC.MESDOCUMENTO, CAC.ANODOCUMENTO
            FROM DSEDAC.CAC CAC
            WHERE CAC.NUMEROALBARAN = 133393
               OR CAC.EJERCICIOALBARAN = 133393
            FETCH FIRST 5 ROWS ONLY
        `, false);
        console.log('   Factura rows:', factura.length);
        factura.forEach(r => console.log('  ', JSON.stringify(r)));
        results.checks.push({ id: 'F-133393', factura });
    } catch (e) {
        console.log('   ❌ Error:', e.message);
        results.checks.push({ id: 'F-133393', error: e.message });
    }

    // ─── CHECK 4: Discrepancias a escala (top 20) ───
    console.log('\n4️⃣  Discrepancias CPC vs LAC (top 20, ejercicio 2026)');
    try {
        const discrepancies = await query(`
            SELECT CPC.NUMEROALBARAN, TRIM(CPC.SERIEALBARAN) AS SERIE,
                   CPC.TERMINALALBARAN, CPC.IMPORTETOTAL,
                   SUM(LAC.IMPORTEVENTA) AS LINE_SUM,
                   ABS(CPC.IMPORTETOTAL - SUM(LAC.IMPORTEVENTA)) AS DIFF,
                   TRIM(CPC.CODIGOVENDEDOR) AS REP
            FROM DSEDAC.CPC CPC
            INNER JOIN DSEDAC.LAC LAC
              ON LAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
             AND TRIM(LAC.SERIEALBARAN) = TRIM(CPC.SERIEALBARAN)
             AND LAC.TERMINALALBARAN = CPC.TERMINALALBARAN
             AND LAC.NUMEROALBARAN = CPC.NUMEROALBARAN
             AND TRIM(LAC.TIPOLINEA) != 'T'
             AND TRIM(LAC.CODIGOARTICULO) != ''
            WHERE CPC.EJERCICIOALBARAN = 2026
            GROUP BY CPC.NUMEROALBARAN, TRIM(CPC.SERIEALBARAN),
                     CPC.TERMINALALBARAN, CPC.IMPORTETOTAL,
                     TRIM(CPC.CODIGOVENDEDOR)
            HAVING ABS(CPC.IMPORTETOTAL - SUM(LAC.IMPORTEVENTA)) > 0.01
            ORDER BY ABS(CPC.IMPORTETOTAL - SUM(LAC.IMPORTEVENTA)) DESC
            FETCH FIRST 20 ROWS ONLY
        `, false);
        console.log('   Found', discrepancies.length, 'discrepancies');
        discrepancies.forEach(r => {
            console.log(`   Alb ${r.SERIE}-${r.TERMINALALBARAN}-${r.NUMEROALBARAN}: CPC=${r.IMPORTETOTAL} LAC=${r.LINE_SUM} Diff=${r.DIFF} Rep=${r.REP}`);
        });
        results.checks.push({ id: 'discrepancies_2026', count: discrepancies.length, rows: discrepancies });
    } catch (e) {
        console.log('   ❌ Error:', e.message);
        results.checks.push({ id: 'discrepancies_2026', error: e.message });
    }

    // ─── CHECK 5: Orden de preparación (OPP) ───
    console.log('\n5️⃣  Ordenes de Preparación (OPP para albaranes de ejemplo)');
    try {
        const opp = await query(`
            SELECT OPP.NUMEROORDENPREPARACION, OPP.ANOREPARTO, OPP.MESREPARTO, OPP.DIAREPARTO,
                   TRIM(OPP.CODIGOREPARTIDOR) AS REP,
                   TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLI,
                   CPC.NUMEROALBARAN
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            WHERE CPC.NUMEROALBARAN IN (4876, 4777)
              AND TRIM(CPC.SERIEALBARAN) = 'P'
              AND CPC.TERMINALALBARAN = 16
            FETCH FIRST 20 ROWS ONLY
        `, false);
        console.log('   OPP rows:', opp.length);
        opp.forEach(r => console.log('  ', JSON.stringify(r)));
        results.checks.push({ id: 'opp_check', rows: opp });
    } catch (e) {
        console.log('   ❌ Error:', e.message);
        results.checks.push({ id: 'opp_check', error: e.message });
    }

    // ─── CHECK 6: Nombres Repartidor (VDD) ───
    console.log('\n6️⃣  Nombres Repartidor via VDD');
    try {
        const names = await query(`
            SELECT TRIM(VDD.CODIGOVENDEDOR) AS COD,
                   TRIM(VDD.NOMBREVENDEDOR) AS NOMBRE
            FROM DSEDAC.VDD VDD
            WHERE TRIM(VDD.CODIGOVENDEDOR) IN ('21','25','30','79')
            ORDER BY VDD.CODIGOVENDEDOR
        `, false);
        console.log('   Repartidores:');
        names.forEach(r => console.log(`   ${r.COD} → ${r.NOMBRE}`));
        results.checks.push({ id: 'vdd_names', rows: names });
    } catch (e) {
        console.log('   ❌ Error:', e.message);
        results.checks.push({ id: 'vdd_names', error: e.message });
    }

    // ─── CHECK 7: DELIVERY_STATUS summary ───
    console.log('\n7️⃣  DELIVERY_STATUS resumen');
    try {
        const ds = await query(`
            SELECT STATUS, COUNT(*) AS CNT,
                   MIN(UPDATED_AT) AS FIRST_UPDATE,
                   MAX(UPDATED_AT) AS LAST_UPDATE
            FROM JAVIER.DELIVERY_STATUS
            GROUP BY STATUS
        `, false);
        ds.forEach(r => console.log(`   ${r.STATUS}: ${r.CNT} (${r.FIRST_UPDATE} - ${r.LAST_UPDATE})`));

        const specific = await query(`
            SELECT ID, STATUS, OBSERVACIONES, FIRMA_PATH, REPARTIDOR_ID, UPDATED_AT
            FROM JAVIER.DELIVERY_STATUS
            WHERE ID LIKE '%4876%' OR ID LIKE '%4777%'
            FETCH FIRST 10 ROWS ONLY
        `, false);
        console.log('   Entries matching 4876/4777:', specific.length);
        specific.forEach(r => console.log('  ', JSON.stringify(r)));
        results.checks.push({ id: 'delivery_status', summary: ds, specific });
    } catch (e) {
        console.log('   ❌ Error:', e.message);
        results.checks.push({ id: 'delivery_status', error: e.message });
    }

    // ─── CHECK 8: Entregas sin observaciones ───
    console.log('\n8️⃣  Entregas sin observaciones');
    try {
        const missing = await query(`
            SELECT ID, STATUS, OBSERVACIONES, UPDATED_AT
            FROM JAVIER.DELIVERY_STATUS
            WHERE STATUS = 'ENTREGADO'
              AND (OBSERVACIONES IS NULL OR TRIM(OBSERVACIONES) = '')
            FETCH FIRST 20 ROWS ONLY
        `, false);
        console.log('   Entregas sin observaciones:', missing.length);
        missing.slice(0, 5).forEach(r => console.log('  ', JSON.stringify(r)));
        results.checks.push({ id: 'missing_observations', count: missing.length, sample: missing.slice(0, 5) });
    } catch (e) {
        console.log('   ❌ Error:', e.message);
        results.checks.push({ id: 'missing_observations', error: e.message });
    }

    // Output JSON
    const fs = require('fs');
    const outputPath = require('path').join(__dirname, 'check_repartidor_db_results.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n✅ Resultados guardados en ${outputPath}`);
    process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
