require('dotenv').config();
const { initDb, query } = require('../config/db');

async function investigateClientData() {
    try {
        await initDb();
        
        // 1. Ver columnas de DSEMOVIL.CLIENTES (donde están las coordenadas)
        console.log('\n=== Columnas de DSEMOVIL.CLIENTES ===\n');
        const colsMovil = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH 
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_NAME = 'CLIENTES' AND TABLE_SCHEMA = 'DSEMOVIL' 
            ORDER BY ORDINAL_POSITION
        `);
        colsMovil.forEach(col => {
            console.log(`${(col.COLUMN_NAME || '').padEnd(25)} ${(col.DATA_TYPE || '').padEnd(15)} ${col.LENGTH || ''}`);
        });
        
        // 2. Ver datos de ejemplo de coordenadas
        console.log('\n=== Ejemplo de coordenadas (DSEMOVIL.CLIENTES) ===\n');
        const coordsExample = await query(`
            SELECT CODIGO, LATITUD, LONGITUD 
            FROM DSEMOVIL.CLIENTES 
            WHERE LATITUD IS NOT NULL AND LATITUD <> 0
            FETCH FIRST 10 ROWS ONLY
        `);
        coordsExample.forEach(row => {
            console.log(`CODIGO: ${row.CODIGO} | LAT: ${row.LATITUD} | LON: ${row.LONGITUD}`);
        });
        
        // 3. Ver teléfonos de ejemplo
        console.log('\n=== Ejemplo de teléfonos (DSEDAC.CLI) ===\n');
        const phonesExample = await query(`
            SELECT CODIGOCLIENTE, TELEFONO1, TELEFONO2, TELEFONOFAX
            FROM DSEDAC.CLI 
            WHERE TELEFONO1 IS NOT NULL AND TRIM(TELEFONO1) <> ''
            FETCH FIRST 10 ROWS ONLY
        `);
        phonesExample.forEach(row => {
            console.log(`CLIENTE: ${row.CODIGOCLIENTE?.trim()} | TEL1: "${row.TELEFONO1?.trim()}" | TEL2: "${row.TELEFONO2?.trim()}" | FAX: "${row.TELEFONOFAX?.trim()}"`);
        });
        
        // 4. Verificar cliente específico 4300032150 (el que decía "no tenía día")
        console.log('\n=== Cliente 4300032150 en RUTERO_CONFIG ===\n');
        const clientRutero = await query(`
            SELECT * FROM JAVIER.RUTERO_CONFIG 
            WHERE CLIENTE = '4300032150' OR TRIM(CLIENTE) = '4300032150'
        `);
        if (clientRutero.length > 0) {
            clientRutero.forEach(row => console.log(row));
        } else {
            console.log('No encontrado en RUTERO_CONFIG');
        }
        
        // 5. Ver si ese cliente existe en LACLAE (días de visita originales)
        console.log('\n=== Cliente 4300032150 días en LACLAE (vendedor 81) ===\n');
        const clientLaclae = await query(`
            SELECT DISTINCT DAYNAME(DATE(CONCAT(CONCAT(CONCAT(CHAR(L.LCAADC), '-'), 
                   LPAD(CHAR(L.LCMMDC), 2, '0')), CONCAT('-', LPAD(CHAR(L.LCDDDC), 2, '0'))))) as DIA
            FROM DSED.LACLAE L
            WHERE L.LCCDCL = '4300032150' 
              AND L.LCCDVE = '81'
              AND L.LCAADC = 2026
            FETCH FIRST 20 ROWS ONLY
        `);
        if (clientLaclae.length > 0) {
            clientLaclae.forEach(row => console.log(`Día visita: ${row.DIA}`));
        } else {
            console.log('No hay ventas en 2026');
        }
        
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

investigateClientData();
