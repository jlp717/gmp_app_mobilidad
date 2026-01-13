/**
 * Buscar la manera correcta de vincular repartidor con documentos
 * Opción 1: LACLAE tiene ORDENPREPARACION?
 * Opción 2: CAC tiene algún campo que vincule directamente
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║    BUSCAR VINCULO REPARTIDOR → DOCUMENTOS                      ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        // 1. ¿LACLAE tiene ORDENPREPARACION?
        console.log('1. ¿LACLAE TIENE ORDENPREPARACION?');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const laclaeOrden = await conn.query(`
            SELECT COLUMN_NAME
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'LACLAE'
              AND COLUMN_NAME = 'ORDENPREPARACION'
        `);
        
        console.log(`   ¿LACLAE tiene ORDENPREPARACION? ${laclaeOrden.length > 0 ? 'SÍ' : 'NO'}`);
        
        if (laclaeOrden.length > 0) {
            // Ver estadísticas
            const laclaeStats = await conn.query(`
                SELECT 
                    COUNT(*) as TOTAL,
                    COUNT(CASE WHEN ORDENPREPARACION > 0 THEN 1 END) as CON_ORDEN
                FROM DSEDAC.LACLAE
            `);
            console.log(`   Total líneas en LACLAE: ${laclaeStats[0]?.TOTAL || 0}`);
            console.log(`   Con ORDENPREPARACION: ${laclaeStats[0]?.CON_ORDEN || 0}`);
        }

        // 2. Verificar columnas CODIGOREPARTIDOR o similar en CAC
        console.log('\n\n2. ¿CAC TIENE COLUMNAS DE REPARTIDOR/CONDUCTOR?');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const cacRepCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'CAC'
              AND (COLUMN_NAME LIKE '%CONDUCTOR%' 
                   OR COLUMN_NAME LIKE '%REPARTIDOR%'
                   OR COLUMN_NAME LIKE '%TRANSPORTISTA%'
                   OR COLUMN_NAME LIKE '%VEHICULO%')
        `);
        
        cacRepCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        // 3. Ver si hay CODIGOVENDEDORCONDUCTOR en CAC
        console.log('\n\n3. BUSCAR DATOS EN CODIGOVENDEDORCONDUCTOR DE CAC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Primero verificar si existe
        const checkCond = await conn.query(`
            SELECT COUNT(*) as EXISTE
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'CAC'
              AND COLUMN_NAME = 'CODIGOVENDEDORCONDUCTOR'
        `);
        
        if (checkCond[0].EXISTE > 0) {
            const condStats = await conn.query(`
                SELECT 
                    TRIM(CODIGOVENDEDORCONDUCTOR) as CONDUCTOR,
                    COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE CODIGOVENDEDORCONDUCTOR IS NOT NULL
                  AND TRIM(CODIGOVENDEDORCONDUCTOR) <> ''
                  AND EJERCICIO = 2026
                GROUP BY TRIM(CODIGOVENDEDORCONDUCTOR)
                ORDER BY TOTAL DESC
                FETCH FIRST 15 ROWS ONLY
            `);
            
            if (condStats.length > 0) {
                console.log('   CONDUCTOR │ TOTAL DOCS');
                console.log('   ──────────┼────────────');
                condStats.forEach(s => {
                    console.log(`   ${(s.CONDUCTOR || '').padEnd(9)} │ ${s.TOTAL}`);
                });
            } else {
                console.log('   No hay datos en CODIGOVENDEDORCONDUCTOR');
            }
        }

        // 4. Ver si hay VEHICULO en CAC
        console.log('\n\n4. BUSCAR CODIGOVEHICULO EN CAC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const checkVeh = await conn.query(`
            SELECT COUNT(*) as EXISTE
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'CAC'
              AND COLUMN_NAME = 'CODIGOVEHICULO'
        `);
        
        if (checkVeh[0].EXISTE > 0) {
            // Ver vehículos en CAC 2026
            const vehStats = await conn.query(`
                SELECT 
                    TRIM(CODIGOVEHICULO) as VEHICULO,
                    COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE CODIGOVEHICULO IS NOT NULL
                  AND TRIM(CODIGOVEHICULO) <> ''
                  AND EJERCICIO = 2026
                GROUP BY TRIM(CODIGOVEHICULO)
                ORDER BY TOTAL DESC
                FETCH FIRST 15 ROWS ONLY
            `);
            
            if (vehStats.length > 0) {
                console.log('   VEHÍCULO │ TOTAL DOCS');
                console.log('   ─────────┼────────────');
                vehStats.forEach(s => {
                    console.log(`   ${(s.VEHICULO || '').padEnd(8)} │ ${s.TOTAL}`);
                });
                
                // 5. Vincular vehículo con repartidor
                console.log('\n\n5. VINCULAR VEHÍCULO CON REPARTIDOR (VEH):');
                console.log('═══════════════════════════════════════════════════════════════\n');
                
                const vehReps = await conn.query(`
                    SELECT 
                        TRIM(VEH.MATRICULAVEHICULO) as MATRICULA,
                        TRIM(VEH.CODIGOVEHICULO) as CODIGO_VEH,
                        TRIM(VEH.CODIGOREPARTIDOR) as REPARTIDOR,
                        TRIM(VDD.NOMBREVENDEDOR) as NOMBRE_REP
                    FROM DSEDAC.VEH VEH
                    LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(VEH.CODIGOREPARTIDOR)
                    WHERE VEH.CODIGOREPARTIDOR IS NOT NULL
                    ORDER BY VEH.CODIGOREPARTIDOR
                `);
                
                console.log('   MATRÍCULA    │ VEH │ REP │ NOMBRE');
                console.log('   ─────────────┼─────┼─────┼──────────────────────');
                vehReps.forEach(v => {
                    const mat = (v.MATRICULA || '').padEnd(12);
                    const veh = (v.CODIGO_VEH || '').padEnd(4);
                    const rep = (v.REPARTIDOR || '').padEnd(4);
                    const nom = (v.NOMBRE_REP || '').substring(0, 25);
                    console.log(`   ${mat} │ ${veh} │ ${rep} │ ${nom}`);
                });

                // 6. Buscar documentos del vehículo del repartidor 79
                console.log('\n\n6. DOCUMENTOS DEL REPARTIDOR 79 VÍA VEHÍCULO:');
                console.log('═══════════════════════════════════════════════════════════════\n');
                
                // Primero obtener el vehículo del repartidor 79
                const veh79 = await conn.query(`
                    SELECT TRIM(CODIGOVEHICULO) as VEH
                    FROM DSEDAC.VEH
                    WHERE TRIM(CODIGOREPARTIDOR) = '79'
                `);
                
                if (veh79.length > 0) {
                    const vehiculo79 = veh79[0].VEH;
                    console.log(`   Vehículo del repartidor 79: ${vehiculo79}`);
                    
                    // Documentos con ese vehículo
                    const docs79 = await conn.query(`
                        SELECT COUNT(*) as TOTAL
                        FROM DSEDAC.CAC
                        WHERE TRIM(CODIGOVEHICULO) = '${vehiculo79}'
                          AND EJERCICIO = 2026
                    `);
                    
                    console.log(`   Documentos 2026 con vehículo ${vehiculo79}: ${docs79[0]?.TOTAL || 0}`);
                    
                    if (docs79[0]?.TOTAL > 0) {
                        // Sample
                        const sample79 = await conn.query(`
                            SELECT 
                                EJERCICIO, NUMDOCUMENTO,
                                TRIM(CODIGOCLIENTE) as CLIENTE,
                                IMPORTETOTALDOCUMENTO / 100.0 as TOTAL,
                                DIA, MES
                            FROM DSEDAC.CAC
                            WHERE TRIM(CODIGOVEHICULO) = '${vehiculo79}'
                              AND EJERCICIO = 2026
                            ORDER BY NUMDOCUMENTO DESC
                            FETCH FIRST 5 ROWS ONLY
                        `);
                        
                        console.log('\n   Sample:');
                        sample79.forEach((d, i) => {
                            console.log(`   [${i+1}] ${d.EJERCICIO}-${d.NUMDOCUMENTO}, Cliente: ${d.CLIENTE}, ${d.DIA}/${d.MES}, Total: ${d.TOTAL}€`);
                        });
                    }
                } else {
                    console.log('   El repartidor 79 no tiene vehículo asignado en VEH');
                }
            }
        } else {
            console.log('   CAC NO tiene CODIGOVEHICULO');
        }

        console.log('\n════════════════════════════════════════════════════════════════');
        console.log('                      RESUMEN');
        console.log('════════════════════════════════════════════════════════════════\n');
        
    } finally {
        await conn.close();
    }
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
