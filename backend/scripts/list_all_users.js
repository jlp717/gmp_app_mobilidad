/**
 * Script para ver todos los usuarios en APPUSUARIOS
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function listAllUsers() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('====== USUARIOS EN APPUSUARIOS ======\n');
        
        // Ver todos los usuarios
        const allUsers = await conn.query(`
            SELECT ID, TRIM(CODIGOUSUARIO) as CODIGO, TRIM(NOMBREUSUARIO) as NOMBRE, 
                   TRIM(DELEGACION) as DELEG, TRIM(GRUPO) as GRUPO
            FROM DSEDAC.APPUSUARIOS
            ORDER BY ID
        `);
        
        console.log('Total usuarios:', allUsers.length);
        console.log('\nLista completa:');
        allUsers.forEach(u => {
            console.log(`  ID:${u.ID} | CODIGO:'${u.CODIGO}' | NOMBRE:'${u.NOMBRE}' | GRUPO:'${u.GRUPO}' | DELEG:'${u.DELEG}'`);
        });
        
        // Buscar usuario 79 o similar
        console.log('\n\nBuscando patrones con 79:');
        const pattern79 = allUsers.filter(u => 
            String(u.ID) === '79' || 
            String(u.CODIGO).includes('79') ||
            String(u.NOMBRE).includes('79')
        );
        if (pattern79.length > 0) {
            console.log('Encontrados:', pattern79);
        } else {
            console.log('No se encontraron patrones con 79 en APPUSUARIOS');
        }
        
        // Ver registros de CAC con vendedor 73 (el que vimos en el sample)
        console.log('\n\nRegistros de CAC con CODIGOVENDEDOR = 73:');
        const vend73 = await conn.query(`
            SELECT COUNT(*) as TOTAL
            FROM DSEDAC.CAC
            WHERE TRIM(CODIGOVENDEDOR) = '73'
              AND ANODOCUMENTO = 2026
        `);
        console.log(`  Total docs en 2026: ${vend73[0]?.TOTAL || 0}`);
        
        console.log('\n====== FIN ======');
        
    } finally {
        await conn.close();
    }
}

listAllUsers().catch(err => {
    console.error('Error fatal:', err.message);
    process.exit(1);
});
