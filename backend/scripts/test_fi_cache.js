/**
 * Test script para verificar que las queries FI funcionan correctamente
 */
const { query, initDb } = require('../config/db');

async function testFiCache() {
    await initDb();
    console.log('✅ Base de datos conectada\n');

    console.log('='.repeat(60));
    console.log('PROBANDO QUERIES DE CACHÉ FI');
    console.log('='.repeat(60));

    try {
        // FI1
        console.log('\n📋 FI1:');
        const fi1 = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO, ORDEN FROM DSEDAC.FI1 ORDER BY ORDEN, DESCRIPCIONFILTRO`);
        console.log(`   Rows: ${fi1.length}`);
        if (fi1.length > 0) {
            console.log(`   Keys: ${Object.keys(fi1[0]).join(', ')}`);
            console.log(`   Sample:`, fi1[0]);
        }

        // FI2
        console.log('\n📋 FI2:');
        const fi2 = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO, ORDEN FROM DSEDAC.FI2 ORDER BY ORDEN, DESCRIPCIONFILTRO`);
        console.log(`   Rows: ${fi2.length}`);
        if (fi2.length > 0) {
            console.log(`   Keys: ${Object.keys(fi2[0]).join(', ')}`);
            console.log(`   Sample:`, fi2[0]);
        }

        // FI3
        console.log('\n📋 FI3:');
        const fi3 = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO, ORDEN FROM DSEDAC.FI3 ORDER BY ORDEN, DESCRIPCIONFILTRO`);
        console.log(`   Rows: ${fi3.length}`);
        if (fi3.length > 0) console.log(`   Sample:`, fi3[0]);

        // FI4
        console.log('\n📋 FI4:');
        const fi4 = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO, ORDEN FROM DSEDAC.FI4 ORDER BY ORDEN, DESCRIPCIONFILTRO`);
        console.log(`   Rows: ${fi4.length}`);
        if (fi4.length > 0) console.log(`   Sample:`, fi4[0]);

        // FI5
        console.log('\n📋 FI5:');
        const fi5 = await query(`SELECT CODIGOFILTRO, DESCRIPCIONFILTRO, ORDEN FROM DSEDAC.FI5 ORDER BY ORDEN, DESCRIPCIONFILTRO`);
        console.log(`   Rows: ${fi5.length}`);
        if (fi5.length > 0) console.log(`   Sample:`, fi5[0]);

        // Test ARTX relation
        console.log('\n📋 ARTX (sample of FILTRO01/02/03/04):');
        const artx = await query(`SELECT CODIGOARTICULO, FILTRO01, FILTRO02, FILTRO03, FILTRO04 FROM DSEDAC.ARTX WHERE FILTRO01 IS NOT NULL FETCH FIRST 5 ROWS ONLY`);
        console.log(`   Rows: ${artx.length}`);
        artx.forEach(a => console.log(`   Art: ${a.CODIGOARTICULO?.trim()} → F1:${a.FILTRO01?.trim()} F2:${a.FILTRO02?.trim()} F3:${a.FILTRO03?.trim()} F4:${a.FILTRO04?.trim()}`));

        console.log('\n' + '='.repeat(60));
        console.log('✅ TODAS LAS QUERIES EJECUTADAS CORRECTAMENTE');
        console.log('='.repeat(60));

    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error(err.stack);
    }

    process.exit(0);
}

testFiCache();
