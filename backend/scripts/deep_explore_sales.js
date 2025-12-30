/**
 * Script de exploración profunda para encontrar datos históricos de ventas
 * Busca tablas en esquemas DSED y DSEDAC que puedan contener histórico
 */

const odbc = require('odbc');

async function main() {
    console.log('🕵️  Iniciando exploración profunda de la base de datos...\n');

    let conn;
    try {
        conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');
        console.log('✅ Conexión exitosa');

        // 1. Obtener lista de tablas candidatas en DSED y DSEDAC
        // Buscamos tablas que suenen a Ventas, Facturas, Histórico, Líneas
        const keywords = ['LIN', 'CAB', 'FAC', 'HIS', 'VEN', 'MOV', 'ALB'];
        let candidateTables = [];

        console.log('\n🔍 Buscando tablas candidatas en catálogos del sistema...');

        // Intentar varias formas de listar tablas en DB2 for i
        const catalogQueries = [
            `SELECT TABLE_SCHEMA, TABLE_NAME FROM QSYS2.SYSTABLES 
       WHERE TABLE_SCHEMA IN ('DSED', 'DSEDAC') AND TABLE_TYPE IN ('T', 'V')`,

            `SELECT SYSTEM_TABLE_SCHEMA as TABLE_SCHEMA, SYSTEM_TABLE_NAME as TABLE_NAME 
       FROM QSYS2.SYSTABLES 
       WHERE SYSTEM_TABLE_SCHEMA IN ('DSED', 'DSEDAC') AND TABLE_TYPE IN ('T', 'V')`
        ];

        for (const q of catalogQueries) {
            try {
                const tables = await conn.query(q);
                if (tables.length > 0) {
                    console.log(`   -> Encontradas ${tables.length} tablas/vistas con consulta de catálogo.`);
                    candidateTables = tables.map(t => ({
                        schema: t.TABLE_SCHEMA.trim(),
                        name: t.TABLE_NAME.trim()
                    }));
                    break;
                }
            } catch (e) {
                // Ignorar error y probar siguiente query
            }
        }

        // Filtrar candidatos por keywords
        const salesTables = candidateTables.filter(t => {
            const name = t.name.toUpperCase();
            return keywords.some(k => name.includes(k));
        });

        console.log(`\n📋 Lista reducida a ${salesTables.length} tablas candidatas para análisis detallado.`);

        // 2. Analizar cada tabla candidata buscando columnas de fecha/año
        console.log('\n🔬 Analizando contenido de tablas (Mín/Máx Años)...');

        for (const t of salesTables) {
            const tableName = `${t.schema}.${t.name}`;

            try {
                // Obtener una fila para ver columnas
                const sample = await conn.query(`SELECT * FROM ${tableName} FETCH FIRST 1 ROWS ONLY`);
                if (sample.length === 0) continue;

                const cols = Object.keys(sample[0]);

                // Buscar columnas que parezcan años o fechas
                const yearCols = cols.filter(c => c.includes('ANO') || c.includes('YEAR') || c.includes('EJER'));
                const dateCols = cols.filter(c => c.includes('FEC') || c.includes('DAT'));

                if (yearCols.length > 0 || dateCols.length > 0) {
                    process.stdout.write(`   Analizando ${tableName}... `);

                    let query = '';
                    if (yearCols.length > 0) {
                        const col = yearCols[0];
                        query = `SELECT MIN(${col}) as min_val, MAX(${col}) as max_val, COUNT(*) as total FROM ${tableName}`;
                    } else if (dateCols.length > 0) {
                        const col = dateCols[0]; // Tomamos la primera fecha
                        query = `SELECT MIN(${col}) as min_val, MAX(${col}) as max_val, COUNT(*) as total FROM ${tableName}`;
                    }

                    try {
                        const stats = await conn.query(query);
                        const s = stats[0];
                        console.log(`Rango: [${s.MIN_VAL} - ${s.MAX_VAL}] | Filas: ${s.TOTAL}`);

                        // Si tiene datos de 2024 o anterior, es MUY INTERESANTE
                        if (String(s.MIN_VAL).includes('2024') || String(s.MIN_VAL).includes('24') ||
                            (typeof s.MIN_VAL === 'number' && s.MIN_VAL <= 2024)) {
                            console.log(`   ⭐ ¡CANDIDATO HISTÓRICO ENCONTRADO!`);
                        }
                    } catch (e) {
                        console.log('Error consultando rango:', e.message);
                    }
                }
            } catch (e) {
                // Error accediendo a tabla (permisos, etc)
            }
        }

        // 3. Probando específicamente LINFAC si existe
        console.log('\n🎯 Verificación específica de DSED.LINFAC / DSEDAC.LINFAC ...');
        const specificTables = ['DSED.LINFAC', 'DSEDAC.LINFAC', 'DSED.HISFAC', 'DSEDAC.HISFAC'];
        for (const st of specificTables) {
            try {
                const exists = await conn.query(`SELECT COUNT(*) as c FROM ${st}`);
                console.log(`   ${st}: EXISTE (${exists[0].C} filas)`);

                // Ver columnas
                const colsObj = await conn.query(`SELECT * FROM ${st} FETCH FIRST 1 ROWS ONLY`);
                console.log(`   Columnas: ${Object.keys(colsObj[0]).join(', ')}`);

            } catch (e) {
                console.log(`   ${st}: No accesible o no existe.`);
            }
        }

    } catch (error) {
        console.error('❌ Error fatal:', error);
    } finally {
        if (conn) {
            await conn.close();
            console.log('\n🔒 Desconectado.');
        }
    }
}

main();
