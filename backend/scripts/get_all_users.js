/**
 * Script para obtener TODOS los usuarios de la app con sus contraseñas
 * y vendedores con su información
 */

const odbc = require('odbc');

async function main() {
    console.log('Conectando a base de datos GMP...');

    try {
        const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');
        console.log('Conexión exitosa!\n');

        // 1. USUARIOS DE LA APP
        console.log('='.repeat(60));
        console.log('USUARIOS DE LA APP (DSEDAC.APPUSUARIOS)');
        console.log('='.repeat(60));
        console.log('USUARIO    | NOMBRE                    | CONTRASEÑA');
        console.log('-'.repeat(60));

        try {
            const users = await conn.query(`
        SELECT CODIGOUSUARIO, NOMBREUSUARIO, PASSWORD, DELEGACION, GRUPO
        FROM DSEDAC.APPUSUARIOS
        WHERE SUBEMPRESA = 'GMP'
        ORDER BY CODIGOUSUARIO
      `);

            users.forEach(u => {
                const cod = (u.CODIGOUSUARIO || '').trim().padEnd(10);
                const nom = (u.NOMBREUSUARIO || '').trim().padEnd(25);
                const pwd = (u.PASSWORD || '').trim();
                console.log(`${cod} | ${nom} | ${pwd}`);
            });
            console.log(`\nTotal usuarios: ${users.length}`);
        } catch (e) {
            console.log('Error consultando usuarios:', e.message);
        }

        // 2. VENDEDORES
        console.log('\n' + '='.repeat(60));
        console.log('VENDEDORES (DSEDAC.VDC + VDDX)');
        console.log('='.repeat(60));
        console.log('CODIGO | TIPO | JEFE | EMAIL');
        console.log('-'.repeat(60));

        try {
            const vendedores = await conn.query(`
        SELECT V.CODIGOVENDEDOR, V.TIPOVENDEDOR, X.JEFEVENTASSN, X.CORREOELECTRONICO
        FROM DSEDAC.VDC V
        LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
        WHERE V.SUBEMPRESA = 'GMP'
        ORDER BY V.CODIGOVENDEDOR
      `);

            vendedores.forEach(v => {
                const cod = (v.CODIGOVENDEDOR || '').trim().padEnd(6);
                const tipo = (v.TIPOVENDEDOR || '-').padEnd(4);
                const jefe = v.JEFEVENTASSN === 'S' ? 'SI  ' : 'NO  ';
                const email = (v.CORREOELECTRONICO || '-').trim();
                console.log(`${cod} | ${tipo} | ${jefe} | ${email}`);
            });
            console.log(`\nTotal vendedores: ${vendedores.length}`);
        } catch (e) {
            console.log('Error consultando vendedores:', e.message);
        }

        // 3. VERIFICAR DSED.LACLAE
        console.log('\n' + '='.repeat(60));
        console.log('VERIFICACIÓN DSED.LACLAE (Rutero)');
        console.log('='.repeat(60));

        try {
            const laclae = await conn.query(`
        SELECT COUNT(*) as total FROM DSED.LACLAE WHERE TIPO_LINEA = 'T'
      `);
            console.log('Total registros LACLAE (TIPO_LINEA=T):', laclae[0]?.TOTAL || 0);

            // Probar query de días
            const diasQuery = await conn.query(`
        SELECT 
          SUM(CASE WHEN R1_T8DIVL = 'S' THEN 1 ELSE 0 END) as lunes,
          SUM(CASE WHEN R1_T8DIVM = 'S' THEN 1 ELSE 0 END) as martes,
          SUM(CASE WHEN R1_T8DIVX = 'S' THEN 1 ELSE 0 END) as miercoles,
          SUM(CASE WHEN R1_T8DIVJ = 'S' THEN 1 ELSE 0 END) as jueves,
          SUM(CASE WHEN R1_T8DIVV = 'S' THEN 1 ELSE 0 END) as viernes
        FROM DSED.LACLAE 
        WHERE TIPO_LINEA = 'T'
      `);
            console.log('Clientes por día:');
            console.log('  Lunes:', diasQuery[0]?.LUNES || 0);
            console.log('  Martes:', diasQuery[0]?.MARTES || 0);
            console.log('  Miércoles:', diasQuery[0]?.MIERCOLES || 0);
            console.log('  Jueves:', diasQuery[0]?.JUEVES || 0);
            console.log('  Viernes:', diasQuery[0]?.VIERNES || 0);
        } catch (e) {
            console.log('Error verificando LACLAE:', e.message);
        }

        await conn.close();
        console.log('\n✅ Script completado');

    } catch (e) {
        console.error('Error de conexión:', e.message);
    }
}

main();
