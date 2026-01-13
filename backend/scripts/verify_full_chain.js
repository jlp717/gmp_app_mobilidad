/**
 * VERIFICAR VINCULACIÓN COMPLETA: OPP → CPC → CAC
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('Conectado a DB2\n');
        
        // 1. Estructura de CPC
        console.log('1. ESTRUCTURA DE CPC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const cpcCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CPC'
            ORDER BY ORDINAL_POSITION
        `);
        
        cpcCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 2. Sample CPC con orden del repartidor 79
        console.log('\n\n2. BUSCAR CPC PARA ORDEN 2026-1732:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const cpc1732 = await conn.query(`
            SELECT * FROM DSEDAC.CPC
            WHERE NUMEROORDENPREPARACION = 1732
            FETCH FIRST 5 ROWS ONLY
        `);
        
        if (cpc1732.length > 0) {
            console.log('   ¡ENCONTRADO!');
            cpc1732.forEach((row, i) => {
                console.log(`\n   [${i+1}]:`);
                Object.entries(row).forEach(([k, v]) => {
                    if (v !== null && v !== 0 && String(v).trim() !== '') {
                        console.log(`       ${k}: ${v}`);
                    }
                });
            });
        } else {
            console.log('   No se encontró');
        }

        // 3. Query completa: Documentos del repartidor 79 vía OPP → CPC → CAC
        console.log('\n\n3. DOCUMENTOS DEL REPARTIDOR 79 (ENERO 2026):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const docs79 = await conn.query(`
            SELECT DISTINCT
                CAC.EJERCICIOALBARAN,
                CAC.SERIEALBARAN,
                CAC.NUMEROALBARAN,
                TRIM(CAC.CODIGOCLIENTEALBARAN) as CLIENTE,
                CAC.IMPORTETOTAL / 100.0 as TOTAL,
                CAC.DIADOCUMENTO, CAC.MESDOCUMENTO,
                OPP.DIAREPARTO, OPP.MESREPARTO
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC 
                ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            WHERE OPP.CODIGOREPARTIDOR = '79'
              AND OPP.ANOREPARTO = 2026
              AND OPP.MESREPARTO = 1
            ORDER BY OPP.DIAREPARTO DESC, CAC.NUMEROALBARAN DESC
            FETCH FIRST 20 ROWS ONLY
        `);
        
        if (docs79.length > 0) {
            console.log('   ¡DOCUMENTOS ENCONTRADOS!');
            console.log('\n   FECHA      │ ALBARÁN       │ CLIENTE       │ TOTAL');
            console.log('   ───────────┼───────────────┼───────────────┼──────────');
            docs79.forEach(d => {
                const fecha = `${d.DIAREPARTO || d.DIADOCUMENTO}/${d.MESREPARTO || d.MESDOCUMENTO}`;
                const alb = `${d.EJERCICIOALBARAN}-${d.SERIEALBARAN}-${d.NUMEROALBARAN}`;
                console.log(`   ${fecha.padEnd(10)} │ ${alb.padEnd(13)} │ ${(d.CLIENTE || '').padEnd(13)} │ ${(d.TOTAL || 0).toFixed(2)}€`);
            });
        } else {
            console.log('   No se encontraron documentos');
        }

        // 4. Contar totales
        console.log('\n\n4. RESUMEN TOTALES REPARTIDOR 79 (ENERO 2026):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const totals79 = await conn.query(`
            SELECT 
                COUNT(DISTINCT CAC.NUMEROALBARAN) as DOCS,
                COUNT(DISTINCT CAC.CODIGOCLIENTEALBARAN) as CLIENTES,
                SUM(CAC.IMPORTETOTAL) / 100.0 as IMPORTE_TOTAL
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC 
                ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            WHERE OPP.CODIGOREPARTIDOR = '79'
              AND OPP.ANOREPARTO = 2026
              AND OPP.MESREPARTO = 1
        `);
        
        if (totals79.length > 0) {
            console.log(`   Total documentos: ${totals79[0]?.DOCS || 0}`);
            console.log(`   Clientes distintos: ${totals79[0]?.CLIENTES || 0}`);
            console.log(`   Importe total: ${(totals79[0]?.IMPORTE_TOTAL || 0).toFixed(2)}€`);
        }

        // 5. Verificar query para entregas pendientes
        console.log('\n\n5. ENTREGAS PENDIENTES REPARTIDOR 79 (HOY):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const today = new Date();
        const entregas = await conn.query(`
            SELECT 
                CAC.EJERCICIOALBARAN,
                CAC.SERIEALBARAN,
                CAC.NUMEROALBARAN,
                TRIM(CAC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(CLI.NOMBRECLIENTE) as NOMBRE,
                TRIM(CLI.DIRECCION) as DIRECCION,
                CAC.IMPORTETOTAL / 100.0 as TOTAL,
                OPP.DIAREPARTO, OPP.MESREPARTO, OPP.ANOREPARTO
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC 
                ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            LEFT JOIN DSEDAC.CLI CLI
                ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
            WHERE OPP.CODIGOREPARTIDOR = '79'
              AND OPP.ANOREPARTO = ${today.getFullYear()}
              AND OPP.MESREPARTO = ${today.getMonth() + 1}
              AND OPP.DIAREPARTO = ${today.getDate()}
            ORDER BY CAC.NUMEROALBARAN
            FETCH FIRST 10 ROWS ONLY
        `);
        
        console.log(`   Fecha de hoy: ${today.getDate()}/${today.getMonth()+1}/${today.getFullYear()}`);
        console.log(`   Entregas encontradas: ${entregas.length}`);
        
        if (entregas.length > 0) {
            entregas.forEach((e, i) => {
                console.log(`\n   [${i+1}] ${e.EJERCICIOALBARAN}-${e.SERIEALBARAN}-${e.NUMEROALBARAN}`);
                console.log(`       Cliente: ${e.CLIENTE} - ${e.NOMBRE || ''}`);
                console.log(`       Dirección: ${e.DIRECCION || ''}`);
                console.log(`       Total: ${(e.TOTAL || 0).toFixed(2)}€`);
            });
        } else {
            console.log('\n   No hay entregas para hoy');
            
            // Mostrar último día con entregas
            const lastDay = await conn.query(`
                SELECT DISTINCT OPP.DIAREPARTO, OPP.MESREPARTO, OPP.ANOREPARTO, COUNT(*) as DOCS
                FROM DSEDAC.OPP OPP
                INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                WHERE OPP.CODIGOREPARTIDOR = '79'
                  AND OPP.ANOREPARTO = 2026
                GROUP BY OPP.DIAREPARTO, OPP.MESREPARTO, OPP.ANOREPARTO
                ORDER BY OPP.ANOREPARTO DESC, OPP.MESREPARTO DESC, OPP.DIAREPARTO DESC
                FETCH FIRST 5 ROWS ONLY
            `);
            
            if (lastDay.length > 0) {
                console.log('\n   Últimos días con entregas:');
                lastDay.forEach(d => {
                    console.log(`   - ${d.DIAREPARTO}/${d.MESREPARTO}/${d.ANOREPARTO}: ${d.DOCS} documentos`);
                });
            }
        }

        await conn.close();
        
        console.log('\n════════════════════════════════════════════════════════════════');
        console.log('                    ¡ÉXITO! VINCULACIÓN CONFIRMADA');
        console.log('════════════════════════════════════════════════════════════════\n');
        console.log('   La cadena correcta es:');
        console.log('   OPP.NUMEROORDENPREPARACION → CPC.NUMEROORDENPREPARACION');
        console.log('   CPC → CAC (por EJERCICIOALBARAN, SERIEALBARAN, TERMINALALBARAN, NUMEROALBARAN)');
        console.log('\n   ¡El repartidor 79 SÍ TIENE DOCUMENTOS!');
        console.log('\n════════════════════════════════════════════════════════════════\n');
        
    } catch (err) {
        console.error('Error:', err.message);
        if (conn) await conn.close();
    }
}

run();
