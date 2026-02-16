/**
 * Diagnóstico rápido: Verificar entregas pendientes
 * Uso: node check_entregas.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../config/db');

async function main() {
    const fecha = '2026-02-04'; // Cambiar según necesites
    const [year, month, day] = fecha.split('-').map(Number);

    console.log(`\n📊 DIAGNÓSTICO ENTREGAS - Fecha: ${fecha}\n`);

    // 1. Contar total de albaranes para ESE día en OPP
    const sqlTotal = `
        SELECT COUNT(*) as TOTAL, TRIM(CODIGOREPARTIDOR) as REP
        FROM DSEDAC.OPP
        WHERE ANOREPARTO = ${year} AND MESREPARTO = ${month} AND DIAREPARTO = ${day}
        GROUP BY TRIM(CODIGOREPARTIDOR)
        ORDER BY TOTAL DESC
        FETCH FIRST 20 ROWS ONLY
    `;

    console.log('1️⃣ Albaranes por Repartidor (según OPP):');
    const rows = await query(sqlTotal, false);
    let grandTotal = 0;
    rows.forEach(r => {
        console.log(`   Rep ${r.REP}: ${r.TOTAL} albaranes`);
        grandTotal += parseInt(r.TOTAL);
    });
    console.log(`   TOTAL: ${grandTotal} albaranes\n`);

    // 2. Verificar un repartidor específico (21)
    const sqlRep21 = `
        SELECT DISTINCT CPC.NUMEROALBARAN
        FROM DSEDAC.OPP OPP
        INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
        WHERE OPP.ANOREPARTO = ${year} AND OPP.MESREPARTO = ${month} AND OPP.DIAREPARTO = ${day}
          AND TRIM(OPP.CODIGOREPARTIDOR) = '21'
    `;

    console.log('2️⃣ Albaranes para Repartidor 21:');
    const rowsRep21 = await query(sqlRep21, false);
    console.log(`   Total: ${rowsRep21.length}`);
    rowsRep21.slice(0, 10).forEach(r => console.log(`   - Alb ${r.NUMEROALBARAN}`));

    // 3. Verificar entregas ya marcadas en DELIVERY_STATUS
    const sqlStatus = `
        SELECT COUNT(*) as TOTAL, STATUS
        FROM JAVIER.DELIVERY_STATUS
        GROUP BY STATUS
    `;

    console.log('\n3️⃣ Estado en DELIVERY_STATUS:');
    try {
        const rowsStatus = await query(sqlStatus, false);
        rowsStatus.forEach(r => console.log(`   ${r.STATUS}: ${r.TOTAL}`));
    } catch (e) {
        console.log(`   Error: ${e.message}`);
    }

    console.log('\n✅ Diagnóstico completado');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
