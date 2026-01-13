/**
 * Script para encontrar vendedores/repartidores con datos para testing
 * Busca quién tiene documentos hoy, mañana, y en el mes actual
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function findTestableRepartidores() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        const today = new Date();
        const dia = today.getDate();
        const mes = today.getMonth() + 1;
        const ano = today.getFullYear();
        
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║     VENDEDORES/REPARTIDORES DISPONIBLES PARA TESTING           ║');
        console.log('╚════════════════════════════════════════════════════════════════╝');
        console.log(`\nFecha actual: ${dia}/${mes}/${ano}\n`);

        // 1. Vendedores con documentos HOY
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('1. VENDEDORES CON DOCUMENTOS HOY (' + dia + '/' + mes + '/' + ano + '):');
        console.log('═══════════════════════════════════════════════════════════════');
        
        const hoy = await conn.query(`
            SELECT 
                TRIM(CAC.CODIGOVENDEDOR) as CODIGO,
                TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
                COUNT(*) as DOCS_HOY,
                SUM(CAC.IMPORTETOTAL) / 100.0 as IMPORTE_TOTAL
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(CAC.CODIGOVENDEDOR)
            WHERE CAC.ANODOCUMENTO = ${ano}
              AND CAC.MESDOCUMENTO = ${mes}
              AND CAC.DIADOCUMENTO = ${dia}
              AND CAC.CODIGOVENDEDOR IS NOT NULL
              AND TRIM(CAC.CODIGOVENDEDOR) <> ''
            GROUP BY TRIM(CAC.CODIGOVENDEDOR), TRIM(VDD.NOMBREVENDEDOR)
            ORDER BY DOCS_HOY DESC
            FETCH FIRST 15 ROWS ONLY
        `);
        
        if (hoy.length > 0) {
            console.log('\n   CÓDIGO   │ NOMBRE                          │ DOCS │ IMPORTE');
            console.log('   ─────────┼─────────────────────────────────┼──────┼──────────');
            hoy.forEach(v => {
                const cod = (v.CODIGO || '').padEnd(8);
                const nom = (v.NOMBRE || 'Sin nombre').substring(0, 30).padEnd(30);
                const docs = String(v.DOCS_HOY).padStart(4);
                const imp = (v.IMPORTE_TOTAL || 0).toFixed(2).padStart(10);
                console.log(`   ${cod} │ ${nom} │ ${docs} │ ${imp}€`);
            });
        } else {
            console.log('   ⚠️  No hay documentos para hoy');
        }

        // 2. Vendedores con documentos AYER (por si hoy es temprano)
        const ayer = new Date(today);
        ayer.setDate(ayer.getDate() - 1);
        
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log(`2. VENDEDORES CON DOCUMENTOS AYER (${ayer.getDate()}/${ayer.getMonth()+1}/${ayer.getFullYear()}):`);
        console.log('═══════════════════════════════════════════════════════════════');
        
        const ayerData = await conn.query(`
            SELECT 
                TRIM(CAC.CODIGOVENDEDOR) as CODIGO,
                TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
                COUNT(*) as DOCS,
                SUM(CAC.IMPORTETOTAL) / 100.0 as IMPORTE
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(CAC.CODIGOVENDEDOR)
            WHERE CAC.ANODOCUMENTO = ${ayer.getFullYear()}
              AND CAC.MESDOCUMENTO = ${ayer.getMonth() + 1}
              AND CAC.DIADOCUMENTO = ${ayer.getDate()}
              AND CAC.CODIGOVENDEDOR IS NOT NULL
              AND TRIM(CAC.CODIGOVENDEDOR) <> ''
            GROUP BY TRIM(CAC.CODIGOVENDEDOR), TRIM(VDD.NOMBREVENDEDOR)
            ORDER BY DOCS DESC
            FETCH FIRST 10 ROWS ONLY
        `);
        
        if (ayerData.length > 0) {
            console.log('\n   CÓDIGO   │ NOMBRE                          │ DOCS');
            console.log('   ─────────┼─────────────────────────────────┼──────');
            ayerData.forEach(v => {
                const cod = (v.CODIGO || '').padEnd(8);
                const nom = (v.NOMBRE || 'Sin nombre').substring(0, 30).padEnd(30);
                const docs = String(v.DOCS).padStart(4);
                console.log(`   ${cod} │ ${nom} │ ${docs}`);
            });
        } else {
            console.log('   ⚠️  No hay documentos de ayer');
        }

        // 3. Top vendedores del MES ACTUAL (para histórico)
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log(`3. TOP VENDEDORES ESTE MES (${mes}/${ano}) - Para histórico:`);
        console.log('═══════════════════════════════════════════════════════════════');
        
        const mesActual = await conn.query(`
            SELECT 
                TRIM(CAC.CODIGOVENDEDOR) as CODIGO,
                TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
                COUNT(*) as TOTAL_DOCS,
                SUM(CAC.IMPORTETOTAL) / 100.0 as IMPORTE_MES,
                COUNT(DISTINCT CAC.DIADOCUMENTO) as DIAS_ACTIVO
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(CAC.CODIGOVENDEDOR)
            WHERE CAC.ANODOCUMENTO = ${ano}
              AND CAC.MESDOCUMENTO = ${mes}
              AND CAC.CODIGOVENDEDOR IS NOT NULL
              AND TRIM(CAC.CODIGOVENDEDOR) <> ''
            GROUP BY TRIM(CAC.CODIGOVENDEDOR), TRIM(VDD.NOMBREVENDEDOR)
            ORDER BY TOTAL_DOCS DESC
            FETCH FIRST 20 ROWS ONLY
        `);
        
        console.log('\n   CÓDIGO   │ NOMBRE                          │ DOCS │ DÍAS │ IMPORTE MES');
        console.log('   ─────────┼─────────────────────────────────┼──────┼──────┼────────────');
        mesActual.forEach(v => {
            const cod = (v.CODIGO || '').padEnd(8);
            const nom = (v.NOMBRE || 'Sin nombre').substring(0, 30).padEnd(30);
            const docs = String(v.TOTAL_DOCS).padStart(4);
            const dias = String(v.DIAS_ACTIVO).padStart(4);
            const imp = (v.IMPORTE_MES || 0).toFixed(2).padStart(11);
            console.log(`   ${cod} │ ${nom} │ ${docs} │ ${dias} │ ${imp}€`);
        });

        // 4. Repartidores con VEHÍCULO asignado
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('4. REPARTIDORES CON VEHÍCULO (rol REPARTIDOR):');
        console.log('═══════════════════════════════════════════════════════════════');
        
        const repartidores = await conn.query(`
            SELECT 
                TRIM(VEH.CODIGOVENDEDOR) as CODIGO,
                TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
                TRIM(VEH.CODIGOVEHICULO) as VEHICULO,
                TRIM(VEH.MATRICULA) as MATRICULA
            FROM DSEDAC.VEH VEH
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(VEH.CODIGOVENDEDOR)
            WHERE VEH.CODIGOVENDEDOR IS NOT NULL
            ORDER BY VEH.CODIGOVENDEDOR
            FETCH FIRST 20 ROWS ONLY
        `);
        
        console.log('\n   CÓDIGO   │ NOMBRE                          │ VEHÍCULO │ MATRÍCULA');
        console.log('   ─────────┼─────────────────────────────────┼──────────┼───────────');
        repartidores.forEach(r => {
            const cod = (r.CODIGO || '').padEnd(8);
            const nom = (r.NOMBRE || 'Sin nombre').substring(0, 30).padEnd(30);
            const veh = (r.VEHICULO || '').padEnd(8);
            const mat = r.MATRICULA || '';
            console.log(`   ${cod} │ ${nom} │ ${veh} │ ${mat}`);
        });

        // 5. Recomendación final
        console.log('\n╔════════════════════════════════════════════════════════════════╗');
        console.log('║                    RECOMENDACIÓN PARA TESTING                  ║');
        console.log('╚════════════════════════════════════════════════════════════════╝');
        
        if (hoy.length > 0) {
            const recomendado = hoy[0];
            console.log(`\n🎯 VENDEDOR RECOMENDADO: ${recomendado.CODIGO}`);
            console.log(`   Nombre: ${recomendado.NOMBRE}`);
            console.log(`   Documentos hoy: ${recomendado.DOCS_HOY}`);
            console.log(`\n   Para probar, haz login con:`);
            console.log(`   - Usuario: ${recomendado.CODIGO}`);
            console.log(`   - Contraseña: (el PIN del vendedor en VDPL1)`);
        } else if (mesActual.length > 0) {
            const recomendado = mesActual[0];
            console.log(`\n🎯 VENDEDOR RECOMENDADO (tiene histórico): ${recomendado.CODIGO}`);
            console.log(`   Nombre: ${recomendado.NOMBRE}`);
            console.log(`   Total docs este mes: ${recomendado.TOTAL_DOCS}`);
        }
        
        // Verificar PIN de los top vendedores
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('5. CREDENCIALES (usuario → PIN):');
        console.log('═══════════════════════════════════════════════════════════════');
        
        const topCodes = mesActual.slice(0, 5).map(v => `'${v.CODIGO}'`).join(',');
        if (topCodes) {
            const pins = await conn.query(`
                SELECT TRIM(P.CODIGOVENDEDOR) as CODIGO, P.CODIGOPIN as PIN
                FROM DSEDAC.VDPL1 P
                WHERE TRIM(P.CODIGOVENDEDOR) IN (${topCodes})
            `);
            
            console.log('\n   USUARIO   │ PIN');
            console.log('   ──────────┼──────');
            pins.forEach(p => {
                console.log(`   ${(p.CODIGO || '').padEnd(9)} │ ${p.PIN || '(sin PIN)'}`);
            });
        }
        
        console.log('\n════════════════════════════════════════════════════════════════');
        
    } finally {
        await conn.close();
    }
}

findTestableRepartidores().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
