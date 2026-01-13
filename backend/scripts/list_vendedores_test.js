/**
 * Lista de vendedores/repartidores disponibles para pruebas
 */

const odbc = require('odbc');

async function main() {
    let conn;
    try {
        conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;TRANSLATE=1');
        console.log('Conectado a DB2\n');

        // Buscar usuarios en la tabla de aplicación
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('USUARIOS DE LA APP (APPUSUARIOS o similar)');
        console.log('═══════════════════════════════════════════════════════════════\n');

        // Primero buscar la tabla de usuarios de la app
        const tablesQuery = `
            SELECT TABLE_NAME 
            FROM SYSIBM.TABLES 
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND (TABLE_NAME LIKE '%USUARIO%' OR TABLE_NAME LIKE '%USER%' OR TABLE_NAME LIKE '%VDD%')
            ORDER BY TABLE_NAME
        `;
        const tables = await conn.query(tablesQuery);
        console.log('Tablas encontradas:', tables.map(t => t.TABLE_NAME).join(', '));

        // Consultar VDD (Vendedores)
        console.log('\n\n═══════════════════════════════════════════════════════════════');
        console.log('VENDEDORES (VDD) - Comerciales');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const vddQuery = `
            SELECT 
                TRIM(CODIGOVENDEDOR) as CODIGO,
                TRIM(NOMBREVENDEDOR) as NOMBRE,
                TRIM(COALESCE(CLAVE, '')) as PIN,
                TRIM(COALESCE(CLAVEAPP, '')) as PIN_APP,
                SITUACION
            FROM DSEDAC.VDD
            WHERE SITUACION = 'A'
            ORDER BY CODIGOVENDEDOR
            FETCH FIRST 50 ROWS ONLY
        `;
        
        try {
            const vendedores = await conn.query(vddQuery);
            console.log('CODIGO │ PIN     │ PIN_APP │ NOMBRE');
            console.log('───────┼─────────┼─────────┼────────────────────────────────');
            vendedores.forEach(v => {
                const codigo = (v.CODIGO || '').padEnd(6);
                const pin = (v.PIN || '-').padEnd(7);
                const pinApp = (v.PIN_APP || '-').padEnd(7);
                console.log(`${codigo} │ ${pin} │ ${pinApp} │ ${v.NOMBRE || ''}`);
            });
            console.log(`\nTotal vendedores activos: ${vendedores.length}`);
        } catch (e) {
            console.log('Error consultando VDD:', e.message);
        }

        // Ver estructura de VDD para encontrar campo de contraseña
        console.log('\n\n═══════════════════════════════════════════════════════════════');
        console.log('ESTRUCTURA VDD (campos de autenticación)');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const vddCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE
            FROM SYSIBM.COLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'VDD'
              AND (COLUMN_NAME LIKE '%CLAVE%' OR COLUMN_NAME LIKE '%PASS%' OR COLUMN_NAME LIKE '%PIN%' OR COLUMN_NAME LIKE '%CODIGO%')
            ORDER BY ORDINAL_POSITION
        `);
        console.log('Columnas relevantes:');
        vddCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        // Buscar repartidores específicamente
        console.log('\n\n═══════════════════════════════════════════════════════════════');
        console.log('REPARTIDORES (con actividad reciente en OPP)');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const repartidoresQuery = `
            SELECT 
                TRIM(OPP.CODIGOREPARTIDOR) as CODIGO,
                TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
                TRIM(COALESCE(VDD.CLAVE, '')) as PIN,
                TRIM(COALESCE(VDD.CLAVEAPP, '')) as PIN_APP,
                COUNT(*) as ORDENES_2026
            FROM DSEDAC.OPP OPP
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
            WHERE OPP.ANOREPARTO = 2026
            GROUP BY TRIM(OPP.CODIGOREPARTIDOR), TRIM(VDD.NOMBREVENDEDOR), TRIM(COALESCE(VDD.CLAVE, '')), TRIM(COALESCE(VDD.CLAVEAPP, ''))
            ORDER BY ORDENES_2026 DESC
            FETCH FIRST 20 ROWS ONLY
        `;

        try {
            const repartidores = await conn.query(repartidoresQuery);
            console.log('CODIGO │ PIN     │ PIN_APP │ ÓRDENES │ NOMBRE');
            console.log('───────┼─────────┼─────────┼─────────┼────────────────────────────');
            repartidores.forEach(r => {
                const codigo = (r.CODIGO || '').padEnd(6);
                const pin = (r.PIN || '-').padEnd(7);
                const pinApp = (r.PIN_APP || '-').padEnd(7);
                const ordenes = String(r.ORDENES_2026 || 0).padEnd(7);
                console.log(`${codigo} │ ${pin} │ ${pinApp} │ ${ordenes} │ ${r.NOMBRE || '(sin nombre)'}`);
            });
        } catch (e) {
            console.log('Error consultando repartidores:', e.message);
        }

        // Buscar tabla de usuarios de app móvil
        console.log('\n\n═══════════════════════════════════════════════════════════════');
        console.log('BUSCAR TABLA DE USUARIOS APP MÓVIL');
        console.log('═══════════════════════════════════════════════════════════════\n');

        const appTables = await conn.query(`
            SELECT TABLE_NAME 
            FROM SYSIBM.TABLES 
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND (TABLE_NAME LIKE '%APP%' OR TABLE_NAME LIKE '%MOVIL%' OR TABLE_NAME LIKE '%LOGIN%')
            ORDER BY TABLE_NAME
        `);
        
        if (appTables.length > 0) {
            console.log('Tablas relacionadas con app:', appTables.map(t => t.TABLE_NAME).join(', '));
            
            // Intentar consultar cada una
            for (const t of appTables) {
                try {
                    const sample = await conn.query(`SELECT * FROM DSEDAC.${t.TABLE_NAME} FETCH FIRST 3 ROWS ONLY`);
                    if (sample.length > 0) {
                        console.log(`\n${t.TABLE_NAME}:`);
                        console.log('   Columnas:', Object.keys(sample[0]).join(', '));
                    }
                } catch (e) {}
            }
        }

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

main();
