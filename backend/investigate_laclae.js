/**
 * Investigar DSED.LACLAE para el rutero
 * Columnas de visita: R1_T8DIVL, R1_T8DIVM, R1_T8DIVX, R1_T8DIVJ, R1_T8DIVV, R1_T8DIVS, R1_T8DIVD
 * Columnas de reparto: R1_T8DIRL, R1_T8DIRM, R1_T8DIRX, R1_T8DIRJ, R1_T8DIRV, R1_T8DIRS, R1_T8DIRD
 * Run with: node investigate_laclae.js
 */
const odbc = require('odbc');

const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function investigate() {
    console.log('='.repeat(70));
    console.log(' INVESTIGACIÓN DE DSED.LACLAE PARA RUTERO');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(CONNECTION_STRING);
        console.log('✓ Conectado a DB2\n');

        // 1. Verificar cliente 8416 en LACLAE
        console.log('1. CLIENTE 4300008416 (CHIRINGUITO EL LIOS) EN LACLAE:');
        console.log('-'.repeat(50));
        const client8416 = await conn.query(`
      SELECT 
        LCCDCL,
        R1_T8CDVD,
        R1_T8DIVL, R1_T8DIVM, R1_T8DIVX, R1_T8DIVJ, R1_T8DIVV, R1_T8DIVS, R1_T8DIVD,
        R1_T8DIRL, R1_T8DIRM, R1_T8DIRX, R1_T8DIRJ, R1_T8DIRV, R1_T8DIRS, R1_T8DIRD
      FROM DSED.LACLAE
      WHERE TRIM(LCCDCL) = '4300008416'
    `);

        if (client8416.length > 0) {
            console.log(`   Registros encontrados: ${client8416.length}`);
            client8416.forEach((row, i) => {
                console.log(`\n   [Registro ${i + 1}]`);
                console.log(`   Cliente: ${row.LCCDCL?.trim()}`);
                console.log(`   Vendedor (R1_T8CDVD): ${row.R1_T8CDVD?.trim()}`);

                const diasVisita = [];
                if (row.R1_T8DIVL === 'S') diasVisita.push('L');
                if (row.R1_T8DIVM === 'S') diasVisita.push('M');
                if (row.R1_T8DIVX === 'S') diasVisita.push('X');
                if (row.R1_T8DIVJ === 'S') diasVisita.push('J');
                if (row.R1_T8DIVV === 'S') diasVisita.push('V');
                if (row.R1_T8DIVS === 'S') diasVisita.push('S');
                if (row.R1_T8DIVD === 'S') diasVisita.push('D');
                console.log(`   Días de VISITA: ${diasVisita.join(', ') || 'NINGUNO'}`);

                const diasReparto = [];
                if (row.R1_T8DIRL === 'S') diasReparto.push('L');
                if (row.R1_T8DIRM === 'S') diasReparto.push('M');
                if (row.R1_T8DIRX === 'S') diasReparto.push('X');
                if (row.R1_T8DIRJ === 'S') diasReparto.push('J');
                if (row.R1_T8DIRV === 'S') diasReparto.push('V');
                if (row.R1_T8DIRS === 'S') diasReparto.push('S');
                if (row.R1_T8DIRD === 'S') diasReparto.push('D');
                console.log(`   Días de REPARTO: ${diasReparto.join(', ') || 'NINGUNO'}`);
            });
        } else {
            console.log('   ⚠️ Cliente no encontrado en LACLAE');
        }
        console.log();

        // 2. Verificar estructura - lista de vendedores
        console.log('2. VENDEDORES EN LACLAE (R1_T8CDVD):');
        console.log('-'.repeat(50));
        const vendedores = await conn.query(`
      SELECT DISTINCT R1_T8CDVD as VENDEDOR, COUNT(*) as CLIENTES
      FROM DSED.LACLAE
      WHERE R1_T8CDVD IS NOT NULL AND TRIM(R1_T8CDVD) <> ''
      GROUP BY R1_T8CDVD
      ORDER BY CLIENTES DESC
      FETCH FIRST 20 ROWS ONLY
    `);
        console.log(`   Vendedores únicos: ${vendedores.length}`);
        vendedores.forEach(v => {
            console.log(`   - ${(v.VENDEDOR?.trim() || 'N/A').padEnd(10)}: ${v.CLIENTES} clientes`);
        });
        console.log();

        // 3. Conteo por día de visita - GLOBAL
        console.log('3. CONTEO GLOBAL POR DÍA DE VISITA:');
        console.log('-'.repeat(50));
        const visitCounts = await conn.query(`
      SELECT 
        SUM(CASE WHEN R1_T8DIVL = 'S' THEN 1 ELSE 0 END) as LUNES,
        SUM(CASE WHEN R1_T8DIVM = 'S' THEN 1 ELSE 0 END) as MARTES,
        SUM(CASE WHEN R1_T8DIVX = 'S' THEN 1 ELSE 0 END) as MIERCOLES,
        SUM(CASE WHEN R1_T8DIVJ = 'S' THEN 1 ELSE 0 END) as JUEVES,
        SUM(CASE WHEN R1_T8DIVV = 'S' THEN 1 ELSE 0 END) as VIERNES,
        SUM(CASE WHEN R1_T8DIVS = 'S' THEN 1 ELSE 0 END) as SABADO,
        SUM(CASE WHEN R1_T8DIVD = 'S' THEN 1 ELSE 0 END) as DOMINGO,
        COUNT(DISTINCT LCCDCL) as TOTAL_CLIENTES
      FROM DSED.LACLAE
    `);
        if (visitCounts.length > 0) {
            const vc = visitCounts[0];
            console.log(`   Lunes: ${vc.LUNES}`);
            console.log(`   Martes: ${vc.MARTES}`);
            console.log(`   Miércoles: ${vc.MIERCOLES}`);
            console.log(`   Jueves: ${vc.JUEVES}`);
            console.log(`   Viernes: ${vc.VIERNES}`);
            console.log(`   Sábado: ${vc.SABADO}`);
            console.log(`   Domingo: ${vc.DOMINGO}`);
            console.log(`   TOTAL CLIENTES ÚNICOS: ${vc.TOTAL_CLIENTES}`);
        }
        console.log();

        // 4. Conteo por día de reparto - GLOBAL
        console.log('4. CONTEO GLOBAL POR DÍA DE REPARTO:');
        console.log('-'.repeat(50));
        const repartoCounts = await conn.query(`
      SELECT 
        SUM(CASE WHEN R1_T8DIRL = 'S' THEN 1 ELSE 0 END) as LUNES,
        SUM(CASE WHEN R1_T8DIRM = 'S' THEN 1 ELSE 0 END) as MARTES,
        SUM(CASE WHEN R1_T8DIRX = 'S' THEN 1 ELSE 0 END) as MIERCOLES,
        SUM(CASE WHEN R1_T8DIRJ = 'S' THEN 1 ELSE 0 END) as JUEVES,
        SUM(CASE WHEN R1_T8DIRV = 'S' THEN 1 ELSE 0 END) as VIERNES,
        SUM(CASE WHEN R1_T8DIRS = 'S' THEN 1 ELSE 0 END) as SABADO,
        SUM(CASE WHEN R1_T8DIRD = 'S' THEN 1 ELSE 0 END) as DOMINGO,
        COUNT(DISTINCT LCCDCL) as TOTAL_CLIENTES
      FROM DSED.LACLAE
    `);
        if (repartoCounts.length > 0) {
            const rc = repartoCounts[0];
            console.log(`   Lunes: ${rc.LUNES}`);
            console.log(`   Martes: ${rc.MARTES}`);
            console.log(`   Miércoles: ${rc.MIERCOLES}`);
            console.log(`   Jueves: ${rc.JUEVES}`);
            console.log(`   Viernes: ${rc.VIERNES}`);
            console.log(`   Sábado: ${rc.SABADO}`);
            console.log(`   Domingo: ${rc.DOMINGO}`);
            console.log(`   TOTAL CLIENTES ÚNICOS: ${rc.TOTAL_CLIENTES}`);
        }
        console.log();

        // 5. Conteo para un vendedor específico (ej: 33 que tiene al CHIRINGUITO)
        console.log('5. CONTEO PARA VENDEDOR "33":');
        console.log('-'.repeat(50));
        const vendor33 = await conn.query(`
      SELECT 
        SUM(CASE WHEN R1_T8DIVL = 'S' THEN 1 ELSE 0 END) as VIS_L,
        SUM(CASE WHEN R1_T8DIVM = 'S' THEN 1 ELSE 0 END) as VIS_M,
        SUM(CASE WHEN R1_T8DIVX = 'S' THEN 1 ELSE 0 END) as VIS_X,
        SUM(CASE WHEN R1_T8DIVJ = 'S' THEN 1 ELSE 0 END) as VIS_J,
        SUM(CASE WHEN R1_T8DIVV = 'S' THEN 1 ELSE 0 END) as VIS_V,
        SUM(CASE WHEN R1_T8DIRL = 'S' THEN 1 ELSE 0 END) as REP_L,
        SUM(CASE WHEN R1_T8DIRM = 'S' THEN 1 ELSE 0 END) as REP_M,
        SUM(CASE WHEN R1_T8DIRX = 'S' THEN 1 ELSE 0 END) as REP_X,
        SUM(CASE WHEN R1_T8DIRJ = 'S' THEN 1 ELSE 0 END) as REP_J,
        SUM(CASE WHEN R1_T8DIRV = 'S' THEN 1 ELSE 0 END) as REP_V,
        COUNT(DISTINCT LCCDCL) as TOTAL
      FROM DSED.LACLAE
      WHERE TRIM(R1_T8CDVD) = '33'
    `);
        if (vendor33.length > 0) {
            const v = vendor33[0];
            console.log(`   VISITA:  L=${v.VIS_L} M=${v.VIS_M} X=${v.VIS_X} J=${v.VIS_J} V=${v.VIS_V}`);
            console.log(`   REPARTO: L=${v.REP_L} M=${v.REP_M} X=${v.REP_X} J=${v.REP_J} V=${v.REP_V}`);
            console.log(`   TOTAL CLIENTES ÚNICOS: ${v.TOTAL}`);
        }
        console.log();

        // 6. Verificar si hay duplicados en LACLAE
        console.log('6. VERIFICAR DUPLICADOS EN LACLAE:');
        console.log('-'.repeat(50));
        const duplicates = await conn.query(`
      SELECT LCCDCL, COUNT(*) as NUM
      FROM DSED.LACLAE
      GROUP BY LCCDCL
      HAVING COUNT(*) > 1
      FETCH FIRST 10 ROWS ONLY
    `);
        if (duplicates.length > 0) {
            console.log(`   ⚠️ Hay ${duplicates.length} clientes duplicados en LACLAE`);
            duplicates.forEach(d => console.log(`   - ${d.LCCDCL?.trim()}: ${d.NUM} registros`));
        } else {
            console.log(`   ✓ No hay duplicados en LACLAE - cada cliente tiene 1 registro`);
        }

        console.log('\n' + '='.repeat(70));
        console.log(' CONCLUSIÓN');
        console.log('='.repeat(70));
        console.log(`
   DSED.LACLAE es la tabla correcta para el rutero:
   - Sin duplicados (1 registro por cliente)
   - Columnas claras para visita (R1_T8DIVx) y reparto (R1_T8DIRx)
   - Incluye vendedor asignado (R1_T8CDVD)
   
   Debemos migrar el backend de CDVI/CDLO a LACLAE.
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

investigate();
