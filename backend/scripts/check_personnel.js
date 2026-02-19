/**
 * Check and seed ALMACEN_PERSONAL
 */
const { query } = require('../config/db');

async function main() {
    console.log('Checking JAVIER.ALMACEN_PERSONAL...');

    try {
        const rows = await query(`SELECT * FROM JAVIER.ALMACEN_PERSONAL`);
        console.log(`Found ${rows.length} rows.`);

        if (rows.length === 0) {
            console.log('Seeding initial personnel data...');
            await query(`
        INSERT INTO JAVIER.ALMACEN_PERSONAL 
        (NOMBRE, CODIGO_VENDEDOR, ROL, ACTIVO, TELEFONO, CREATED_AT)
        VALUES 
        ('Juan Pérez', '901', 'PREPARADOR', 'S', '600123456', CURRENT_TIMESTAMP),
        ('María García', '902', 'JEFE_TURNO', 'S', '600654321', CURRENT_TIMESTAMP),
        ('Carlos Ruiz', '903', 'CARRETILLERO', 'S', '600987654', CURRENT_TIMESTAMP),
        ('Ana López', '904', 'PREPARADOR', 'S', '600111222', CURRENT_TIMESTAMP)
      `);
            console.log('Seeded 4 rows.');
        } else {
            console.log('Sample:', rows[0]);
        }
    } catch (e) {
        console.error('Error:', e.message);
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
