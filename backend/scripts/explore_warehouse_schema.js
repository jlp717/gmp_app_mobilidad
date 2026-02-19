/**
 * ═══════════════════════════════════════════════════════════════════════
 * FASE 1: DATA DISCOVERY - Exploración Completa del Esquema de Almacén
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Este script explora exhaustivamente las tablas en DSEDAC, DSED y JAVIER 
 * para mapear todo lo relacionado con logística, almacén, y transporte.
 * 
 * Ejecutar: node scripts/explore_warehouse_schema.js
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

const SEPARATOR = '═'.repeat(70);
const LINE = '─'.repeat(70);

async function run() {
    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('✅ Conectado a DB2/AS400\n');

        const report = {};

        // ═══════════════════════════════════════════════════════════════
        // 1. ARTÍCULOS (ART) - Peso y datos logísticos
        // ═══════════════════════════════════════════════════════════════
        console.log(`${SEPARATOR}`);
        console.log('  1. TABLA DSEDAC.ART - Artículos (Datos logísticos)');
        console.log(`${SEPARATOR}\n`);

        const artCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'ART'
            ORDER BY ORDINAL_POSITION
        `);

        console.log('TODAS las columnas de ART:');
        artCols.forEach(c => {
            console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH}${c.NUMERIC_SCALE ? ',' + c.NUMERIC_SCALE : ''})`);
        });

        // Buscar columnas relevantes para logística
        const logisticCols = artCols.filter(c => {
            const name = c.COLUMN_NAME.toUpperCase();
            return name.includes('PESO') || name.includes('VOL') || name.includes('DIM') ||
                name.includes('MEDIDA') || name.includes('ALTO') || name.includes('ANCH') ||
                name.includes('LARGO') || name.includes('CAJA') || name.includes('PALET') ||
                name.includes('UNIDAD') || name.includes('BULTO') || name.includes('EMBALAJE') ||
                name.includes('EMPAQUE') || name.includes('FORMATO');
        });

        console.log('\n🔍 Columnas LOGÍSTICAS encontradas en ART:');
        if (logisticCols.length > 0) {
            logisticCols.forEach(c => console.log(`   ✅ ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));
        } else {
            console.log('   ❌ No se encontraron columnas de dimensiones/volumen');
        }

        // Sample de datos de peso
        console.log('\nSample de artículos con PESO:');
        const artSample = await conn.query(`
            SELECT CODIGOARTICULO, DESCRIPCIONARTICULO, PESO, UNIDADESCAJA
            FROM DSEDAC.ART
            WHERE PESO IS NOT NULL AND PESO > 0 AND ANOBAJA = 0
            FETCH FIRST 10 ROWS ONLY
        `);
        artSample.forEach(a => {
            console.log(`   ${String(a.CODIGOARTICULO).trim()}: ${String(a.DESCRIPCIONARTICULO).trim()} | Peso: ${a.PESO} | Uds/Caja: ${a.UNIDADESCAJA}`);
        });

        // Estadísticas de peso
        const artStats = await conn.query(`
            SELECT 
                COUNT(*) as TOTAL_ARTICULOS,
                SUM(CASE WHEN PESO > 0 THEN 1 ELSE 0 END) as CON_PESO,
                SUM(CASE WHEN PESO IS NULL OR PESO = 0 THEN 1 ELSE 0 END) as SIN_PESO,
                AVG(CASE WHEN PESO > 0 THEN PESO END) as PESO_MEDIO,
                MAX(PESO) as PESO_MAX
            FROM DSEDAC.ART
            WHERE ANOBAJA = 0
        `);
        const stats = artStats[0];
        report.articulos = {
            total: stats.TOTAL_ARTICULOS,
            conPeso: stats.CON_PESO,
            sinPeso: stats.SIN_PESO,
            pesoMedio: stats.PESO_MEDIO,
            pesoMax: stats.PESO_MAX
        };
        console.log(`\n📊 Estadísticas de Peso:`);
        console.log(`   Total activos: ${stats.TOTAL_ARTICULOS}`);
        console.log(`   Con peso: ${stats.CON_PESO} (${((stats.CON_PESO / stats.TOTAL_ARTICULOS) * 100).toFixed(1)}%)`);
        console.log(`   Sin peso: ${stats.SIN_PESO}`);
        console.log(`   Peso medio: ${parseFloat(stats.PESO_MEDIO).toFixed(3)} kg`);
        console.log(`   Peso máximo: ${stats.PESO_MAX} kg`);

        // ═══════════════════════════════════════════════════════════════
        // 2. ARTX - Artículos Extendidos
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n${SEPARATOR}`);
        console.log('  2. TABLA DSEDAC.ARTX - Artículos Extendidos');
        console.log(`${SEPARATOR}\n`);

        const artxCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'ARTX'
            ORDER BY ORDINAL_POSITION
        `);

        console.log('Columnas de ARTX:');
        artxCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // ═══════════════════════════════════════════════════════════════
        // 3. ARTALM - Artículos Almacén
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n${SEPARATOR}`);
        console.log('  3. BÚSQUEDA TABLA DSEDAC.ARTALM - Artículos Almacén');
        console.log(`${SEPARATOR}\n`);

        try {
            const artalmCols = await conn.query(`
                SELECT COLUMN_NAME, DATA_TYPE, LENGTH
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'ARTALM'
                ORDER BY ORDINAL_POSITION
            `);

            if (artalmCols.length > 0) {
                console.log('✅ ARTALM existe! Columnas:');
                artalmCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

                const artalmSample = await conn.query(`
                    SELECT * FROM DSEDAC.ARTALM FETCH FIRST 3 ROWS ONLY
                `);
                console.log('\nSample de ARTALM:');
                artalmSample.forEach((row, i) => {
                    console.log(`   [${i + 1}]:`);
                    Object.entries(row).forEach(([k, v]) => {
                        if (v !== null && String(v).trim() !== '') {
                            console.log(`       ${k}: ${v}`);
                        }
                    });
                });
            } else {
                console.log('❌ ARTALM no tiene columnas registradas');
            }
        } catch (e) {
            console.log(`❌ ARTALM no existe o error: ${e.message}`);
        }

        // ═══════════════════════════════════════════════════════════════
        // 4. VEHÍCULOS (VEH) - Capacidades
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n${SEPARATOR}`);
        console.log('  4. TABLA DSEDAC.VEH - Vehículos / Camiones');
        console.log(`${SEPARATOR}\n`);

        const vehCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'VEH'
            ORDER BY ORDINAL_POSITION
        `);

        console.log('Columnas de VEH:');
        vehCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // Buscar columnas de capacidad
        const capCols = vehCols.filter(c => {
            const name = c.COLUMN_NAME.toUpperCase();
            return name.includes('CAPACI') || name.includes('PESO') || name.includes('VOLUM') ||
                name.includes('CARGA') || name.includes('TARA') || name.includes('PMA') ||
                name.includes('LARGO') || name.includes('ALTO') || name.includes('ANCH') ||
                name.includes('DIM');
        });

        console.log('\n🔍 Columnas de CAPACIDAD en VEH:');
        if (capCols.length > 0) {
            capCols.forEach(c => console.log(`   ✅ ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));
        } else {
            console.log('   ❌ No se encontraron columnas de capacidad/dimensiones del vehículo');
        }

        // All vehicles
        console.log('\nTodos los vehículos:');
        const vehicles = await conn.query(`
            SELECT * FROM DSEDAC.VEH 
            ORDER BY CODIGOVEHICULO
        `);

        report.vehiculos = { total: vehicles.length };
        vehicles.forEach((v, i) => {
            console.log(`   [${i + 1}]:`);
            Object.entries(v).forEach(([k, val]) => {
                if (val !== null && String(val).trim() !== '' && val !== 0) {
                    console.log(`       ${k}: ${val}`);
                }
            });
            console.log('');
        });

        // ═══════════════════════════════════════════════════════════════
        // 5. OPP - Orden Preparación Pedidos
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n${SEPARATOR}`);
        console.log('  5. TABLA DSEDAC.OPP - Orden Preparación Pedidos');
        console.log(`${SEPARATOR}\n`);

        const oppCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPP'
            ORDER BY ORDINAL_POSITION
        `);

        console.log('Columnas de OPP:');
        oppCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // Sample reciente de OPP
        console.log('\nSample OPP reciente (2026):');
        const oppSample = await conn.query(`
            SELECT * FROM DSEDAC.OPP
            WHERE ANOREPARTO = 2026
            ORDER BY MESREPARTO DESC, DIAREPARTO DESC
            FETCH FIRST 3 ROWS ONLY
        `);

        oppSample.forEach((row, i) => {
            console.log(`   [${i + 1}]:`);
            Object.entries(row).forEach(([k, v]) => {
                if (v !== null && (typeof v !== 'string' || v.trim() !== '') && v !== 0) {
                    console.log(`       ${k}: ${v}`);
                }
            });
            console.log('');
        });

        // Estadísticas OPP
        const oppStats = await conn.query(`
            SELECT 
                COUNT(*) as TOTAL,
                COUNT(DISTINCT TRIM(CODIGOREPARTIDOR)) as NUM_REPARTIDORES,
                COUNT(DISTINCT TRIM(CODIGOVEHICULO)) as NUM_VEHICULOS,
                COUNT(DISTINCT NUMEROORDENPREPARACION) as NUM_ORDENES
            FROM DSEDAC.OPP
            WHERE ANOREPARTO = 2026
        `);
        const oStats = oppStats[0];
        report.opp = oStats;
        console.log(`📊 OPP 2026: ${oStats.TOTAL} registros, ${oStats.NUM_REPARTIDORES} repartidores, ${oStats.NUM_VEHICULOS} vehículos, ${oStats.NUM_ORDENES} órdenes`);

        // ═══════════════════════════════════════════════════════════════
        // 6. OPL - Líneas de Orden Preparación  
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n${SEPARATOR}`);
        console.log('  6. TABLAS OP* - Líneas de Orden Preparación');
        console.log(`${SEPARATOR}\n`);

        const opTables = await conn.query(`
            SELECT TABLE_NAME, COUNT(*) as NUM_COLS
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME LIKE 'OP%'
            GROUP BY TABLE_NAME
            ORDER BY TABLE_NAME
        `);

        console.log('Tablas OP*:');
        opTables.forEach(t => console.log(`   ${t.TABLE_NAME}: ${t.NUM_COLS} columnas`));

        // Explorar cada tabla OP* (excepto OPP ya vista)
        for (const table of opTables) {
            if (table.TABLE_NAME === 'OPP') continue;
            console.log(`\n   ${LINE}`);
            console.log(`   Estructura de DSEDAC.${table.TABLE_NAME}:`);
            const cols = await conn.query(`
                SELECT COLUMN_NAME, DATA_TYPE, LENGTH
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${table.TABLE_NAME}'
                ORDER BY ORDINAL_POSITION
            `);
            cols.forEach(c => console.log(`       ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

            try {
                const count = await conn.query(`SELECT COUNT(*) as CNT FROM DSEDAC.${table.TABLE_NAME}`);
                console.log(`   Registros: ${count[0].CNT}`);

                if (count[0].CNT > 0) {
                    const sample = await conn.query(`SELECT * FROM DSEDAC.${table.TABLE_NAME} FETCH FIRST 1 ROWS ONLY`);
                    console.log(`   Sample:`);
                    Object.entries(sample[0]).forEach(([k, v]) => {
                        if (v !== null && String(v).trim() !== '' && v !== 0) {
                            console.log(`       ${k}: ${v}`);
                        }
                    });
                }
            } catch (e) {
                console.log(`   Error consultando ${table.TABLE_NAME}: ${e.message}`);
            }
        }

        // ═══════════════════════════════════════════════════════════════
        // 7. CPC - Cabeceras de Pedidos de Clientes
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n${SEPARATOR}`);
        console.log('  7. TABLA DSEDAC.CPC - Cabeceras Pedidos Clientes');
        console.log(`${SEPARATOR}\n`);

        const cpcCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CPC'
            ORDER BY ORDINAL_POSITION
        `);

        console.log('Columnas de CPC:');
        cpcCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // ═══════════════════════════════════════════════════════════════
        // 8. Personal / Operarios - LACLAE y tablas de personal
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n${SEPARATOR}`);
        console.log('  8. PERSONAL / OPERARIOS DEL ALMACÉN');
        console.log(`${SEPARATOR}\n`);

        // Check for personnel tables
        const personalTables = await conn.query(`
            SELECT TABLE_NAME, COUNT(*) as NUM_COLS
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA IN ('DSEDAC', 'DSED')
              AND (TABLE_NAME LIKE '%PERSONAL%' OR TABLE_NAME LIKE '%OPERARIO%' OR 
                   TABLE_NAME LIKE '%EMPLEA%' OR TABLE_NAME LIKE '%TRABAJ%' OR
                   TABLE_NAME LIKE '%PREP%')
            GROUP BY TABLE_NAME
            ORDER BY TABLE_NAME
        `);

        console.log('Tablas de personal encontradas:');
        if (personalTables.length > 0) {
            personalTables.forEach(t => console.log(`   ✅ ${t.TABLE_NAME}: ${t.NUM_COLS} columnas`));
        } else {
            console.log('   ❌ No se encontraron tablas de personal/operarios');
        }

        // VDD - Vendedores/Repartidores (ya conocido)
        console.log('\nVDD (Vendedores/Repartidores):');
        const vddCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'VDD'
            ORDER BY ORDINAL_POSITION
        `);
        vddCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // List repartidores activos
        console.log('\nRepartidores con actividad reciente (2026):');
        const repartidores = await conn.query(`
            SELECT DISTINCT 
                TRIM(OPP.CODIGOREPARTIDOR) as CODE,
                TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
                COUNT(*) as ORDENES
            FROM DSEDAC.OPP OPP
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
            WHERE OPP.ANOREPARTO = 2026 AND TRIM(OPP.CODIGOREPARTIDOR) <> ''
            GROUP BY TRIM(OPP.CODIGOREPARTIDOR), TRIM(VDD.NOMBREVENDEDOR)
            ORDER BY ORDENES DESC
        `);
        repartidores.forEach(r => {
            console.log(`   ${r.CODE}: ${r.NOMBRE || 'N/A'} (${r.ORDENES} órdenes)`);
        });

        // ═══════════════════════════════════════════════════════════════
        // 9. BÚSQUEDA GLOBAL - Columnas logísticas en todo DSEDAC
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n${SEPARATOR}`);
        console.log('  9. BÚSQUEDA GLOBAL DE COLUMNAS LOGÍSTICAS');
        console.log(`${SEPARATOR}\n`);

        const logisticSearch = await conn.query(`
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC'
              AND (COLUMN_NAME LIKE '%PESO%' OR COLUMN_NAME LIKE '%VOL%' 
                   OR COLUMN_NAME LIKE '%DIM%' OR COLUMN_NAME LIKE '%MEDIDA%'
                   OR COLUMN_NAME LIKE '%CAMION%' OR COLUMN_NAME LIKE '%VEHICUL%'
                   OR COLUMN_NAME LIKE '%CAPACID%' OR COLUMN_NAME LIKE '%PALET%'
                   OR COLUMN_NAME LIKE '%BULTO%' OR COLUMN_NAME LIKE '%EMBAL%'
                   OR COLUMN_NAME LIKE '%CARGA%' OR COLUMN_NAME LIKE '%TARA%'
                   OR COLUMN_NAME LIKE '%ALTO%' OR COLUMN_NAME LIKE '%ANCH%'
                   OR COLUMN_NAME LIKE '%LARGO%')
            ORDER BY TABLE_NAME, COLUMN_NAME
        `);

        console.log('Columnas logísticas en DSEDAC:');
        let currentTable = '';
        logisticSearch.forEach(c => {
            if (c.TABLE_NAME !== currentTable) {
                currentTable = c.TABLE_NAME;
                console.log(`\n   📦 ${currentTable}:`);
            }
            console.log(`       ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`);
        });

        // ═══════════════════════════════════════════════════════════════
        // 10. TABLAS EN JAVIER (custom tables)
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n${SEPARATOR}`);
        console.log('  10. TABLAS EN ESQUEMA JAVIER (Custom)');
        console.log(`${SEPARATOR}\n`);

        const javierTables = await conn.query(`
            SELECT TABLE_NAME
            FROM QSYS2.SYSTABLES
            WHERE TABLE_SCHEMA = 'JAVIER'
            ORDER BY TABLE_NAME
        `);

        console.log('Tablas existentes en JAVIER:');
        javierTables.forEach(t => console.log(`   📋 ${t.TABLE_NAME}`));
        report.javierTables = javierTables.map(t => t.TABLE_NAME);

        // ═══════════════════════════════════════════════════════════════
        // 11. CAC - Cabeceras Albaranes (relación con transporte)
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n${SEPARATOR}`);
        console.log('  11. DSEDAC.CAC - Columnas de transporte en Albaranes');
        console.log(`${SEPARATOR}\n`);

        const cacTransport = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAC'
            AND (COLUMN_NAME LIKE '%VEHICULO%' OR COLUMN_NAME LIKE '%REPARTIDOR%'
                 OR COLUMN_NAME LIKE '%CONDUCTOR%' OR COLUMN_NAME LIKE '%TRANSPORT%'
                 OR COLUMN_NAME LIKE '%RUTA%' OR COLUMN_NAME LIKE '%ZONA%'
                 OR COLUMN_NAME LIKE '%REPARTO%')
            ORDER BY COLUMN_NAME
        `);

        console.log('Columnas de transporte en CAC:');
        cacTransport.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // ═══════════════════════════════════════════════════════════════
        // 12. Relación OPP → CPC/CAC
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n${SEPARATOR}`);
        console.log('  12. RELACIÓN OPP → CPC / CAC');
        console.log(`${SEPARATOR}\n`);

        // Check if OPP has PEDIDO or ALBARAN references
        const oppRefs = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPP'
            AND (COLUMN_NAME LIKE '%PEDIDO%' OR COLUMN_NAME LIKE '%ALBARAN%' 
                 OR COLUMN_NAME LIKE '%CLIENTE%' OR COLUMN_NAME LIKE '%DOCUMENT%'
                 OR COLUMN_NAME LIKE '%NUMERO%' OR COLUMN_NAME LIKE '%EJERCICIO%')
            ORDER BY COLUMN_NAME
        `);

        console.log('Columnas de referencia en OPP:');
        oppRefs.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // ═══════════════════════════════════════════════════════════════
        // 13. Tablas APP_USUARIOS
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n${SEPARATOR}`);
        console.log('  13. JAVIER.APP_USUARIOS - Roles de Usuario');
        console.log(`${SEPARATOR}\n`);

        try {
            const userCols = await conn.query(`
                SELECT COLUMN_NAME, DATA_TYPE, LENGTH
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'APP_USUARIOS'
                ORDER BY ORDINAL_POSITION
            `);

            console.log('Columnas de APP_USUARIOS:');
            userCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

            const users = await conn.query(`
                SELECT * FROM JAVIER.APP_USUARIOS FETCH FIRST 5 ROWS ONLY
            `);
            console.log('\nSample de usuarios:');
            users.forEach((u, i) => {
                console.log(`   [${i + 1}]:`);
                Object.entries(u).forEach(([k, v]) => {
                    if (v !== null && String(v).trim() !== '') {
                        console.log(`       ${k}: ${v}`);
                    }
                });
            });
        } catch (e) {
            console.log(`   Error: ${e.message}`);
        }

        // ═══════════════════════════════════════════════════════════════
        // INFORME FINAL - GAP ANALYSIS
        // ═══════════════════════════════════════════════════════════════
        console.log(`\n${'█'.repeat(70)}`);
        console.log('  INFORME FINAL - GAP ANALYSIS');
        console.log(`${'█'.repeat(70)}\n`);

        // Check for missing PESO
        const hasPeso = logisticCols.some(c => c.COLUMN_NAME.includes('PESO'));
        console.log(`   PESO de artículos:     ${hasPeso ? '✅ EXISTE en DSEDAC.ART' : '❌ NO EXISTE'}`);

        // Check for DIMENSIONS
        const hasDim = logisticCols.some(c =>
            c.COLUMN_NAME.includes('ALTO') || c.COLUMN_NAME.includes('ANCH') || c.COLUMN_NAME.includes('LARGO'));
        console.log(`   DIMENSIONES (L/A/H):   ${hasDim ? '✅ EXISTE' : '❌ NO EXISTE → Crear JAVIER.ALMACEN_ART_DIMENSIONES'}`);

        // Check for VOLUMEN
        const hasVol = logisticCols.some(c => c.COLUMN_NAME.includes('VOL'));
        console.log(`   VOLUMEN artículos:     ${hasVol ? '✅ EXISTE' : '❌ NO EXISTE → Calculable desde dimensiones'}`);

        // Check for vehicle capacity
        const hasVehCap = capCols.length > 0;
        console.log(`   CAPACIDAD vehículos:   ${hasVehCap ? '✅ EXISTE' : '❌ NO EXISTE → Crear JAVIER.ALMACEN_CAMIONES_CONFIG'}`);

        // Check for personnel
        const hasPersonal = personalTables.length > 0;
        console.log(`   OPERARIOS almacén:     ${hasPersonal ? '✅ EXISTE' : '❌ NO EXISTE → Crear JAVIER.ALMACEN_PERSONAL'}`);

        console.log('\n   TABLAS A CREAR:');
        if (!hasDim) console.log('   📋 JAVIER.ALMACEN_ART_DIMENSIONES (largo, alto, ancho, volumen por artículo)');
        if (!hasVehCap) console.log('   📋 JAVIER.ALMACEN_CAMIONES_CONFIG (capacidad kg, volumen m³, dimensiones caja)');
        if (!hasPersonal) console.log('   📋 JAVIER.ALMACEN_PERSONAL (operarios de almacén/preparadores)');
        console.log('   📋 JAVIER.ALMACEN_CARGA_HISTORICO (histórico de cargas/planificaciones)');

        console.log(`\n${SEPARATOR}`);
        console.log('  FIN DEL INFORME DE DATA DISCOVERY');
        console.log(`${SEPARATOR}\n`);

    } catch (error) {
        console.error('❌ Error fatal:', error.message);
        console.error(error);
    } finally {
        if (conn) await conn.close();
    }
}

run();
