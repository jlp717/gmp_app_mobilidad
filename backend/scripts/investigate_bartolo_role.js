/**
 * Script para investigar por qué BARTOLO 02 tiene rol de jefe
 * Revisa la tabla APPUSUARIOS, VDC y VDDX
 */
require('dotenv').config();
const odbc = require('odbc');

async function investigate() {
    const dsn = process.env.ODBC_DSN || 'GMP';
    const uid = process.env.ODBC_UID;
    const pwd = process.env.ODBC_PWD;
    
    const connectionString = `DSN=${dsn};UID=${uid};PWD=${pwd}`;
    
    console.log('='.repeat(60));
    console.log('INVESTIGACIÓN: Por qué BARTOLO 02 tiene rol de Jefe');
    console.log('='.repeat(60));
    
    let conn;
    try {
        conn = await odbc.connect(connectionString);
        console.log('✅ Conectado a la base de datos\n');

        // 1. Buscar BARTOLO en APPUSUARIOS
        console.log('📋 PASO 1: Buscar en APPUSUARIOS\n');
        const users = await conn.query(`
            SELECT ID, CODIGOUSUARIO, NOMBREUSUARIO, PASSWORD, SUBEMPRESA
            FROM DSEDAC.APPUSUARIOS
            WHERE UPPER(TRIM(NOMBREUSUARIO)) LIKE '%BARTOLO%'
               OR UPPER(TRIM(CODIGOUSUARIO)) LIKE '%BARTOLO%'
        `);
        
        console.log('Usuarios encontrados con "BARTOLO":');
        users.forEach(u => {
            console.log(`  - ID: ${u.ID}, Codigo: "${u.CODIGOUSUARIO}", Nombre: "${u.NOMBREUSUARIO}", Subempresa: ${u.SUBEMPRESA}`);
        });

        // 2. Buscar en VDC (Vendedores)
        console.log('\n📋 PASO 2: Buscar en VDC (Vendedores)\n');
        const vendedores = await conn.query(`
            SELECT V.CODIGOVENDEDOR, V.TIPOVENDEDOR, V.NOMBREVENDEDOR, V.SUBEMPRESA,
                   X.JEFEVENTASSN, X.CORREOELECTRONICO
            FROM DSEDAC.VDC V
            LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR AND V.SUBEMPRESA = X.SUBEMPRESA
            WHERE V.SUBEMPRESA = 'GMP'
              AND (UPPER(V.NOMBREVENDEDOR) LIKE '%BARTOLO%' 
                   OR UPPER(X.CORREOELECTRONICO) LIKE '%BARTOLO%')
        `);
        
        console.log('Vendedores encontrados:');
        vendedores.forEach(v => {
            console.log(`  - Codigo: ${v.CODIGOVENDEDOR}, Nombre: "${v.NOMBREVENDEDOR}"`);
            console.log(`    Tipo: ${v.TIPOVENDEDOR}, Email: ${v.CORREOELECTRONICO}`);
            console.log(`    ⭐ JEFEVENTASSN: "${v.JEFEVENTASSN}" ${v.JEFEVENTASSN === 'S' ? '← ES JEFE!' : ''}`);
        });

        // 3. Ver todos los que tienen JEFEVENTASSN = 'S'
        console.log('\n📋 PASO 3: Todos los usuarios con JEFEVENTASSN = "S"\n');
        const jefes = await conn.query(`
            SELECT V.CODIGOVENDEDOR, V.NOMBREVENDEDOR, X.JEFEVENTASSN, X.CORREOELECTRONICO
            FROM DSEDAC.VDC V
            LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR AND V.SUBEMPRESA = X.SUBEMPRESA
            WHERE V.SUBEMPRESA = 'GMP'
              AND X.JEFEVENTASSN = 'S'
        `);
        
        console.log('Usuarios marcados como JEFE en la BD:');
        jefes.forEach(j => {
            console.log(`  - Codigo: ${j.CODIGOVENDEDOR}, Nombre: "${j.NOMBREVENDEDOR}", Email: ${j.CORREOELECTRONICO}`);
        });

        // 4. Simular el login de BARTOLO 02 exactamente como lo hace auth.js
        console.log('\n📋 PASO 4: Simular login de BARTOLO (como auth.js)\n');
        
        // Buscar el usuario en APPUSUARIOS
        const bartoloUser = await conn.query(`
            SELECT ID, CODIGOUSUARIO, NOMBREUSUARIO, PASSWORD, SUBEMPRESA
            FROM DSEDAC.APPUSUARIOS
            WHERE UPPER(TRIM(CODIGOUSUARIO)) = 'BARTOLO'
              AND SUBEMPRESA = 'GMP'
        `);
        
        if (bartoloUser.length > 0) {
            const user = bartoloUser[0];
            console.log('Usuario encontrado:', user.NOMBREUSUARIO);
            
            // Extraer patrón de búsqueda (primeros 4 caracteres del nombre)
            const searchPattern = (user.NOMBREUSUARIO || '').trim().toUpperCase().substring(0, 4);
            console.log(`Patrón de búsqueda: "${searchPattern}"`);
            
            // Buscar vendedor por email
            const vendorMatch = await conn.query(`
                SELECT V.CODIGOVENDEDOR, V.TIPOVENDEDOR, V.NOMBREVENDEDOR,
                       X.JEFEVENTASSN, X.CORREOELECTRONICO
                FROM DSEDAC.VDC V
                LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR AND V.SUBEMPRESA = X.SUBEMPRESA
                WHERE V.SUBEMPRESA = 'GMP' 
                  AND UPPER(X.CORREOELECTRONICO) LIKE '%${searchPattern}%'
            `);
            
            console.log(`\nVendedores que coinciden con "${searchPattern}" en el email:`);
            vendorMatch.forEach(v => {
                console.log(`  - Codigo: ${v.CODIGOVENDEDOR}, Nombre: "${v.NOMBREVENDEDOR}"`);
                console.log(`    Email: ${v.CORREOELECTRONICO}`);
                console.log(`    ⭐ JEFEVENTASSN: "${v.JEFEVENTASSN}" ${v.JEFEVENTASSN === 'S' ? '← ESTO LO HACE JEFE!' : ''}`);
            });
        } else {
            console.log('Usuario BARTOLO no encontrado en APPUSUARIOS');
        }

        // 5. Ver la estructura de VDDX para entender el campo
        console.log('\n📋 PASO 5: Valores únicos de JEFEVENTASSN en VDDX\n');
        const valuesJefe = await conn.query(`
            SELECT DISTINCT JEFEVENTASSN, COUNT(*) as CANTIDAD
            FROM DSEDAC.VDDX
            WHERE SUBEMPRESA = 'GMP'
            GROUP BY JEFEVENTASSN
        `);
        
        console.log('Distribución de valores JEFEVENTASSN:');
        valuesJefe.forEach(v => {
            console.log(`  - "${v.JEFEVENTASSN || '(null)'}": ${v.CANTIDAD} vendedores`);
        });

        console.log('\n' + '='.repeat(60));
        console.log('FIN DE LA INVESTIGACIÓN');
        console.log('='.repeat(60));

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        if (conn) await conn.close();
        process.exit(0);
    }
}

investigate();
