/**
 * Script de Corrección: Asignar Cliente 4300008335 a Bartolo (02)
 * 
 * Problema: El cliente aparece en LACLAE asignado a múltiples vendedores.
 * Solución: Crear un override en JAVIER.RUTERO_CONFIG.
 */

const { query, initDb } = require('../config/db');

async function fixClientAssignment() {
    console.log('='.repeat(60));
    console.log('FIX: Asignar Taberna la Esquinica (4300008335) a Bartolo (02)');
    console.log('='.repeat(60));

    try {
        await initDb();

        const clientCode = '4300008335';
        const targetVendor = '02'; // Bartolo
        const visitDay = 'miercoles'; // Según diagnóstico
        const order = 1; // Prioridad alta

        // 1. Verificar si ya existe override
        const check = await query(`
            SELECT * FROM JAVIER.RUTERO_CONFIG 
            WHERE CLIENTE = '${clientCode}'
        `);

        if (check.length > 0) {
            console.log(`ℹ Ya existe configuración para este cliente:`, check[0]);

            // Update
            await query(`
                UPDATE JAVIER.RUTERO_CONFIG
                SET VENDEDOR = '${targetVendor}', DIA = '${visitDay}', ORDEN = ${order}
                WHERE CLIENTE = '${clientCode}'
            `);
            console.log(`✅ Registro ACTUALIZADO a Vendedor ${targetVendor} (${visitDay})`);
        } else {
            // Insert
            await query(`
                INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, CLIENTE, DIA, ORDEN)
                VALUES ('${targetVendor}', '${clientCode}', '${visitDay}', ${order})
            `);
            console.log(`✅ Registro INSERTADO: Vendedor ${targetVendor} (${visitDay})`);
        }

    } catch (error) {
        console.error('❌ Error aplicando corrección:', error.message);
    }

    process.exit(0);
}

fixClientAssignment();
