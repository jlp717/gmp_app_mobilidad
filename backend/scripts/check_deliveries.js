/**
 * check_deliveries.js - Investigar estado de entregas en DSEDAC
 * Ejecutar: node scripts/check_deliveries.js
 */
const { initDb, query } = require('../config/db');

async function main() {
    await initDb();
    console.log('\n=== INVESTIGACIÓN ENTREGAS DSEDAC ===\n');

    // 1. Ver columnas de OPP (Ordenes de Preparación de Pedidos)
    console.log('--- 1. COLUMNAS DE DSEDAC.OPP ---');
    try {
        const oppCols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH, IS_NULLABLE
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPP'
            ORDER BY ORDINAL_POSITION
        `, false);
        oppCols.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE}, len=${c.LENGTH})`));
    } catch (e) {
        console.log('  Error:', e.message);
        // Fallback: intentar con SYSIBM
        try {
            const oppCols = await query(`
                SELECT NAME, COLTYPE, LENGTH
                FROM SYSIBM.SYSCOLUMNS
                WHERE TBNAME = 'OPP' AND TBCREATOR = 'DSEDAC'
            `, false);
            oppCols.forEach(c => console.log(`  ${c.NAME} (${c.COLTYPE}, len=${c.LENGTH})`));
        } catch (e2) {
            console.log('  Fallback error:', e2.message);
        }
    }

    // 2. Ver columnas de CPC
    console.log('\n--- 2. COLUMNAS DE DSEDAC.CPC ---');
    try {
        const cpcCols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CPC'
            ORDER BY ORDINAL_POSITION
        `, false);
        cpcCols.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE}, len=${c.LENGTH})`));
    } catch (e) {
        console.log('  Error:', e.message);
    }

    // 3. Ver sample de OPP con todas las columnas para un reparto reciente
    console.log('\n--- 3. SAMPLE OPP (últimos repartos) ---');
    try {
        const sample = await query(`
            SELECT * FROM DSEDAC.OPP
            WHERE ANOREPARTO = 2026 AND MESREPARTO = 2
            FETCH FIRST 3 ROWS ONLY
        `, false);
        if (sample.length > 0) {
            console.log('  Columnas:', Object.keys(sample[0]).join(', '));
            sample.forEach((row, i) => {
                console.log(`\n  --- Fila ${i + 1} ---`);
                Object.entries(row).forEach(([k, v]) => {
                    if (v !== null && v !== undefined && v !== '' && v !== 0) {
                        console.log(`    ${k} = ${v}`);
                    }
                });
            });
        }
    } catch (e) {
        console.log('  Error:', e.message);
    }

    // 4. Ver columnas de LAC (líneas de albarán)
    console.log('\n--- 4. COLUMNAS DE DSEDAC.LAC ---');
    try {
        const lacCols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC'
            ORDER BY ORDINAL_POSITION
        `, false);
        lacCols.forEach(c => console.log(`  ${c.COLUMN_NAME} (${c.DATA_TYPE}, len=${c.LENGTH})`));
    } catch (e) {
        console.log('  Error:', e.message);
    }

    // 5. Sample LAC para un albarán conocido
    console.log('\n--- 5. SAMPLE LAC (1 albarán) ---');
    try {
        const sampleLac = await query(`
            SELECT * FROM DSEDAC.LAC
            WHERE EJERCICIOALBARAN = 2026
            FETCH FIRST 2 ROWS ONLY
        `, false);
        if (sampleLac.length > 0) {
            console.log('  Columnas:', Object.keys(sampleLac[0]).join(', '));
            sampleLac.forEach((row, i) => {
                console.log(`\n  --- Línea ${i + 1} ---`);
                Object.entries(row).forEach(([k, v]) => {
                    if (v !== null && v !== undefined && v !== '') {
                        console.log(`    ${k} = ${v}`);
                    }
                });
            });
        }
    } catch (e) {
        console.log('  Error:', e.message);
    }

    // 6. Ver cuántas entregas hay en JAVIER.DELIVERY_STATUS
    console.log('\n--- 6. DELIVERY_STATUS (nuestra tabla) ---');
    try {
        const ds = await query(`
            SELECT COUNT(*) as TOTAL,
                   SUM(CASE WHEN STATUS = 'ENTREGADO' THEN 1 ELSE 0 END) as ENTREGADOS,
                   SUM(CASE WHEN STATUS = 'NO_ENTREGADO' THEN 1 ELSE 0 END) as NO_ENTREGADOS
            FROM JAVIER.DELIVERY_STATUS
        `, false);
        console.log('  Total:', ds[0]?.TOTAL, '| Entregados:', ds[0]?.ENTREGADOS, '| No entregados:', ds[0]?.NO_ENTREGADOS);

        // Ver las últimas 5
        const last5 = await query(`
            SELECT ID, STATUS, FECHA_ENTREGA, TRIM(REPARTIDOR) as REP
            FROM JAVIER.DELIVERY_STATUS
            ORDER BY FECHA_ENTREGA DESC
            FETCH FIRST 5 ROWS ONLY
        `, false);
        last5.forEach(r => console.log(`  ${r.ID} | ${r.STATUS} | ${r.FECHA_ENTREGA} | rep=${r.REP}`));
    } catch (e) {
        console.log('  Error:', e.message);
    }

    // 7. Buscar columnas que puedan indicar "entregado" en OPP/CPC
    console.log('\n--- 7. BUSCAR CAMPOS DE ESTADO EN OPP ---');
    try {
        const oppSample = await query(`
            SELECT * FROM DSEDAC.OPP
            WHERE ANOREPARTO = 2026 AND MESREPARTO = 2 AND DIAREPARTO = 6
            FETCH FIRST 1 ROWS ONLY
        `, false);
        if (oppSample.length > 0) {
            console.log('  Todas las columnas de OPP con valores:');
            Object.entries(oppSample[0]).forEach(([k, v]) => {
                console.log(`    ${k} = [${v}] (type: ${typeof v})`);
            });
        }
    } catch (e) {
        console.log('  Error:', e.message);
    }

    console.log('\n=== FIN INVESTIGACIÓN ===');
    process.exit(0);
}

main().catch(e => {
    console.error('Error fatal:', e.message);
    process.exit(1);
});
