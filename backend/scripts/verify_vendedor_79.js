/**
 * Script para verificar vendedor 79 y cómo se relaciona con CAC
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function verifyVendedor79() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('====== VERIFICANDO VENDEDOR 79 ======\n');
        
        // 1. Buscar en VDD (datos de vendedor)
        console.log('1. Buscando vendedor 79 en DSEDAC.VDD:');
        const vdd79 = await conn.query(`
            SELECT CODIGOVENDEDOR, TRIM(NOMBREVENDEDOR) as NOMBRE
            FROM DSEDAC.VDD
            WHERE TRIM(CODIGOVENDEDOR) = '79'
        `);
        if (vdd79.length > 0) {
            console.log(`  ✅ Encontrado: ${vdd79[0].NOMBRE} (${vdd79[0].CODIGOVENDEDOR})`);
        } else {
            console.log('  ❌ No encontrado en VDD');
        }
        
        // 2. Ver todos los vendedores que tienen documentos en CAC 2026
        console.log('\n2. Vendedores activos en CAC 2026:');
        const activeVend = await conn.query(`
            SELECT DISTINCT TRIM(CAC.CODIGOVENDEDOR) as COD,
                   TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
                   COUNT(*) as DOCS
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(CAC.CODIGOVENDEDOR) = TRIM(VDD.CODIGOVENDEDOR)
            WHERE CAC.ANODOCUMENTO = 2026
            GROUP BY TRIM(CAC.CODIGOVENDEDOR), TRIM(VDD.NOMBREVENDEDOR)
            ORDER BY DOCS DESC
            FETCH FIRST 20 ROWS ONLY
        `);
        activeVend.forEach(v => console.log(`  '${v.COD}': ${v.NOMBRE || '(sin nombre)'} - ${v.DOCS} docs`));
        
        // 3. Verificar si 79 tiene registros en CAC (cualquier año)
        console.log('\n3. Registros de vendedor 79 en CAC (todos los años):');
        const cac79 = await conn.query(`
            SELECT ANODOCUMENTO as ANO, COUNT(*) as DOCS
            FROM DSEDAC.CAC
            WHERE TRIM(CODIGOVENDEDOR) = '79'
            GROUP BY ANODOCUMENTO
            ORDER BY ANODOCUMENTO DESC
        `);
        if (cac79.length > 0) {
            cac79.forEach(r => console.log(`  Año ${r.ANO}: ${r.DOCS} documentos`));
        } else {
            console.log('  ❌ No hay registros para vendedor 79');
        }
        
        // 4. Verificar tabla VEH para repartidores
        console.log('\n4. Verificando vehículos asignados (tabla VEH):');
        try {
            const veh = await conn.query(`
                SELECT TRIM(CODIGOVENDEDOR) as VEND, TRIM(MATRICULA) as MATRICULA, TRIM(CODIGOVEHICULO) as VEH
                FROM DSEDAC.VEH
                ORDER BY CODIGOVENDEDOR
                FETCH FIRST 20 ROWS ONLY
            `);
            veh.forEach(v => console.log(`  Vendedor '${v.VEND}': Vehículo ${v.VEH} (${v.MATRICULA})`));
        } catch (e) {
            console.log('  Error accediendo a VEH:', e.message.substring(0, 80));
        }
        
        // 5. Ver si hay vendedor 79 en VDC
        console.log('\n5. Verificando VDC para vendedor 79:');
        const vdc79 = await conn.query(`
            SELECT TRIM(CODIGOVENDEDOR) as COD, TRIM(SUBEMPRESA) as SUB, TIPOVENDEDOR
            FROM DSEDAC.VDC
            WHERE TRIM(CODIGOVENDEDOR) = '79'
        `);
        if (vdc79.length > 0) {
            vdc79.forEach(v => console.log(`  Vendedor 79 en subempresa ${v.SUB}: tipo ${v.TIPOVENDEDOR}`));
        } else {
            console.log('  ❌ Vendedor 79 no encontrado en VDC');
        }
        
        // 6. Mostrar todos los vendedores en VDD
        console.log('\n6. Todos los vendedores en VDD:');
        const allVdd = await conn.query(`
            SELECT TRIM(CODIGOVENDEDOR) as COD, TRIM(NOMBREVENDEDOR) as NOMBRE
            FROM DSEDAC.VDD
            ORDER BY CODIGOVENDEDOR
            FETCH FIRST 50 ROWS ONLY
        `);
        allVdd.forEach(v => console.log(`  '${v.COD}': ${v.NOMBRE}`));
        
        console.log('\n====== FIN VERIFICACIÓN ======');
        
    } finally {
        await conn.close();
    }
}

verifyVendedor79().catch(err => {
    console.error('Error fatal:', err.message);
    process.exit(1);
});
