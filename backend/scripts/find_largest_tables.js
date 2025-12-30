/**
 * Script para encontrar las tablas más grandes (probables históricos)
 * usando QSYS2.SYSPARTITIONSTAT
 */

const odbc = require('odbc');

async function main() {
    console.log('🐘 Buscando tablas más grandes (datos históricos)...\n');

    try {
        const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

        // Consultar estadísticas de partición para encontrar tablas con más filas
        const query = `
      SELECT SYSTEM_TABLE_SCHEMA as SCHEMA, SYSTEM_TABLE_NAME as NAME, NUMBER_ROWS as ROWS
      FROM QSYS2.SYSPARTITIONSTAT
      WHERE SYSTEM_TABLE_SCHEMA IN ('DSED', 'DSEDAC')
      ORDER BY NUMBER_ROWS DESC
      FETCH FIRST 40 ROWS ONLY
    `;

        console.log('Ejecutando consulta de estadísticas...');
        const result = await conn.query(query);

        console.log('\n📊 TOP TABLAS POR NÚMERO DE FILAS:');
        console.log('------------------------------------------------');
        console.log('ESQUEMA  | TABLA           | FILAS');
        console.log('------------------------------------------------');

        const candidates = [];

        for (const r of result) {
            console.log(`${r.SCHEMA.padEnd(8)} | ${r.NAME.padEnd(15)} | ${r.ROWS}`);

            // Si tiene muchas filas, analizamos sus columnas de fecha/año
            if (r.ROWS > 1000) {
                candidates.push({ schema: r.SCHEMA, name: r.NAME });
            }
        }

        console.log('\n🔬 Analizando fechas en las tablas candidatas...');

        for (const t of candidates) {
            // Ignorar algunas tablas de sistema o configuración obvias
            if (['ART', 'CLI', 'PRO', 'VEN', 'RUT'].includes(t.name)) continue;

            const fullTable = `${t.schema}.${t.name}`;
            try {
                const sample = await conn.query(`SELECT * FROM ${fullTable} FETCH FIRST 1 ROWS ONLY`);
                if (sample.length === 0) continue;

                const cols = Object.keys(sample[0]);
                const yearCols = cols.filter(c => c.includes('ANO') || c.includes('YEAR') || c.includes('EJER'));

                if (yearCols.length > 0) {
                    const col = yearCols[0];
                    const stats = await conn.query(`SELECT MIN(${col}) as min_val, MAX(${col}) as max_val FROM ${fullTable}`);
                    console.log(`   ${fullTable}: Años [${stats[0].MIN_VAL} - ${stats[0].MAX_VAL}] (Col: ${col})`);
                } else {
                    // Buscar alguna fecha
                    const dCols = cols.filter(c => c.includes('FEC') || c.includes('DAT'));
                    if (dCols.length > 0) {
                        const col = dCols[0];
                        const stats = await conn.query(`SELECT MIN(${col}) as min_val, MAX(${col}) as max_val FROM ${fullTable}`);
                        console.log(`   ${fullTable}: Fechas [${stats[0].MIN_VAL} - ${stats[0].MAX_VAL}]`);
                    }
                }
            } catch (e) {
                // Ignorar errores
            }
        }

        await conn.close();

    } catch (error) {
        console.error('Error:', error);
    }
}

main();
