/**
 * SCRIPT PARA ENCONTRAR TABLAS DE OBJETIVOS EN TODA LA BASE DE DATOS
 * Ejecutar con: node scripts/find_objectives_tables.js
 * 
 * Busca tablas que puedan contener objetivos, metas, cuotas, presupuestos
 * de ventas en todos los esquemas disponibles.
 */

const odbc = require('odbc');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function findObjectivesTables() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     BÚSQUEDA DE TABLAS DE OBJETIVOS                          ║');
    console.log('║     Explorando todos los esquemas                            ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    const conn = await odbc.connect(DB_CONFIG);
    const results = {
        timestamp: new Date().toISOString(),
        foundTables: [],
        vendedorData: null
    };

    try {
        // =========================================================================
        // PASO 1: Buscar tablas con nombres relacionados a objetivos
        // =========================================================================
        console.log('=== PASO 1: Buscando tablas por nombre ===\n');

        const keywords = [
            'OBJ%', 'META%', 'CUOTA%', 'TAR%', 'PRES%', 'BUDGET%',
            'GOAL%', 'PLAN%', 'PVE%', 'OBT%', 'VEND%OBJ%', '%OBJETIVO%'
        ];

        for (const keyword of keywords) {
            try {
                const tables = await conn.query(`
          SELECT TABLE_SCHEMA, TABLE_NAME 
          FROM QSYS2.SYSTABLES 
          WHERE UPPER(TABLE_NAME) LIKE '${keyword}'
          ORDER BY TABLE_SCHEMA, TABLE_NAME
          FETCH FIRST 20 ROWS ONLY
        `);

                if (tables.length > 0) {
                    console.log(`Tablas con patrón '${keyword}':`);
                    for (const t of tables) {
                        console.log(`  ${t.TABLE_SCHEMA}.${t.TABLE_NAME}`);
                        results.foundTables.push(`${t.TABLE_SCHEMA}.${t.TABLE_NAME}`);
                    }
                    console.log();
                }
            } catch (e) {
                // Ignorar errores de esquema no accesible
            }
        }

        // =========================================================================
        // PASO 2: Buscar columnas que contengan 'objetivo', 'meta', 'cuota'
        // =========================================================================
        console.log('\n=== PASO 2: Buscando columnas relacionadas ===\n');

        const columnKeywords = ['OBJETIVO', 'META', 'CUOTA', 'TARGET', 'GOAL', 'PRESUP'];

        for (const col of columnKeywords) {
            try {
                const columns = await conn.query(`
          SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
          FROM QSYS2.SYSCOLUMNS
          WHERE UPPER(COLUMN_NAME) LIKE '%${col}%'
          ORDER BY TABLE_SCHEMA, TABLE_NAME
          FETCH FIRST 30 ROWS ONLY
        `);

                if (columns.length > 0) {
                    console.log(`Columnas con '${col}':`);
                    for (const c of columns) {
                        console.log(`  ${c.TABLE_SCHEMA}.${c.TABLE_NAME}.${c.COLUMN_NAME}`);
                    }
                    console.log();
                }
            } catch (e) {
                // Ignorar
            }
        }

        // =========================================================================
        // PASO 3: Revisar tablas de vendedores para campos de objetivos
        // =========================================================================
        console.log('\n=== PASO 3: Campos de objetivos en tablas de vendedores ===\n');

        const vendedorTables = ['VDC', 'VDDX', 'VEN', 'VENL1', 'VDO', 'VDOBJETIVO'];

        for (const vt of vendedorTables) {
            for (const schema of ['DSEDAC', 'DSED']) {
                try {
                    const data = await conn.query(`SELECT * FROM ${schema}.${vt} FETCH FIRST 3 ROWS ONLY`);
                    if (data.length > 0) {
                        const cols = Object.keys(data[0]);
                        const objCols = cols.filter(c =>
                            c.includes('OBJ') || c.includes('META') || c.includes('CUOTA') ||
                            c.includes('PRES') || c.includes('TARGET') || c.includes('IMPORTE') ||
                            c.includes('COMISION')
                        );

                        console.log(`${schema}.${vt}:`);
                        console.log(`  Total columnas: ${cols.length}`);
                        if (objCols.length > 0) {
                            console.log(`  Columnas de interés: ${objCols.join(', ')}`);
                        }
                        console.log(`  Todas: ${cols.join(', ')}`);
                        console.log();
                    }
                } catch (e) {
                    // Tabla no existe
                }
            }
        }

        // =========================================================================
        // PASO 4: Explorar tablas específicas que suelen tener objetivos
        // =========================================================================
        console.log('\n=== PASO 4: Explorando tablas candidatas específicas ===\n');

        const candidates = [
            'DSEDAC.OBJVEN', 'DSEDAC.OBJCLI', 'DSEDAC.OBJTVO', 'DSEDAC.OBJCOM',
            'DSEDAC.METAVEN', 'DSEDAC.METACLI', 'DSEDAC.CUOTAVEN', 'DSEDAC.TARVEN',
            'DSEDAC.PREVENTA', 'DSEDAC.PREVISION', 'DSEDAC.PRESUPUESTO',
            'DSEDAC.CVE', 'DSEDAC.CVEB', 'DSEDAC.CVEP', 'DSEDAC.CVEO',
            'DSED.LACLAEOBJ', 'DSED.OBJETA', 'DSED.OBJET',
            'JAVIER.OBJETIVOS', 'JAVIER.METAS', 'JAVIER.CUOTAS_VENTAS'
        ];

        for (const table of candidates) {
            try {
                const data = await conn.query(`SELECT * FROM ${table} FETCH FIRST 2 ROWS ONLY`);
                console.log(`✅ ENCONTRADA: ${table}`);
                console.log(`   Columnas: ${Object.keys(data[0] || {}).join(', ')}`);
                if (data[0]) {
                    console.log(`   Ejemplo: ${JSON.stringify(data[0]).substring(0, 200)}`);
                }
                console.log();
                results.foundTables.push(table);
            } catch (e) {
                // Tabla no existe
            }
        }

        // =========================================================================
        // PASO 5: Buscar en esquemas alternativos
        // =========================================================================
        console.log('\n=== PASO 5: Listando todos los esquemas accesibles ===\n');

        try {
            const schemas = await conn.query(`
        SELECT DISTINCT TABLE_SCHEMA 
        FROM QSYS2.SYSTABLES 
        WHERE TABLE_SCHEMA NOT LIKE 'SYS%' 
          AND TABLE_SCHEMA NOT LIKE 'Q%'
        ORDER BY TABLE_SCHEMA
      `);

            console.log('Esquemas disponibles:');
            for (const s of schemas) {
                console.log(`  - ${s.TABLE_SCHEMA}`);
            }
        } catch (e) {
            console.log('No se pudo listar esquemas:', e.message);
        }

        // =========================================================================
        // GUARDAR RESULTADOS
        // =========================================================================
        console.log('\n=== RESULTADOS ===\n');
        console.log('Tablas encontradas:', results.foundTables);

        require('fs').writeFileSync(
            'objectives_tables_found.json',
            JSON.stringify(results, null, 2)
        );
        console.log('\nResultados guardados en objectives_tables_found.json');

    } catch (error) {
        console.error('Error general:', error);
    } finally {
        await conn.close();
    }
}

findObjectivesTables().catch(console.error);
