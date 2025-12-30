/**
 * Script para identificar y reportar clientes con múltiples registros en CDVI
 * (como CHIRINGUITO EL LIOS que tiene 2 filas separadas para L,X y M,J)
 * Run with: node find_duplicate_cdvi.js
 */
const odbc = require('odbc');

const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function findDuplicates() {
    console.log('='.repeat(70));
    console.log(' ANÁLISIS DE REGISTROS DUPLICADOS EN CDVI');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(CONNECTION_STRING);
        console.log('✓ Conectado a DB2\n');

        // Find clients with multiple CDVI records for the same vendor
        console.log('1. CLIENTES CON MÚLTIPLES REGISTROS CDVI (mismo vendedor):');
        console.log('-'.repeat(50));
        const duplicates = await conn.query(`
      SELECT 
        V.CODIGOCLIENTE,
        V.CODIGOVENDEDOR,
        COUNT(*) as NUM_REGISTROS
      FROM DSEDAC.CDVI V
      GROUP BY V.CODIGOCLIENTE, V.CODIGOVENDEDOR
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      FETCH FIRST 50 ROWS ONLY
    `);

        console.log(`   Encontrados ${duplicates.length} clientes con registros duplicados\n`);

        if (duplicates.length > 0) {
            for (const dup of duplicates) {
                const clientCode = dup.CODIGOCLIENTE?.trim();
                const vendorCode = dup.CODIGOVENDEDOR?.trim();
                const numRecords = dup.NUM_REGISTROS;

                // Get client name
                const clientInfo = await conn.query(`
          SELECT TRIM(COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), NOMBRECLIENTE)) as NOMBRE
          FROM DSEDAC.CLI
          WHERE TRIM(CODIGOCLIENTE) = '${clientCode}'
        `);
                const clientName = clientInfo[0]?.NOMBRE?.trim() || 'Sin nombre';

                // Get the duplicate records
                const records = await conn.query(`
          SELECT 
            DIAVISITALUNESSN as L,
            DIAVISITAMARTESSN as M,
            DIAVISITAMIERCOLESSN as X,
            DIAVISITAJUEVESSN as J,
            DIAVISITAVIERNESSN as V,
            DIAVISITASABADOSN as S,
            DIAVISITADOMINGOSN as D
          FROM DSEDAC.CDVI
          WHERE TRIM(CODIGOCLIENTE) = '${clientCode}'
            AND TRIM(CODIGOVENDEDOR) = '${vendorCode}'
        `);

                console.log(`   📌 ${clientCode}: ${clientName}`);
                console.log(`      Vendedor: ${vendorCode}, Registros: ${numRecords}`);

                // Combine all days from all records
                const allDays = new Set();
                records.forEach((rec, i) => {
                    const dias = [];
                    if (rec.L === 'S') { dias.push('L'); allDays.add('L'); }
                    if (rec.M === 'S') { dias.push('M'); allDays.add('M'); }
                    if (rec.X === 'S') { dias.push('X'); allDays.add('X'); }
                    if (rec.J === 'S') { dias.push('J'); allDays.add('J'); }
                    if (rec.V === 'S') { dias.push('V'); allDays.add('V'); }
                    if (rec.S === 'S') { dias.push('S'); allDays.add('S'); }
                    if (rec.D === 'S') { dias.push('D'); allDays.add('D'); }
                    console.log(`      Registro ${i + 1}: ${dias.join(', ') || 'NINGUNO'}`);
                });
                console.log(`      ➡️  Días combinados: ${Array.from(allDays).join(', ')}`);
                console.log();
            }
        }

        // Summary
        console.log('2. RESUMEN:');
        console.log('-'.repeat(50));
        const totalDuplicates = duplicates.reduce((sum, d) => sum + (d.NUM_REGISTROS - 1), 0);
        console.log(`   Total de clientes afectados: ${duplicates.length}`);
        console.log(`   Total de registros redundantes: ${totalDuplicates}`);
        console.log();

        console.log('3. RECOMENDACIÓN:');
        console.log('-'.repeat(50));
        console.log(`
   Los registros duplicados en CDVI causan que un cliente aparezca 
   en múltiples días como si fueran registros separados.
   
   OPCIONES:
   
   A) CONSOLIDAR EN BD (recomendado):
      - Merge los días de visita de los registros duplicados en uno solo
      - DELETE el registro redundante
      
   B) ADAPTAR EL CÓDIGO:
      - Modificar el backend para agregar días de múltiples registros
      - Mostrar días consolidados en el frontend
      
   Para el caso de CHIRINGUITO EL LIOS (4300008416):
   - Tiene Registro 1: L, X
   - Tiene Registro 2: M, J
   - Debería ser UN solo registro con: L, M, X, J
`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        if (conn) {
            await conn.close();
            console.log('\n✓ Conexión cerrada');
        }
    }
}

findDuplicates();
