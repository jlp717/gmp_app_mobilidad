/**
 * Script para explorar APPUSUARIOS y encontrar repartidor 79
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function exploreAppUsuarios() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('====== EXPLORANDO APPUSUARIOS ======\n');
        
        // 1. Ver columnas de APPUSUARIOS
        console.log('1. Columnas de DSEDAC.APPUSUARIOS:');
        const cols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'APPUSUARIOS'
            ORDER BY COLUMN_NAME
        `);
        cols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));
        
        // 2. Buscar usuario con ID 79
        console.log('\n2. Buscando usuario ID 79:');
        const user79 = await conn.query(`
            SELECT * FROM DSEDAC.APPUSUARIOS
            WHERE ID = 79
        `);
        if (user79.length > 0) {
            console.log('  Usuario 79 encontrado:');
            for (const [key, value] of Object.entries(user79[0])) {
                if (value !== null) {
                    console.log(`    ${key}: ${value}`);
                }
            }
        } else {
            console.log('  No encontrado con ID=79. Buscando por CODIGO...');
            const userCod79 = await conn.query(`
                SELECT * FROM DSEDAC.APPUSUARIOS
                WHERE TRIM(CODIGOUSUARIO) = '79' OR TRIM(CODIGOVENDEDOR) = '79'
                FETCH FIRST 5 ROWS ONLY
            `);
            userCod79.forEach(u => console.log('  Found:', JSON.stringify(u).substring(0, 200)));
        }
        
        // 3. Ver todos los usuarios repartidores
        console.log('\n3. Usuarios tipo REPARTIDOR:');
        try {
            const repartidores = await conn.query(`
                SELECT ID, CODIGOUSUARIO, CODIGOVENDEDOR, NOMBRE, ROL, ACTIVO
                FROM DSEDAC.APPUSUARIOS
                WHERE UPPER(ROL) LIKE '%REPART%' OR UPPER(TIPOUSUARIO) LIKE '%REPART%'
                FETCH FIRST 20 ROWS ONLY
            `);
            repartidores.forEach(r => console.log(`  ID:${r.ID} COD:${r.CODIGOUSUARIO} VEND:${r.CODIGOVENDEDOR} NOMBRE:${r.NOMBRE} ROL:${r.ROL}`));
        } catch (e) {
            console.log('  Error:', e.message.substring(0, 80));
        }
        
        // 4. Ver todos los usuarios (primeros 20)
        console.log('\n4. Primeros 20 usuarios:');
        const allUsers = await conn.query(`
            SELECT * FROM DSEDAC.APPUSUARIOS
            FETCH FIRST 20 ROWS ONLY
        `);
        allUsers.forEach(u => {
            const relevantFields = Object.entries(u)
                .filter(([k, v]) => v !== null && v !== '' && !k.includes('PASSWORD') && !k.includes('HASH'))
                .map(([k, v]) => `${k}:${v}`)
                .join(' | ');
            console.log(`  ${relevantFields}`);
        });
        
        // 5. Contar registros por CODIGOVENDEDOR
        console.log('\n5. Registros en CAC por CODIGOVENDEDOR (2026):');
        const vendedores = await conn.query(`
            SELECT TRIM(CODIGOVENDEDOR) as VEND, COUNT(*) as CNT
            FROM DSEDAC.CAC
            WHERE ANODOCUMENTO = 2026
            GROUP BY TRIM(CODIGOVENDEDOR)
            ORDER BY CNT DESC
            FETCH FIRST 15 ROWS ONLY
        `);
        vendedores.forEach(v => console.log(`  Vendedor '${v.VEND}': ${v.CNT} documentos`));
        
        console.log('\n====== FIN EXPLORACIÓN ======');
        
    } finally {
        await conn.close();
    }
}

exploreAppUsuarios().catch(err => {
    console.error('Error fatal:', err.message);
    process.exit(1);
});
