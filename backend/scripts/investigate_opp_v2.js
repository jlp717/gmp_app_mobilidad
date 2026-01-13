/**
 * Script corregido para investigar OPP y encontrar repartidores reales
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function investigateOPP() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║          INVESTIGACIÓN TABLA OPP - REPARTIDORES                ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        // 1. Cuántos registros tiene OPP por repartidor
        console.log('1. DISTRIBUCIÓN DE CODIGOREPARTIDOR EN OPP:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const repsOPP = await conn.query(`
            SELECT 
                TRIM(CODIGOREPARTIDOR) as REP,
                COUNT(*) as TOTAL
            FROM DSEDAC.OPP
            WHERE CODIGOREPARTIDOR IS NOT NULL
              AND TRIM(CODIGOREPARTIDOR) <> ''
            GROUP BY TRIM(CODIGOREPARTIDOR)
            ORDER BY TOTAL DESC
            FETCH FIRST 15 ROWS ONLY
        `);
        
        console.log('   REPARTIDOR │ TOTAL REGISTROS');
        console.log('   ───────────┼─────────────────');
        repsOPP.forEach(r => {
            console.log(`   ${(r.REP || '').padEnd(10)} │ ${r.TOTAL}`);
        });

        // 2. Sample de OPP - solo columnas simples
        console.log('\n\n2. SAMPLE DE REGISTROS OPP:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const sample = await conn.query(`
            SELECT 
                ID,
                TRIM(CODIGOREPARTIDOR) as REP,
                TRIM(CODIGOVEHICULO) as VEH,
                EJERCICIOORDENPREPARACION as EJERCICIO,
                NUMEROORDENPREPARACION as NUMORDEN,
                ANOREPARTO, MESREPARTO, DIAREPARTO,
                ESTADOORDENPREPARACION as ESTADO
            FROM DSEDAC.OPP
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
            ORDER BY ID DESC
            FETCH FIRST 5 ROWS ONLY
        `);
        
        sample.forEach((r, i) => {
            console.log(`   [${i+1}] ID: ${r.ID}, Rep: ${r.REP}, Veh: ${r.VEH}, Orden: ${r.EJERCICIO}-${r.NUMORDEN}, Reparto: ${r.DIAREPARTO}/${r.MESREPARTO}/${r.ANOREPARTO}, Estado: ${r.ESTADO}`);
        });

        // 3. OPP está vinculada a otra tabla? Buscar el documento real
        console.log('\n\n3. BUSCAR RELACIÓN OPP -> DOCUMENTOS CAC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Verificar si NUMEROORDENPREPARACION se relaciona con CAC
        const checkRelacion = await conn.query(`
            SELECT 
                OPP.EJERCICIOORDENPREPARACION as EJ_OPP,
                OPP.NUMEROORDENPREPARACION as NUM_OPP,
                COUNT(DISTINCT CAC.CODIGODOCUMENTO) as DOCS_CAC
            FROM DSEDAC.OPP OPP
            LEFT JOIN DSEDAC.CAC CAC 
                ON CAC.EJERCICIO = OPP.EJERCICIOORDENPREPARACION 
                AND CAC.NUMDOCUMENTO = OPP.NUMEROORDENPREPARACION
            WHERE TRIM(OPP.CODIGOREPARTIDOR) = '79'
            GROUP BY OPP.EJERCICIOORDENPREPARACION, OPP.NUMEROORDENPREPARACION
            FETCH FIRST 10 ROWS ONLY
        `);
        
        console.log('   EJ_OPP │ NUM_OPP  │ DOCS CAC');
        console.log('   ───────┼──────────┼──────────');
        checkRelacion.forEach(r => {
            console.log(`   ${r.EJ_OPP || 'NULL'}   │ ${String(r.NUM_OPP || '').padEnd(8)} │ ${r.DOCS_CAC}`);
        });

        // 4. Buscar la columna correcta en CAC para vincular
        console.log('\n\n4. COLUMNAS EN CAC QUE PODRÍAN VINCULAR A REPARTIDOR:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const cacCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'CAC'
              AND (COLUMN_NAME LIKE '%REPARTO%' 
                   OR COLUMN_NAME LIKE '%VEHICULO%' 
                   OR COLUMN_NAME LIKE '%CONDUCTOR%'
                   OR COLUMN_NAME LIKE '%ORDEN%'
                   OR COLUMN_NAME LIKE '%PREPARACION%')
            ORDER BY COLUMN_NAME
        `);
        
        cacCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 5. Revisar el campo CODIGOSERIE en CAC - verificar tipos de documentos
        console.log('\n\n5. TIPOS DE DOCUMENTOS EN CAC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const tiposDoc = await conn.query(`
            SELECT 
                TRIM(CODIGOSERIE) as SERIE,
                TRIM(CODIGOTIPODOCUMENTO) as TIPO,
                COUNT(*) as TOTAL
            FROM DSEDAC.CAC
            WHERE EJERCICIO = 2026
            GROUP BY TRIM(CODIGOSERIE), TRIM(CODIGOTIPODOCUMENTO)
            ORDER BY TOTAL DESC
            FETCH FIRST 15 ROWS ONLY
        `);
        
        console.log('   SERIE │ TIPO │ TOTAL');
        console.log('   ──────┼──────┼───────');
        tiposDoc.forEach(r => {
            console.log(`   ${(r.SERIE || '').padEnd(5)} │ ${(r.TIPO || '').padEnd(4)} │ ${r.TOTAL}`);
        });

        // 6. Buscar en OPC (lineas de orden de preparacion)
        console.log('\n\n6. EXPLORAR TABLA OPC (LÍNEAS DE ORDEN PREPARACIÓN):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const opcCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPC'
            ORDER BY COLUMN_NAME
            FETCH FIRST 30 ROWS ONLY
        `);
        
        opcCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 7. Verificar OPC para encontrar documentos del repartidor
        console.log('\n\n7. SAMPLE OPC VINCULADO A REPARTIDOR 79:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        try {
            const opcSample = await conn.query(`
                SELECT 
                    OPC.EJERCICIOORDENPREPARACION,
                    OPC.NUMEROORDENPREPARACION,
                    OPC.CODIGOCLIENTE,
                    OPC.EJERCICIODOCUMENTO,
                    OPC.NUMDOCUMENTO,
                    OPC.TIPODOCUMENTO
                FROM DSEDAC.OPC OPC
                INNER JOIN DSEDAC.OPP OPP 
                    ON OPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                    AND OPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                WHERE TRIM(OPP.CODIGOREPARTIDOR) = '79'
                FETCH FIRST 5 ROWS ONLY
            `);
            
            opcSample.forEach((r, i) => {
                console.log(`   [${i+1}] Orden: ${r.EJERCICIOORDENPREPARACION}-${r.NUMEROORDENPREPARACION}`);
                console.log(`       Cliente: ${r.CODIGOCLIENTE}, Doc: ${r.TIPODOCUMENTO} ${r.EJERCICIODOCUMENTO}-${r.NUMDOCUMENTO}`);
            });
        } catch (e) {
            console.log('   Error en OPC:', e.message);
        }

        // 8. Repartidores con vehículo asignado y datos en OPP
        console.log('\n\n8. REPARTIDORES CON VEHÍCULO + DATOS OPP:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const repsConVeh = await conn.query(`
            SELECT 
                TRIM(VEH.CODIGOREPARTIDOR) as REP,
                TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
                TRIM(VEH.MATRICULAVEHICULO) as MATRICULA,
                (SELECT COUNT(*) FROM DSEDAC.OPP O WHERE TRIM(O.CODIGOREPARTIDOR) = TRIM(VEH.CODIGOREPARTIDOR)) as ENTREGAS_OPP
            FROM DSEDAC.VEH VEH
            INNER JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(VEH.CODIGOREPARTIDOR)
            WHERE VEH.CODIGOREPARTIDOR IS NOT NULL
            ORDER BY ENTREGAS_OPP DESC
            FETCH FIRST 10 ROWS ONLY
        `);
        
        console.log('   REP │ NOMBRE                      │ MATRÍCULA  │ ENTREGAS OPP');
        console.log('   ────┼─────────────────────────────┼────────────┼──────────────');
        repsConVeh.forEach(r => {
            const rep = (r.REP || '').padEnd(3);
            const nom = (r.NOMBRE || '').substring(0, 26).padEnd(26);
            const mat = (r.MATRICULA || '').padEnd(10);
            console.log(`   ${rep} │ ${nom} │ ${mat} │ ${r.ENTREGAS_OPP}`);
        });

        // 9. Obtener PIN de estos repartidores
        console.log('\n\n9. CREDENCIALES DE REPARTIDORES CON VEHÍCULO:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const repsIds = repsConVeh.filter(r => r.ENTREGAS_OPP > 0).slice(0, 5).map(r => `'${r.REP}'`).join(',');
        if (repsIds) {
            const pins = await conn.query(`
                SELECT TRIM(CODIGOVENDEDOR) as COD, CODIGOPIN as PIN
                FROM DSEDAC.VDPL1
                WHERE TRIM(CODIGOVENDEDOR) IN (${repsIds})
            `);
            
            console.log('   CÓDIGO │ PIN');
            console.log('   ───────┼─────');
            pins.forEach(p => {
                console.log(`   ${(p.COD || '').padEnd(6)} │ ${p.PIN || '(sin PIN)'}`);
            });
        }

        console.log('\n════════════════════════════════════════════════════════════════');
        console.log('                         CONCLUSIÓN');
        console.log('════════════════════════════════════════════════════════════════\n');
        
        console.log('   Para obtener entregas de un REPARTIDOR:');
        console.log('   1. OPP tiene CODIGOREPARTIDOR y NUMEROORDENPREPARACION');
        console.log('   2. OPC vincula orden de preparación con documentos reales');
        console.log('   3. El JOIN correcto es: OPP -> OPC -> CAC');
        console.log('\n   Query corregida debe usar:');
        console.log('   SELECT ... FROM CAC');
        console.log('   INNER JOIN OPC ON CAC.EJERCICIO = OPC.EJERCICIODOCUMENTO');
        console.log('                 AND CAC.NUMDOCUMENTO = OPC.NUMDOCUMENTO');
        console.log('   INNER JOIN OPP ON OPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION');
        console.log('                 AND OPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION');
        console.log('   WHERE TRIM(OPP.CODIGOREPARTIDOR) = :repartidorId');
        
        console.log('\n════════════════════════════════════════════════════════════════\n');
        
    } finally {
        await conn.close();
    }
}

investigateOPP().catch(err => {
    console.error('Error:', err.message);
    console.error(err.stack);
    process.exit(1);
});
