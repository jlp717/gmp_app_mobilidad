/**
 * Get users/passwords and find clients with different visit vs delivery days
 * Run with: node find_visit_delivery_diff.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function investigate() {
    console.log('='.repeat(80));
    console.log('USUARIOS Y CLIENTES CON VISITA ≠ REPARTO');
    console.log('='.repeat(80));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. Get all users with passwords
        console.log('\n1. 👤 USUARIOS Y CONTRASEÑAS PARA LOGIN:');
        console.log('-'.repeat(70));

        try {
            const users = await conn.query(`
        SELECT 
          CODIGOUSUARIO, 
          PASSWORD,
          CODIGOVENDEDOR,
          NOMBREUSUARIO,
          TIPOROL
        FROM DSEDAC.VDDX
        WHERE CODIGOUSUARIO IS NOT NULL
        ORDER BY CODIGOVENDEDOR
        FETCH FIRST 30 ROWS ONLY
      `);

            console.log('Usuario        | Contraseña      | Cod.Vendedor | Nombre                    | Rol');
            console.log('-'.repeat(90));
            users.forEach(u => {
                const user = (u.CODIGOUSUARIO || '').trim().padEnd(14);
                const pass = (u.PASSWORD || '').trim().padEnd(15);
                const vend = (u.CODIGOVENDEDOR || '').trim().padEnd(12);
                const name = (u.NOMBREUSUARIO || '').trim().substring(0, 25).padEnd(25);
                const rol = (u.TIPOROL || '').trim();
                console.log(`${user} | ${pass} | ${vend} | ${name} | ${rol}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 2. Find clients with different visit vs delivery days for DOMINGO (33)
        console.log('\n\n2. 📅 CLIENTES DE DOMINGO (33) CON VISITA ≠ REPARTO:');
        console.log('-'.repeat(70));

        try {
            const different = await conn.query(`
        SELECT DISTINCT
          L.LCCDCL as CODIGO,
          COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) as RAZON_SOCIAL,
          L.R1_T8DIVL as VIS_L, L.R1_T8DIVM as VIS_M, L.R1_T8DIVX as VIS_X, 
          L.R1_T8DIVJ as VIS_J, L.R1_T8DIVV as VIS_V,
          L.R1_T8DIRL as REP_L, L.R1_T8DIRM as REP_M, L.R1_T8DIRX as REP_X,
          L.R1_T8DIRJ as REP_J, L.R1_T8DIRV as REP_V
        FROM DSED.LACLAE L
        LEFT JOIN DSEDAC.CLI C ON L.LCCDCL = C.CODIGOCLIENTE
        WHERE L.R1_T8CDVD = '33'
          AND (
            L.R1_T8DIVL <> L.R1_T8DIRL OR
            L.R1_T8DIVM <> L.R1_T8DIRM OR
            L.R1_T8DIVX <> L.R1_T8DIRX OR
            L.R1_T8DIVJ <> L.R1_T8DIRJ OR
            L.R1_T8DIVV <> L.R1_T8DIRV
          )
        FETCH FIRST 20 ROWS ONLY
      `);

            if (different.length === 0) {
                console.log('  No se encontraron clientes con días diferentes');
            } else {
                console.log(`  Encontrados ${different.length} clientes:\n`);
                different.forEach(r => {
                    const dias = ['L', 'M', 'X', 'J', 'V'];
                    let visitaDias = [];
                    let repartoDias = [];

                    if (r.VIS_L === 'S') visitaDias.push('Lunes');
                    if (r.VIS_M === 'S') visitaDias.push('Martes');
                    if (r.VIS_X === 'S') visitaDias.push('Miércoles');
                    if (r.VIS_J === 'S') visitaDias.push('Jueves');
                    if (r.VIS_V === 'S') visitaDias.push('Viernes');

                    if (r.REP_L === 'S') repartoDias.push('Lunes');
                    if (r.REP_M === 'S') repartoDias.push('Martes');
                    if (r.REP_X === 'S') repartoDias.push('Miércoles');
                    if (r.REP_J === 'S') repartoDias.push('Jueves');
                    if (r.REP_V === 'S') repartoDias.push('Viernes');

                    console.log(`  📍 ${r.CODIGO?.trim()} - ${r.RAZON_SOCIAL?.trim()}`);
                    console.log(`     Visita:  ${visitaDias.join(', ') || 'Ninguno'}`);
                    console.log(`     Reparto: ${repartoDias.join(', ') || 'Ninguno'}`);
                    console.log('');
                });
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 3. Check if these clients exist in LAC (sales data) for 2024
        console.log('\n3. 🔍 VERIFICANDO SI ESTOS CLIENTES TIENEN VENTAS EN 2024:');
        console.log('-'.repeat(70));

        try {
            const sales = await conn.query(`
        SELECT 
          L.CODIGOCLIENTEALBARAN as CODIGO,
          COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) as RAZON_SOCIAL,
          SUM(L.IMPORTEVENTA) as VENTAS
        FROM DSEDAC.LAC L
        JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
        WHERE L.CODIGOVENDEDOR = '33' AND L.ANODOCUMENTO = 2024
        GROUP BY L.CODIGOCLIENTEALBARAN, C.NOMBREALTERNATIVO, C.NOMBRECLIENTE
        ORDER BY VENTAS DESC
        FETCH FIRST 15 ROWS ONLY
      `);

            console.log('  Top 15 clientes de DOMINGO en 2024:\n');
            sales.forEach((s, i) => {
                console.log(`  ${i + 1}. ${s.CODIGO?.trim()} - ${s.RAZON_SOCIAL?.trim().substring(0, 40)} - ${parseFloat(s.VENTAS).toLocaleString('es-ES')}€`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 4. Check other vendedors for clients with different days
        console.log('\n\n4. 📊 OTROS VENDEDORES CON CLIENTES VISITA ≠ REPARTO:');
        console.log('-'.repeat(70));

        try {
            const byVendor = await conn.query(`
        SELECT 
          R1_T8CDVD as VENDEDOR,
          COUNT(DISTINCT LCCDCL) as CLIENTES_DIFERENTES
        FROM DSED.LACLAE
        WHERE (
            R1_T8DIVL <> R1_T8DIRL OR
            R1_T8DIVM <> R1_T8DIRM OR
            R1_T8DIVX <> R1_T8DIRX OR
            R1_T8DIVJ <> R1_T8DIRJ OR
            R1_T8DIVV <> R1_T8DIRV
          )
        GROUP BY R1_T8CDVD
        ORDER BY CLIENTES_DIFERENTES DESC
        FETCH FIRST 15 ROWS ONLY
      `);

            console.log('  Vendedor | Clientes con días diferentes');
            console.log('  ' + '-'.repeat(40));
            byVendor.forEach(v => {
                console.log(`  ${(v.VENDEDOR || '').trim().padEnd(8)} | ${v.CLIENTES_DIFERENTES}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        console.log('\n' + '='.repeat(80));
        console.log('INVESTIGACIÓN COMPLETA');
        console.log('='.repeat(80));

    } catch (error) {
        console.error('Error de conexión:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

investigate().catch(console.error);
