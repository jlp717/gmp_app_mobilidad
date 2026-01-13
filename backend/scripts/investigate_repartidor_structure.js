/**
 * Script para entender la estructura de repartidores vs comerciales
 * y encontrar el campo correcto para documentos de repartidor
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function investigateRepartidores() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║     INVESTIGANDO ESTRUCTURA REPARTIDOR VS COMERCIAL            ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        // 1. Ver TODAS las columnas de CAC que podrían relacionarse con repartidor
        console.log('1. COLUMNAS EN CAC RELACIONADAS CON VENDEDOR/CONDUCTOR/REPARTIDOR:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const cols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAC'
            AND (COLUMN_NAME LIKE '%VENDEDOR%' 
                 OR COLUMN_NAME LIKE '%CONDUCTOR%' 
                 OR COLUMN_NAME LIKE '%TRANSPORT%'
                 OR COLUMN_NAME LIKE '%REPARTIDOR%'
                 OR COLUMN_NAME LIKE '%RUTA%')
            ORDER BY COLUMN_NAME
        `);
        cols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 2. Ver qué valores hay en cada columna de vendedor/conductor
        console.log('\n2. VALORES EN CADA COLUMNA (sample 2026):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const columnsToCheck = [
            'CODIGOVENDEDOR',
            'CODIGOVENDEDORCOBRO', 
            'CODIGOVENDEDORCONDUCTOR',
            'CODIGOVENDEDORREPARTORUTERO',
            'CODIGOCONDUCTOR',
            'CODIGORUTA'
        ];
        
        for (const col of columnsToCheck) {
            try {
                const vals = await conn.query(`
                    SELECT DISTINCT TRIM(${col}) as VAL, COUNT(*) as CNT
                    FROM DSEDAC.CAC
                    WHERE ANODOCUMENTO = 2026
                      AND ${col} IS NOT NULL
                      AND TRIM(${col}) <> ''
                    GROUP BY TRIM(${col})
                    ORDER BY CNT DESC
                    FETCH FIRST 10 ROWS ONLY
                `);
                
                if (vals.length > 0) {
                    console.log(`   ${col}:`);
                    vals.forEach(v => console.log(`      '${v.VAL}': ${v.CNT} docs`));
                } else {
                    console.log(`   ${col}: (vacío)`);
                }
                console.log('');
            } catch (e) {
                console.log(`   ${col}: ERROR - ${e.message.substring(0, 50)}`);
            }
        }

        // 3. Los repartidores con vehículo
        console.log('\n3. REPARTIDORES CON VEHÍCULO (tabla VEH):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const repartidores = await conn.query(`
            SELECT 
                TRIM(VEH.CODIGOVENDEDOR) as CODIGO,
                TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
                TRIM(VEH.MATRICULA) as MATRICULA
            FROM DSEDAC.VEH VEH
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(VEH.CODIGOVENDEDOR)
            ORDER BY VEH.CODIGOVENDEDOR
        `);
        
        const repartidorCodes = repartidores.map(r => r.CODIGO);
        console.log('   Códigos de repartidores:', repartidorCodes.join(', '));

        // 4. Ver si algún repartidor aparece en CODIGOVENDEDOR
        console.log('\n\n4. DOCUMENTOS DONDE CODIGOVENDEDOR = REPARTIDOR (2026):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        for (const rep of repartidores.slice(0, 10)) {
            const docs = await conn.query(`
                SELECT COUNT(*) as CNT
                FROM DSEDAC.CAC
                WHERE TRIM(CODIGOVENDEDOR) = '${rep.CODIGO}'
                  AND ANODOCUMENTO = 2026
            `);
            console.log(`   Repartidor ${rep.CODIGO} (${rep.NOMBRE?.substring(0, 25)}): ${docs[0]?.CNT || 0} docs como CODIGOVENDEDOR`);
        }

        // 5. Ver si hay otra tabla que relacione repartidores con albaranes
        console.log('\n\n5. BUSCANDO TABLAS QUE RELACIONEN REPARTIDOR CON ENTREGAS:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const tablas = await conn.query(`
            SELECT TABLE_NAME
            FROM QSYS2.SYSTABLES
            WHERE TABLE_SCHEMA = 'DSEDAC'
            AND (TABLE_NAME LIKE '%ENT%' 
                 OR TABLE_NAME LIKE '%REP%'
                 OR TABLE_NAME LIKE '%ALB%'
                 OR TABLE_NAME LIKE '%RUT%')
            ORDER BY TABLE_NAME
        `);
        tablas.forEach(t => console.log(`   - ${t.TABLE_NAME}`));

        // 6. Verificar tabla de RUTAS
        console.log('\n\n6. ESTRUCTURA DE RUTAS (si repartidores se asignan por ruta):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        try {
            const rutaCols = await conn.query(`
                SELECT COLUMN_NAME
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' 
                AND TABLE_NAME LIKE '%RUT%'
                ORDER BY TABLE_NAME, COLUMN_NAME
                FETCH FIRST 30 ROWS ONLY
            `);
            rutaCols.forEach(c => console.log(`   ${c.COLUMN_NAME}`));
        } catch (e) {
            console.log('   No se encontró tabla de rutas');
        }

        // 7. Ver tipo de vendedor en VDC para distinguir comercial vs repartidor
        console.log('\n\n7. TIPOS DE VENDEDOR EN VDC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        try {
            const tipos = await conn.query(`
                SELECT DISTINCT TRIM(TIPOVENDEDOR) as TIPO, COUNT(*) as CNT
                FROM DSEDAC.VDC
                WHERE SUBEMPRESA = 'GMP'
                GROUP BY TRIM(TIPOVENDEDOR)
            `);
            tipos.forEach(t => console.log(`   Tipo '${t.TIPO}': ${t.CNT} vendedores`));
            
            // Ver qué repartidores tienen qué tipo
            console.log('\n   Tipos de los repartidores con vehículo:');
            for (const rep of repartidores.slice(0, 5)) {
                const tipo = await conn.query(`
                    SELECT TRIM(TIPOVENDEDOR) as TIPO
                    FROM DSEDAC.VDC
                    WHERE TRIM(CODIGOVENDEDOR) = '${rep.CODIGO}' AND SUBEMPRESA = 'GMP'
                    FETCH FIRST 1 ROWS ONLY
                `);
                console.log(`   ${rep.CODIGO}: tipo='${tipo[0]?.TIPO || '(sin tipo)'}'`);
            }
        } catch (e) {
            console.log(`   Error: ${e.message}`);
        }

        console.log('\n════════════════════════════════════════════════════════════════');
        
    } finally {
        await conn.close();
    }
}

investigateRepartidores().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
