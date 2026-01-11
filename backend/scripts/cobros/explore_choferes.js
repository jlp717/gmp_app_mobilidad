/**
 * EXPLORAR TABLAS DE CHOFERES/EMPLEADOS/REPARTIDORES
 * 
 * Ejecutar: node scripts/cobros/explore_choferes.js
 */

const odbc = require('odbc');
const fs = require('fs');
require('dotenv').config();

const connectionString = `DSN=GMP;UID=${process.env.ODBC_UID};PWD=${process.env.ODBC_PWD};NAM=1;`;

async function explorarChoferes() {
    let conn;
    const resultados = {};

    try {
        console.log('🔌 Conectando a la base de datos...\n');
        conn = await odbc.connect(connectionString);

        // ============================================
        // 1. TABLA CHO (CHOFERES/CONDUCTORES)
        // ============================================
        console.log('═'.repeat(70));
        console.log('1. TABLA DSEDAC.CHO (CHOFERES)');
        console.log('═'.repeat(70));

        try {
            // Estructura
            const choCols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CHO'
        ORDER BY ORDINAL_POSITION
      `);
            console.log('Columnas de CHO:');
            console.table(choCols);
            resultados.cho_columnas = choCols;

            // Contenido
            const choData = await conn.query(`SELECT * FROM DSEDAC.CHO FETCH FIRST 30 ROWS ONLY`);
            console.log('\nContenido de CHO:');
            console.log(JSON.stringify(choData, null, 2));
            resultados.cho_data = choData;
        } catch (e) {
            console.log('Error con CHO:', e.message);
        }

        // ============================================
        // 2. TABLA EMP (EMPLEADOS)
        // ============================================
        console.log('\n' + '═'.repeat(70));
        console.log('2. TABLA DSEDAC.EMP (EMPLEADOS)');
        console.log('═'.repeat(70));

        try {
            const empCols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'EMP'
        ORDER BY ORDINAL_POSITION
      `);
            console.log('Columnas de EMP:');
            console.table(empCols);
            resultados.emp_columnas = empCols;

            const empData = await conn.query(`SELECT * FROM DSEDAC.EMP FETCH FIRST 30 ROWS ONLY`);
            console.log('\nContenido de EMP:');
            console.log(JSON.stringify(empData, null, 2));
            resultados.emp_data = empData;
        } catch (e) {
            console.log('Error con EMP:', e.message);
        }

        // ============================================
        // 3. VISTA DSEMOVIL.EMPLEADOS
        // ============================================
        console.log('\n' + '═'.repeat(70));
        console.log('3. VISTA DSEMOVIL.EMPLEADOS');
        console.log('═'.repeat(70));

        try {
            const empMovilCols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEMOVIL' AND TABLE_NAME = 'EMPLEADOS'
        ORDER BY ORDINAL_POSITION
      `);
            console.log('Columnas:');
            console.table(empMovilCols);

            const empMovilData = await conn.query(`SELECT * FROM DSEMOVIL.EMPLEADOS FETCH FIRST 30 ROWS ONLY`);
            console.log('\nContenido:');
            console.log(JSON.stringify(empMovilData, null, 2));
            resultados.dsemovil_empleados = empMovilData;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // 4. VISTA DSEMOVIL.REPARTOS
        // ============================================
        console.log('\n' + '═'.repeat(70));
        console.log('4. VISTA DSEMOVIL.REPARTOS');
        console.log('═'.repeat(70));

        try {
            const repCols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEMOVIL' AND TABLE_NAME = 'REPARTOS'
        ORDER BY ORDINAL_POSITION
      `);
            console.log('Columnas:');
            console.table(repCols);
            resultados.repartos_columnas = repCols;

            const repData = await conn.query(`SELECT * FROM DSEMOVIL.REPARTOS FETCH FIRST 20 ROWS ONLY`);
            console.log('\nMuestra:');
            console.log(JSON.stringify(repData, null, 2));
            resultados.repartos_data = repData;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // 5. VISTA DSEMOVIL.TRANSPORTI (TRANSPORTISTAS)
        // ============================================
        console.log('\n' + '═'.repeat(70));
        console.log('5. VISTA DSEMOVIL.TRANSPORTI');
        console.log('═'.repeat(70));

        try {
            const transCols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEMOVIL' AND TABLE_NAME = 'TRANSPORTI'
        ORDER BY ORDINAL_POSITION
      `);
            console.log('Columnas:');
            console.table(transCols);

            const transData = await conn.query(`SELECT * FROM DSEMOVIL.TRANSPORTI FETCH FIRST 30 ROWS ONLY`);
            console.log('\nContenido:');
            console.log(JSON.stringify(transData, null, 2));
            resultados.transportistas = transData;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // 6. TABLA VEH (VEHÍCULOS)
        // ============================================
        console.log('\n' + '═'.repeat(70));
        console.log('6. TABLA DSEDAC.VEH (VEHÍCULOS)');
        console.log('═'.repeat(70));

        try {
            const vehData = await conn.query(`SELECT * FROM DSEDAC.VEH FETCH FIRST 20 ROWS ONLY`);
            console.log(JSON.stringify(vehData, null, 2));
            resultados.vehiculos = vehData;
        } catch (e) {
            console.log('Error:', e.message);
        }

        // ============================================
        // GUARDAR
        // ============================================
        fs.writeFileSync('resultados_choferes.json', JSON.stringify(resultados, null, 2));
        console.log('\n✅ Resultados guardados en: resultados_choferes.json');

    } catch (error) {
        console.error('❌ Error general:', error);
    } finally {
        if (conn) await conn.close();
        console.log('\n🔌 Conexión cerrada');
    }
}

explorarChoferes();
