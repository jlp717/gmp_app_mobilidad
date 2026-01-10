/**
 * Script de REVERSIÓN: Eliminar override de cliente 4300008335
 * 
 * Se elimina la asignación forzada para dejar el dato original.
 */

const { query, initDb } = require('../config/db');

async function revertClientAssignment() {
    console.log('='.repeat(60));
    console.log('REVERT: Eliminar override de Taberna la Esquinica (4300008335)');
    console.log('='.repeat(60));

    try {
        await initDb();
        const clientCode = '4300008335';

        // Delete
        await query(`
            DELETE FROM JAVIER.RUTERO_CONFIG
            WHERE CLIENTE = '${clientCode}'
        `);
        console.log(`✅ Registro ELIMINADO de RUTERO_CONFIG.`);
        console.log(`Ahora el cliente volverá a usar el vendedor definido en sus datos de origen.`);

    } catch (error) {
        console.error('❌ Error revirtiendo:', error.message);
    }

    process.exit(0);
}

revertClientAssignment();
